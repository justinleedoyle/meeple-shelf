// Imports the household collection from data/collection-sheet.md (a snapshot of
// the shared Google Sheet) into the database:
//
//   npm run import-sheet
//
// - One account per household column (username = lowercase name)
// - Every ✓ becomes a library entry for that household
// - All households are placed into one crew together
// - Titles that match the built-in catalog are enriched with player counts,
//   play time, and year
//
// Default password for created accounts is "meeple123" (override: PASSWORD=… npm run import-sheet).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, createUser, createCrew, findOrCreateGame } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PASSWORD = process.env.PASSWORD || 'meeple123';
const CREW_NAME = process.env.CREW_NAME || 'Game Night Crew';

// ---------- parse the markdown table ----------

const md = readFileSync(path.join(__dirname, 'data', 'collection-sheet.md'), 'utf8');
const tableLines = md.split('\n').filter((l) => l.trim().startsWith('|'));

const splitRow = (line) =>
  line.split('|').slice(1, -1).map((c) => c.trim().replace(/\\!/g, '!'));

const headerIdx = tableLines.findIndex((l) => splitRow(l)[0] === 'Game');
if (headerIdx === -1) {
  console.error('Could not find the collection table header in data/collection-sheet.md');
  process.exit(1);
}
const header = splitRow(tableLines[headerIdx]);
const households = header.slice(2, header.length - 1); // between "Primary Category" and "Notes"

const rows = [];
for (const line of tableLines.slice(headerIdx + 1)) {
  const cells = splitRow(line);
  if (cells.length !== header.length) break; // end of the collection table
  if (cells.every((c) => c.includes(':-:'))) continue; // alignment separator
  const [title, category, ...rest] = cells;
  if (!title) continue;
  rows.push({
    title,
    category: category || null,
    owners: households.filter((_, i) => rest[i] === '✓'),
    notes: rest[households.length] || '',
  });
}

// ---------- catalog enrichment ----------

const catalog = JSON.parse(readFileSync(path.join(__dirname, 'data', 'popular-games.json'), 'utf8'));

function norm(t) {
  return t
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/^the /, '');
}

// sheet vocabulary → catalog vocabulary, where simple normalization isn't enough
const ALIASES = new Map([
  ['settlers of catan', 'catan'],
]);

const catalogByNorm = new Map(catalog.map((c) => [norm(c.title), c]));
const enrich = (title) => {
  const n = norm(title);
  return catalogByNorm.get(ALIASES.get(n) ?? n) || null;
};

// ---------- load it all in ----------

const users = {};
for (const name of households) {
  const username = name.toLowerCase();
  const existing = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  users[name] = existing || createUser({ username, displayName: name, password: PASSWORD });
}

let entries = 0;
let enriched = 0;
const perHousehold = Object.fromEntries(households.map((h) => [h, 0]));

for (const row of rows) {
  const match = enrich(row.title);
  if (match) enriched++;
  const game = findOrCreateGame({
    title: row.title, // keep the sheet's title as canonical
    year: match?.year ?? null,
    minPlayers: match?.minPlayers ?? null,
    maxPlayers: match?.maxPlayers ?? null,
    playTime: match?.playTime ?? null,
    category: row.category,
  });
  for (const h of row.owners) {
    const info = db
      .prepare('INSERT OR IGNORE INTO library_entries (user_id, game_id, notes) VALUES (?, ?, ?)')
      .run(users[h].id, game.id, row.notes);
    entries += info.changes;
    perHousehold[h] += info.changes;
  }
}

let crew = db.prepare('SELECT * FROM crews WHERE name = ?').get(CREW_NAME);
if (!crew) {
  const creator = users['Doyles'] || users[households[0]];
  crew = createCrew(CREW_NAME, creator.id);
}
for (const name of households) {
  db.prepare('INSERT OR IGNORE INTO crew_members (crew_id, user_id) VALUES (?, ?)').run(crew.id, users[name].id);
}

console.log(`Imported ${rows.length} games (${enriched} enriched from the built-in catalog)`);
console.log(`Added ${entries} new shelf entries:`);
for (const h of households) console.log(`  ${h}: ${perHousehold[h]}`);
console.log(`Crew "${crew.name}" — invite code ${crew.invite_code}, ${households.length} households`);
console.log(`\nLog in as any household (e.g. doyles) — password: ${PASSWORD}`);
