import { describe, it, expect } from 'vitest';
import { getRuntimeModelId, getFallbackRuntimeModel, getThinkingConfig, getMaxOutputTokens, PUBLIC_MODELS } from '../../providers/antigravity.js';

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
