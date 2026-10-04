# Phase 2: Antigravity (isolated) — design

Date: 2026-10-04. Status: user-approved. Isolated from phase 1
(opencode-free + Kilo); merged only on success, dropped cleanly on failure.
Source: `pi-antigravity` v0.9.0 (~6.4K lines).

## Goal

Port Google Antigravity / Cloud Code Assist models into freellmapi as a
native provider: per-user Google OAuth, the `v1internal:` wire protocol,
8 public models with thinking-level runtime routing, plus the search/image
pseudo-tools. No slash commands, no relay, no sidecar.

## Source analysis (pi-antigravity)

- Per-user Google OAuth (PKCE, `localhost:51121` callback,
  `aicode`/`cloud-platform`/`cclog`/`experimentsandconfigs` scopes, public
  Antigravity desktop client ID, auto-refresh, multi-account file with
  hard-429 failover).
- Non-OpenAI wire against `https://daily-cloudcode-pa.googleapis.com`
  (fallbacks: sandbox, prod): `v1internal:listCloudAICompanionProjects` →
  project, `v1internal:fetchAvailableModels` → catalog,
  `v1internal:streamGenerateContent?alt=sse` → Gemini-shaped
  `{contents, systemInstruction, generationConfig:{thinkingConfig}}` in an
  Agent envelope (project, runtime model id, requestType, step/last_step/
  request counters, session/trajectory labels).
- 8 public models collapse thinking variants to runtime ids with integer
  `thinkingBudget` per family (claude 1024, gpt-oss 8192, gemini bands).
- Extras: `google_search` / `generate_image` model-facing tools and
  `/antigravity.*` commands (usage, models, accounts, doctor, image, search).

## Decisions (user-locked)

- Credential as JSON blob in the existing `api_keys` row (option A), no
  schema change; refresh in place.
- Device-flow login (option A): show Google URL, paste code back, no
  loopback listener.
- Static 8-model seed + live discovery refresh (option B).
- Provider + search/image tools, no slash commands (option B).
- One key row per Google account; router multi-key failover covers account
  failover (option A).

## Architecture

New file `server/src/providers/antigravity.ts`:

- `AntigravityProvider extends BaseProvider`, `platform: 'antigravity'`,
  keyed (JSON blob rows). Existing providers untouched.
- Credential handling: parse blob (`token`, `refresh`, `projectId`,
  `expiry`, `email`); refresh via `oauth2.googleapis.com/token` when
  expired, writing the rotated blob back to the same row. One row per
  Google account; hard-429 failover rides the router's multi-key path.
- Login routes (dashboard): `GET /api/antigravity/auth-url` returns the
  consent URL (PKCE, public desktop client ID, full scope set);
  `POST /api/antigravity/exchange` takes `{code, state}`, exchanges for
  tokens, discovers the project, stores the blob row enabled. No listener.
- Request path: endpoint fallback (daily → sandbox → prod), project
  discovery with stable fallback, Gemini body per family thinking budgets,
  Agent envelope counters, SSE parsing to chat chunks. Hard quota walls
  (429 + reset hint) are non-retryable; generic RESOURCE_EXHAUSTED stays
  retryable.
- Models: 8 static entries with runtime routing + `thinkingBudget` maps;
  `fetchAvailableModels` merges newly advertised runtime ids at runtime,
  static table is the fallback.
- Tools: `google_search` and `generate_image` as provider-internal
  pseudo-tools (same pattern as `google.ts` grounding name-mapping), no new
  tools framework and no slash commands.

## Data

- `shared/types.ts`: add `'antigravity'` to the `Platform` union.
- Migration seeds 8 rows **disabled** (no credential = no routing; login
  enables), price 0/0, plus quirk `antigravity-oauth-required`.
- Key-parser aliases for the platform slug; catalog entries mirror rows.

## Validation and tests

- OAuth exchange/refresh against a mocked token endpoint; blob rotation
  persisted.
- Runtime-id routing per thinking level for all 8 models; fallback routing.
- SSE parsing to chat chunks; quota-wall classification (hard vs
  transient).
- Discovery merge: new runtime ids adopted, static fallback on failure.
- Smoke: `npm run build`, provider tests. No live Google calls in tests.

## Non-goals

Slash commands, relay egress, loopback listener, multi-account
switch/remove UI (one row per account instead), changes to phase-1 code or
the shared compat path. Merge = keep the directory; rollback = drop it.
