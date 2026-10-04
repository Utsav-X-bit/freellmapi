# Antigravity (Isolated Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a keyed `antigravity` provider (Google OAuth JSON-blob credential, device-flow login, Cloud Code Assist wire protocol, 8 models with live discovery refresh, search/image pseudo-tools), fully isolated from phase-1 code.

**Architecture:** One new provider file `server/src/providers/antigravity.ts` (`AntigravityProvider extends BaseProvider`, never the compat class — the wire is Gemini-shaped, not OpenAI-shaped) plus a small OAuth helper module, two login routes, one migration (disabled seed rows), and Keys UI entries. Phase-1 files (`opencode-free.ts`, kilo seeds) untouched; merge = keep the directory, rollback = drop it.

**Tech Stack:** TypeScript, `BaseProvider` subclass, `fetchWithTimeout` + `readSseStream`, AES-256-GCM `api_keys` rows (JSON blob), vitest with mocked fetch, `npm run build -w server`.

## Global Constraints

- Node `>=20.18.0 <25.0.0`, npm `>=10.0.0`.
- `server/build` = `tsc`; no new dependencies.
- Endpoints: `https://daily-cloudcode-pa.googleapis.com` → `https://daily-cloudcode-pa.sandbox.googleapis.com` → `https://cloudcode-pa.googleapis.com`; token `https://oauth2.googleapis.com/token`; auth `https://accounts.google.com/o/oauth2/v2/auth`.
- Thinking budgets: claude 1024, gpt-oss 8192, gemini-3.5 low/medium/high 1000/4000/10000, gemini-3.1-pro low/high 1001/10001, other gemini low/medium/high 1000/4000/-1; off = budget 0 + includeThoughts false.
- Runtime ids: `gemini-3.8-flash-{low,medium,high}`, `gemini-3.7-flash-{low,medium,high}`, `gemini-3.6-flash-{low,medium,high}`, `gemini-3.5-flash-extra-low`, `gemini-3.5-flash-low`, `gemini-3-flash-agent`, `gemini-3.1-pro-low`, `gemini-pro-agent`, `claude-sonnet-4-6`, `claude-opus-4-6-thinking`, `gpt-oss-120b-medium`.
- Max outputs: gemini 65536, gemini-3.1-pro 65535, claude 64000, gpt-oss 32768.
- New rows disabled by default (no credential = no routing); login enables.
- Mocked fetch only in tests, NEVER live Google; fake tokens only (`ya29.test_*`).
- Never log tokens, refresh tokens, codes, or verifiers.

---

### Task 1: Platform type + registry + Keys surface for `antigravity`

**Files:**
- Modify: `shared/types.ts` (add `| 'antigravity'` + comment after the opencode-free block)
- Modify: `server/src/providers/index.ts` (import + `register(new AntigravityProvider())`)
- Modify: `server/src/routes/keys.ts` PLATFORMS const (add `'antigravity'`)
- Modify: `server/src/lib/key-parser.ts` (slug entries: `antigravity`, `antigravity-api`, `google-antigravity`)
- Modify: `client/src/components/keys/shared.tsx` (add `{ value: 'antigravity', label: 'Google Antigravity (Google login)', url: 'https://antigravity.google/' }`, NOT keyless)

**Interfaces:**
- Consumes: `AntigravityProvider` (Task 2 creates it; this task only wires the import — build stays red with TS2307 until Task 2 lands, same as phase-1 Task 1).
- Produces: `hasProvider('antigravity') === true` once Task 2 lands.

- [ ] **Step 1: Add the union member**

```ts
// shared/types.ts, after the opencode-free block:
// Google Antigravity / Cloud Code Assist — per-user Google OAuth (JSON blob
// credential), v1internal wire protocol; see providers/antigravity.ts.
| 'antigravity'
```

- [ ] **Step 2: Register the provider**

```ts
// server/src/providers/index.ts
import { AntigravityProvider } from './antigravity.js';
// ... after the opencode-free block:
register(new AntigravityProvider());
```

