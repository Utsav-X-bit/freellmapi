// Migration: seed 8 opencode-free + 19 Kilo :free models, all enabled.
// Created: 2026-10-04
//
// DOWN: reversible disable (opencode-free only). Kilo rows stay: they belong to
// the pre-existing kilo platform. Disable (not DELETE) so down/up round-trips
// bit-for-bit: re-inserting would mint new AUTOINCREMENT ids and reshuffle
// fallback_config priorities, breaking the migration roundtrip test.
//
// All claims live-probed 2026-10-04: opencode-free rows carry conservative
// 20rpm/200rpd limits with a fingerprint-gated budget label; Kilo :free rows
// are IP-based (200/hr) so no per-key limits are seeded. Pricing table
// untouched (null = free display).

import type { Db } from '../types.js';

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
  const reassert = db.prepare(`
    UPDATE models SET display_name = ?, intelligence_rank = ?, speed_rank = ?, size_label = ?,
      rpm_limit = ?, rpd_limit = ?, tpm_limit = ?, tpd_limit = ?, monthly_token_budget = ?,
      context_window = ?, enabled = 1, supports_vision = ?, supports_tools = ?
    WHERE platform = ? AND model_id = ?
  `);
  const apply = db.transaction(() => {
    for (const a of additions) insert.run(...a);
    // Re-assert every column: a disable-down leaves rows present where
    // INSERT OR IGNORE is a no-op (V24 pattern). Absolute SETs keep up
    // idempotent and the down/up round trip bit-for-bit stable.
    for (const a of additions) {
      reassert.run(a[2], a[3], a[4], a[5], a[6], a[7], a[8], a[9], a[10], a[11], a[13], a[14], a[0], a[1]);
    }
    backfillFallback(db);
    backfillProfiles(db);
    // Re-enable this migration's chain rows (a disable-down switched them
    // off; the backfills above only ADD missing rows, never flip flags).
    for (const stmt of [
      `UPDATE fallback_config SET enabled = 1 WHERE model_db_id IN (SELECT id FROM models WHERE ${MINE_BARE})`,
      `UPDATE profile_models SET enabled = 1 WHERE model_db_id IN (SELECT id FROM models WHERE ${MINE_BARE})`,
    ]) db.prepare(stmt).run(...KILO_IDS);
    // Quirk: the fingerprint path is all-or-nothing — if Zen closes it,
    // every opencode-free row 403s together. Fixed ids (1000+) outside the
    // baseline AUTOINCREMENT range + INSERT OR REPLACE: re-running never
    // mints new ids, so the down/up round trip stays bit-for-bit stable.
    db.prepare(`
      INSERT OR REPLACE INTO quirks (id, slug, title, body, severity, created_at_ms, updated_at_ms)
      VALUES (1000, 'zen-fingerprint-required', 'Keyless Zen fingerprint auth',
        'opencode-free sends Bearer public + OpenCode client headers (UA, x-opencode-*) and injected stub tools; no user key. If Zen closes the fingerprint path, all rows 403 together.',
        'warning', 1788307200000, 1788307200000)
    `).run();
    db.prepare(`DELETE FROM quirk_targets WHERE quirk_id = 1000`).run();
    db.prepare(`INSERT INTO quirk_targets (id, quirk_id, platform, model_glob) VALUES (1000, 1000, 'opencode-free', NULL)`).run();
    // Extend the curated keyless-anonymous selector with the new platform.
    // Fixed id (1001) for the same round-trip reason.
    db.prepare(`INSERT OR IGNORE INTO quirk_targets (id, quirk_id, platform, model_glob) SELECT 1001, id, 'opencode-free', NULL FROM quirks WHERE slug = 'keyless-anonymous'`).run();
  });
  apply();
}

