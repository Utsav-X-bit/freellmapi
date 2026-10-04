import type {
  ChatMessage,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ChatToolDefinition,
  ChatToolChoice,
  Platform,
} from '@freellmapi/shared/types.js';
import { BaseProvider, type CompletionOptions, type KeyValidationResult } from './base.js';
import type { QuotaObservationContext } from '../services/provider-quota.js';
import { contentToString } from '../lib/content.js';

/** Cloud Code Assist endpoint candidates, production first. */
export const ENDPOINTS = [
  'https://daily-cloudcode-pa.googleapis.com',
  'https://daily-cloudcode-pa.sandbox.googleapis.com',
  'https://cloudcode-pa.googleapis.com',
];

export interface AntigravityPublicModel {
  id: string;
  name: string;
  reasoning: boolean;
  contextWindow: number;
  maxTokens: number;
  input: Array<'text' | 'image'>;
}

export const PUBLIC_MODELS: AntigravityPublicModel[] = [
  { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', reasoning: true, contextWindow: 1048576, maxTokens: 65536, input: ['text', 'image'] },
  { id: 'gemini-3.7-flash', name: 'Gemini 3.7 Flash', reasoning: true, contextWindow: 1048576, maxTokens: 65536, input: ['text', 'image'] },
  { id: 'gemini-3.6-flash', name: 'Gemini 3.6 Flash', reasoning: true, contextWindow: 1048576, maxTokens: 65536, input: ['text', 'image'] },
  { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash', reasoning: true, contextWindow: 1048576, maxTokens: 65536, input: ['text', 'image'] },
  { id: 'gemini-3.1-pro', name: 'Gemini 3.1 Pro', reasoning: true, contextWindow: 1048576, maxTokens: 65535, input: ['text', 'image'] },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', reasoning: true, contextWindow: 200000, maxTokens: 64000, input: ['text', 'image'] },
  { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', reasoning: true, contextWindow: 200000, maxTokens: 64000, input: ['text', 'image'] },
  { id: 'gpt-oss-120b', name: 'GPT-OSS 120B', reasoning: true, contextWindow: 131072, maxTokens: 32768, input: ['text'] },
];

export const RUNTIME_MAX_OUTPUT_TOKENS: Record<string, number> = {
  'gemini-3.8-flash-low': 65536,
  'gemini-3.8-flash-medium': 65536,
  'gemini-3.8-flash-high': 65536,
  'gemini-3.7-flash-low': 65536,
  'gemini-3.7-flash-medium': 65536,
  'gemini-3.7-flash-high': 65536,
  'gemini-3.6-flash-low': 65536,
  'gemini-3.6-flash-medium': 65536,
  'gemini-3.6-flash-high': 65536,
  'gemini-3.5-flash-extra-low': 65536,
  'gemini-3.5-flash-low': 65536,
  'gemini-3-flash-agent': 65536,
  'gemini-3.1-pro-low': 65535,
  'gemini-pro-agent': 65535,
  'claude-sonnet-4-6': 64000,
  'claude-opus-4-6-thinking': 64000,
  'gpt-oss-120b-medium': 32768,
};

export function getMaxOutputTokens(modelId: string, runtimeModel?: string): number {
  if (runtimeModel && RUNTIME_MAX_OUTPUT_TOKENS[runtimeModel] !== undefined) {
    return RUNTIME_MAX_OUTPUT_TOKENS[runtimeModel] as number;
  }
  if (RUNTIME_MAX_OUTPUT_TOKENS[modelId] !== undefined) {
    return RUNTIME_MAX_OUTPUT_TOKENS[modelId] as number;
  }
  if (runtimeModel) {
    if (runtimeModel.startsWith('claude-')) return 64000;
    if (runtimeModel.startsWith('gpt-oss-')) return 32768;
    if (runtimeModel.startsWith('gemini-3.1-pro') || runtimeModel === 'gemini-pro-agent') return 65535;
    if (runtimeModel.startsWith('gemini-')) return 65536;
  }
  if (modelId.startsWith('claude-')) return 64000;
  if (modelId.startsWith('gpt-oss-')) return 32768;
  return 65536;
}

/** Public model id + thinking effort → Antigravity runtime model id. */
export function getRuntimeModelId(modelId: string, effort: string | undefined): string {
  const e = effort ?? 'off';
  switch (modelId) {
    case 'gemini-3.8-flash':
    case 'gemini-3.7-flash':
    case 'gemini-3.6-flash':
      if (e === 'low' || e === 'minimal' || e === 'none' || e === 'off') return `${modelId}-low`;
      if (e === 'medium') return `${modelId}-medium`;
      return `${modelId}-high`;
    case 'gemini-3.5-flash':
      if (e === 'low' || e === 'minimal' || e === 'none' || e === 'off') return 'gemini-3.5-flash-extra-low';
      if (e === 'medium') return 'gemini-3.5-flash-low';
      return 'gemini-3-flash-agent';
    case 'gemini-3.1-pro':
      if (e === 'low' || e === 'minimal' || e === 'none' || e === 'off') return 'gemini-3.1-pro-low';
      return 'gemini-pro-agent';
    case 'claude-sonnet-4-6':
      return 'claude-sonnet-4-6';
    case 'claude-opus-4-6':
      return 'claude-opus-4-6-thinking';
    case 'gpt-oss-120b':
      return 'gpt-oss-120b-medium';
    default:
      return modelId;
  }
}

/** Cross-generation fallback when a runtime id 404s. */
export function getFallbackRuntimeModel(runtimeModel: string, effort?: string): string | undefined {
  if (runtimeModel.startsWith('gemini-3.8-flash-')) {
    return runtimeModel.replace('gemini-3.8-flash-', 'gemini-3.7-flash-');
  }
  if (runtimeModel === 'gemini-3.8-flash') return getRuntimeModelId('gemini-3.7-flash', effort);
  if (runtimeModel === 'gemini-3.7-flash-tiered') return getRuntimeModelId('gemini-3.6-flash', effort);
  if (runtimeModel.startsWith('gemini-3.7-flash-')) {
    return runtimeModel.replace('gemini-3.7-flash-', 'gemini-3.6-flash-');
  }
  if (runtimeModel === 'gemini-3.7-flash') return getRuntimeModelId('gemini-3.6-flash', effort);
  return undefined;
}

export interface ThinkingWire {
  includeThoughts: boolean;
  thinkingBudget: number;
}

export function getThinkingConfig(modelId: string, effort: string | undefined): ThinkingWire | undefined {
  if (modelId.startsWith('claude-')) {
    if (!effort || effort === 'off') return { includeThoughts: false, thinkingBudget: 0 };
    return { includeThoughts: true, thinkingBudget: 1024 };
  }
  if (modelId.startsWith('gpt-oss-')) {
    if (!effort || effort === 'off') return { includeThoughts: false, thinkingBudget: 0 };
    return { includeThoughts: true, thinkingBudget: 8192 };
  }
  if (modelId.startsWith('gemini-3.5-flash') || modelId === 'gemini-3-flash-agent') {
    if (!effort || effort === 'off') return { includeThoughts: false, thinkingBudget: 0 };
    const thinkingBudget = effort === 'high' || effort === 'xhigh' ? 10000 : effort === 'medium' ? 4000 : 1000;
    return { includeThoughts: true, thinkingBudget };
  }
  if (modelId.startsWith('gemini-3.1-pro') || modelId === 'gemini-pro-agent') {
    if (!effort || effort === 'off') return { includeThoughts: false, thinkingBudget: 0 };
    return { includeThoughts: true, thinkingBudget: effort === 'high' || effort === 'xhigh' ? 10001 : 1001 };
  }
  if (modelId.startsWith('gemini-')) {
    if (!effort || effort === 'off') return { includeThoughts: false, thinkingBudget: 0 };
    const thinkingBudget = effort === 'high' || effort === 'xhigh' ? -1 : effort === 'medium' ? 4000 : 1000;
    return { includeThoughts: true, thinkingBudget };
  }
  return undefined;
}

interface GeminiPart {
  text?: string;
  functionResponse?: { name: string; response: unknown };
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

/** Chat history → Gemini contents (assistant→model, tool→functionResponse). */
export function buildGeminiContents(messages: ChatMessage[]): GeminiContent[] {
  const out: GeminiContent[] = [];
  for (const m of messages) {
    if (m.role === 'tool') {
      out.push({
        role: 'user',
        parts: [{ functionResponse: { name: m.name ?? 'unknown', response: contentToString(m.content) } }],
      });
      continue;
    }
    const text = contentToString(m.content);
    if (text || !(m.tool_calls?.length)) {
      out.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text }] });
    }
    for (const call of m.tool_calls ?? []) {
      out.push({
        role: 'model',
        parts: [{ text: `[function call: ${call.function.name}]` }],
      });
    }
  }
  return out;
}