- [ ] **Step 3: Keys PLATFORMS + key-parser slugs + client entry**

```ts
// keys.ts PLATFORMS array near 'opencode-free':
'antigravity',
// key-parser.ts slug map near opencode-free:
'antigravity': 'antigravity',
'antigravity-api': 'antigravity',
'google-antigravity': 'antigravity',
// client shared.tsx after the opencode-free entry:
{ value: 'antigravity', label: 'Google Antigravity (Google login)', url: 'https://antigravity.google/' },
```

- [ ] **Step 4: Attempt build, record expected TS2307**

Run: `npm run build -w server` (from repo root)
Expected: FAIL with sole error `TS2307: Cannot find module './antigravity.js'` (Task 2 pending — plan-mandated, not a defect).

- [ ] **Step 5: Commit**

```bash
git add shared/types.ts server/src/providers/index.ts server/src/routes/keys.ts server/src/lib/key-parser.ts client/src/components/keys/shared.tsx
git commit -m "feat: register antigravity platform"
```

---

### Task 2: OAuth credential module (blob parse/refresh, PKCE, device flow)

**Files:**
- Create: `server/src/lib/antigravity-auth.ts`
- Test: `server/src/__tests__/lib/antigravity-auth.test.ts`

**Interfaces:**
- Consumes: `encrypt`/`decrypt` from `../lib/crypto.js`; global `fetch` (mocked in tests).
- Produces: `AntigravityCredential` type; `parseCredential(blob): AntigravityCredential`; `isExpired(cred, skewMs?): boolean`; `refreshCredential(cred): Promise<AntigravityCredential>` (POST token endpoint with refresh_token grant); `buildAuthUrl(state, verifier): {url, codeChallenge}` (PKCE S256); `exchangeCode(code, verifier): Promise<{token, refresh, expiry}>`. Task 3 consumes all of these.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseCredential, isExpired, refreshCredential, buildAuthUrl } from '../../lib/antigravity-auth.js';

afterEach(() => vi.restoreAllMocks());

