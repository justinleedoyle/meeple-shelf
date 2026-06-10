// Backfills cover art for games that don't have any, by matching titles against
// data/bgg-catalog.json (the BGG ranked-games dataset):
//
//   npm run enrich
//
// Only fills empty image_url fields — never overwrites art someone set by hand.
// Re-run any time after adding games. Idempotent.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let bgg;
try {
  bgg = JSON.parse(readFileSync(path.join(__dirname, 'data', 'bgg-catalog.json'), 'utf8'));
} catch {
  console.error('data/bgg-catalog.json not found — run build-bgg-catalog.js first.');
  process.exit(1);
}

function norm(t) {
  return t
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/^the /, '');
}

const ALIASES = new Map([
  ['settlers of catan', 'catan'],
]);

// bgg is rank-sorted, so each per-title list is already best-first
const byNorm = new Map();
for (const g of bgg) {
  const n = norm(g.t);
  if (!byNorm.has(n)) byNorm.set(n, []);
  byNorm.get(n).push(g);
}

const games = db.prepare('SELECT * FROM games WHERE image_url IS NULL').all();
let filled = 0;
for (const game of games) {
  const n = norm(game.title);
  const candidates = byNorm.get(ALIASES.get(n) ?? n);
  if (!candidates) continue;
  const pick = (game.year && candidates.find((c) => c.y === game.year)) || candidates[0];
  db.prepare('UPDATE games SET image_url = ? WHERE id = ?').run(pick.im, game.id);
  filled++;
}

console.log(`Filled cover art for ${filled} of ${games.length} games without images.`);
if (games.length - filled > 0) {
  console.log('No match (likely expansions or very obscure titles) — they keep their generated covers.');
}
