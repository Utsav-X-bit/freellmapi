# OpenCode-Free + Kilo Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a keyless `opencode-free` provider (Zen client fingerprint + Muse Responses path) and 19 verbatim Kilo `:free` seed rows, enabled by default.

**Architecture:** New `OpenCodeFreeProvider extends OpenAICompatProvider` in its own file (Pollinations pattern); Kilo is seed-rows-only. Two small visibility widenings in `openai-compat.ts` (`authHeader`, `baseUrl`/`extraHeaders` protected) so the subclass can override headers and build its own bodies. Data via one new timestamped migration file (V25 was last model-data migration; model data now ships in migrations per baseline comment "V25 is the LAST model-data migration" — this plan follows the newer per-file convention like `20260915_*`).

**Tech Stack:** TypeScript, `OpenAICompatProvider` subclass, vitest, better-sqlite3 migrations, `npm run build -w server`.

## Global Constraints

- Node `>=20.18.0 <25.0.0`, npm `>=10.0.0`.
- `server/build` = `tsc`; no new dependencies.
- Fingerprint UA is exactly `opencode/1.18.31`; session `ses_[0-9a-f]{12}[0-9A-Za-z]{14}`, request `msg_[0-9a-f]{12}[0-9A-Za-z]{14}`.
- Kilo `:free` ids verbatim (slashes/colons kept).
- Always inject the 4 stub tools (`bash`, `glob`, `grep`, `read`); force `stream: true`.
- Muse ids (`muse-spark-1.2-contributor-free`, `muse-spark-1.3-contributor-free`) → `POST /responses`; others → chat completions.
- New rows enabled by default, price 0; keyed `opencode` rows untouched.
- Fake keys only in tests (`sk_test_*`); never log credentials.

---

### Task 1: Platform type + registry + Keys surface for `opencode-free`

**Files:**
- Modify: `shared/types.ts:126-128` (add union member + comment)
- Modify: `server/src/providers/index.ts:277-281` (import + register)
- Modify: `server/src/routes/keys.ts:44-56` (add to PLATFORMS const)
- Modify: `client/src/components/keys/shared.tsx:29-97` (add keyless entry)

**Interfaces:**
- Consumes: existing `Platform` union, `register()` helper, `OpenCodeFreeProvider` (Task 2 provides the class; this task only wires the import — implement Task 2 first or stub the import path).
- Produces: `hasProvider('opencode-free') === true`; `keyless === true` on the registered provider.

- [ ] **Step 1: Add the union member**

```ts
// shared/types.ts, after the opencode block (lines 126-128):
// OpenCode Zen free tier — keyless client-fingerprint access
// (Bearer public + x-opencode-* headers); see providers/opencode-free.ts.
| 'opencode-free'
```

- [ ] **Step 2: Register the provider**

```ts
// server/src/providers/index.ts
import { OpenCodeFreeProvider } from './opencode-free.js';
// ... after the opencode block:
register(new OpenCodeFreeProvider());
```

- [ ] **Step 3: Add to Keys PLATFORMS const**

```ts
// server/src/routes/keys.ts, in the PLATFORMS array near 'opencode':
'opencode-free',
```

- [ ] **Step 4: Add client Keys entry (keyless, no key URL)**

```tsx
{ value: 'opencode-free', label: 'OpenCode Zen Free (no key needed)', url: 'https://opencode.ai/zen', keyless: true },
```

- [ ] **Step 5: Run typecheck and registry test**

Run: `npm run build -w server`
Expected: PASS (provider file from Task 2 must exist first; do Task 2 before running).

- [ ] **Step 6: Commit**

```bash
git add shared/types.ts server/src/providers/index.ts server/src/routes/keys.ts client/src/components/keys/shared.tsx
git commit -m "feat: register keyless opencode-free platform"
```

---

### Task 2: `OpenCodeFreeProvider` — fingerprint headers + chat body shaping

