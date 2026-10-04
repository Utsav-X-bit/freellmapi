import { randomBytes } from 'node:crypto';
import type { ChatMessage, ChatCompletionResponse, ChatCompletionChunk, ChatToolCall, Platform } from '@freellmapi/shared/types.js';
import { OpenAICompatProvider } from './openai-compat.js';
import { providerHttpError, type CompletionOptions, type KeyValidationResult } from './base.js';
import { extendedBodyParams, resolveMaxTokens } from '../lib/sampling-params.js';
import { contentToString } from '../lib/content.js';
import { providerTimeoutMs } from '../lib/provider-timeout.js';
import { recordQuotaObservationsFromResponse, type QuotaObservationContext } from '../services/provider-quota.js';

const ZEN_BASE_URL = 'https://opencode.ai/zen/v1';
const OPENCODE_UA = 'opencode/1.18.31';
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const FINGERPRINT_TOOLS = ['bash', 'glob', 'grep', 'read'] as const;

function rand14(): string {
  const bytes = randomBytes(14);
  let out = '';
  for (let i = 0; i < 14; i++) out += BASE62[bytes[i]! % 62];
  return out;
}
function hex6(v: bigint): string {
  return Array.from({ length: 6 }, (_, i) => Number((v >> BigInt(40 - 8 * i)) & 0xffn).toString(16).padStart(2, '0')).join('');
}
let lastTs = 0; let counter = 0;
function sessionId(now = Date.now()): string {
  if (now !== lastTs) { lastTs = now; counter = 0; }
  counter++;
  return `ses_${hex6(~(BigInt(now) * 0x1000n + BigInt(counter)))}${rand14()}`;
}
function requestId(now = Date.now()): string {
  return `msg_${hex6(BigInt(now) * 0x1000n + 1n)}${rand14()}`;
}
const OPENCODE_SESSION = sessionId();

export function isResponsesModel(modelId: string): boolean {
  return modelId === 'muse-spark-1.2-contributor-free' || modelId === 'muse-spark-1.3-contributor-free';
}

/** Terminal Responses object subset this adapter reads. */
interface ResponsesContentPart {
  type?: string;
  text?: string;
}
interface ResponsesOutputItem {
  type?: string;
  content?: ResponsesContentPart[];
}
interface ResponsesObject {
  id?: string;
  model?: string;
  created?: number;
  created_at?: number;
  output?: ResponsesOutputItem[];
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
}

/** Parent-equivalent wire messages: opencode-free is not a strict platform,
 * so only the assistant `partial` prefill flag is stripped (mirrors the
 * non-strict branch of the parent's message sanitizer). */
function stripPartial(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m) => {
    if (m.role === 'assistant' && m.partial !== undefined) {
      const copy: ChatMessage = { ...m };
      delete copy.partial;
      return copy;
    }
    return m;
  });
}

/** Best-effort upstream message without proving a body shape. */
function upstreamErrorText(body: unknown, res: Response): string {
  if (body && typeof body === 'object') {
    if ('error' in body) {
      const err = body.error;
      if (err && typeof err === 'object' && 'message' in err && typeof err.message === 'string' && err.message) return err.message;
    }
    if ('detail' in body && typeof body.detail === 'string' && body.detail) return body.detail;
    if ('message' in body && typeof body.message === 'string' && body.message) return body.message;
  }
  return res.statusText;
}

export class OpenCodeFreeProvider extends OpenAICompatProvider {
  readonly platform: Platform = 'opencode-free';
  readonly name = 'OpenCode Zen Free';

  constructor() {
    super({ platform: 'opencode-free', name: 'OpenCode Zen Free', baseUrl: ZEN_BASE_URL, keyless: true, timeoutMs: 60_000 });
  }

