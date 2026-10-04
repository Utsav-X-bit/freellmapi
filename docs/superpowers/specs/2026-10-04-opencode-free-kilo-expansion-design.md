# Phase 1: keyless OpenCode-free + Kilo `:free` expansion — design

Date: 2026-10-04. Status: user-approved. Phase 2 (Antigravity OAuth) explicitly
out of scope; attempted only in isolation after phase 1 lands, merged only on
success.

## Goal

Port the free-model coverage of `pi-bansos` v0.4.12 into freellmapi as native
providers: the OpenCode Zen free tier (client-fingerprint, keyless) and the
KiloCode gateway `:free` roster (keyless). No sidecar proxy, no relay, no
Antigravity.

## Source analysis (pi-bansos `extensions/index.ts`, ~1440 lines)

- One `bansos` pi provider backed by a loopback proxy (`127.0.0.1`, default
  port 18080, auto-bump to 18100). The proxy routes by model id: Kilo ids go
  to `https://api.kilo.ai/api/gateway/chat/completions` with
  `Authorization: Bearer kilo-free`; everything else goes to
  `https://opencode.ai/zen/v1` with the fingerprint headers.
- OpenCode Zen free tier answers only with an OpenCode client fingerprint:
  UA `opencode/1.18.31`, `Authorization: Bearer public`,
  `x-opencode-client: desktop`, `x-opencode-project: global`, per-request
  `x-opencode-session: ses_<12 hex><14 base62>` and
  `x-opencode-request: msg_<12 hex><14 base62>`, `stream: true` forced, and
  four stub tools (`bash`, `glob`, `grep`, `read`) present in `tools`.
  Missing any one → 403 FreeTierError. Verified live 2026-09-18.
- 8 OpenCode models: `muse-spark-1.3/1.2-contributor-free` use the Responses
  API (`/v1/responses`, `max_output_tokens`, `store: false`, Responses-shaped
  fingerprint tools, prior-turn `reasoning` items dropped); the other 6 use
  chat completions. Context 200K–1M, output 32K–262K.
- 19 Kilo models, ids verbatim with `/` and `:free` suffix
  (e.g. `nvidia/nemotron-3-ultra-550b-a55b:free`), keyless at 200 req/hr/IP.
  `nvidia/nemotron-3-super-120b-a12b:free` emits its output in the `reasoning`
  field under pi's payload and renders blank (bansos's own `ponytail:`
  comment); shipped with a note, not dropped.
- Local rate guards: 200/UTC-day/IP (OpenCode), 200/rolling-hour/IP (Kilo).
  Out of scope for freellmapi (router/cooldowns already own this).

## Decisions (user-locked)

- New separate keyless platform for OpenCode-free (option B), not keyless
  behavior on the existing keyed `opencode` registration.
- Kilo ids verbatim upstream (slashes/colons kept); flatten only if routing
  breaks.
- Always inject the four fingerprint stub tools (mirror bansos exactly).
- Include Muse Spark via Responses translation in phase 1 (no deferral).
- Migration-seeded, enabled by default (matches the keyless precedent).

## Architecture

New file `server/src/providers/opencode-free.ts`:

- `OpenCodeFreeProvider extends OpenAICompatProvider`, `platform:
  'opencode-free'`, `keyless: true`, base URL `https://opencode.ai/zen/v1`.
  Existing `opencode` (keyed) registration untouched.
- `authHeader()` override returns the Zen fingerprint: fixed UA, fixed
  `Bearer public`, fixed client/project, fresh session + request ids per
  call matching `ses_[0-9a-f]{12}[0-9A-Za-z]{14}` /
  `msg_[0-9a-f]{12}[0-9A-Za-z]{14}`.
- Body override: force `stream: true`; always append missing stub tools
  (chat shape or Responses shape by model); Muse path maps
  `max_tokens`/`max_completion_tokens` → `max_output_tokens`, sets
  `store: false`, drops `reasoning`-typed input items and
  `encrypted_content` fields.
- `chatCompletion`/`streamChatCompletion` branch on model id: Muse ids go to
  `POST /responses` with SSE translated back to chat-completion chunks;
  the rest use the inherited chat-completions path. Translation stays
  private to this file (~150 lines).
- `validateKey` probes `GET /models` with fingerprint headers (catalog
  membership = liveness, mirroring bansos's startup check); 403 FreeTierError
  surfaces as key-invalid with the upstream message preserved.
- Sentinel key row so routing treats the platform as configured; the
  `Bearer public` credential is fixed, never user-supplied.

Kilo: no code change. Plain `OpenAICompatProvider`, `keyless: true`,
existing `https://api.kilo.ai/api/gateway/v1` registration; only seed rows
expand.

## Data

- `shared/types.ts`: add `'opencode-free'` to the `Platform` union with a
  comment in the existing style.
- Migration (enabled by default, price 0): 8 `opencode-free` rows with
  bansos context windows and conservative output caps; 19 Kilo `:free` rows
  verbatim with bansos windows/caps. `nemotron-3-super` carries the blank-
  rendering note. Keyed `opencode` free rows stay disabled (#1249).
- Catalog entries mirror the migration rows for catalog-sync consumers.
- Key-parser: `OPENCODEFREE_` alias reserved only if env keys ever apply;
  keyless ships sentinel-only.

## Validation and tests

- Provider unit tests: fingerprint header shape (UA/session/request regex),
  stub-tool injection on tool-less and tooled requests, `stream: true`
  forcing, `max_tokens` → `max_output_tokens` mapping, reasoning-item
  sanitizing, `/responses` routing for Muse ids only, 403 FreeTierError
  message preservation.
- Proxy/router tests pin a sample of verbatim `:free` ids end to end.
- Smoke: `npm run build`, provider tests, `npm run test:bootstrap`.
- No new test framework, no relay/Vercel code, no `/bansos` command port.

## Non-goals

Antigravity (per-user Google OAuth + `v1internal:` wire protocol), relay
egress, local proxy process, rate-guard port, `/bansos` command, changes to
the keyed `opencode` provider or the shared compat hot path.
