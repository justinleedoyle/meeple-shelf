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
  won INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (play_id, user_id)
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
]) {
  try {
    db.exec(ddl);
  } catch {
    /* column already exists */
  }
}

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
