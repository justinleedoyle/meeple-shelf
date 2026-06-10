// Seeds demo data so you can see the whole app working without rounding up
// three real friends first: three users, stocked shelves, and one crew.
//
//   npm run seed
//
// Log in as justin / meeple123 (or sam / meeple123, riley / meeple123).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, createUser, createCrew, findOrCreateGame } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(readFileSync(path.join(__dirname, 'data', 'popular-games.json'), 'utf8'));

const PASSWORD = 'meeple123';

const SHELVES = {
  justin: [
    'Wingspan', 'Scythe', 'Viticulture Essential Edition', 'Tapestry', 'Apiary',
    'Cascadia', 'Brass: Birmingham', 'Codenames', 'Catan', 'Azul',
    '7 Wonders Duel', 'Spirit Island',
  ],
  sam: [
    'Catan', 'Codenames', 'Root', 'Everdell', 'Ark Nova', 'Just One',
    'Sushi Go Party!', 'Camel Up', 'Terraforming Mars', 'Patchwork',
  ],
  riley: [
    'Wavelength', 'Codenames', 'Dune: Imperium', 'Cascadia', 'The Crew: Mission Deep Sea',
    'Heat: Pedal to the Metal', 'Splendor', 'Ticket to Ride', 'Blood on the Clocktower', 'Jaipur',
  ],
};

const NOTES = {
  'Wingspan': 'Sleeved. European Expansion in the same box.',
  'Catan': 'Missing one wheat card — house rule: bank IOU.',
  'Blood on the Clocktower': 'Needs 5+ people, plan ahead!',
};

function ensureUser(username, displayName) {
  const existing = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (existing) return { user: existing, created: false };
  return { user: createUser({ username, displayName, password: PASSWORD }), created: true };
}

function addShelf(user, titles) {
  let added = 0;
  for (const title of titles) {
    const data = catalog.find((g) => g.title === title) || { title };
    const game = findOrCreateGame(data);
    const info = db
      .prepare('INSERT OR IGNORE INTO library_entries (user_id, game_id, notes) VALUES (?, ?, ?)')
      .run(user.id, game.id, NOTES[title] || '');
    added += info.changes;
  }
  return added;
}

const users = {};
let anyCreated = false;
for (const [username, displayName] of [['justin', 'Justin'], ['sam', 'Sam'], ['riley', 'Riley']]) {
  const { user, created } = ensureUser(username, displayName);
  users[username] = user;
  anyCreated = anyCreated || created;
  const added = addShelf(user, SHELVES[username]);
  console.log(`${created ? 'Created' : 'Found'} ${username} — ${added} game(s) added to their shelf`);
}

const existingCrew = db
  .prepare(
    `SELECT c.* FROM crews c JOIN crew_members cm ON cm.crew_id = c.id
     WHERE c.name = ? AND cm.user_id = ?`
  )
  .get('Friday Night Crew', users.justin.id);

let crew = existingCrew;
if (!crew) {
  crew = createCrew('Friday Night Crew', users.justin.id);
  for (const u of [users.sam, users.riley]) {
    db.prepare('INSERT OR IGNORE INTO crew_members (crew_id, user_id) VALUES (?, ?)').run(crew.id, u.id);
  }
  console.log(`Created crew "Friday Night Crew" (invite code ${crew.invite_code})`);
} else {
  console.log(`Crew "Friday Night Crew" already exists (invite code ${crew.invite_code})`);
}

console.log('\nDone! Log in with any of: justin / sam / riley — password: ' + PASSWORD);
