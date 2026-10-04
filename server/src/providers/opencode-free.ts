import { randomBytes } from 'node:crypto';
import type { ChatMessage, ChatCompletionResponse, ChatCompletionChunk, Platform } from '@freellmapi/shared/types.js';
import { OpenAICompatProvider } from './openai-compat.js';
import type { CompletionOptions, KeyValidationResult } from './base.js';
import type { QuotaObservationContext } from '../services/provider-quota.js';

const ZEN_BASE_URL = 'https://opencode.ai/zen/v1';
const OPENCODE_UA = 'opencode/1.18.31';
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const SESSION_RE = /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/;
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

export function isResponsesModel(modelId: string): boolean {
  return modelId === 'muse-spark-1.2-contributor-free' || modelId === 'muse-spark-1.3-contributor-free';
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
      'x-opencode-session': sessionId(),
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
}