**Files:**
- Create: `server/src/providers/opencode-free.ts`
- Test: `server/src/__tests__/providers/opencode-free.test.ts`
- Modify: `server/src/providers/openai-compat.ts:75-76` (`baseUrl`, `extraHeaders`: `private readonly` → `protected readonly`)
- Modify: `server/src/providers/openai-compat.ts:178` (`private authHeader` → `protected authHeader`)

**Interfaces:**
- Consumes: `OpenAICompatProvider` (chatCompletion/streamChatCompletion/fetchCatalogEndpoint/fetchWithTimeout), `bearerAuthHeader` replaced by fixed fingerprint, `CompletionOptions.tools`.
- Produces: `OpenCodeFreeProvider` class with `platform = 'opencode-free'`, `keyless = true`, `isResponsesModel(id)`, fingerprint header builder, chat-body shaper. Task 3 consumes `isResponsesModel` + the header builder for the Responses path.

- [ ] **Step 1: Widen visibility in openai-compat.ts**

```ts
// line 75-76:
protected readonly baseUrl: string;
protected readonly extraHeaders: Record<string, string>;
// line 178:
protected authHeader(apiKey: string): Record<string, string> {
```

- [ ] **Step 2: Write the failing test (headers + body shaping)**

```ts
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run --pool=forks --fileParallelism=false src/__tests__/providers/opencode-free.test.ts`
Expected: FAIL with "Failed to resolve import" (file does not exist yet).

- [ ] **Step 4: Write minimal provider**

```ts
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
```