  protected authHeader(_apiKey: string): Record<string, string> {
    return {
      'Authorization': 'Bearer public',
      'User-Agent': OPENCODE_UA,
      'x-opencode-client': 'desktop',
      'x-opencode-project': 'global',
      'x-opencode-session': OPENCODE_SESSION,
      'x-opencode-request': requestId(),
      'Accept': 'text/event-stream',
    };
  }

  /** Chat-completions wire body: stream forced, stub tools always present. */
  protected chatBody(messages: ChatMessage[], modelId: string, options?: CompletionOptions): Record<string, unknown> {
    const tools = [...(options?.tools ?? [])];
    const present = new Set(tools.map(t => t?.function?.name).filter(Boolean));
    for (const n of FINGERPRINT_TOOLS) {
      if (present.has(n)) continue;
      tools.push({ type: 'function' as const, function: { name: n, description: `OpenCode built-in ${n} tool`, parameters: { type: 'object', properties: {} } } });
    }
    return { model: modelId, messages, stream: true, ...(tools.length ? { tools } : {}) };
  }

  /** Responses input: role/text mapping; `reasoning`-typed prior items are
   * dropped and `encrypted_content` replay keys never reach the wire (the
   * allowlist pick below only forwards known fields). */
  private responsesInput(messages: ChatMessage[]): Array<Record<string, unknown>> {
    const input: Array<Record<string, unknown>> = [];
    for (const m of messages) {
      if (m && typeof m === 'object' && 'type' in m && m.type === 'reasoning') continue;
      const text = contentToString(m.content);
      if (m.role === 'tool') {
        input.push({ type: 'function_call_output', call_id: m.tool_call_id ?? m.name ?? 'unknown_call', output: text });
        continue;
      }
      if (text || !m.tool_calls?.length) input.push({ role: m.role, content: text });
      for (const call of m.tool_calls ?? []) {
        input.push({ type: 'function_call', call_id: call.id, name: call.function.name, arguments: call.function.arguments });
      }
    }
    return input;
  }

  /** Responses-shaped fingerprint tools (flat `{name, ...}`, not chat's `{function: {...}}`). */
  private responsesTools(options?: CompletionOptions): Array<Record<string, unknown>> {
    const tools: Array<Record<string, unknown>> = (options?.tools ?? []).map((t) => ({
      type: 'function', name: t?.function?.name, description: t?.function?.description, parameters: t?.function?.parameters,
    }));
    const present = new Set((options?.tools ?? []).map((t) => t?.function?.name).filter(Boolean));
    for (const n of FINGERPRINT_TOOLS) {
      if (present.has(n)) continue;
      tools.push({ type: 'function', name: n, description: `OpenCode built-in ${n} tool`, parameters: { type: 'object', properties: {} } });
    }
    return tools;
  }

  private responsesBody(messages: ChatMessage[], modelId: string, options: CompletionOptions | undefined): Record<string, unknown> {
    const alias = options && typeof options === 'object' && 'max_completion_tokens' in options
      ? options.max_completion_tokens
      : undefined;
    const requested = options?.max_tokens ?? (typeof alias === 'number' ? alias : undefined);
    const maxOutput = resolveMaxTokens(this.platform, requested, options?.contextBudget);
    // OpenCode Zen gate: stream:false -> 403 FreeTierError even with valid UA/session.
    const body: Record<string, unknown> = { model: modelId, input: this.responsesInput(messages), store: false, stream: true };
    if (maxOutput !== undefined) body.max_output_tokens = maxOutput;
    const tools = this.responsesTools(options);
    if (tools.length > 0) body.tools = tools;
    return body;
  }

