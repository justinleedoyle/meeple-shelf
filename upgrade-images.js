// Upgrades pixelated 64px "micro" thumbnails (from the BGG rankings dataset) to
// crisp 500px versions, using BGG's public image API:
//
//   npm run upgrade-images
//
// For each game whose image_url is a __micro thumbnail, looks up the image id at
// api.geekdo.com/api/images/<id> (no auth required) and swaps in the signed
// "medium" (500x500) URL. Idempotent — already-upgraded and hand-set images are
// left alone. New games added through the app are upgraded automatically by the
// server; this script backfills.

import { db } from './db.js';

const PICK = ['medium', 'itempage', 'small'];

async function hiResFor(imageUrl) {
  const m = imageUrl.match(/pic(\d+)\.[a-z]+$/i);
  if (!m) return null;
  const res = await fetch(`https://api.geekdo.com/api/images/${m[1]}`, {
    headers: { 'User-Agent': 'MeepleShelf/1.0 (personal board game library)' },
  });
  if (!res.ok) return null;
  const data = await res.json();
  for (const variant of PICK) {
    const url = data?.images?.[variant]?.url;
    if (url) return url;
  }
  return null;
}

const games = db.prepare("SELECT id, title, image_url FROM games WHERE image_url LIKE '%__micro%'").all();
console.log(`${games.length} game(s) with micro thumbnails…`);

let upgraded = 0;
for (const game of games) {
  try {
    const url = await hiResFor(game.image_url);
    if (url) {
      db.prepare('UPDATE games SET image_url = ? WHERE id = ?').run(url, game.id);
      upgraded++;
    } else {
      console.log(`  (no upgrade available) ${game.title}`);
    }
  } catch {
    console.log(`  (lookup failed, kept micro) ${game.title}`);
  }
  await new Promise((r) => setTimeout(r, 150)); // be polite
}
console.log(`Upgraded ${upgraded} of ${games.length} to 500px images.`);
