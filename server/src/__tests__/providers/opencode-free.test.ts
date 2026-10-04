import { describe, it, expect, vi, afterEach } from 'vitest';
import { OpenCodeFreeProvider } from '../../providers/opencode-free.js';

afterEach(() => vi.restoreAllMocks());

describe('opencode-free fingerprint', () => {
  // stream:true is a fingerprint requirement, so the chat path answers SSE
  // even for non-streaming callers; the provider accumulates the frames.
  const sseBody = (text: string) =>
    `data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', created: 1, model: 'mimo-v2.5-free', choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] })}\n\n` +
    `data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', created: 1, model: 'mimo-v2.5-free', choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })}\n\n` +
    `data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', created: 1, model: 'mimo-v2.5-free', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n` +
    `data: [DONE]\n\n`;
  const sseResponse = (text: string) => new Response(sseBody(text), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  it('sends Bearer public + x-opencode-* headers with valid id shapes', async () => {
    let sent: Record<string, string> = {};
    vi.spyOn(global, 'fetch').mockImplementation(async (_u: unknown, init?: RequestInit) => {
      sent = (init?.headers ?? {}) as Record<string, string>;
      return sseResponse('ok');
    });
    const p = new OpenCodeFreeProvider();
    const out = await p.chatCompletion('no-key', [{ role: 'user', content: 'hi' }], 'mimo-v2.5-free');
    expect(sent['Authorization']).toBe('Bearer public');
    expect(sent['User-Agent']).toBe('opencode/1.18.31');
    expect(sent['x-opencode-client']).toBe('desktop');
    expect(sent['x-opencode-project']).toBe('global');
    expect(sent['x-opencode-session']).toMatch(/^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/);
    expect(sent['x-opencode-request']).toMatch(/^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/);
    expect((out.choices[0]?.message.content ?? '') as string).toContain('ok');
  });

  it('forces stream:true and injects the four stub tools', async () => {
    let body: Record<string, unknown> = {};
    vi.spyOn(global, 'fetch').mockImplementation(async (_u: unknown, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return sseResponse('ok');
    });
    const p = new OpenCodeFreeProvider();
    await p.chatCompletion('no-key', [{ role: 'user', content: 'hi' }], 'mimo-v2.5-free');
    expect(body['stream']).toBe(true);
    const tools = body['tools'];
    const names = Array.isArray(tools) ? tools.map((t: unknown) => (t as { function?: { name?: string } }).function?.name) : [];
    for (const n of ['bash', 'glob', 'grep', 'read']) expect(names).toContain(n);
  });
});

describe('opencode-free responses routing + validateKey', () => {
  it('routes Muse models to POST /responses, others to /chat/completions', async () => {
    const urls: string[] = [];
    vi.spyOn(global, 'fetch').mockImplementation(async (u: unknown) => {
      urls.push(String(u));
      const sseData =
        `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: 'ok' })}\n\n` +
        `data: ${JSON.stringify({ type: 'response.completed' })}\n\n`;
      return new Response(sseData, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    });
    const p = new OpenCodeFreeProvider();
    const out = await p.chatCompletion('no-key', [{ role: 'user', content: 'hi' }], 'muse-spark-1.3-contributor-free');
    expect(urls[0]).toContain('/responses');
    expect(out.choices[0]?.message.content).toContain('ok');
  });

  it('validateKey accepts 200, rejects 403 FreeTierError with message', async () => {
    const p = new OpenCodeFreeProvider();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ data: [] }), headers: new Headers() } as unknown as Response);
    expect(await p.validateKey('no-key')).toBe(true);
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({ ok: false, status: 403, statusText: 'Forbidden',
      json: () => Promise.resolve({ error: { message: "FreeTierError: OpenCode's free tier can only be used from within OpenCode" } }), headers: new Headers() } as unknown as Response);
    const bad = await p.validateKey('no-key');
    expect(bad).not.toBe(true);
    expect((bad as { error: string }).error).toContain('FreeTierError');
  });
});
