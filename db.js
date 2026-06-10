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
`);

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

// Find-or-create a game, deduping by title (case-insensitive) so two friends
// adding "Catan" end up pointing at the same game row. Backfills any details
// the existing row is missing.
export function findOrCreateGame(data) {
  const title = data.title.trim();
  const existing = db.prepare('SELECT * FROM games WHERE title = ? COLLATE NOCASE').get(title);
  if (existing) {
    db.prepare('UPDATE games SET year = ?, min_players = ?, max_players = ?, play_time = ?, image_url = ? WHERE id = ?')
      .run(
        existing.year ?? data.year ?? null,
        existing.min_players ?? data.minPlayers ?? null,
        existing.max_players ?? data.maxPlayers ?? null,
        existing.play_time ?? data.playTime ?? null,
        existing.image_url || data.imageUrl || null,
        existing.id
      );
    return db.prepare('SELECT * FROM games WHERE id = ?').get(existing.id);
  }
  const info = db
    .prepare('INSERT INTO games (title, year, min_players, max_players, play_time, image_url) VALUES (?, ?, ?, ?, ?, ?)')
    .run(title, data.year ?? null, data.minPlayers ?? null, data.maxPlayers ?? null, data.playTime ?? null, data.imageUrl || null);
  return db.prepare('SELECT * FROM games WHERE id = ?').get(info.lastInsertRowid);
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
    imageUrl: g.image_url,
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