/** Full Gemini request body (contents + systemInstruction + generationConfig). */
export function buildGeminiBody(
  messages: ChatMessage[],
  modelId: string,
  runtimeModel: string,
  options?: CompletionOptions,
): Record<string, unknown> {
  const contents = buildGeminiContents(messages);
  const systems = messages.filter(m => m.role === 'system').map(m => contentToString(m.content)).filter(Boolean);
  const body: Record<string, unknown> = {
    contents,
    systemInstruction: { role: 'user', parts: [{ text: systems.join('\n\n') || 'You are a helpful assistant.' }] },
  };
  const generationConfig: Record<string, unknown> = {};
  if (options?.temperature !== undefined) generationConfig['temperature'] = options.temperature;
  const maxAllowed = getMaxOutputTokens(modelId, runtimeModel);
  generationConfig['maxOutputTokens'] = options?.max_tokens !== undefined
    ? Math.min(options.max_tokens, maxAllowed)
    : Math.min(maxAllowed, 65536);
  const thinking = getThinkingConfig(runtimeModel, options?.reasoning_effort ?? 'off');
  if (thinking) generationConfig['thinkingConfig'] = thinking;
  if (Object.keys(generationConfig).length > 0) body['generationConfig'] = generationConfig;
  const tools = options?.tools?.map((t: ChatToolDefinition) => ({
    functionDeclarations: [{
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters,
    }],
  }));
  if (tools?.length) body['tools'] = tools;
  if (options?.tool_choice && options.tool_choice !== 'auto') {
    const choice = options.tool_choice as ChatToolChoice;
    body['toolConfig'] = {
      functionCallingConfig: { mode: typeof choice === 'string' ? choice.toUpperCase() : 'ANY' },
    };
  }
  return body;
}

/** Full request path lands in Task 4; this stub keeps the registry green. */
export class AntigravityProvider extends BaseProvider {
  readonly platform: Platform = 'antigravity';
  readonly name = 'Google Antigravity';

  async chatCompletion(): Promise<ChatCompletionResponse> {
    throw new Error('AntigravityProvider.chatCompletion lands in Task 4');
  }

  async *streamChatCompletion(): AsyncGenerator<ChatCompletionChunk> {
    throw new Error('AntigravityProvider.streamChatCompletion lands in Task 4');
  }

  async validateKey(): Promise<KeyValidationResult> {
    throw new Error('AntigravityProvider.validateKey lands in Task 4');
  }
}