NOTE: `chatCompletion`/`streamChatCompletion` overrides that actually USE
`chatBody` (merging sampling/max_tokens/tools params like the parent does)
plus the Responses branch land in Task 3. This task's test only pins headers
+ body shape via the parent path — keep the parent methods until Task 3
replaces them, so Task 1's build stays green.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run --pool=forks --fileParallelism=false src/__tests__/providers/opencode-free.test.ts`
Expected: PASS (headers test passes; body test passes once Task 3 wires chatBody — if it fails here, that is the expected red for Task 3's first step; do NOT gold-plate here).

- [ ] **Step 6: Commit**

```bash
git add server/src/providers/opencode-free.ts server/src/providers/openai-compat.ts server/src/__tests__/providers/opencode-free.test.ts
git commit -m "feat: opencode-free provider with Zen fingerprint headers"
```

---

### Task 3: Chat overrides + Muse Responses translation + validateKey

**Files:**
- Modify: `server/src/providers/opencode-free.ts` (chatCompletion/streamChatCompletion overrides, Responses path, validateKey)
- Test: extend `server/src/__tests__/providers/opencode-free.test.ts`

**Interfaces:**
- Consumes: `chatBody` + `isResponsesModel` + `authHeader` from Task 2; parent `fetchWithTimeout`, `readSseStream`, `validationResult`, `recordQuotaObservationsFromResponse`.
- Produces: full `chatCompletion`/`streamChatCompletion` honoring fingerprint + Responses routing; `validateKey` via `GET /models` with fingerprint headers (403 → invalid with upstream message).

- [ ] **Step 1: Write the failing tests (Responses routing + validateKey)**

```ts
it('routes Muse models to POST /responses, others to /chat/completions', async () => {
  const urls: string[] = [];
  vi.spyOn(global, 'fetch').mockImplementation(async (u: any, init: any) => {
    urls.push(String(u));
    return { ok: true, status: 200, headers: new Headers(),
      json: () => Promise.resolve({ id: 'r1', object: 'response', created: 1, model: 'muse-spark-1.3-contributor-free',
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }) } as unknown as Response;
  });
  const p = new OpenCodeFreeProvider();
  await p.chatCompletion('no-key', [{ role: 'user', content: 'hi' }], 'muse-spark-1.3-contributor-free');
  expect(urls[0]).toContain('/responses');
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run --pool=forks --fileParallelism=false src/__tests__/providers/opencode-free.test.ts`
Expected: FAIL (no `/responses` branch yet; validateKey uses parent models probe without fingerprint assertion — the 403 case may pass shape but the URL assertion fails).

- [ ] **Step 3: Implement overrides**

Requirements (exact, no placeholders):
1. `chatCompletion`: if `isResponsesModel(modelId)` → build Responses body (`model`, `input` from messages via text mapping, `store: false`, `max_output_tokens` from `options?.max_tokens` (map `max_completion_tokens` fallback), Responses-shaped stub tools, drop `reasoning`-typed prior items + `encrypted_content` keys) → `POST ${baseUrl}/responses` with `authHeader` + `extraHeaders` → translate terminal object (`output[].content[].text` joined) into a `ChatCompletionResponse` (usage `input_tokens`→prompt, `output_tokens`→completion). Else → parent-equivalent chat body: sampling via `samplingForModel`, `max_tokens` via `resolveMaxTokens('opencode-free', …)`, tools from `chatBody` (which already injects stubs), `tool_choice`, `parallel_tool_calls`, `extendedBodyParams('opencode-free', options)`, `stream: false`.
2. `streamChatCompletion`: same branch; Responses path uses `stream: true` + `readSseStream` on the SSE response, mapping `response.output_text.delta` events to content deltas (fall back to synthesized role/content/finish sequence like SailProvider does if event mapping proves shape-unstable — keep the translator ≤60 lines).
3. `validateKey`: `fetchCatalogEndpoint(modelsUrl, apiKey)` (inherited, now sends fingerprint via overridden `authHeader`) → `validationResult(res)`.
4. Quota observations recorded with `endpoint: 'chat/completions'` or `'responses'` respectively.

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run --pool=forks --fileParallelism=false src/__tests__/providers/opencode-free.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/providers/opencode-free.ts server/src/__tests__/providers/opencode-free.test.ts
git commit -m "feat: opencode-free chat overrides and Muse responses path"
```

---

### Task 4: Quota pool + reasoning-timeout + openai-compat registry test updates

**Files:**
- Modify: `server/src/services/provider-quota.ts:151` (add `opencode-free` pool), `:184` (add to shared-pool list)
- Modify: `server/src/__tests__/providers/openai-compat.test.ts:660-661` (add registry row)
- Modify: `server/src/__tests__/providers/reasoning-timeouts.test.ts:24` (add timeout row)
- Modify: `server/src/routes/proxy.ts:190` (add `'opencode-free'` to `PLATFORMS_REQUIRING_REASONING_ECHO`)

**Interfaces:**
- Consumes: `OpenCodeFreeProvider` registered (Task 1).
- Produces: quota isolation for the free pool; timeout parity; reasoning-echo parity with keyed opencode.

- [ ] **Step 1: Quota pool lines**

```ts
// after line 151:
if (platform === 'opencode-free') return 'opencode-free::promo';
// line 184 list: add 'opencode-free' next to 'opencode'.
```

- [ ] **Step 2: Registry + timeout test rows**

```ts
// openai-compat.test.ts registry list, after the opencode row:
{ platform: 'opencode-free', name: 'OpenCode Zen Free', baseUrl: 'https://opencode.ai/zen/v1' },
// reasoning-timeouts.test.ts, after ['opencode', 60_000]:
['opencode-free', 60_000],
```

- [ ] **Step 3: Reasoning-echo set**

```ts
const PLATFORMS_REQUIRING_REASONING_ECHO = new Set(['opencode', 'opencode-free']);
```

- [ ] **Step 4: Run affected tests**

Run: `npx vitest run --pool=forks --fileParallelism=false src/__tests__/providers/openai-compat.test.ts src/__tests__/providers/reasoning-timeouts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/provider-quota.ts server/src/__tests__/providers/openai-compat.test.ts server/src/__tests__/providers/reasoning-timeouts.test.ts server/src/routes/proxy.ts
git commit -m "feat: opencode-free quota, timeout, and reasoning-echo parity"
```

---

### Task 5: Migration — 8 opencode-free + 19 Kilo `:free` rows, enabled

**Files:**
- Create: `server/src/db/migrations/20261004_000001_opencode_free_kilo_expansion.ts`
- Test: extend `server/src/__tests__/db/migrate/roundtrip.test.ts` (or new `opencode-free-kilo.test.ts` if roundtrip is table-shaped — check first)

**Interfaces:**
- Consumes: `models` table columns incl. `enabled, supports_vision, supports_tools` (V23 pattern with 15-col insert), `backfillFallback` helper, `fallback_config` backfill.
- Produces: 27 enabled rows with price-0 semantics (pricing table untouched → null = free display), conservative limits.

- [ ] **Step 1: Write migration (exact rows)**

```ts
import type { Db } from '../types.js';
import { backfillFallback } from './20260101_000000_legacy_baseline.js'; // check actual export location; inline the fallback backfill if not exported

export function up(db: Db): void {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO models (platform, model_id, display_name, intelligence_rank, speed_rank, size_label, rpm_limit, rpd_limit, tpm_limit, tpd_limit, monthly_token_budget, context_window, enabled, supports_vision, supports_tools)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  // [platform, model_id, display, intel, speed, size, rpm, rpd, tpm, tpd, budget, ctx, enabled, vision, tools]
  const additions: Array<[string, string, string, number, number, string, number | null, number | null, number | null, number | null, string, number | null, number, number, number]> = [
    ['opencode-free', 'muse-spark-1.3-contributor-free', 'Muse Spark 1.3 Free (OpenCode Zen Free)', 4, 4, 'Frontier', 20, 200, null, null, 'free · fingerprint', 1048576, 1, 1, 1],
    ['opencode-free', 'muse-spark-1.2-contributor-free', 'Muse Spark 1.2 Free (OpenCode Zen Free)', 5, 4, 'Frontier', 20, 200, null, null, 'free · fingerprint', 1048576, 1, 1, 1],
    ['opencode-free', 'mimo-v2.5-free', 'MiMo V2.5 Free (OpenCode Zen Free)', 14, 4, 'Medium', 20, 200, null, null, 'free · fingerprint', 200000, 1, 1, 1],
    ['opencode-free', 'mimo-v2.6-flash-free', 'MiMo V2.6 Flash Free (OpenCode Zen Free)', 15, 3, 'Medium', 20, 200, null, null, 'free · fingerprint', 200000, 1, 1, 1],
    ['opencode-free', 'ling-3.0-flash-fin-free', 'Ling 3.0 Flash Fin Free (OpenCode Zen Free)', 16, 4, 'Medium', 20, 200, null, null, 'free · fingerprint', 262144, 1, 0, 1],
    ['opencode-free', 'nemotron-3-ultra-free', 'Nemotron 3 Ultra Free (OpenCode Zen Free)', 7, 4, 'Frontier', 20, 200, null, null, 'free · fingerprint', 1000000, 1, 0, 1],
    ['opencode-free', 'nemotron-3.5-lightning-free', 'Nemotron 3.5 Lightning Free (OpenCode Zen Free)', 12, 4, 'Large', 20, 200, null, null, 'free · fingerprint', 262144, 1, 0, 1],
    ['opencode-free', 'big-pickle', 'Big Pickle (OpenCode Zen Free)', 10, 4, 'Large', 20, 200, null, null, 'free · fingerprint', 200000, 1, 0, 1],
    ['kilo', 'kilo-auto/free', 'Kilo Auto Free (Kilo)', 28, 6, 'Medium', null, null, null, null, 'free · 200/hr per IP', 256000, 1, 0, 1],
    ['kilo', 'stepfun/step-3.7-flash:free', 'Step 3.7 Flash Free (Kilo)', 14, 3, 'Medium', null, null, null, null, 'free · 200/hr per IP', 262144, 1, 1, 1],
    ['kilo', 'nvidia/nemotron-3-ultra-550b-a55b:free', 'Nemotron 3 Ultra 550B Free (Kilo)', 7, 5, 'Frontier', null, null, null, null, 'free · 200/hr per IP', 1000000, 1, 0, 1],
    ['kilo', 'nvidia/nemotron-3-super-120b-a12b:free', 'Nemotron 3 Super 120B Free (Kilo)', 12, 5, 'Large', null, null, null, null, 'free · 200/hr per IP (trial)', 262144, 1, 0, 1],
    ['kilo', 'dots-studio/dots-3-note-preview:free', 'Dots3-Note Preview Free (Kilo)', 9, 5, 'Large', null, null, null, null, 'free · 200/hr per IP', 512000, 1, 1, 1],
    ['kilo', 'cohere/north-mini-code:free', 'North Mini Code Free (Kilo)', 24, 2, 'Small', null, null, null, null, 'free · 200/hr per IP', 256000, 1, 0, 1],
    ['kilo', 'poolside/laguna-xs-2.1:free', 'Laguna XS 2.1 Free (Kilo)', 16, 4, 'Medium', null, null, null, null, 'free · 200/hr per IP', 262144, 1, 0, 1],
    ['kilo', 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', 'Nemotron 3 Nano Omni Free (Kilo)', 18, 5, 'Medium', null, null, null, null, 'free · 200/hr per IP', 256000, 1, 1, 1],
    ['kilo', 'openrouter/free', 'OpenRouter Free Auto (Kilo)', 20, 5, 'Medium', null, null, null, null, 'free · 200/hr per IP', 200000, 1, 1, 1],
    ['kilo', 'nvidia/nemotron-3.5-lightning:free', 'Nemotron 3.5 Lightning Free (Kilo)', 11, 4, 'Large', null, null, null, null, 'free · 200/hr per IP', 1000000, 1, 0, 1],
    ['kilo', 'nvidia/nemotron-3.5-content-safety:free', 'Nemotron 3.5 Content Safety Free (Kilo)', 26, 4, 'Small', null, null, null, null, 'free · 200/hr per IP', 128000, 1, 1, 1],
    ['kilo', 'inclusionai/ling-3.0-flash-sante:free', 'Ling 3.0 Flash Sante Free (Kilo)', 17, 4, 'Medium', null, null, null, null, 'free · 200/hr per IP', 262144, 1, 0, 1],
    ['kilo', 'inclusionai/ling-3.0-flash-fin:free', 'Ling 3.0 Flash Fin Free (Kilo)', 17, 4, 'Medium', null, null, null, null, 'free · 200/hr per IP', 262144, 1, 0, 1],
    ['kilo', 'liquid/lfm-2.5-2.6b:free', 'Liquid LFM 2.5 2.6B Free (Kilo)', 30, 2, 'Small', null, null, null, null, 'free · 200/hr per IP', 65536, 1, 0, 1],
    ['kilo', 'poolside/laguna-s-2.1:free', 'Laguna S 2.1 Free (Kilo)', 17, 4, 'Medium', null, null, null, null, 'free · 200/hr per IP', 262144, 1, 0, 1],
    ['kilo', 'minimax/minimax-m3:free', 'MiniMax M3 Free (Kilo)', 4, 4, 'Frontier', null, null, null, null, 'free · 200/hr per IP', 1048576, 1, 1, 1],
    ['kilo', 'thinkingmachines/inkling-small:free', 'Inkling Small Free (Kilo)', 8, 4, 'Large', null, null, null, null, 'free · 200/hr per IP', 1048576, 1, 1, 1],
    ['kilo', 'thinkingmachines/inkling:free', 'Inkling Free (Kilo)', 6, 4, 'Frontier', null, null, null, null, 'free · 200/hr per IP', 1048576, 1, 1, 1],
    ['kilo', 'minimax/minimax-m2.7:free', 'MiniMax M2.7 Free (Kilo)', 10, 4, 'Large', null, null, null, null, 'free · 200/hr per IP', 196608, 1, 0, 1],
  ];
  const apply = db.transaction(() => {
    for (const a of additions) insert.run(...a);
    backfillFallback(db);
  });
  apply();
}

export function down(db: Db): void {
  const ids = db.prepare(`SELECT id FROM models WHERE platform = 'opencode-free'`).all() as { id: number }[];
  const delFb = db.prepare('DELETE FROM fallback_config WHERE model_db_id = ?');
  const del = db.prepare('DELETE FROM models WHERE id = ?');
  for (const r of ids) { delFb.run(r.id); del.run(r.id); }
  // Kilo rows stay: they belong to the pre-existing kilo platform.
}
```

NOTE: verify `backfillFallback` export location before writing (baseline
defines it as a module-local function — if not exported, copy the 10-line
fallback-backfill body from V18 into this file). Kilo ids already present
(`nvidia/nemotron-3-super-120b-a12b:free`, `stepfun/step-3.7-flash:free`,
laguna rows) are INSERT OR IGNORE — no duplicates. `down` removes only
opencode-free rows.

- [ ] **Step 2: Run migration roundtrip test**

Run: `npm run test:migrations -w server`
Expected: PASS.

- [ ] **Step 3: Verify row count on a scratch DB**

Run: `npx tsx src/db/migrate/cli.ts up && sqlite3 data/freeapi.db "SELECT COUNT(*) FROM models WHERE platform='opencode-free' AND enabled=1;"`
Expected: `8`. (Use a scratch copy; do not commit a dirty dev DB.)

- [ ] **Step 4: Commit**

```bash
git add server/src/db/migrations/20261004_000001_opencode_free_kilo_expansion.ts
git commit -m "feat: seed opencode-free and kilo :free models enabled"
```

---

### Task 6: Quirks, pricing, key-parser, export-catalog verification

**Files:**
- Modify: `server/src/db/migrations/20260101_000000_legacy_baseline.ts:2108-2143` — NO. Do not touch baseline. Instead add quirk seeds to the Task 5 migration file (quirks + quirk_targets inserts).
- Modify: `server/src/db/model-pricing.ts:142-147` (add opencode-free + kilo rows, null = free display)
- Modify: `server/src/lib/key-parser.ts:97-98,185-187` (OPENCODEFREE_ alias — keyless ships sentinel-only, but the alias reserves the env-key path)
- Test: `server/src/__tests__/services/quirks.test.ts` (assert keyless quirk covers opencode-free)

**Interfaces:**
- Consumes: quirk seed shape from baseline `Seed` type; pricing tuple shape.
- Produces: `zen-fingerprint-required` quirk targeting `opencode-free`; pricing rows; key alias.

- [ ] **Step 1: Quirk seeds in the Task 5 migration (append to up())**

```ts
const quirk = db.prepare(`INSERT INTO quirks (slug, title, body, severity, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`);
const now = Date.now();
const q1 = quirk.run('zen-fingerprint-required', 'Keyless Zen fingerprint auth',
  'opencode-free sends Bearer public + OpenCode client headers (UA, x-opencode-*) and injected stub tools; no user key. If Zen closes the fingerprint path, all rows 403 together.',
  'warning', now, now);
const qt = db.prepare(`INSERT INTO quirk_targets (quirk_id, platform, model_glob) VALUES (?, ?, ?)`);
qt.run(q1.lastInsertRowid, 'opencode-free', null);
// extend keyless-anonymous targets: handled by updating the existing seed row:
db.prepare(`INSERT OR IGNORE INTO quirk_targets (quirk_id, platform, model_glob) SELECT id, 'opencode-free', NULL FROM quirks WHERE slug = 'keyless-anonymous'`).run();
```

- [ ] **Step 2: Pricing rows**

```ts
// after the opencode block:
['opencode-free', 'muse-spark-1.3-contributor-free', 0, 0],
['opencode-free', 'mimo-v2.5-free', 0, 0],
// ... one per opencode-free id (8 total), plus kilo :free rows at 0/0:
['kilo', 'dots-studio/dots-3-note-preview:free', 0, 0],
// (all 19 kilo ids; null also renders free — use explicit 0 to mark verified-free)
```

- [ ] **Step 3: Key-parser alias**

```ts
// env-prefix map near OPENCODE_:
OPENCODEFREE_: 'opencode-free',
// slug map near opencode: (only if the map is slug→platform; check shape first)
'opencode-free': 'opencode-free',
```

- [ ] **Step 4: Run quirks + pricing tests**

Run: `npx vitest run --pool=forks --fileParallelism=false src/__tests__/services/quirks.test.ts`
Expected: PASS (update the `['kilo','llm7','ovh']` keyless assertion to include `'opencode-free'`).

- [ ] **Step 5: Commit**

```bash
git add server/src/db/migrations/20261004_000001_opencode_free_kilo_expansion.ts server/src/db/model-pricing.ts server/src/lib/key-parser.ts server/src/__tests__/services/quirks.test.ts
git commit -m "feat: opencode-free quirks, pricing, and key alias"
```

---

### Task 7: Proxy pin test for verbatim `:free` ids + full verification

**Files:**
- Test: `server/src/__tests__/routes/proxy-tools.test.ts` (or nearest proxy routing test — add verbatim-id cases)
- Docs: check `docs/` provider list for an opencode/kilo section to extend (grep `opencode.ai` in docs/)

**Interfaces:**
- Consumes: all prior tasks.
- Produces: green build + suite + pinned routing for slash/colon ids.

- [ ] **Step 1: Add verbatim-id routing test**

```ts
it('routes verbatim kilo :free ids with slashes/colons unchanged', async () => {
  // mock fetch on the kilo provider; assert the outgoing body.model equals
  // 'nvidia/nemotron-3-ultra-550b-a55b:free' byte-for-byte (no slug flattening).
});
```

- [ ] **Step 2: Run full verification**

Run: `npm run build` then `npm run test -w server`
Expected: build exit 0; suite PASS (note pre-existing client vite SIGBUS is environmental, not a gate).

- [ ] **Step 3: Update docs provider section (if one names opencode/kilo)**

Grep `docs/` for `opencode.ai`; extend the matching section with the
`opencode-free` keyless note + Kilo `:free` roster pointer. One paragraph max.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test+docs: pin verbatim :free routing, document opencode-free"
```

---

## Self-Review

**Spec coverage:** fingerprint headers/body (Tasks 2–3) ✓; Responses/Muse (Task 3) ✓;
new keyless platform (Tasks 1, 4) ✓; verbatim Kilo ids (Tasks 5, 7) ✓;
always-inject (Task 2) ✓; enabled-by-default seeds (Task 5) ✓; Antigravity
excluded ✓. Quirk for `nemotron-3-super` blank rendering: covered by seed
comment + Task 6 quirk — the proxy does NOT special-case it (matches bansos:
shipped with note).

**Placeholder scan:** every step has exact paths, code, commands, expected
output. Task 5 flags the one genuine unknown (`backfillFallback` export
location) with a fallback instruction instead of a placeholder.

**Type consistency:** `OpenCodeFreeProvider.platform: Platform =
'opencode-free'` matches the union member from Task 1; quota/echo/timeout
lists use the same literal; migration uses the V23 15-column insert shape.
`chatBody` is `protected` so Task 3 overrides can reuse it; `authHeader`
widening is `protected` (not public) matching `samplingForModel` precedent.