  /** Terminal Responses object -> ChatCompletionResponse (output text joined, input_tokens -> prompt). */
  private translateResponses(res: ResponsesObject, modelId: string): ChatCompletionResponse {
    const text = (res.output ?? [])
      .filter((item) => item.type === 'message')
      .flatMap((item) => item.content ?? [])
      .filter((part) => part.type === 'output_text')
      .map((part) => part.text ?? '')
      .join('');
    const prompt = res.usage?.input_tokens ?? 0;
    const completion = res.usage?.output_tokens ?? 0;
    const out: ChatCompletionResponse = {
      id: res.id ?? `resp-${Date.now()}`,
      object: 'chat.completion',
      created: res.created ?? res.created_at ?? Math.floor(Date.now() / 1000),
      model: modelId,
      choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
      usage: { prompt_tokens: prompt, completion_tokens: completion, total_tokens: res.usage?.total_tokens ?? prompt + completion },
    };
    out._routed_via = { platform: this.platform, model: modelId };
    return out;
  }

  private record(res: Response, endpoint: string, quotaContext?: QuotaObservationContext, modelId?: string): void {
    recordQuotaObservationsFromResponse(res, { ...quotaContext, platform: this.platform, modelId, endpoint });
  }

  private wireHeaders(apiKey: string): Record<string, string> {
    return { ...this.authHeader(apiKey), 'Content-Type': 'application/json', ...this.extraHeaders };
  }

  private requestTimeoutMs(options?: CompletionOptions): number {
    return options?.timeoutMs ?? providerTimeoutMs(this.platform, 60_000);
  }

