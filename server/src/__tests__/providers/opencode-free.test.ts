import { describe, it, expect, vi, afterEach } from 'vitest';
import { OpenCodeFreeProvider } from '../../providers/opencode-free.js';

afterEach(() => vi.restoreAllMocks());

describe('opencode-free fingerprint', () => {
  it('sends Bearer public + x-opencode-* headers with valid id shapes', async () => {
    let sent: Record<string, string> = {};
    vi.spyOn(global, 'fetch').mockImplementation(async (_u: any, init: any) => {
      sent = init.headers as Record<string, string>;
      return { ok: true, status: 200, headers: new Headers(),
        json: () => Promise.resolve({ id: 'x', object: 'chat.completion', created: 1, model: 'mimo-v2.5-free',
          choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }) } as unknown as Response;
    });
    const p = new OpenCodeFreeProvider();
    await p.chatCompletion('no-key', [{ role: 'user', content: 'hi' }], 'mimo-v2.5-free');
    expect(sent['Authorization']).toBe('Bearer public');
    expect(sent['User-Agent']).toBe('opencode/1.18.31');
    expect(sent['x-opencode-client']).toBe('desktop');
    expect(sent['x-opencode-project']).toBe('global');
    expect(sent['x-opencode-session']).toMatch(/^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/);
    expect(sent['x-opencode-request']).toMatch(/^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/);
  });

  it('forces stream:true and injects the four stub tools', async () => {
    let body: any;
    vi.spyOn(global, 'fetch').mockImplementation(async (_u: any, init: any) => {
      body = JSON.parse(String(init.body));
      return { ok: true, status: 200, headers: new Headers(),
        json: () => Promise.resolve({ id: 'x', object: 'chat.completion', created: 1, model: 'mimo-v2.5-free',
          choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }) } as unknown as Response;
    });
    const p = new OpenCodeFreeProvider();
    await p.chatCompletion('no-key', [{ role: 'user', content: 'hi' }], 'mimo-v2.5-free');
    expect(body.stream).toBe(true);
    const names = (body.tools ?? []).map((t: any) => t.function?.name);
    for (const n of ['bash', 'glob', 'grep', 'read']) expect(names).toContain(n);
  });
});