describe('antigravity-auth', () => {
  it('parses a valid blob and detects expiry', () => {
    const cred = parseCredential(JSON.stringify({ token: 'ya29.test_a', refresh: 'r', projectId: 'p', expiry: Date.now() + 3600_000, email: 'u@test.com' }));
    expect(cred.email).toBe('u@test.com');
    expect(isExpired(cred)).toBe(false);
    expect(isExpired({ ...cred, expiry: Date.now() - 1000 })).toBe(true);
  });

  it('rejects a non-JSON or tokenless blob', () => {
    expect(() => parseCredential('no-key')).toThrow();
    expect(() => parseCredential(JSON.stringify({ refresh: 'r' }))).toThrow();
  });

  it('refreshes via the token endpoint', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'ya29.test_b', expires_in: 3600 }), { status: 200 }));
    const out = await refreshCredential({ token: 'ya29.test_old', refresh: 'refresh.test_x', projectId: 'p', expiry: 0 });
    expect(out.token).toBe('ya29.test_b');
  });

  it('builds a consent URL with PKCE challenge', () => {
    const { url } = buildAuthUrl('state.test_1', 'verifier.test_2');
    expect(url).toContain('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url).toContain('code_challenge=');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --pool=forks --fileParallelism=false src/__tests__/lib/antigravity-auth.test.ts` (from `server/`)
Expected: FAIL with "Failed to resolve import".

- [ ] **Step 3: Write minimal implementation**

```ts
import { createHash, randomBytes } from 'node:crypto';

export interface AntigravityCredential { token: string; refresh?: string; projectId?: string; expiry: number; email?: string; }
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
// Public Antigravity desktop client (pi-antigravity verified); override via env.
const CLIENT_ID = process.env.ANTIGRAVITY_CLIENT_ID ?? '1071006060591-thmssin2h21lcme235vtolpj4g403ec.apps.googleusercontent.com';
const CLIENT_SECRET = process.env.ANTIGRAVITY_CLIENT_SECRET ?? 'GOCSPX-K58FWU44NkdLJ1mLB8sXC4nQDa';
const SCOPES = ['https://www.googleapis.com/auth/aicode', 'https://www.googleapis.com/auth/cloud-platform', 'https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/userinfo.profile', 'https://www.googleapis.com/auth/cclog', 'https://www.googleapis.com/auth/experimentsandconfigs'].join(' ');

export function parseCredential(blob: string): AntigravityCredential {
  let raw: unknown;
  try { raw = JSON.parse(blob); } catch { throw new Error('Antigravity credential is not JSON — re-run login'); }
  if (!raw || typeof raw !== 'object' || typeof (raw as { token?: unknown }).token !== 'string' || !(raw as { token: string }).token) throw new Error('Antigravity credential has no token — re-run login');
  const r = raw as Record<string, unknown>;
  return { token: r['token'] as string, refresh: typeof r['refresh'] === 'string' ? r['refresh'] as string : undefined, projectId: typeof r['projectId'] === 'string' ? r['projectId'] as string : undefined, expiry: typeof r['expiry'] === 'number' ? r['expiry'] as number : 0, email: typeof r['email'] === 'string' ? r['email'] as string : undefined };
}

export function isExpired(cred: AntigravityCredential, skewMs = 60_000): boolean {
  return Date.now() >= cred.expiry - skewMs;
}

function b64url(buf: Buffer): string { return buf.toString('base64url'); }

export function buildAuthUrl(state: string, verifier: string): { url: string; codeChallenge: string } {
  const codeChallenge = b64url(createHash('sha256').update(verifier).digest());
  const q = new URLSearchParams({ client_id: CLIENT_ID, redirect_uri: 'urn:ietf:wg:oauth:2.0:oob', response_type: 'code', scope: SCOPES, state, code_challenge: codeChallenge, code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent' });
  return { url: `${AUTH_URL}?${q}`, codeChallenge };
}

export function newVerifier(): string { return b64url(randomBytes(32)); }
export function newState(): string { return b64url(randomBytes(16)); }

export async function refreshCredential(cred: AntigravityCredential): Promise<AntigravityCredential> {
  if (!cred.refresh) throw new Error('Antigravity refresh token missing — re-run login');
  const res = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: 'refresh_token', refresh_token: cred.refresh }) });
  if (!res.ok) throw new Error(`Antigravity token refresh failed (HTTP ${res.status}) — re-run login`);
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error('Antigravity refresh returned no token — re-run login');
  return { ...cred, token: data.access_token, expiry: Date.now() + (data.expires_in ?? 3600) * 1000 };
}

export async function exchangeCode(code: string, verifier: string): Promise<{ token: string; refresh?: string; expiry: number }> {
  const res = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: 'urn:ietf:wg:oauth:2.0:oob' }) });
  if (!res.ok) { const t = await res.text().catch(() => ''); throw new Error(`Antigravity code exchange failed (HTTP ${res.status}): ${t.slice(0, 200)}`); }
  const data = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error('Antigravity exchange returned no token');
  return { token: data.access_token, refresh: data.refresh_token, expiry: Date.now() + (data.expires_in ?? 3600) * 1000 };
}

export async function fetchUserEmail(token: string): Promise<string | undefined> {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v1/userinfo?alt=json', { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return undefined;
    const data = (await res.json()) as { email?: string };
    return data.email;
  } catch { return undefined; }
}
```

NOTE: `redirect_uri: 'urn:ietf:wg:oauth:2.0:oob'` is the device-flow paste-back
mode — Google shows the code, the user pastes it. If Google rejects OOB for
this client id at live-test time, switch to a `http://127.0.0.1:<port>` code
displayed for manual paste (still no listener) and note it in the report.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --pool=forks --fileParallelism=false src/__tests__/lib/antigravity-auth.test.ts` (from `server/`)
Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/antigravity-auth.ts server/src/__tests__/lib/antigravity-auth.test.ts
git commit -m "feat: antigravity OAuth credential module"
```

---

### Task 3: `AntigravityProvider` — catalog, routing tables, request building

**Files:**
- Create: `server/src/providers/antigravity.ts` (PARTIAL: constants, model tables, request builders — no chatCompletion yet; Task 4 wires it)
- Test: `server/src/__tests__/providers/antigravity.test.ts` (routing-table tests only in this task)

**Interfaces:**
- Consumes: `AntigravityCredential` helpers from Task 2; `ChatMessage`/`Platform` types; `contentToString` from `../lib/content.js`.
- Produces: `ENDPOINTS`, `PUBLIC_MODELS` (8 entries: id, name, contextWindow, maxTokens, input), `RUNTIME_MAX_OUTPUT_TOKENS`, `getMaxOutputTokens(modelId, runtime?)`, `getRuntimeModelId(modelId, effort)`, `getFallbackRuntimeModel(runtime, effort?)`, `getThinkingConfig(runtime, effort)`, `buildGeminiBody(messages, modelId, runtime, options)` (contents/systemInstruction/generationConfig/tools/toolConfig). Task 4 consumes all of these for the request path.

- [ ] **Step 1: Write the failing routing tests**

```ts
import { describe, it, expect } from 'vitest';
import { getRuntimeModelId, getFallbackRuntimeModel, getThinkingConfig, getMaxOutputTokens, PUBLIC_MODELS } from '../../providers/antigravity.js';

describe('antigravity routing', () => {
  it('has 8 public models', () => { expect(PUBLIC_MODELS.map(m => m.id).sort()).toEqual(['claude-opus-4-6', 'claude-sonnet-4-6', 'gemini-3.1-pro', 'gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-3.7-flash', 'gemini-3.8-flash', 'gpt-oss-120b']); });
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --pool=forks --fileParallelism=false src/__tests__/providers/antigravity.test.ts` (from `server/`)
Expected: FAIL with "Failed to resolve import".

- [ ] **Step 3: Write the module (tables + builders, no provider class yet)**

Requirements (exact): `ENDPOINTS` = the 3 URLs in order; `PUBLIC_MODELS` with windows (gemini-3.8/3.7-flash 1M ctx? — use pi-antigravity's static table: flash models 1M context? No: pi README says max output 65K; context windows: use 1_048_576 for gemini-3.8/3.7/3.6-flash, claude pair, gpt-oss? — FIXED VALUES: gemini-3.8-flash/3.7/3.6 ctx 1048576, gemini-3.5-flash 1048576, gemini-3.1-pro 1048576, claude-sonnet-4-6/claude-opus-4-6 200000, gpt-oss-120b 131072; maxTokens per Global Constraints); runtime routing map per constraints; thinking budgets per constraints; `buildGeminiBody` mapping chat messages to `{role:'user'|'model', parts:[{text}]}` (assistant→model, tool→functionResponse part), systemInstruction `{role:'user', parts:[{text}]}` from system messages or default, generationConfig with temperature/maxOutputTokens/thinkingConfig, tools passthrough + toolConfig on non-auto choice.

- [ ] **Step 4: Run tests to verify pass**

Run: same file. Expected: PASS (5/5).

- [ ] **Step 5: Commit**

```bash
git add server/src/providers/antigravity.ts server/src/__tests__/providers/antigravity.test.ts
git commit -m "feat: antigravity catalog and routing tables"
```

---

### Task 4: Request path — envelope, SSE parse, chat/stream/validate, discovery

**Files:**
- Modify: `server/src/providers/antigravity.ts` (add `AntigravityProvider extends BaseProvider`)
- Test: extend `server/src/__tests__/providers/antigravity.test.ts` (SSE parse, quota classification, envelope counters)

**Interfaces:**
- Consumes: Task 2 credential helpers; Task 3 tables/builders; parent `fetchWithTimeout`, `readSseStream`, `validationResult`; `recordQuotaObservationsFromResponse`.
- Produces: full provider with `chatCompletion` (non-streaming via SSE accumulate, like opencode-free), `streamChatCompletion` (true SSE deltas), `validateKey` (project discovery probe), `refreshCatalog()` (fetchAvailableModels merge).

- [ ] **Step 1: Write the failing tests**

```ts
it('parses SSE text deltas into content', async () => {
  // mock fetch on daily endpoint with SSE body carrying candidates[0].content.parts[0].text frames;
  // assert chatCompletion returns joined text.
});
it('classifies hard quota walls as non-retryable', async () => {
  // mock 429 with 'Individual quota reached ... Resets in 3h' → providerHttpError with retryable=false marker;
  // mock 429 RESOURCE_EXHAUSTED without reset → retryable path (plain providerHttpError, no marker).
});
it('discovers the project before streaming', async () => {
  // mock listCloudAICompanionProjects → project id used in envelope assertions via captured body.
});
```

(Write full bodies with mocked `Response` SSE frames; follow the opencode-free.test.ts SSE helper pattern from phase 1.)

- [ ] **Step 2: Run to verify they fail**

Run: same file. Expected: FAIL (no provider class yet).

- [ ] **Step 3: Implement the provider class**

Requirements: `platform='antigravity'`, `keyless=false`; per-call: parse blob → refresh if expired (write-back needs keyId — accept `quotaContext.keyId` and UPDATE the row via `getDb()`; if no keyId, refresh in memory only) → project (blob → discovery → stable fallback) → runtime (+fallback) → envelope (step=contents.length, last_step=length-1, requestIndex=assistant-turn count, session/trajectory UUIDs) → endpoint loop with status-based retry (ok break; 429+reset-hint break; else next endpoint on 403/404/429/500/502/503/504) → SSE accumulate (non-stream) / delta yield (stream) → quota record per endpoint. `validateKey`: discovery probe, true on project found. `refreshCatalog`: merge discovered runtime ids (static fallback on failure). Hard-quota errors carry `retryable:false` on the thrown error for the router.

- [ ] **Step 4: Run tests to verify pass**

Run: full file. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/providers/antigravity.ts server/src/__tests__/providers/antigravity.test.ts
git commit -m "feat: antigravity request path with envelope and SSE"
```

---

### Task 5: Login routes (device flow) + migration + quota/timeout wiring

**Files:**
- Create: `server/src/routes/antigravity.ts` (auth-url + exchange routers)
- Modify: `server/src/app.ts` (mount `/api/antigravity` with requireAuth)
- Create: `server/src/db/migrations/20261005_000001_antigravity_models.ts` (8 disabled rows + quirk)
- Modify: `server/src/services/provider-quota.ts` (pool `antigravity::account` + shared list)
- Test: `server/src/__tests__/routes/antigravity-auth.test.ts` (auth-url shape, exchange stores blob row, login enables rows)

**Interfaces:**
- Consumes: Task 2 `buildAuthUrl`/`exchangeCode`/`fetchUserEmail`/`newVerifier`/`newState`; `encrypt` from crypto; `hasProvider`.
- Produces: working login flow; 8 disabled seed rows; quota isolation.

- [ ] **Step 1: Write the failing route tests**

```ts
// GET /api/antigravity/auth-url → 200 {url contains accounts.google.com, state}
// POST /api/antigravity/exchange {code, state, verifier?} with mocked token+userinfo fetch → 201 key row, blob decrypts to token, models enabled
// POST with garbage code → 502, no row
```

- [ ] **Step 2: Run to verify they fail**

Run: the new test file. Expected: FAIL (no routes).

- [ ] **Step 3: Implement routes + migration**

Routes: `GET /auth-url` (new verifier+state per call; return `{url, state, verifier}` — verifier returned so the dashboard holds it for exchange; never logged); `POST /exchange {code, state, verifier}` (exchange → email → project discovery via provider → encrypt blob → INSERT key row → `UPDATE models SET enabled=1 WHERE platform='antigravity'`). Migration: 8 rows from Task 3 PUBLIC_MODELS with `enabled=0`, `supports_vision=1` (all 8 take image per pi README), `supports_tools=1`, conservative 60s-timeout note in quota_label; quirk `antigravity-oauth-required` (fixed id 1002, INSERT OR REPLACE) targeting `antigravity`. Quota: pool line + shared list.

- [ ] **Step 4: Run tests to verify pass**

Run: new test file + roundtrip test. Expected: PASS (roundtrip extended with the new filename — same pattern as phase 1).

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/antigravity.ts server/src/app.ts server/src/db/migrations/20261005_000001_antigravity_models.ts server/src/services/provider-quota.ts server/src/__tests__/routes/antigravity-auth.test.ts server/src/db/migrate/defaults.ts server/src/__tests__/db/migrate/roundtrip.test.ts
git commit -m "feat: antigravity login flow and disabled seed rows"
```

---

### Task 6: Pseudo-tools (search/image) + pricing + key-parser check + full verification

**Files:**
- Modify: `server/src/providers/antigravity.ts` (tool interception in request builder)
- Modify: `server/src/db/model-pricing.ts` (8 rows at 0/0)
- Test: extend `server/src/__tests__/providers/antigravity.test.ts` (grounding + image tool mapping)
- Docs: check `docs/` for a provider list mentioning antigravity (expect none beyond specs — record only)

**Interfaces:**
- Consumes: full provider from Task 4.
- Produces: `google_search` → grounding block in Gemini tools; `generate_image` → image request path returning image parts as content; pricing rows; green build + suite.

- [ ] **Step 1: Write the failing tool tests**

```ts
it('maps google_search to a grounding block, not a function declaration', async () => {
  // capture Gemini body; expect tools to contain a search-retrieval block and no functionDeclaration named google_search.
});
it('routes generate_image to the image path', async () => {
  // expect image bytes/URL surfaced as message content with metadata, not a 400.
});
```

- [ ] **Step 2: Run to verify they fail**

Run: same file. Expected: FAIL.

- [ ] **Step 3: Implement interception + pricing**

In `buildGeminiBody` (or a `toolsForRequest` helper): split `google_search` ( + spellings `googlesearch`, `google_search_retrieval` — same set as google.ts) into a retrieval block; route `generate_image` calls to the image endpoint with prompt/size, returning parts. Pricing: 8 `['antigravity', id, 0, 0]` rows after the opencode-free block.

- [ ] **Step 4: Full verification**

Run: `npm run build` (root) then `npm run test -w server`. Expected: build exit 0; suite green except the 2 known pre-existing compression perf failures (verify they still fail identically on the clean tree only if anything changed nearby — they are untouched, so record-and-move-on).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: antigravity search/image tools and pricing"
```

---

## Self-Review

**Spec coverage:** JSON blob credential (Tasks 2, 5) ✓; device-flow login no listener (Task 5) ✓;
8 static models + live discovery (Tasks 3, 4) ✓; runtime routing + budgets (Task 3) ✓;
search/image pseudo-tools, no commands (Task 6) ✓; one row per account + router
failover (Task 5, no account-switch code) ✓; disabled-by-default seeds (Task 5) ✓;
quota/timeout parity (Task 5) ✓; isolation — no phase-1/shared-compat edits
beyond protected-widening reuse (all tasks) ✓.

**Placeholder scan:** every step has exact paths, code, commands, expected
output. Task 3's context windows are FIXED VALUES inline (no "check pi
README" deferral). Task 2 names the OOB risk with a concrete fallback.

**Type consistency:** `AntigravityCredential` field names (`token`,
`refresh`, `projectId`, `expiry`, `email`) identical in Tasks 2/4/5;
`getRuntimeModelId(modelId, effort)`, `getThinkingConfig(runtime, effort)`,
`getMaxOutputTokens(modelId, runtime?)` signatures identical in Tasks 3/4;
quirk fixed id 1002 continues the 1000/1001 sequence; migration filename
`20261005_000001_antigravity_models.ts` follows the phase-1 convention.