  private async *readResponsesSseStream(res: Response, modelId: string): AsyncGenerator<ChatCompletionChunk> {
    const reader = res.body?.getReader();
    if (!reader) throw new Error('No response body');
    const decoder = new TextDecoder();
    let buffer = '';
    const base = { id: `chatcmpl-muse-${Date.now()}`, object: 'chat.completion.chunk' as const, created: Math.floor(Date.now() / 1000), model: modelId };
    yield { ...base, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] };
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const data = trimmed.slice(5).trim();
          if (data === '[DONE]') return;
          try {
            const parsed = JSON.parse(data) as Record<string, unknown>;
            if (parsed.type === 'response.output_text.delta' && typeof parsed.delta === 'string') {
              yield { ...base, choices: [{ index: 0, delta: { content: parsed.delta as string }, finish_reason: null }] };
            } else if (parsed.type === 'response.completed') {
              yield { ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] };
              return;
            }
          } catch {}
        }
      }
    } finally {
      reader.cancel().catch(() => {});
    }
    yield { ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] };
  }

  async chatCompletion(
    apiKey: string,
    messages: ChatMessage[],
    modelId: string,
    options?: CompletionOptions,
    quotaContext?: QuotaObservationContext,
  ): Promise<ChatCompletionResponse> {
    if (isResponsesModel(modelId)) {
      const res = await this.fetchWithTimeout(`${this.baseUrl}/responses`, {
        method: 'POST',
        headers: this.wireHeaders(apiKey),
        body: JSON.stringify(this.responsesBody(messages, modelId, options)),
      }, this.requestTimeoutMs(options), { signal: options?.signal, timeoutBounds: 'request' });
      this.record(res, 'responses', quotaContext, modelId);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw providerHttpError(res, `${this.name} API error ${res.status}: ${upstreamErrorText(err, res)}`, err);
      }
      let content = '';
      for await (const chunk of this.readResponsesSseStream(res, modelId)) {
        const text = chunk.choices?.[0]?.delta?.content;
        if (typeof text === 'string') content += text;
      }
      return {
        id: `chatcmpl-muse-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: modelId,
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        _routed_via: { platform: this.platform, model: modelId },
      };
    }
    const sampling = this.samplingForModel(modelId, options);
    const shaped = this.chatBody(messages, modelId, options);
    const res = await this.fetchWithTimeout(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.wireHeaders(apiKey),
      body: JSON.stringify({
        model: modelId,
        messages: stripPartial(messages),
        temperature: sampling.temperature,
        max_tokens: resolveMaxTokens(this.platform, options?.max_tokens, options?.contextBudget),
        top_p: sampling.topP,
        stop: options?.stop,
        tools: shaped.tools,
        tool_choice: options?.tool_choice,
        parallel_tool_calls: this.resolveParallelToolCalls(options),
        ...extendedBodyParams(this.platform, options),
        // Fingerprint requires stream:true even on the non-streaming entry point (Task 2 pins body.stream true).
        stream: true,
      }),
    }, this.requestTimeoutMs(options), { signal: options?.signal, timeoutBounds: 'request' });
    this.record(res, 'chat/completions', quotaContext, modelId);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw providerHttpError(res, `${this.name} API error ${res.status}: ${upstreamErrorText(err, res)}`, err);
    }
    // stream:true is a fingerprint requirement, so Zen answers this path with
    // SSE frames, not a single JSON document: accumulate the deltas into one
    // terminal response (same shape the streaming path yields per chunk).
    let content = '';
    const toolCalls: ChatToolCall[] = [];
    let finish: ChatCompletionResponse['choices'][number]['finish_reason'] = 'stop';
    let usage: ChatCompletionResponse['usage'] | undefined;
    for await (const chunk of this.readSseStream(res, { firstByteTimeoutMs: this.requestTimeoutMs(options) })) {
      const choice = chunk.choices?.[0];
      if (typeof choice?.delta?.content === 'string') content += choice.delta.content;
      if (choice?.delta?.tool_calls) toolCalls.push(...choice.delta.tool_calls);
      if (choice?.finish_reason) finish = choice.finish_reason;
      const u = (chunk as { usage?: ChatCompletionResponse['usage'] }).usage;
      if (u) usage = u;
    }
    return {
      id: `chatcmpl-zen-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: modelId,
      choices: [{ index: 0, message: { role: 'assistant', content, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) }, finish_reason: finish }],
      usage: usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      _routed_via: { platform: this.platform, model: modelId },
    };
  }

  async *streamChatCompletion(
    apiKey: string,
    messages: ChatMessage[],
    modelId: string,
    options?: CompletionOptions,
    quotaContext?: QuotaObservationContext,
  ): AsyncGenerator<ChatCompletionChunk> {
    if (isResponsesModel(modelId)) {
      const res = await this.fetchWithTimeout(`${this.baseUrl}/responses`, {
        method: 'POST',
        headers: this.wireHeaders(apiKey),
        body: JSON.stringify(this.responsesBody(messages, modelId, options)),
      }, this.requestTimeoutMs(options), { signal: options?.signal });
      this.record(res, 'responses', quotaContext, modelId);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw providerHttpError(res, `${this.name} API error ${res.status}: ${upstreamErrorText(err, res)}`, err);
      }
      yield* this.readResponsesSseStream(res, modelId);
      return;
    }
    const sampling = this.samplingForModel(modelId, options);
    const shaped = this.chatBody(messages, modelId, options);
    const res = await this.fetchWithTimeout(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.wireHeaders(apiKey),
      body: JSON.stringify({
        model: modelId,
        messages: stripPartial(messages),
        temperature: sampling.temperature,
        max_tokens: resolveMaxTokens(this.platform, options?.max_tokens, options?.contextBudget),
        top_p: sampling.topP,
        stop: options?.stop,
        tools: shaped.tools,
        tool_choice: options?.tool_choice,
        parallel_tool_calls: this.resolveParallelToolCalls(options),
        ...extendedBodyParams(this.platform, options),
        stream: true,
        stream_options: options?.stream_options,
      }),
    }, this.requestTimeoutMs(options), { signal: options?.signal });
    this.record(res, 'chat/completions', quotaContext, modelId);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw providerHttpError(res, `${this.name} API error ${res.status}: ${upstreamErrorText(err, res)}`, err);
    }
    yield* this.readSseStream(res, { firstByteTimeoutMs: this.requestTimeoutMs(options) });
  }

  async validateKey(apiKey: string, quotaContext?: QuotaObservationContext): Promise<KeyValidationResult> {
    return this.validationResult(await this.fetchCatalogEndpoint(this.validateUrl ?? this.modelsUrl, apiKey, quotaContext));
  }
}
