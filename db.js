import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, 'data');
mkdirSync(dataDir, { recursive: true });

export const db = new Database(process.env.DB_PATH || path.join(dataDir, 'meeple-shelf.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  share_slug TEXT NOT NULL UNIQUE,
  library_public INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  year INTEGER,
  min_players INTEGER,
  max_players INTEGER,
  play_time INTEGER,
  category TEXT,
  image_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_games_title ON games(title COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS library_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id INTEGER NOT NULL REFERENCES games(id),
  notes TEXT NOT NULL DEFAULT '',
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, game_id)
);

CREATE TABLE IF NOT EXISTS crews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  invite_code TEXT NOT NULL UNIQUE,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS crew_members (
  crew_id INTEGER NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (crew_id, user_id)
);

CREATE TABLE IF NOT EXISTS plays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  crew_id INTEGER NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
  game_id INTEGER NOT NULL REFERENCES games(id),
  played_at TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  logged_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_plays_crew ON plays(crew_id, played_at);

CREATE TABLE IF NOT EXISTS play_players (
  play_id INTEGER NOT NULL REFERENCES plays(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  person_id INTEGER NOT NULL DEFAULT 0,
  won INTEGER NOT NULL DEFAULT 0,
  score INTEGER,
  PRIMARY KEY (play_id, user_id, person_id)
);

CREATE TABLE IF NOT EXISTS loan_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL REFERENCES games(id),
  owner_id INTEGER NOT NULL REFERENCES users(id),
  borrower_id INTEGER NOT NULL REFERENCES users(id),
  out_at TEXT NOT NULL DEFAULT (datetime('now')),
  returned_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_loan_events_open ON loan_events(owner_id, game_id);
CREATE INDEX IF NOT EXISTS idx_plays_crew_game ON plays(crew_id, game_id);

CREATE TABLE IF NOT EXISTS play_expansions (
  play_id INTEGER NOT NULL REFERENCES plays(id) ON DELETE CASCADE,
  game_id INTEGER NOT NULL REFERENCES games(id),
  PRIMARY KEY (play_id, game_id)
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  crew_id INTEGER NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Game night',
  event_date TEXT NOT NULL,
  start_time TEXT,
  host_user_id INTEGER REFERENCES users(id),
  notes TEXT NOT NULL DEFAULT '',
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  canceled_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_crew ON events(crew_id, event_date);

CREATE TABLE IF NOT EXISTS event_rsvps (
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  response TEXT NOT NULL CHECK (response IN ('in','maybe','out')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (event_id, user_id)
);

CREATE TABLE IF NOT EXISTS event_votes (
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  game_id INTEGER NOT NULL REFERENCES games(id),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (event_id, game_id, user_id)
);

CREATE TABLE IF NOT EXISTS borrow_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL REFERENCES games(id),
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined','canceled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_borrow_owner ON borrow_requests(owner_id, status);
CREATE INDEX IF NOT EXISTS idx_borrow_requester ON borrow_requests(requester_id, status);

CREATE TABLE IF NOT EXISTS reset_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE IF NOT EXISTS game_tags (
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  crew_id INTEGER NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id),
  PRIMARY KEY (game_id, crew_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_game_tags_crew ON game_tags(crew_id);

CREATE TABLE IF NOT EXISTS live_plays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  crew_id INTEGER NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
  game_id INTEGER NOT NULL REFERENCES games(id),
  event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
  host_user_id INTEGER REFERENCES users(id),
  started_by INTEGER REFERENCES users(id),
  started_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_live_plays_crew ON live_plays(crew_id);

CREATE TABLE IF NOT EXISTS live_play_players (
  live_play_id INTEGER NOT NULL REFERENCES live_plays(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  person_id INTEGER NOT NULL DEFAULT 0,
  score INTEGER,
  PRIMARY KEY (live_play_id, user_id, person_id)
);

CREATE TABLE IF NOT EXISTS live_play_expansions (
  live_play_id INTEGER NOT NULL REFERENCES live_plays(id) ON DELETE CASCADE,
  game_id INTEGER NOT NULL REFERENCES games(id),
  PRIMARY KEY (live_play_id, game_id)
);

CREATE TABLE IF NOT EXISTS people (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  household_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  retired_at TEXT,
  claimed_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_people_household ON people(household_id);
`);

// migrations for databases created before these columns existed
for (const ddl of [
  'ALTER TABLE games ADD COLUMN category TEXT',
  'ALTER TABLE games ADD COLUMN expansion_of INTEGER REFERENCES games(id)',
  'ALTER TABLE library_entries ADD COLUMN loaned_to INTEGER REFERENCES users(id)',
  'ALTER TABLE games ADD COLUMN bgg_id INTEGER',
  'ALTER TABLE games ADD COLUMN description TEXT',
  'ALTER TABLE games ADD COLUMN website_url TEXT',
  'ALTER TABLE play_players ADD COLUMN score INTEGER',
  'ALTER TABLE games ADD COLUMN score_dir TEXT',
  'ALTER TABLE plays ADD COLUMN host_user_id INTEGER REFERENCES users(id)',
  'ALTER TABLE library_entries ADD COLUMN due_date TEXT',
  "ALTER TABLE library_entries ADD COLUMN status TEXT NOT NULL DEFAULT 'owned'",
  // SET NULL keeps the events→plays edge safe when a crew delete cascades both tables
  'ALTER TABLE plays ADD COLUMN event_id INTEGER REFERENCES events(id) ON DELETE SET NULL',
  'ALTER TABLE plays ADD COLUMN duration_min INTEGER',
  'ALTER TABLE plays ADD COLUMN coop_result TEXT',
]) {
  try {
    db.exec(ddl);
  } catch {
    /* column already exists */
  }
}

// ---- player-layer migration: add the person dimension to play rosters ----
// PK(play_id, user_id) can't hold two siblings from one household on one play,
// and ALTER can't change a PK — so the table is rebuilt with person_id in the
// key. person_id=0 is the "whole household" sentinel (NULL-in-PK would let
// duplicate household rows coexist; SQLite treats NULLs as distinct in unique
// indexes). Legacy rows become person_id=0 rows; every existing query keeps
// working because all inserts name their columns.
function addPersonDimension({ table, refCol, refTable, hasWon }) {
  const hasPersonCol = () => db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = 'person_id'`).get();
  if (hasPersonCol()) return; // column presence IS the idempotence marker
  db.pragma('foreign_keys = OFF'); // must happen OUTSIDE the txn — it's a silent no-op inside one
  try {
    // IMMEDIATE: take the write lock before the re-check, so a second process
    // racing this boot waits on busy_timeout and then no-ops instead of dying
    // on a snapshot-upgrade SQLITE_BUSY mid-rebuild
    db.transaction(() => {
      if (hasPersonCol()) return; // re-check: two dev processes can share one DB
      db.exec(`
        DROP VIEW IF EXISTS play_household_results;
        DROP TABLE IF EXISTS ${table}_new;
        CREATE TABLE ${table}_new (
          ${refCol} INTEGER NOT NULL REFERENCES ${refTable}(id) ON DELETE CASCADE,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          person_id INTEGER NOT NULL DEFAULT 0,
          ${hasWon ? 'won INTEGER NOT NULL DEFAULT 0,' : ''}
          score INTEGER,
          PRIMARY KEY (${refCol}, user_id, person_id)
        );
        INSERT INTO ${table}_new (${refCol}, user_id, person_id, ${hasWon ? 'won, ' : ''}score)
          SELECT ${refCol}, user_id, 0, ${hasWon ? 'won, ' : ''}score FROM ${table};
        DROP TABLE ${table};
        ALTER TABLE ${table}_new RENAME TO ${table};
      `);
      const bad = db.pragma(`foreign_key_check(${table})`);
      if (bad.length) throw new Error(`${table} person_id rebuild produced FK violations`); // throw → full rollback
    }).immediate();
  } finally {
    db.pragma('foreign_keys = ON'); // restore even on throw; boot also re-asserts ON above
  }
}
addPersonDimension({ table: 'play_players', refCol: 'play_id', refTable: 'plays', hasWon: true });
addPersonDimension({ table: 'live_play_players', refCol: 'live_play_id', refTable: 'live_plays', hasWon: false });

// the ONE definition of household grain: a household won a play iff any of its
// identities (the bare household row or any tagged person) won. With zero
// person rows this view is row-for-row identical to the table, so legacy
// household stats are byte-identical by construction. Recreated every boot so
// a definition change can never go stale; deliberately EXCLUDES score (scores
// are row-grain facts — records read the raw table on purpose).
db.exec(`
DROP VIEW IF EXISTS play_household_results;
CREATE VIEW play_household_results AS
  SELECT play_id, user_id, MAX(won) AS won FROM play_players GROUP BY play_id, user_id;
CREATE INDEX IF NOT EXISTS idx_play_players_person ON play_players(person_id);
`);

// one-shot backfill: open a loan event for copies already lent out before the
// loan-history feature existed (idempotent — no-op once loan_events has rows).
// out_at uses the entry's added_at as the best available floor for "when".
try {
  db.exec(`
  INSERT INTO loan_events (game_id, owner_id, borrower_id, out_at)
  SELECT le.game_id, le.user_id, le.loaned_to, COALESCE(le.added_at, datetime('now'))
  FROM library_entries le
  WHERE le.loaned_to IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM loan_events);
  `);
} catch (e) {
  console.error('loan_events backfill failed (continuing):', e.message);
}

// THE single loan_events writer: closes the open event and/or opens a new one
// when a copy's borrower changes. null→B opens; A→null closes; A→B does both.
// The close runs unconditionally so "at most one open event per (game, owner)"
// self-heals even if the journal ever desyncs from loaned_to.
export function logLoanChange(gameId, ownerId, prev, next) {
  if ((prev ?? null) === (next ?? null)) return;
  db.prepare("UPDATE loan_events SET returned_at = datetime('now') WHERE game_id = ? AND owner_id = ? AND returned_at IS NULL")
    .run(gameId, ownerId);
  if (next != null) {
    db.prepare('INSERT INTO loan_events (game_id, owner_id, borrower_id) VALUES (?, ?, ?)').run(gameId, ownerId, next);
  }
}

// ---------- auth helpers ----------

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split('$');
  if (!salt || !hash) return false;
  const test = scryptSync(password, salt, 64);
  const real = Buffer.from(hash, 'hex');
  return test.length === real.length && timingSafeEqual(test, real);
}

// Invite codes skip lookalike characters (0/O, 1/I/L) so they survive being read aloud.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function newInviteCode(len = 6) {
  const bytes = randomBytes(len);
  let out = '';
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return out;
}

export function newShareSlug() {
  return randomBytes(5).toString('hex');
}

export function newSessionToken() {
  return randomBytes(32).toString('hex');
}

// ---------- shared operations (used by server.js and seed.js) ----------

export function createUser({ username, displayName, password }) {
  const info = db
    .prepare('INSERT INTO users (username, display_name, password_hash, share_slug) VALUES (?, ?, ?, ?)')
    .run(username, displayName, hashPassword(password), newShareSlug());
  return db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
}

export function normTitle(t) {
  return t
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/^the /, '');
}

// Expansions named like "Wingspan — European Expansion" (the sheet's convention)
// get linked to their base game when one exists, so the combined view can group
// them under the base game's card.
export function autoLinkExpansion(game) {
  if (!game || game.expansion_of || game.category !== 'Expansion for Base-game') return game;
  const sep = game.title.indexOf(' — ');
  if (sep === -1) return game;
  const baseTitle = game.title.slice(0, sep).trim();
  let base = db
    .prepare("SELECT * FROM games WHERE title = ? COLLATE NOCASE AND id != ? AND category IS NOT 'Expansion for Base-game'")
    .get(baseTitle, game.id);
  if (!base) {
    // fuzzy fallback: "Viticulture — Tuscany…" → base "Viticulture: Essential Edition"
    const n = normTitle(baseTitle);
    const candidates = db
      .prepare("SELECT * FROM games WHERE id != ? AND category IS NOT 'Expansion for Base-game'")
      .all(game.id)
      .filter((g) => {
        const gn = normTitle(g.title);
        return gn === n || gn.startsWith(n + ' ') || n.startsWith(gn + ' ');
      });
    if (candidates.length === 1) base = candidates[0];
  }
  if (base) {
    db.prepare('UPDATE games SET expansion_of = ? WHERE id = ?').run(base.id, game.id);
    game.expansion_of = base.id;
  }
  return game;
}

// Find-or-create a game, deduping by title (case-insensitive) so two friends
// adding "Catan" end up pointing at the same game row. Backfills any details
// the existing row is missing.
export function findOrCreateGame(data) {
  const title = data.title.trim();
  const existing = db.prepare('SELECT * FROM games WHERE title = ? COLLATE NOCASE').get(title);
  if (existing) {
    db.prepare('UPDATE games SET year = ?, min_players = ?, max_players = ?, play_time = ?, category = ?, image_url = ?, bgg_id = ? WHERE id = ?')
      .run(
        existing.year ?? data.year ?? null,
        existing.min_players ?? data.minPlayers ?? null,
        existing.max_players ?? data.maxPlayers ?? null,
        existing.play_time ?? data.playTime ?? null,
        existing.category || data.category || null,
        existing.image_url || data.imageUrl || null,
        existing.bgg_id ?? data.bggId ?? null,
        existing.id
      );
    return autoLinkExpansion(db.prepare('SELECT * FROM games WHERE id = ?').get(existing.id));
  }
  const info = db
    .prepare('INSERT INTO games (title, year, min_players, max_players, play_time, category, image_url, bgg_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(title, data.year ?? null, data.minPlayers ?? null, data.maxPlayers ?? null, data.playTime ?? null, data.category || null, data.imageUrl || null, data.bggId ?? null);
  return autoLinkExpansion(db.prepare('SELECT * FROM games WHERE id = ?').get(info.lastInsertRowid));
}

export function createCrew(name, userId) {
  for (;;) {
    try {
      const info = db
        .prepare('INSERT INTO crews (name, invite_code, created_by) VALUES (?, ?, ?)')
        .run(name, newInviteCode(), userId);
      const crew = db.prepare('SELECT * FROM crews WHERE id = ?').get(info.lastInsertRowid);
      db.prepare('INSERT INTO crew_members (crew_id, user_id) VALUES (?, ?)').run(crew.id, userId);
      return crew;
    } catch (e) {
      // invite_code collision → roll a new code and retry
      if (!String(e.message).includes('UNIQUE')) throw e;
    }
  }
}

export function gameToJson(g) {
  return {
    id: g.id,
    title: g.title,
    year: g.year,
    minPlayers: g.min_players,
    maxPlayers: g.max_players,
    playTime: g.play_time,
    category: g.category,
    expansionOf: g.expansion_of,
    imageUrl: g.image_url,
    bggId: g.bgg_id,
    websiteUrl: g.website_url,
    scoreDir: g.score_dir,
  };
}

export function userToJson(u) {
  return {
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    shareSlug: u.share_slug,
    libraryPublic: !!u.library_public,
  };
}
