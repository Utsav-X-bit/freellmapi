import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../../app.js';
import { initDb, getDb, getUnifiedApiKey } from '../../db/index.js';
import { mintDashboardToken, isGatedApiPath } from '../helpers/auth.js';
import { clearReasoningMemory } from '../../routes/proxy.js';

let dashToken = '';

async function request(app: Express, method: string, path: string, body?: any, headers: Record<string, string> = {}) {
  const server = app.listen(0, '127.0.0.1');
  if (!server.listening) await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const addr = server.address() as any;
  const url = `http://127.0.0.1:${addr.port}${path}`;

  const res = await fetch(url, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(isGatedApiPath(path) && !('Authorization' in headers) ? { Authorization: `Bearer ${dashToken}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.text();
  server.close();

  let json: any = null;
  try { json = JSON.parse(data); } catch {}

  return { status: res.status, body: json, headers: res.headers, raw: data };
}

function authHeaders() {
  return { Authorization: `Bearer ${getUnifiedApiKey()}` };
}

describe('Proxy tool-calling support', () => {
  let app: Express;

  beforeAll(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    app = createApp();
    dashToken = mintDashboardToken();
  });

  beforeEach(async () => {
    const db = getDb();
    db.prepare('DELETE FROM api_keys').run();
    db.prepare('DELETE FROM requests').run();

    clearReasoningMemory();

    const addKey = await request(app, 'POST', '/api/keys', {
      platform: 'groq',
      key: 'gsk_proxy_tool_test',
      label: 'proxy-tools',
    });
    expect(addKey.status).toBe(201);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes tools/tool_choice to provider and returns tool_calls', async () => {
    const origFetch = global.fetch;
    let providerBody: any = null;

    vi.spyOn(global, 'fetch').mockImplementation(async (url, init) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('api.groq.com/openai/v1/chat/completions')) {
        providerBody = JSON.parse((init as any).body);
        return {
          ok: true,
          json: () => Promise.resolve({
            id: 'chatcmpl-tool',
            object: 'chat.completion',
            created: 123,
            model: 'openai/gpt-oss-120b',
            choices: [{
              index: 0,
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [{
                  id: 'call_weather',
                  type: 'function',
                  function: {
                    name: 'get_weather',
                    arguments: '{"city":"Karachi"}',
                  },
                }],
              },
              finish_reason: 'tool_calls',
            }],
            usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
          }),
        } as any;
      }
      return origFetch(url, init);
    });

    const { status, body } = await request(app, 'POST', '/v1/chat/completions', {
      // No `model` → auto-route via fallback chain.
      messages: [{ role: 'user', content: 'What is the weather in Karachi?' }],
      tools: [{
        type: 'function',
        function: {
          name: 'get_weather',
          description: 'Get current weather',
          parameters: {
            type: 'object',
            properties: { city: { type: 'string' } },
            required: ['city'],
          },
        },
      }],
      tool_choice: 'required',
    }, authHeaders());

    expect(status).toBe(200);
    expect(providerBody.tools).toHaveLength(1);
    expect(providerBody.tool_choice).toBe('required');
    expect(body.choices[0].finish_reason).toBe('tool_calls');
    expect(body.choices[0].message.tool_calls[0].function.name).toBe('get_weather');
  });

  it('accepts assistant tool_calls + tool messages in follow-up turns', async () => {
    const origFetch = global.fetch;
    let providerBody: any = null;

    vi.spyOn(global, 'fetch').mockImplementation(async (url, init) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('api.groq.com/openai/v1/chat/completions')) {
        providerBody = JSON.parse((init as any).body);
        return {
          ok: true,
          json: () => Promise.resolve({
            id: 'chatcmpl-final',
            object: 'chat.completion',
            created: 123,
            model: 'openai/gpt-oss-120b',
            choices: [{
              index: 0,
              message: {
                role: 'assistant',
                content: 'It is 30C in Karachi.',
              },
              finish_reason: 'stop',
            }],
            usage: { prompt_tokens: 18, completion_tokens: 6, total_tokens: 24 },
          }),
        } as any;
      }
      return origFetch(url, init);
    });

    const { status, body } = await request(app, 'POST', '/v1/chat/completions', {
      messages: [
        { role: 'user', content: 'Weather in Karachi?' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: 'call_weather_1',
            type: 'function',
            function: {
              name: 'get_weather',
              arguments: '{"city":"Karachi"}',
            },
          }],
        },
        {
          role: 'tool',
          tool_call_id: 'call_weather_1',
          content: '{"temp_c":30}',
        },
      ],
    }, authHeaders());

    expect(status).toBe(200);
    expect(providerBody.messages[1].role).toBe('assistant');
    expect(providerBody.messages[1].content).toBeNull();
    expect(providerBody.messages[1].tool_calls).toHaveLength(1);
    expect(providerBody.messages[2].role).toBe('tool');
    expect(providerBody.messages[2].tool_call_id).toBe('call_weather_1');
    expect(body.choices[0].message.content).toContain('30C');
  });

  it('round-trips assistant reasoning_content on follow-up turns (DeepSeek thinking — #255)', async () => {
    const origFetch = global.fetch;
    let providerBody: any = null;

    vi.spyOn(global, 'fetch').mockImplementation(async (url, init) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('api.groq.com/openai/v1/chat/completions')) {
        providerBody = JSON.parse((init as any).body);
        return {
          ok: true,
          json: () => Promise.resolve({
            id: 'chatcmpl-r', object: 'chat.completion', created: 1, model: 'm',
            choices: [{ index: 0, message: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
          }),
        } as any;
      }
      return origFetch(url, init);
    });

    const { status } = await request(app, 'POST', '/v1/chat/completions', {
      messages: [
        { role: 'user', content: 'think then answer' },
        {
          role: 'assistant',
          content: 'partial',
          // What a DeepSeek thinking model returned last turn and the client
          // replayed. Stripping it makes OpenCode Zen 400 on this request.
          reasoning_content: 'Let me reason about this step by step...',
        },
        { role: 'user', content: 'continue' },
      ],
    }, authHeaders());

    expect(status).toBe(200);
    expect(providerBody.messages[1].role).toBe('assistant');
    expect(providerBody.messages[1].reasoning_content).toBeUndefined();
  });

  it('restores session reasoning_content the client dropped on replay (#797)', async () => {
    const origFetch = global.fetch;
    let turn = 0;
    let providerBody: any = null;

    vi.spyOn(global, 'fetch').mockImplementation(async (url, init) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('api.groq.com/openai/v1/chat/completions')) {
        turn += 1;
        if (turn === 2) providerBody = JSON.parse((init as any).body);
        return {
          ok: true,
          json: () => Promise.resolve({
            id: 'chatcmpl-r', object: 'chat.completion', created: 1, model: 'm',
            choices: [{
              index: 0,
              message: {
                role: 'assistant',
                content: turn === 1 ? 'first answer' : 'second answer',
                // Turn 1 is a thinking turn: the provider returns a trace the
                // proxy must remember for the session.
                ...(turn === 1 ? { reasoning_content: 'session trace from turn one' } : {}),
              },
              finish_reason: 'stop',
            }],
            usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
          }),
        } as any;
      }
      return origFetch(url, init);
    });

    const sessHeaders = { ...authHeaders(), 'x-session-id': 'sess-797' };

    // Turn 1: thinking model returns reasoning_content → proxy records it.
    const first = await request(app, 'POST', '/v1/chat/completions', {
      messages: [{ role: 'user', content: 'think then answer' }],
    }, sessHeaders);
    expect(first.status).toBe(200);

    // Turn 2: same session; opencode-style replay strips reasoning_content
    // (AI-SDK convertToOpenAICompatibleChatMessages). The proxy must restore
    // the trace it returned last turn or OpenCode Zen 400s.
    const second = await request(app, 'POST', '/v1/chat/completions', {
      messages: [
        { role: 'user', content: 'think then answer' },
        { role: 'assistant', content: 'first answer' },
        { role: 'user', content: 'continue' },
      ],
    }, sessHeaders);
    expect(second.status).toBe(200);
    expect(providerBody.messages[1].role).toBe('assistant');
    expect(providerBody.messages[1].reasoning_content).toBeUndefined();
  });

  it('sends the client\'s messages untouched when the session remembers no reasoning (#797)', async () => {
    const origFetch = global.fetch;
    let providerBody: any = null;

    vi.spyOn(global, 'fetch').mockImplementation(async (url, init) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('api.groq.com/openai/v1/chat/completions')) {
        providerBody = JSON.parse((init as any).body);
        return {
          ok: true,
          json: () => Promise.resolve({
            id: 'chatcmpl-p', object: 'chat.completion', created: 1, model: 'm',
            // No reasoning_content anywhere in this session.
            choices: [{ index: 0, message: { role: 'assistant', content: 'plain answer 2' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
          }),
        } as any;
      }
      return origFetch(url, init);
    });

    const sent = [
      { role: 'user', content: 'no thinking in this session' },
      { role: 'assistant', content: 'plain answer' },
      { role: 'user', content: 'continue' },
    ];

    const { status } = await request(app, 'POST', '/v1/chat/completions', { messages: sent },
      { ...authHeaders(), 'x-session-id': 'sess-797-plain' });

    expect(status).toBe(200);
    // Byte-identical: no restore, no empty-string filler, no reordering.
    expect(providerBody.messages).toEqual(sent);
    expect(providerBody.messages.some((m: any) => 'reasoning_content' in m)).toBe(false);
  });

  it('restores only into the outbound copy, so a failover hop still sends the client\'s bytes (#797)', async () => {
    const origFetch = global.fetch;
    const calls: any[] = [];

    vi.spyOn(global, 'fetch').mockImplementation(async (url, init) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('api.groq.com/openai/v1/chat/completions')) {
        calls.push(JSON.parse((init as any).body));
        // Call 1 is turn 1 (records the trace). Call 2 is turn 2's first
        // attempt — rate-limited so the request fails over to another model.
        if (calls.length === 2) {
          return new Response(JSON.stringify({ error: { message: 'rate limited' } }), { status: 429 }) as any;
        }
        return {
          ok: true,
          json: () => Promise.resolve({
            id: 'chatcmpl-f', object: 'chat.completion', created: 1, model: 'm',
            choices: [{
              index: 0,
              message: {
                role: 'assistant',
                content: 'answer',
                ...(calls.length === 1 ? { reasoning_content: 'trace bound to the first model' } : {}),
              },
              finish_reason: 'stop',
            }],
            usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
          }),
        } as any;
      }
      return origFetch(url, init);
    });

    const sessHeaders = { ...authHeaders(), 'x-session-id': 'sess-797-failover' };

    const first = await request(app, 'POST', '/v1/chat/completions', {
      messages: [{ role: 'user', content: 'think then answer' }],
    }, sessHeaders);
    expect(first.status).toBe(200);

    const second = await request(app, 'POST', '/v1/chat/completions', {
      messages: [
        { role: 'user', content: 'think then answer' },
        { role: 'assistant', content: 'answer' },
        { role: 'user', content: 'continue' },
      ],
    }, sessHeaders);
    expect(second.status).toBe(200);
    expect(calls).toHaveLength(3);

    // Attempt 1 goes to the model that produced the trace — restored.
    expect(calls[1].messages[1].reasoning_content).toBeUndefined();
    // Attempt 2 is a different model. The restore lived on the outbound copy
    // only, so this hop carries exactly what the client sent — no leaked
    // reasoning_content from the mutated request body.
    expect(calls[2].model).not.toBe(calls[1].model);
    expect(calls[2].messages[1].reasoning_content).toBeUndefined();
    expect(calls[2].messages.some((m: any) => 'reasoning_content' in m)).toBe(false);
  });

  // Phase-1 port (opencode-free + kilo expansion): model ids with slashes
  // and colons must reach the upstream byte-for-byte — no slug flattening.
  it('passes verbatim kilo :free ids with slashes/colons to the upstream', async () => {
    const origFetch = global.fetch;
    let providerBody: any = null;
    let providerUrl = '';

    vi.spyOn(global, 'fetch').mockImplementation(async (url, init) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('api.kilo.ai/api/gateway')) {
        providerUrl = urlStr;
        providerBody = JSON.parse((init as any).body);
        return {
          ok: true,
          json: () => Promise.resolve({
            id: 'chatcmpl-k', object: 'chat.completion', created: 1, model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
            choices: [{ index: 0, message: { role: 'assistant', content: 'verbatim ok' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
          }),
        } as any;
      }
      return origFetch(url, init);
    });

    const db = getDb();
    const kiloRow = db.prepare("SELECT id FROM models WHERE platform = 'kilo' AND model_id = 'nvidia/nemotron-3-ultra-550b-a55b:free' AND enabled = 1").get() as { id: number } | undefined;
    expect(kiloRow).toBeDefined();
    await request(app, 'POST', '/api/keys', { platform: 'kilo', key: '' });

    const { status } = await request(app, 'POST', '/v1/chat/completions', {
      model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
      messages: [{ role: 'user', content: 'verbatim id test' }],
    }, authHeaders());

    expect(status).toBe(200);
    expect(providerUrl).toContain('api.kilo.ai');
    expect(providerBody.model).toBe('nvidia/nemotron-3-ultra-550b-a55b:free');
  });

  // Phase-1 port: opencode-free sends the Zen fingerprint (Bearer public +
  // x-opencode-*) and forces stream:true with the four stub tools present.
  it('sends the Zen fingerprint on opencode-free requests', async () => {
    const origFetch = global.fetch;
    let sentHeaders: Record<string, string> = {};
    let providerBody: any = null;

    vi.spyOn(global, 'fetch').mockImplementation(async (url, init) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('opencode.ai/zen/v1/chat/completions')) {
        sentHeaders = Object.fromEntries(
          Object.entries(((init as any).headers ?? {}) as Record<string, string>)
            .map(([k, v]) => [String(k).toLowerCase(), String(v)]),
        );
        providerBody = JSON.parse((init as any).body);
        // stream:true is a fingerprint requirement: Zen answers SSE even for
        // non-streaming callers; the provider accumulates the frames.
        const sse = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`;
        const chunk = (delta: unknown, finish: string | null) => ({ id: 'c1', object: 'chat.completion.chunk', created: 1, model: 'mimo-v2.5-free', choices: [{ index: 0, delta, finish_reason: finish }] });
        return new Response(
          sse(chunk({ role: 'assistant' }, null)) + sse(chunk({ content: 'fingerprint ok' }, null)) + sse(chunk({}, 'stop')) + 'data: [DONE]\n\n',
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
        );
      }
      return origFetch(url, init);
    });

    const db = getDb();
    const zenRow = db.prepare("SELECT id FROM models WHERE platform = 'opencode-free' AND model_id = 'mimo-v2.5-free' AND enabled = 1").get() as { id: number } | undefined;
    expect(zenRow).toBeDefined();
    await request(app, 'POST', '/api/keys', { platform: 'opencode-free', key: '' });

    const { status } = await request(app, 'POST', '/v1/chat/completions', {
      model: 'mimo-v2.5-free',
      messages: [{ role: 'user', content: 'fingerprint test' }],
    }, authHeaders());

    expect(status).toBe(200);
    expect(sentHeaders['authorization']).toBe('Bearer public');
    expect(sentHeaders['user-agent']).toBe('opencode/1.18.31');
    expect(sentHeaders['x-opencode-client']).toBe('desktop');
    expect(sentHeaders['x-opencode-session']).toMatch(/^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/);
    expect(providerBody.stream).toBe(true);
    const names = (providerBody.tools ?? []).map((t: any) => t?.function?.name);
    for (const n of ['bash', 'glob', 'grep', 'read']) expect(names).toContain(n);
  });
});
