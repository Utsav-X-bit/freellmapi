// Reseed migration: repairs any install where catalog-sync's stale cache
// pruned bundled opencode-free, kilo expansion, or antigravity models.
//
// DOWN: reversible (clears reseed marker).

import type { Db } from '../types.js';
import { up as reseedOpencodeFreeKilo } from './20261004_000001_opencode_free_kilo_expansion.js';
import { up as reseedAntigravity } from './20261005_000001_antigravity_models.js';

const MARKER_KEY = 'reseed_models_20261005';

export function up(db: Db): void {
  reseedOpencodeFreeKilo(db);
  reseedAntigravity(db);
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(MARKER_KEY, '1');
}

export function down(db: Db): void {
  db.prepare('DELETE FROM settings WHERE key = ?').run(MARKER_KEY);
}
