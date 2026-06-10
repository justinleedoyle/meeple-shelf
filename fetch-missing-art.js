// Fills cover art for games the ranked-games dataset couldn't match (mostly
// expansions and obscure titles), using BGG's open endpoints:
//
//   geekitems (thing lookup, includes imageid + expansion links)  →
//   /api/images/<imageid> (signed URLs for every size)
//
//   node fetch-missing-art.js                              # automatic pass
//   node fetch-missing-art.js '{"Exact Title": 12345}'     # plus manual title→bggId map
//
// Expansions are resolved through their base game's expansion links (base BGG id
// comes from data/bgg-catalog.json). Anything unresolved is listed with its game
// id so it can be supplied via the manual map. Idempotent.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, normTitle } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Known title → BGG object id mappings for games the automatic passes can't
// resolve (renamed on BGG, unranked, or named differently on the sheet).
const BUILTIN_MAP = {
  'Bang! — Bullet Edition': 30933, // BANG! The Bullet!
  'Bob Ross: Art of Chill': 231696,
  'Castles of Burgundy — Special Edition': 363622,
  'Disney Chronology': 395369, // Chronology: Disney Edition
  'Dune: A Game of Conquest & Diplomacy': 341165,
  'First to Worst': 420370,
  'Fractal: Beyond the Void': 408724,
  'Harry Potter: Hogwarts Battle — The Monster Book of Monsters': 223494, // BGG: "Monster Box of Monsters"
  'Quacks of Quedlinburg': 244521, // renamed "Quacks" on BGG
  "Star Wars: Jabba's Palace (Love Letter)": 353470,
  'Star Wars: Rivals': 385408, // Series 1: Premier Set
  'Stardew Valley': 332290,
  'Tapestry — Fantasies & Futures': 379578,
  'Ultimate Pub Trivia': 135598, // BGG lists it as a version of "Pub Trivia"
  'Battlestar Galactica — Pegasus Expansion': 43539,
  'The Lord of the Rings: Adventure Board Game': 133063, // Pressman "Complete Trilogy"
};

const manualMap = { ...BUILTIN_MAP, ...(process.argv[2] ? JSON.parse(process.argv[2]) : {}) };

const UA = { 'User-Agent': 'MeepleShelf/1.0 (personal board game library)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function geekJson(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) return null;
  return res.json();
}

async function imageUrlFor(bggObjectId) {
  const item = (await geekJson(`https://api.geekdo.com/api/geekitems?objectid=${bggObjectId}&objecttype=thing`))?.item;
  if (!item?.imageid) return null;
  await sleep(200);
  const img = await geekJson(`https://api.geekdo.com/api/images/${item.imageid}`);
  return img?.images?.medium?.url || img?.images?.itempage?.url || null;
}

// token sets for fuzzy expansion-name matching
const STOP = new Set(['the', 'a', 'an', 'and', 'of', 'for', 'expansion']);
function tokens(s) {
  return new Set(
    normTitle(s)
      .split(' ')
      .map((t) => (t === 'extension' ? 'expansion' : t))
      .filter((t) => t && !STOP.has(t))
  );
}
const subset = (a, b) => [...a].every((t) => b.has(t));

const catalog = JSON.parse(readFileSync(path.join(__dirname, 'data', 'bgg-catalog.json'), 'utf8'));
const ALIASES = new Map([['settlers of catan', 'catan']]);
const catalogByNorm = new Map(catalog.map((c) => [normTitle(c.t), c]));
const bggIdForTitle = (title) => {
  const n = normTitle(title);
  return catalogByNorm.get(ALIASES.get(n) ?? n)?.i ?? null;
};

const artless = db.prepare('SELECT * FROM games WHERE image_url IS NULL').all();
console.log(`${artless.length} game(s) without art…`);
const unresolved = [];
let filled = 0;

for (const game of artless) {
  try {
    let bggId = manualMap[game.title] ?? manualMap[String(game.id)] ?? null;

    if (!bggId && game.expansion_of) {
      const base = db.prepare('SELECT * FROM games WHERE id = ?').get(game.expansion_of);
      const baseBggId = base && bggIdForTitle(base.title);
      if (baseBggId) {
        const item = (await geekJson(`https://api.geekdo.com/api/geekitems?objectid=${baseBggId}&objecttype=thing`))?.item;
        await sleep(200);
        const ours = tokens(game.title);
        const candidates = (item?.links?.boardgameexpansion || [])
          .filter((e) => !/fan|promo/i.test(e.name))
          .map((e) => ({ id: e.objectid, name: e.name, t: tokens(e.name) }));
        const exact = candidates.find((c) => subset(c.t, ours) || subset(ours, c.t));
        if (exact) bggId = exact.id;
      }
    }

    if (!bggId) bggId = bggIdForTitle(game.title); // base game ranked under a variant title

    if (!bggId) {
      unresolved.push(game);
      continue;
    }
    const url = await imageUrlFor(bggId);
    await sleep(200);
    if (url) {
      db.prepare('UPDATE games SET image_url = ? WHERE id = ?').run(url, game.id);
      console.log(`  ✓ ${game.title}`);
      filled++;
    } else {
      unresolved.push(game);
    }
  } catch {
    unresolved.push(game);
  }
}

console.log(`\nFilled ${filled} of ${artless.length}.`);
if (unresolved.length) {
  console.log('Unresolved (supply via manual map {gameId: bggObjectId}):');
  for (const g of unresolved) console.log(`  #${g.id}  ${g.title}`);
}
