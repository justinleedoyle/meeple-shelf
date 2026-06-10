// Links existing expansion rows ("Wingspan — European Expansion") to their base
// games so the combined view can group them. New games are linked automatically
// on add; this backfills ones that predate the feature. Idempotent.
//
//   npm run link-expansions

import { db, autoLinkExpansion } from './db.js';

const unlinked = db
  .prepare("SELECT * FROM games WHERE category = 'Expansion for Base-game' AND expansion_of IS NULL")
  .all();

let linked = 0;
for (const game of unlinked) {
  const after = autoLinkExpansion(game);
  if (after.expansion_of) {
    const base = db.prepare('SELECT title FROM games WHERE id = ?').get(after.expansion_of);
    console.log(`  ${game.title}  →  ${base.title}`);
    linked++;
  } else {
    console.log(`  (no base found) ${game.title}`);
  }
}
console.log(`\nLinked ${linked} of ${unlinked.length} unlinked expansions.`);