const KILO_IDS: readonly string[] = [
  'kilo-auto/free',
  'stepfun/step-3.7-flash:free',
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'dots-studio/dots-3-note-preview:free',
  'cohere/north-mini-code:free',
  'poolside/laguna-xs-2.1:free',
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
  'openrouter/free',
  'nvidia/nemotron-3.5-lightning:free',
  'nvidia/nemotron-3.5-content-safety:free',
  'inclusionai/ling-3.0-flash-sante:free',
  'inclusionai/ling-3.0-flash-fin:free',
  'liquid/lfm-2.5-2.6b:free',
  'poolside/laguna-s-2.1:free',
  'minimax/minimax-m3:free',
  'thinkingmachines/inkling-small:free',
  'thinkingmachines/inkling:free',
  'minimax/minimax-m2.7:free',
];
const KILO_IN = `(${KILO_IDS.map(() => '?').join(', ')})`;
/** This migration's 27 rows, for scoping chain writes. The backfills MUST
 *  stay scoped here: a broad "every model missing a chain row" backfill would
 *  adopt user/custom rows created after first boot (and break the
 *  migration roundtrip test, which seeds exactly such a row). */
const MINE_ON_M = `(m.platform = 'opencode-free' OR (m.platform = 'kilo' AND m.model_id IN ${KILO_IN}))`;
const MINE_BARE = `(platform = 'opencode-free' OR (platform = 'kilo' AND model_id IN ${KILO_IN}))`;

/** Mirror this migration's fallback rows into every profile's chain
 *  (profile_chain_backfill pattern): the router prefers the active profile's
 *  profile_models, so rows missing there never enter auto routing. Scoped to
 *  MINE_ON_M — a broad backfill would adopt user/custom rows created after
 *  first boot (and break the migration roundtrip test, which seeds exactly
 *  such a row). Idempotent via the anti-join. */
function backfillProfiles(db: Db) {
  const profiles = db.prepare('SELECT id FROM profiles ORDER BY id ASC').all() as { id: number }[];
  const missing = db.prepare(`
    SELECT m.id, f.enabled, f.priority
      FROM fallback_config f
      JOIN models m ON m.id = f.model_db_id
      LEFT JOIN profile_models pm ON pm.profile_id = ? AND pm.model_db_id = m.id
     WHERE pm.id IS NULL AND ${MINE_ON_M}
     ORDER BY f.priority ASC
  `);
  const insert = db.prepare('INSERT INTO profile_models (profile_id, model_db_id, priority, enabled) VALUES (?, ?, ?, ?)');
  for (const profile of profiles) {
    const rows = missing.all(profile.id, ...KILO_IDS) as { id: number; enabled: number; priority: number }[];
    for (const r of rows) insert.run(profile.id, r.id, r.priority, r.enabled);
  }
}

export function down(db: Db): void {
  db.prepare(`UPDATE fallback_config SET enabled = 0 WHERE model_db_id IN (SELECT id FROM models WHERE platform = 'opencode-free')`).run();
  db.prepare(`UPDATE profile_models SET enabled = 0 WHERE model_db_id IN (SELECT id FROM models WHERE platform = 'opencode-free')`).run();
  db.prepare(`UPDATE models SET enabled = 0 WHERE platform = 'opencode-free'`).run();
  // Kilo rows stay: they belong to the pre-existing kilo platform.
}

/** Append this migration's models to the fallback chain, lowest priority,
 *  ordered by intelligence_rank. Scoped to MINE_ON_M (same reason as
 *  backfillProfiles above). Inlined from the legacy baseline. */
function backfillFallback(db: Db) {
  const missing = db.prepare(`
    SELECT m.id FROM models m
    LEFT JOIN fallback_config f ON m.id = f.model_db_id
    WHERE f.id IS NULL AND ${MINE_ON_M}
    ORDER BY m.intelligence_rank ASC
  `).all(...KILO_IDS) as { id: number }[];
  if (missing.length > 0) {
    const maxPriority = (db.prepare('SELECT COALESCE(MAX(priority), 0) AS mx FROM fallback_config').get() as { mx: number }).mx;
    const addFb = db.prepare('INSERT INTO fallback_config (model_db_id, priority, enabled) VALUES (?, ?, 1)');
    for (let i = 0; i < missing.length; i++) addFb.run(missing[i].id, maxPriority + i + 1);
  }
}

