import { describe, it, expect, vi, afterEach } from 'vitest';
import { AntigravityProvider, isHardQuotaWall, buildGenerateBody, getRuntimeModelId, getFallbackRuntimeModel, getThinkingConfig, getMaxOutputTokens, PUBLIC_MODELS } from '../../providers/antigravity.js';

describe('antigravity routing', () => {
  it('has 8 public models', () => {
    expect(PUBLIC_MODELS.map(m => m.id).sort()).toEqual(['claude-opus-4-6', 'claude-sonnet-4-6', 'gemini-3.1-pro', 'gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-3.7-flash', 'gemini-3.8-flash', 'gpt-oss-120b']);
  });
  it('routes thinking levels to runtime ids', () => {
    expect(getRuntimeModelId('gemini-3.8-flash', 'high')).toBe('gemini-3.8-flash-high');
    expect(getRuntimeModelId('gemini-3.5-flash', 'low')).toBe('gemini-3.5-flash-extra-low');
    expect(getRuntimeModelId('gemini-3.5-flash', 'high')).toBe('gemini-3-flash-agent');
    expect(getRuntimeModelId('claude-opus-4-6', 'high')).toBe('claude-opus-4-6-thinking');
  });
  it('falls back across generations', () => {
    expect(getFallbackRuntimeModel('gemini-3.8-flash-high', 'high')).toBe('gemini-3.7-flash-high');
    expect(getFallbackRuntimeModel('gemini-3.7-flash-low', 'low')).toBe('gemini-3.6-flash-low');
  });
  it('maps thinking budgets per family', () => {
    expect(getThinkingConfig('claude-sonnet-4-6', 'high')).toEqual({ includeThoughts: true, thinkingBudget: 1024 });
    expect(getThinkingConfig('gpt-oss-120b-medium', 'medium')).toEqual({ includeThoughts: true, thinkingBudget: 8192 });
    expect(getThinkingConfig('gemini-3.8-flash-high', 'off')).toEqual({ includeThoughts: false, thinkingBudget: 0 });
  });
  it('caps max outputs', () => {
    expect(getMaxOutputTokens('gemini-3.8-flash')).toBe(65536);
    expect(getMaxOutputTokens('claude-sonnet-4-6')).toBe(64000);
    expect(getMaxOutputTokens('gpt-oss-120b')).toBe(32768);
  });
});

describe('antigravity request path', () => {
  afterEach(() => vi.restoreAllMocks());

  const blob = (over: Record<string, unknown> = {}) => JSON.stringify({
    token: 'ya29.test_tok', refresh: 'refresh.test_r', projectId: 'proj.test_1',
    expiry: Date.now() + 3600_000, email: 'u@test.com', ...over,
  });
  // Antigravity SSE shape: candidates[0].content.parts[].text frames.
  const agySse = (text: string) =>
    `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }], role: 'model' } }] })}\n\n` +
    `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: '' }], role: 'model' }, finishReason: 'STOP' }] })}\n\n` +
    `data: [DONE]\n\n`;

  it('builds the Agent envelope with counters and project', () => {
    const body = buildGenerateBody(
      [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'yo' }, { role: 'user', content: 'again' }],
      'gemini-3.8-flash', 'gemini-3.8-flash-high', 'proj.test_1', { reasoning_effort: 'high' },
    );
    expect(body['project']).toBe('proj.test_1');
    expect(body['model']).toBe('gemini-3.8-flash-high');
    expect(body['requestType']).toBe('Agent');
    expect(typeof body['requestId']).toBe('string');
    const req = body['request'] as { labels?: Record<string, string> };
    expect(req.labels?.['step']).toBe('3');
    expect(req.labels?.['last_step_index']).toBe('2');
  });

  it('classifies hard quota walls vs transient throttling', () => {
    expect(isHardQuotaWall(429, 'Individual quota reached. Resets in 3h')).toBe(true);
    expect(isHardQuotaWall(429, 'RESOURCE_EXHAUSTED: Resource has been exhausted')).toBe(false);
    expect(isHardQuotaWall(500, 'Individual quota reached')).toBe(false);
  });

  it('discovers the project before streaming', async () => {
    const seen: string[] = [];
    let projectBody: unknown = null;
    vi.spyOn(global, 'fetch').mockImplementation(async (u: unknown, init?: RequestInit) => {
      const url = String(u);
      seen.push(url);
      if (url.includes('listCloudAICompanionProjects')) {
        return new Response(JSON.stringify({ cloudaicompanionProject: { id: 'proj.test_live' } }), { status: 200 });
      }
      if (url.includes('streamGenerateContent')) {
        projectBody = JSON.parse(String(init?.body));
        return new Response(agySse('hello'), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    const p = new AntigravityProvider();
    const out = await p.chatCompletion(blob({ projectId: undefined }), [{ role: 'user', content: 'hi' }], 'gemini-3.8-flash');
    expect(seen.some(u => u.includes('listCloudAICompanionProjects'))).toBe(true);
    expect((projectBody as { project?: string })?.project).toBe('proj.test_live');
    expect(out.choices[0]?.message.content).toContain('hello');
  });
});
