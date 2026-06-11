import express from 'express';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyThingMeta, mediumImageUrl } from './bgg-meta.js';
import {
  db,
  logLoanChange,
  verifyPassword,
  hashPassword,
  newSessionToken,
  newInviteCode,
  createUser,
  createCrew,
  findOrCreateGame,
  gameToJson,
  userToJson,
} from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(readFileSync(path.join(__dirname, 'data', 'popular-games.json'), 'utf8'));

// Optional big catalog built from BGG's ranked-games dataset (~30k titles with
// year + cover thumbnail). See build-bgg-catalog.js. Search works without it.
let bggCatalog = [];
try {
  bggCatalog = JSON.parse(readFileSync(path.join(__dirname, 'data', 'bgg-catalog.json'), 'utf8'))
    .map((g) => ({ title: g.t, tl: g.t.toLowerCase(), year: g.y, rank: g.r ?? 1e9, imageUrl: g.im, bggId: g.i }));
} catch {
  /* dataset not present */
}

const PROD = process.env.NODE_ENV === 'production';

const app = express();
if (PROD) app.set('trust proxy', 1);
app.use(express.json({ limit: '100kb' }));
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
  next();
});

// ---------- session helpers ----------

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function currentUser(req) {
  const token = parseCookies(req).session;
  if (!token) return null;
  return db
    .prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?')
    .get(token) || null;
}

function startSession(res, userId) {
  const token = newSessionToken();
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, userId);
  res.append('Set-Cookie', `session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=31536000${PROD ? '; Secure' : ''}`);
}

// Tiny in-memory rate limit for credential endpoints (per IP, 10 tries / 15 min).
const attempts = new Map();
function rateLimitAuth(req, res, next) {
  const key = req.ip || 'unknown';
  const now = Date.now();
  const slot = attempts.get(key);
  if (!slot || now > slot.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + 15 * 60 * 1000 });
    return next();
  }
  if (slot.count >= 10) return res.status(429).json({ error: 'Too many attempts — try again in a few minutes' });
  slot.count++;
  next();
}

function requireAuth(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Not logged in' });
  req.user = user;
  next();
}

// ---------- validation ----------

function intOrNull(v, min, max) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

function dateOrNull(v) {
  const s = String(v ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === s ? s : null; // rejects 2026-13-45
}

// scores: any finite number is accepted and rounded — half-point house scores
// shouldn't silently vanish
function scoreOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const r = Math.round(n);
  return r >= -99999 && r <= 999999 ? r : null;
}

const playTier = (n) => (n >= 25 ? 'quarter' : n >= 10 ? 'dime' : n >= 5 ? 'five' : null);

function validateGameInput(body) {
  const title = String(body.title || '').trim().slice(0, 120);
  if (!title) return null;
  let minPlayers = intOrNull(body.minPlayers, 1, 999);
  let maxPlayers = intOrNull(body.maxPlayers, 1, 999);
  if (minPlayers && maxPlayers && maxPlayers < minPlayers) [minPlayers, maxPlayers] = [maxPlayers, minPlayers];
  let imageUrl = String(body.imageUrl || '').trim().slice(0, 500);
  if (imageUrl && !/^https?:\/\//i.test(imageUrl)) imageUrl = '';
  return {
    title,
    year: intOrNull(body.year, 1, 3000),
    minPlayers,
    maxPlayers,
    playTime: intOrNull(body.playTime, 1, 6000),
    category: String(body.category || '').trim().slice(0, 60) || null,
    imageUrl: imageUrl || null,
    bggId: intOrNull(body.bggId, 1, 99999999),
  };
}

// ---------- auth routes ----------

app.post('/api/signup', rateLimitAuth, (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const displayName = String(req.body.displayName || '').trim().slice(0, 30) || username;
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    return res.status(400).json({ error: 'Username must be 3–20 characters (letters, numbers, underscores)' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  try {
    const user = createUser({ username, displayName, password });
    startSession(res, user.id);
    res.status(201).json({ user: userToJson(user) });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'That username is taken' });
    }
    throw e;
  }
});

app.post('/api/login', rateLimitAuth, (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  startSession(res, user.id);
  res.json({ user: userToJson(user) });
});

app.post('/api/logout', (req, res) => {
  const token = parseCookies(req).session;
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.append('Set-Cookie', 'session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  const user = currentUser(req);
  // pendingRequests powers the Account-tab badge: borrow requests waiting on you
  const pendingRequests = user
    ? db.prepare("SELECT COUNT(*) AS n FROM borrow_requests WHERE owner_id = ? AND status = 'pending'").get(user.id).n
    : 0;
  res.json({ user: user ? userToJson(user) : null, pendingRequests });
});

app.post('/api/me/password', requireAuth, (req, res) => {
  const current = String(req.body.currentPassword || '');
  const next = String(req.body.newPassword || '');
  if (!verifyPassword(current, req.user.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  if (next.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(next), req.user.id);
  // log out every other device, keep this session
  const token = parseCookies(req).session;
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(req.user.id, token);
  res.json({ ok: true });
});

// ---------- password reset (no email on this server, so a crewmate vouches
// for you: they generate a one-time code and hand it over in person/text) ----------

app.post('/api/crewmates/:id/reset-code', requireAuth, (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'No such user' });
  if (target.id === req.user.id) {
    return res.status(400).json({ error: 'Use "Change password" for your own account' });
  }
  if (!crewmateIds(req.user.id).includes(target.id)) {
    return res.status(403).json({ error: 'You can only generate reset codes for members of your crews' });
  }
  const raw = newInviteCode(8);
  db.transaction(() => {
    // one live code per person: a new code retires any outstanding ones
    db.prepare("UPDATE reset_codes SET used_at = datetime('now') WHERE user_id = ? AND used_at IS NULL").run(target.id);
    db.prepare("INSERT INTO reset_codes (user_id, code_hash, created_by, expires_at) VALUES (?, ?, ?, datetime('now', '+1 hour'))")
      .run(target.id, hashPassword(raw), req.user.id);
  })();
  res.status(201).json({
    code: `${raw.slice(0, 4)}-${raw.slice(4)}`,
    expiresMinutes: 60,
    username: target.username,
    displayName: target.display_name,
  });
});

app.post('/api/reset-password', rateLimitAuth, (req, res) => {
  const username = String(req.body.username || '').trim();
  const code = String(req.body.code || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  const newPassword = String(req.body.newPassword || '');
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  const candidates = user
    ? db.prepare("SELECT * FROM reset_codes WHERE user_id = ? AND used_at IS NULL AND expires_at > datetime('now')").all(user.id)
    : [];
  const match = candidates.find((c) => verifyPassword(code, c.code_hash));
  if (!match) return res.status(401).json({ error: 'Invalid or expired reset code' });
  db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), user.id);
    db.prepare("UPDATE reset_codes SET used_at = datetime('now') WHERE id = ?").run(match.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id); // every old session dies with the old password
  })();
  startSession(res, user.id);
  res.json({ user: userToJson(user) });
});

app.patch('/api/me/sharing', requireAuth, (req, res) => {
  const isPublic = req.body.isPublic ? 1 : 0;
  db.prepare('UPDATE users SET library_public = ? WHERE id = ?').run(isPublic, req.user.id);
  res.json({ user: userToJson({ ...req.user, library_public: isPublic }) });
});

// ---------- crewmates (people you share a crew with — used for "add to whose shelf") ----------

function crewmateIds(userId) {
  return db
    .prepare(
      `SELECT DISTINCT cm2.user_id AS id FROM crew_members cm1
       JOIN crew_members cm2 ON cm2.crew_id = cm1.crew_id WHERE cm1.user_id = ?`
    )
    .all(userId)
    .map((r) => r.id);
}

app.get('/api/crewmates', requireAuth, (req, res) => {
  const ids = new Set(crewmateIds(req.user.id));
  ids.add(req.user.id);
  const rows = db
    .prepare(`SELECT id, display_name FROM users WHERE id IN (${[...ids].map(() => '?').join(',')}) ORDER BY display_name`)
    .all(...ids);
  res.json({
    crewmates: rows.map((u) => ({ id: u.id, displayName: u.display_name, isMe: u.id === req.user.id })),
  });
});

// ---------- game search (community games + curated catalog + BGG dataset) ----------

app.get('/api/games/search', requireAuth, (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  if (q.length < 2) return res.json({ results: [] });

  const like = `%${q.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
  const fromDb = db
    .prepare("SELECT * FROM games WHERE title LIKE ? ESCAPE '\\' ORDER BY title COLLATE NOCASE LIMIT 12")
    .all(like)
    .map((g) => ({ source: 'community', gameId: g.id, ...gameToJson(g) }));

  const fromCatalog = catalog
    .filter((g) => g.title.toLowerCase().includes(q))
    .slice(0, 15)
    .map((g) => ({ source: 'catalog', ...g }));

  const fromBgg = bggCatalog
    .filter((g) => g.tl.includes(q))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 15)
    .map((g) => ({ source: 'bgg', title: g.title, year: g.year, imageUrl: g.imageUrl, bggId: g.bggId }));

  // Merge by title+year. Community first (has a gameId), then the curated catalog
  // (has player counts / play time), then BGG (has cover art) — later sources fill
  // in whatever fields the kept row is missing.
  const seen = new Map();
  for (const r of [...fromDb, ...fromCatalog, ...fromBgg]) {
    const key = `${r.title.toLowerCase()}|${r.year ?? ''}`;
    const ex = seen.get(key);
    if (!ex) {
      seen.set(key, { ...r });
      continue;
    }
    for (const f of ['minPlayers', 'maxPlayers', 'playTime', 'category', 'imageUrl', 'bggId']) ex[f] = ex[f] ?? r[f];
  }
  const results = [...seen.values()].sort(
    (a, b) =>
      Number(b.title.toLowerCase().startsWith(q)) - Number(a.title.toLowerCase().startsWith(q)) ||
      a.title.localeCompare(b.title)
  );
  res.json({ results: results.slice(0, 12) });
});

// Fire-and-forget: enrich a freshly added game from BGG's open endpoints —
// description, official website, and 500px art (replacing micro thumbnails).
async function upgradeGameMeta(game) {
  try {
    if (game?.bgg_id && (!game.description || !game.image_url || game.image_url.includes('__micro'))) {
      await applyThingMeta(db, game, game.bgg_id);
      return;
    }
    // no BGG id known — at least upgrade a micro thumbnail via its image id
    if (!game?.image_url?.includes('__micro')) return;
    const m = game.image_url.match(/pic(\d+)\.[a-z]+$/i);
    if (!m) return;
    const url = await mediumImageUrl(m[1]);
    if (url) db.prepare('UPDATE games SET image_url = ? WHERE id = ?').run(url, game.id);
  } catch {
    /* keep whatever we had */
  }
}

// ---------- my library ----------

const ENTRY_STATUSES = ['owned', 'wish', 'grabs'];

function entryToJson(r) {
  return {
    id: r.entry_id,
    notes: r.notes,
    addedAt: r.added_at,
    status: r.entry_status || 'owned',
    loanedTo: r.loaned_to_id ? { id: r.loaned_to_id, displayName: r.loaned_to_name } : null,
    dueDate: r.due_date_ || null,
    loanedOutAt: r.loaned_out_at || null,
    game: gameToJson(r),
  };
}

const ENTRY_SELECT = `
  SELECT le.id AS entry_id, le.notes, le.added_at, le.due_date AS due_date_, le.status AS entry_status,
         le.loaned_to AS loaned_to_id, lb.display_name AS loaned_to_name,
         (SELECT ev.out_at FROM loan_events ev
           WHERE ev.game_id = le.game_id AND ev.owner_id = le.user_id AND ev.returned_at IS NULL
           ORDER BY ev.id DESC LIMIT 1) AS loaned_out_at,
         g.*
  FROM library_entries le
  JOIN games g ON g.id = le.game_id
  LEFT JOIN users lb ON lb.id = le.loaned_to`;

function libraryEntriesFor(userId) {
  return db
    .prepare(`${ENTRY_SELECT} WHERE le.user_id = ? ORDER BY le.added_at DESC, le.id DESC`)
    .all(userId)
    .map(entryToJson);
}

app.get('/api/library', requireAuth, (req, res) => {
  res.json({ entries: libraryEntriesFor(req.user.id) });
});

app.post('/api/library', requireAuth, (req, res) => {
  let game;
  if (req.body.gameId) {
    game = db.prepare('SELECT * FROM games WHERE id = ?').get(req.body.gameId);
    if (!game) return res.status(404).json({ error: 'Game not found' });
  } else {
    const input = validateGameInput(req.body);
    if (!input) return res.status(400).json({ error: 'A game needs at least a title' });
    game = findOrCreateGame(input);
  }
  // Add for yourself by default, or for any crewmates ("ownerIds") — handy when
  // one person maintains the whole group's collection.
  let ownerIds = Array.isArray(req.body.ownerIds)
    ? [...new Set(req.body.ownerIds.map(Number).filter(Number.isInteger))]
    : [req.user.id];
  if (!ownerIds.length) ownerIds = [req.user.id];
  const allowed = new Set(crewmateIds(req.user.id));
  allowed.add(req.user.id);
  if (ownerIds.some((id) => !allowed.has(id))) {
    return res.status(403).json({ error: 'You can only add games for yourself or members of your crews' });
  }

  const notes = String(req.body.notes || '').slice(0, 500);
  const status = ENTRY_STATUSES.includes(req.body.status) ? req.body.status : 'owned';
  let added = 0;
  for (const uid of ownerIds) {
    added += db
      .prepare('INSERT OR IGNORE INTO library_entries (user_id, game_id, notes, status) VALUES (?, ?, ?, ?)')
      .run(uid, game.id, notes, status).changes;
    // buying a wishlisted game: re-adding it as owned upgrades the wish entry
    if (status === 'owned') {
      added += db
        .prepare("UPDATE library_entries SET status = 'owned' WHERE user_id = ? AND game_id = ? AND status = 'wish'")
        .run(uid, game.id).changes;
    }
  }
  upgradeGameMeta(game); // async, non-blocking
  res.status(201).json({ game: gameToJson(game), added, requested: ownerIds.length });
});

app.patch('/api/library/:id', requireAuth, (req, res) => {
  const entry = db
    .prepare('SELECT * FROM library_entries WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!entry) return res.status(404).json({ error: 'Entry not found' });
  if (req.body.notes !== undefined) {
    db.prepare('UPDATE library_entries SET notes = ? WHERE id = ?').run(String(req.body.notes).slice(0, 500), entry.id);
  }
  if (req.body.imageUrl !== undefined) {
    let imageUrl = String(req.body.imageUrl || '').trim().slice(0, 500);
    if (imageUrl && !/^https?:\/\//i.test(imageUrl)) imageUrl = '';
    db.prepare('UPDATE games SET image_url = ? WHERE id = ?').run(imageUrl || null, entry.game_id);
  }
  // Game details are shared across everyone who owns the game; any owner can fix them.
  const stats = {};
  if (req.body.year !== undefined) stats.year = intOrNull(req.body.year, 1, 3000);
  if (req.body.minPlayers !== undefined) stats.min_players = intOrNull(req.body.minPlayers, 1, 999);
  if (req.body.maxPlayers !== undefined) stats.max_players = intOrNull(req.body.maxPlayers, 1, 999);
  if (req.body.playTime !== undefined) stats.play_time = intOrNull(req.body.playTime, 1, 6000);
  if (req.body.category !== undefined) stats.category = String(req.body.category || '').trim().slice(0, 60) || null;
  if (Object.keys(stats).length) {
    db.prepare(`UPDATE games SET ${Object.keys(stats).map((k) => k + ' = ?').join(', ')} WHERE id = ?`)
      .run(...Object.values(stats), entry.game_id);
  }
  // Per-game scoring direction (shared metadata, like category). Garbage values
  // are ignored rather than nulling a direction the group chose; explicit null clears.
  if (req.body.scoreDir === null || ['high', 'low', 'coop'].includes(req.body.scoreDir)) {
    db.prepare('UPDATE games SET score_dir = ? WHERE id = ?').run(req.body.scoreDir, entry.game_id);
  }
  // Copy status: on the shelf, on the wishlist, or up for grabs. A copy that's
  // currently lent out can't become a wish — unless this same save also brings
  // it home (the edit modal clears the loan when you pick "wishlist").
  if (req.body.status !== undefined && ENTRY_STATUSES.includes(req.body.status) && req.body.status !== entry.status) {
    const returningNow = req.body.loanedTo !== undefined && (req.body.loanedTo == null || req.body.loanedTo === '');
    if (req.body.status === 'wish' && entry.loaned_to != null && !returningNow) {
      return res.status(400).json({ error: 'This copy is lent out — mark it returned before moving it to your wishlist' });
    }
    db.prepare('UPDATE library_entries SET status = ? WHERE id = ?').run(req.body.status, entry.id);
  }
  // Lend this copy to a crewmate ("loanedTo": userId) or bring it home (null),
  // optionally with a due-back date. Loan changes are journaled to loan_events.
  if (req.body.loanedTo !== undefined || req.body.dueDate !== undefined) {
    const prev = entry.loaned_to ?? null;
    let next = prev;
    if (req.body.loanedTo !== undefined) {
      next = req.body.loanedTo == null || req.body.loanedTo === '' ? null : Number(req.body.loanedTo);
      // validate only actual changes — an unchanged loan to someone who has since
      // left all shared crews must still round-trip through unrelated edits
      if (next != null && next !== prev) {
        const allowed = new Set(crewmateIds(req.user.id));
        if (next === req.user.id || !allowed.has(next)) {
          return res.status(400).json({ error: 'You can only lend games to members of your crews' });
        }
      }
    }
    const dueDate = next == null ? null : req.body.dueDate !== undefined ? dateOrNull(req.body.dueDate) : entry.due_date;
    db.transaction(() => {
      db.prepare('UPDATE library_entries SET loaned_to = ?, due_date = ? WHERE id = ?').run(next, dueDate, entry.id);
      logLoanChange(entry.game_id, req.user.id, prev, next);
    })();
  }
  const updated = db.prepare(`${ENTRY_SELECT} WHERE le.id = ?`).get(entry.id);
  res.json({ entry: entryToJson(updated) });
});

app.delete('/api/library/:id', requireAuth, (req, res) => {
  const entry = db
    .prepare('SELECT * FROM library_entries WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!entry) return res.status(404).json({ error: 'Entry not found' });
  db.transaction(() => {
    if (entry.loaned_to != null) logLoanChange(entry.game_id, entry.user_id, entry.loaned_to, null);
    db.prepare('DELETE FROM library_entries WHERE id = ?').run(entry.id);
  })();
  res.json({ ok: true });
});

// ---------- game details (public — titles and blurbs aren't secrets) ----------

app.get('/api/games/:id', (req, res) => {
  const game = db.prepare('SELECT * FROM games WHERE id = ?').get(req.params.id);
  if (!game) return res.status(404).json({ error: 'Game not found' });
  res.json({ game: { ...gameToJson(game), description: game.description } });
});

// ---------- public shared shelf ----------

app.get('/api/shared/:slug', (req, res) => {
  const owner = db.prepare('SELECT * FROM users WHERE share_slug = ?').get(req.params.slug);
  if (!owner || !owner.library_public) {
    return res.status(404).json({ error: "This shelf doesn't exist or is private" });
  }
  // public route: strip loan logistics (due dates, checkout timestamps)
  const all = libraryEntriesFor(owner.id).map(({ dueDate, loanedOutAt, ...rest }) => rest);
  res.json({
    owner: { displayName: owner.display_name },
    entries: all.filter((e) => e.status !== 'wish'),
    wishlist: all.filter((e) => e.status === 'wish').map(({ loanedTo, ...rest }) => rest),
  });
});

// ---------- crews (groups with a combined library) ----------

app.post('/api/crews', requireAuth, (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 40);
  if (!name) return res.status(400).json({ error: 'Give your crew a name' });
  const crew = createCrew(name, req.user.id);
  res.status(201).json({ crew: { id: crew.id, name: crew.name, inviteCode: crew.invite_code } });
});

app.get('/api/crews', requireAuth, (req, res) => {
  const crews = db
    .prepare(
      `SELECT c.*,
        (SELECT COUNT(*) FROM crew_members cm WHERE cm.crew_id = c.id) AS member_count,
        (SELECT COUNT(DISTINCT le.game_id) FROM crew_members cm
          JOIN library_entries le ON le.user_id = cm.user_id
          WHERE cm.crew_id = c.id AND le.status != 'wish') AS game_count
       FROM crews c JOIN crew_members me ON me.crew_id = c.id
       WHERE me.user_id = ? ORDER BY c.created_at DESC, c.id DESC`
    )
    .all(req.user.id)
    .map((c) => ({
      id: c.id,
      name: c.name,
      inviteCode: c.invite_code,
      memberCount: c.member_count,
      gameCount: c.game_count,
    }));
  res.json({ crews });
});

app.post('/api/crews/join', requireAuth, (req, res) => {
  const code = String(req.body.code || '').trim().toUpperCase();
  const crew = db.prepare('SELECT * FROM crews WHERE invite_code = ?').get(code);
  if (!crew) return res.status(404).json({ error: 'No crew found with that code' });
  const existing = db
    .prepare('SELECT 1 FROM crew_members WHERE crew_id = ? AND user_id = ?')
    .get(crew.id, req.user.id);
  if (existing) {
    return res.json({ crew: { id: crew.id, name: crew.name }, alreadyMember: true });
  }
  db.prepare('INSERT INTO crew_members (crew_id, user_id) VALUES (?, ?)').run(crew.id, req.user.id);
  res.status(201).json({ crew: { id: crew.id, name: crew.name }, alreadyMember: false });
});

app.get('/api/crews/:id', requireAuth, (req, res) => {
  const crew = db.prepare('SELECT * FROM crews WHERE id = ?').get(req.params.id);
  if (!crew) return res.status(404).json({ error: 'Crew not found' });
  const isMember = db
    .prepare('SELECT 1 FROM crew_members WHERE crew_id = ? AND user_id = ?')
    .get(crew.id, req.user.id);
  if (!isMember) return res.status(403).json({ error: 'You are not a member of this crew' });

  const members = db
    .prepare(
      `SELECT u.id, u.display_name,
        (SELECT COUNT(*) FROM library_entries le WHERE le.user_id = u.id AND le.status != 'wish') AS game_count
       FROM crew_members cm JOIN users u ON u.id = cm.user_id
       WHERE cm.crew_id = ? ORDER BY cm.joined_at, u.id`
    )
    .all(crew.id)
    .map((m) => ({ id: m.id, displayName: m.display_name, gameCount: m.game_count }));

  // The combined library: every game any member owns, with its owners attached
  // (and where each copy physically is, if lent out). Wishlist entries are
  // wants, not games on a shelf — they stay out of the combined library.
  const rows = db
    .prepare(
      `SELECT g.*, u.id AS owner_id, u.display_name AS owner_name, le.status AS entry_status,
              le.loaned_to AS loaned_to_id, lb.display_name AS loaned_to_name,
              le.due_date AS due_date_,
              (SELECT ev.out_at FROM loan_events ev
                WHERE ev.game_id = le.game_id AND ev.owner_id = le.user_id AND ev.returned_at IS NULL
                ORDER BY ev.id DESC LIMIT 1) AS loaned_out_at
       FROM crew_members cm
       JOIN library_entries le ON le.user_id = cm.user_id
       JOIN games g ON g.id = le.game_id
       JOIN users u ON u.id = cm.user_id
       LEFT JOIN users lb ON lb.id = le.loaned_to
       WHERE cm.crew_id = ? AND le.status != 'wish'
       ORDER BY g.title COLLATE NOCASE, u.display_name`
    )
    .all(crew.id);
  const tagRows = db.prepare('SELECT game_id, tag FROM game_tags WHERE crew_id = ? ORDER BY tag').all(crew.id);
  const tagsBy = new Map();
  for (const t of tagRows) {
    if (!tagsBy.has(t.game_id)) tagsBy.set(t.game_id, []);
    tagsBy.get(t.game_id).push(t.tag);
  }
  // play counts per game power the Never-played filter, Last-played sort,
  // weighted Surprise, and milestone badges — one GROUP BY, no N+1
  const playAgg = new Map(
    db.prepare('SELECT game_id, COUNT(*) AS n, MAX(played_at) AS last FROM plays WHERE crew_id = ? GROUP BY game_id')
      .all(crew.id)
      .map((r) => [r.game_id, r])
  );
  const byGame = new Map();
  for (const r of rows) {
    if (!byGame.has(r.id)) {
      byGame.set(r.id, {
        ...gameToJson(r),
        playCount: playAgg.get(r.id)?.n || 0,
        lastPlayedAt: playAgg.get(r.id)?.last || null,
        tags: tagsBy.get(r.id) || [],
        owners: [],
      });
    }
    byGame.get(r.id).owners.push({
      id: r.owner_id,
      displayName: r.owner_name,
      grabs: r.entry_status === 'grabs',
      loanedTo: r.loaned_to_id ? { id: r.loaned_to_id, displayName: r.loaned_to_name } : null,
      dueDate: r.due_date_ || null,
      loanedOutAt: r.loaned_out_at || null,
    });
  }

  res.json({
    crew: { id: crew.id, name: crew.name, inviteCode: crew.invite_code },
    members,
    games: [...byGame.values()],
  });
});

// Set exactly which crew members own a game — the "fix the matrix" endpoint.
// Only touches entries of this crew's members; other owners are unaffected.
app.put('/api/crews/:id/games/:gameId/owners', requireAuth, (req, res) => {
  const crew = db.prepare('SELECT * FROM crews WHERE id = ?').get(req.params.id);
  if (!crew) return res.status(404).json({ error: 'Crew not found' });
  const isMember = db
    .prepare('SELECT 1 FROM crew_members WHERE crew_id = ? AND user_id = ?')
    .get(crew.id, req.user.id);
  if (!isMember) return res.status(403).json({ error: 'You are not a member of this crew' });
  const game = db.prepare('SELECT * FROM games WHERE id = ?').get(req.params.gameId);
  if (!game) return res.status(404).json({ error: 'Game not found' });

  const memberIds = db
    .prepare('SELECT user_id FROM crew_members WHERE crew_id = ?')
    .all(crew.id)
    .map((r) => r.user_id);
  // Body: { owners: [{ id, loanedTo?, dueDate? }] } — loanedTo marks where that
  // copy physically is. Legacy { userIds: [...] } still accepted.
  const list = Array.isArray(req.body.owners)
    ? req.body.owners
    : Array.isArray(req.body.userIds)
      ? req.body.userIds.map((id) => ({ id }))
      : [];
  const prevLoans = new Map(
    db.prepare(`SELECT user_id, loaned_to, due_date FROM library_entries WHERE game_id = ? AND status != 'wish' AND user_id IN (${memberIds.map(() => '?').join(',')})`)
      .all(game.id, ...memberIds)
      .map((r) => [r.user_id, { loanedTo: r.loaned_to ?? null, dueDate: r.due_date ?? null }])
  );

  const want = new Map();
  for (const o of list) {
    const id = Number(o.id);
    if (!memberIds.includes(id)) return res.status(400).json({ error: 'All owners must be members of this crew' });
    // loanedTo === undefined means "don't touch the loan" (legacy bodies, stale
    // clients); null/'' means an explicit return.
    let loanedTo;
    if (o.loanedTo === undefined) loanedTo = undefined;
    else loanedTo = o.loanedTo == null || o.loanedTo === '' ? null : Number(o.loanedTo);
    // validate changes only: an unchanged cross-crew loan (rendered as the
    // "(other crew)" option) must round-trip without tripping membership checks
    if (loanedTo != null && loanedTo !== prevLoans.get(id)?.loanedTo && (loanedTo === id || !memberIds.includes(loanedTo))) {
      return res.status(400).json({ error: 'Games can only be lent to other members of this crew' });
    }
    want.set(id, { loanedTo, dueDate: o.dueDate });
  }

  db.transaction(() => {
    for (const uid of memberIds) {
      const prev = prevLoans.get(uid) ?? { loanedTo: null, dueDate: null };
      if (want.has(uid)) {
        const o = want.get(uid);
        db.prepare('INSERT OR IGNORE INTO library_entries (user_id, game_id) VALUES (?, ?)').run(uid, game.id);
        // marking someone as an owner upgrades a lingering wishlist row to a real copy
        db.prepare("UPDATE library_entries SET status = 'owned' WHERE user_id = ? AND game_id = ? AND status = 'wish'").run(uid, game.id);
        if (o.loanedTo !== undefined) {
          const next = o.loanedTo;
          // fresh due date if supplied; keep the old one only when the same loan continues
          const due = next == null ? null : o.dueDate !== undefined ? dateOrNull(o.dueDate) : next === prev.loanedTo ? prev.dueDate : null;
          db.prepare('UPDATE library_entries SET loaned_to = ?, due_date = ? WHERE user_id = ? AND game_id = ?').run(next, due, uid, game.id);
          logLoanChange(game.id, uid, prev.loanedTo, next);
        }
      } else {
        if (prev.loanedTo != null) logLoanChange(game.id, uid, prev.loanedTo, null);
        // unchecking an owner removes their copy — but never someone's wishlist row
        db.prepare("DELETE FROM library_entries WHERE user_id = ? AND game_id = ? AND status != 'wish'").run(uid, game.id);
      }
    }
  })();

  const owners = db
    .prepare(
      `SELECT u.id, u.display_name, le.loaned_to AS loaned_to_id, lb.display_name AS loaned_to_name, le.due_date AS due_date_
       FROM library_entries le JOIN users u ON u.id = le.user_id
       LEFT JOIN users lb ON lb.id = le.loaned_to
       WHERE le.game_id = ? AND le.status != 'wish' AND le.user_id IN (${memberIds.map(() => '?').join(',')}) ORDER BY u.display_name`
    )
    .all(game.id, ...memberIds);
  res.json({
    owners: owners.map((o) => ({
      id: o.id,
      displayName: o.display_name,
      loanedTo: o.loaned_to_id ? { id: o.loaned_to_id, displayName: o.loaned_to_name } : null,
      dueDate: o.due_date_ || null,
    })),
  });
});

// ---------- plays & leaderboard ----------

function memberOfCrew(req, res) {
  const crew = db.prepare('SELECT * FROM crews WHERE id = ?').get(req.params.id);
  if (!crew) {
    res.status(404).json({ error: 'Crew not found' });
    return null;
  }
  const isMember = db
    .prepare('SELECT 1 FROM crew_members WHERE crew_id = ? AND user_id = ?')
    .get(crew.id, req.user.id);
  if (!isMember) {
    res.status(403).json({ error: 'You are not a member of this crew' });
    return null;
  }
  return crew;
}

function playsFor(crewId, limit = 100, playId = null) {
  const rows = db
    .prepare(
      `SELECT p.id AS play_id, p.played_at, p.notes AS play_notes,
              p.host_user_id, hu.display_name AS host_name, g.*
       FROM plays p JOIN games g ON g.id = p.game_id
       LEFT JOIN users hu ON hu.id = p.host_user_id
       WHERE p.crew_id = ? AND (? IS NULL OR p.id = ?)
       ORDER BY p.played_at DESC, p.id DESC LIMIT ?`
    )
    .all(crewId, playId, playId, limit);
  if (!rows.length) return [];
  const ids = rows.map((r) => r.play_id);
  const players = db
    .prepare(
      `SELECT pp.play_id, pp.won, pp.score, u.id, u.display_name FROM play_players pp
       JOIN users u ON u.id = pp.user_id
       WHERE pp.play_id IN (${ids.map(() => '?').join(',')}) ORDER BY u.display_name`
    )
    .all(...ids);
  const byPlay = new Map();
  for (const p of players) {
    if (!byPlay.has(p.play_id)) byPlay.set(p.play_id, []);
    byPlay.get(p.play_id).push({ id: p.id, displayName: p.display_name, won: !!p.won, score: p.score });
  }
  return rows.map((r) => ({
    id: r.play_id,
    playedAt: r.played_at,
    notes: r.play_notes,
    host: r.host_user_id ? { id: r.host_user_id, displayName: r.host_name } : null,
    game: gameToJson(r),
    players: byPlay.get(r.play_id) || [],
  }));
}

app.post('/api/crews/:id/plays', requireAuth, (req, res) => {
  const crew = memberOfCrew(req, res);
  if (!crew) return;
  const game = db.prepare('SELECT * FROM games WHERE id = ?').get(req.body.gameId);
  if (!game) return res.status(404).json({ error: 'Game not found' });

  const memberIds = db
    .prepare('SELECT user_id FROM crew_members WHERE crew_id = ?')
    .all(crew.id)
    .map((r) => r.user_id);
  const seen = new Map();
  for (const p of Array.isArray(req.body.players) ? req.body.players : []) {
    const id = Number(p.id);
    if (Number.isInteger(id)) seen.set(id, { won: p.won ? 1 : 0, score: scoreOrNull(p.score) });
  }
  if (!seen.size) return res.status(400).json({ error: 'Pick who played' });
  for (const id of seen.keys()) {
    if (!memberIds.includes(id)) return res.status(400).json({ error: 'All players must be members of this crew' });
  }
  const hostId = intOrNull(req.body.hostId, 1, 99999999);
  if (hostId != null && !memberIds.includes(hostId)) {
    return res.status(400).json({ error: 'The host must be a member of this crew' });
  }

  const today = new Date().toISOString().slice(0, 10);
  let playedAt = dateOrNull(req.body.playedAt) || today;
  if (playedAt > today) playedAt = today; // future-dated mistaps clamp to today
  const notes = String(req.body.notes || '').slice(0, 300);
  const hasScores = [...seen.values()].some((v) => v.score != null);

  let playId;
  db.transaction(() => {
    playId = db
      .prepare('INSERT INTO plays (crew_id, game_id, played_at, notes, logged_by, host_user_id) VALUES (?, ?, ?, ?, ?, ?)')
      .run(crew.id, game.id, playedAt, notes, req.user.id, hostId).lastInsertRowid;
    for (const [uid, v] of seen) {
      db.prepare('INSERT INTO play_players (play_id, user_id, won, score) VALUES (?, ?, ?, ?)').run(playId, uid, v.won, v.score);
    }
    // lazy scoring-direction inference: first scores ever for this game default
    // to highest-wins; never overwrites a direction someone chose explicitly
    if (hasScores) {
      db.prepare("UPDATE games SET score_dir = 'high' WHERE id = ? AND score_dir IS NULL").run(game.id);
    }
  })();

  const playCount = db.prepare('SELECT COUNT(*) AS n FROM plays WHERE crew_id = ? AND game_id = ?').get(crew.id, game.id).n;
  const milestone = playCount === 25 ? 'quarter' : playCount === 10 ? 'dime' : playCount === 5 ? 'five' : null;
  res.status(201).json({ play: playsFor(crew.id, 1, Number(playId))[0] || null, milestone });
});

app.get('/api/crews/:id/plays', requireAuth, (req, res) => {
  const crew = memberOfCrew(req, res);
  if (!crew) return;
  res.json({ plays: playsFor(crew.id) });
});

app.delete('/api/crews/:id/plays/:playId', requireAuth, (req, res) => {
  const crew = memberOfCrew(req, res);
  if (!crew) return;
  const info = db.prepare('DELETE FROM plays WHERE id = ? AND crew_id = ?').run(req.params.playId, crew.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Play not found' });
  res.json({ ok: true });
});

app.get('/api/crews/:id/stats', requireAuth, (req, res) => {
  const crew = memberOfCrew(req, res);
  if (!crew) return;
  // tie-break key used wherever "most recent" decides: lexicographic max of
  // 'YYYY-MM-DD|0000000id' — latest date first, insertion order within a day
  const totals = db
    .prepare(
      `SELECT u.id, u.display_name, COUNT(*) AS plays, COALESCE(SUM(pp.won), 0) AS wins
       FROM play_players pp
       JOIN plays p ON p.id = pp.play_id
       JOIN users u ON u.id = pp.user_id
       WHERE p.crew_id = ? GROUP BY u.id`
    )
    .all(crew.id);
  const byId = new Map(totals.map((t) => [t.id, t]));

  // per-game champion (most wins; tie → most recent winning play)
  const champRows = db
    .prepare(
      `WITH win_counts AS (
         SELECT p.game_id, pp.user_id, COUNT(*) AS wins,
                MAX(p.played_at || '|' || printf('%010d', p.id)) AS last_win
         FROM plays p JOIN play_players pp ON pp.play_id = p.id
         JOIN crew_members cm ON cm.crew_id = p.crew_id AND cm.user_id = pp.user_id
         WHERE p.crew_id = ? AND pp.won = 1
         GROUP BY p.game_id, pp.user_id
       ), ranked AS (
         SELECT *, ROW_NUMBER() OVER (PARTITION BY game_id ORDER BY wins DESC, last_win DESC, user_id) AS rn
         FROM win_counts
       )
       SELECT r.game_id, r.user_id AS id, u.display_name AS displayName, r.wins
       FROM ranked r JOIN users u ON u.id = r.user_id WHERE r.rn = 1`
    )
    .all(crew.id);
  const champBy = new Map(champRows.map((c) => [c.game_id, { id: c.id, displayName: c.displayName, wins: c.wins }]));

  // nemesis per household: the winner who appears most among plays you lost
  const nemesisRows = db
    .prepare(
      `WITH beat AS (
         SELECT loser.user_id AS loser_id, winner.user_id AS winner_id, COUNT(*) AS losses,
                MAX(p.played_at || '|' || printf('%010d', p.id)) AS last_loss
         FROM plays p
         JOIN play_players loser ON loser.play_id = p.id AND loser.won = 0
         JOIN play_players winner ON winner.play_id = p.id AND winner.won = 1
         JOIN crew_members cmw ON cmw.crew_id = p.crew_id AND cmw.user_id = winner.user_id
         WHERE p.crew_id = ?
         GROUP BY loser.user_id, winner.user_id
       ), ranked AS (
         SELECT *, ROW_NUMBER() OVER (PARTITION BY loser_id ORDER BY losses DESC, last_loss DESC, winner_id) AS rn
         FROM beat
       )
       SELECT r.loser_id, r.winner_id AS id, u.display_name AS displayName, r.losses
       FROM ranked r JOIN users u ON u.id = r.winner_id WHERE r.rn = 1`
    )
    .all(crew.id);
  const nemesisBy = new Map(nemesisRows.map((n) => [n.loser_id, { id: n.id, displayName: n.displayName, losses: n.losses }]));

  // h-index per household (over plays they participated in)
  const hRows = db
    .prepare(
      `SELECT user_id, COUNT(*) AS h FROM (
         SELECT pp.user_id AS user_id, COUNT(*) AS n,
                ROW_NUMBER() OVER (PARTITION BY pp.user_id ORDER BY COUNT(*) DESC) AS rnk
         FROM plays p JOIN play_players pp ON pp.play_id = p.id
         WHERE p.crew_id = ?
         GROUP BY pp.user_id, p.game_id
       ) t WHERE t.n >= t.rnk GROUP BY user_id`
    )
    .all(crew.id);
  const hBy = new Map(hRows.map((r) => [r.user_id, r.h]));

  const hostRows = db
    .prepare(
      `SELECT host_user_id AS id, COUNT(*) AS hosted FROM plays
       WHERE crew_id = ? AND host_user_id IS NOT NULL GROUP BY host_user_id`
    )
    .all(crew.id);
  const hostBy = new Map(hostRows.map((r) => [r.id, r.hosted]));

  const members = db
    .prepare(
      `SELECT u.id, u.display_name FROM crew_members cm JOIN users u ON u.id = cm.user_id
       WHERE cm.crew_id = ? ORDER BY cm.joined_at, u.id`
    )
    .all(crew.id);
  const standings = members
    .map((m) => {
      const t = byId.get(m.id);
      const plays = t?.plays || 0;
      const wins = t?.wins || 0;
      return {
        id: m.id,
        displayName: m.display_name,
        plays,
        wins,
        winRate: plays ? Math.round((wins / plays) * 100) : 0,
        hIndex: hBy.get(m.id) || 0,
        hosted: hostBy.get(m.id) || 0,
        nemesis: nemesisBy.get(m.id) || null,
      };
    })
    .sort((a, b) => b.wins - a.wins || b.winRate - a.winRate || b.plays - a.plays || a.displayName.localeCompare(b.displayName));

  const topGames = db
    .prepare(
      `SELECT g.id, g.title, g.image_url AS imageUrl, COUNT(*) AS plays
       FROM plays p JOIN games g ON g.id = p.game_id
       WHERE p.crew_id = ? GROUP BY g.id ORDER BY plays DESC, g.title COLLATE NOCASE LIMIT 8`
    )
    .all(crew.id)
    .map((g) => ({ ...g, badge: playTier(g.plays), champion: champBy.get(g.id) || null }));

  // milestone wall: every game at 5+ plays
  const milestones = db
    .prepare(
      `SELECT g.id AS gameId, g.title, g.image_url AS imageUrl, COUNT(*) AS plays
       FROM plays p JOIN games g ON g.id = p.game_id
       WHERE p.crew_id = ? GROUP BY g.id HAVING COUNT(*) >= 5
       ORDER BY plays DESC, g.title COLLATE NOCASE`
    )
    .all(crew.id)
    .map((m) => ({ ...m, tier: playTier(m.plays), champion: champBy.get(m.gameId) || null }));

  // crew h-index + totals
  const crewH = db
    .prepare(
      `SELECT COUNT(*) AS h FROM (
         SELECT COUNT(*) AS n, ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC) AS rnk
         FROM plays WHERE crew_id = ? GROUP BY game_id
       ) t WHERE t.n >= t.rnk`
    )
    .get(crew.id).h;
  const tot = db.prepare('SELECT COUNT(*) AS n, COUNT(DISTINCT game_id) AS games FROM plays WHERE crew_id = ?').get(crew.id);

  // 52-week heatmap (sparse day → count; 372-day window absorbs UTC/local skew)
  const heatmap = Object.fromEntries(
    db.prepare("SELECT played_at AS day, COUNT(*) AS n FROM plays WHERE crew_id = ? AND played_at >= date('now', '-372 days') GROUP BY played_at")
      .all(crew.id)
      .map((r) => [r.day, r.n])
  );

  // record book: every game with at least one numeric score
  const scoredRows = db
    .prepare(
      `SELECT p.game_id, g.title, g.image_url AS imageUrl, g.score_dir,
              pp.score, u.display_name AS name, p.played_at
       FROM play_players pp
       JOIN plays p ON p.id = pp.play_id
       JOIN users u ON u.id = pp.user_id
       JOIN games g ON g.id = p.game_id
       WHERE p.crew_id = ? AND pp.score IS NOT NULL
       ORDER BY p.played_at DESC, p.id DESC`
    )
    .all(crew.id);
  const recMap = new Map();
  for (const r of scoredRows) {
    if (!recMap.has(r.game_id)) {
      recMap.set(r.game_id, { gameId: r.game_id, title: r.title, imageUrl: r.imageUrl, scoreDir: r.score_dir || 'high', scores: [] });
    }
    recMap.get(r.game_id).scores.push(r);
  }
  const records = [...recMap.values()].map((g) => {
    const vals = g.scores.map((s) => s.score);
    const best = g.scoreDir === 'low' ? Math.min(...vals) : Math.max(...vals);
    const holder = g.scores.find((s) => s.score === best); // rows are DESC → most recent achiever
    const avg = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
    return { gameId: g.gameId, title: g.title, imageUrl: g.imageUrl, scoreDir: g.scoreDir, best: { score: best, displayName: holder.name, playedAt: holder.played_at }, avg, scoredPlays: vals.length };
  });

  res.json({ standings, topGames, milestones, records, totalPlays: tot.n, distinctGames: tot.games, hIndex: crewH, heatmap });
});

// per-game crew stats for the detail modal — crew-scoped so play data never
// leaks through the public game route
app.get('/api/crews/:id/games/:gameId/stats', requireAuth, (req, res) => {
  const crew = memberOfCrew(req, res);
  if (!crew) return;
  const game = db.prepare('SELECT * FROM games WHERE id = ?').get(req.params.gameId);
  if (!game) return res.status(404).json({ error: 'Game not found' });

  const summary = db
    .prepare('SELECT COUNT(*) AS plays, MAX(played_at) AS last FROM plays WHERE crew_id = ? AND game_id = ?')
    .get(crew.id, game.id);
  const record = db
    .prepare(
      `SELECT u.id, u.display_name AS displayName, COUNT(*) AS plays, COALESCE(SUM(pp.won), 0) AS wins
       FROM play_players pp JOIN plays p ON p.id = pp.play_id JOIN users u ON u.id = pp.user_id
       WHERE p.crew_id = ? AND p.game_id = ?
       GROUP BY u.id ORDER BY wins DESC, plays DESC, u.display_name`
    )
    .all(crew.id, game.id);
  const champRow = db
    .prepare(
      `SELECT pp.user_id AS id, u.display_name AS displayName, COUNT(*) AS wins,
              MAX(p.played_at || '|' || printf('%010d', p.id)) AS last_win
       FROM plays p JOIN play_players pp ON pp.play_id = p.id JOIN users u ON u.id = pp.user_id
       JOIN crew_members cm ON cm.crew_id = p.crew_id AND cm.user_id = pp.user_id
       WHERE p.crew_id = ? AND p.game_id = ? AND pp.won = 1
       GROUP BY pp.user_id ORDER BY wins DESC, last_win DESC, pp.user_id LIMIT 1`
    )
    .get(crew.id, game.id);

  const ord = game.score_dir === 'low' ? 'ASC' : 'DESC';
  const bestRow = db
    .prepare(
      `SELECT pp.score, u.display_name AS displayName, p.played_at
       FROM play_players pp JOIN plays p ON p.id = pp.play_id JOIN users u ON u.id = pp.user_id
       WHERE p.crew_id = ? AND p.game_id = ? AND pp.score IS NOT NULL
       ORDER BY pp.score ${ord}, p.played_at DESC LIMIT 1`
    )
    .get(crew.id, game.id);

  res.json({
    stats: {
      plays: summary.plays,
      lastPlayedAt: summary.last || null,
      badge: playTier(summary.plays),
      champion: champRow ? { id: champRow.id, displayName: champRow.displayName, wins: champRow.wins } : null,
      record,
      bestScore: bestRow ? { score: bestRow.score, displayName: bestRow.displayName, playedAt: bestRow.played_at } : null,
    },
  });
});

// loan history for a game — visible to anyone sharing a crew with the lender.
// Visibility is applied in SQL *before* the LIMIT so other crews' events can't
// crowd out the caller's, and the total is a real COUNT, not the page size.
app.get('/api/games/:id/loans', requireAuth, (req, res) => {
  const game = db.prepare('SELECT id FROM games WHERE id = ?').get(req.params.id);
  if (!game) return res.status(404).json({ error: 'Game not found' });
  const visible = [...new Set([...crewmateIds(req.user.id), req.user.id])];
  const ph = visible.map(() => '?').join(',');
  const total = db
    .prepare(`SELECT COUNT(*) AS n FROM loan_events WHERE game_id = ? AND owner_id IN (${ph})`)
    .get(game.id, ...visible).n;
  const events = db
    .prepare(
      `SELECT ev.out_at, ev.returned_at,
              ou.display_name AS ownerName, bu.display_name AS borrowerName
       FROM loan_events ev
       JOIN users ou ON ou.id = ev.owner_id
       JOIN users bu ON bu.id = ev.borrower_id
       WHERE ev.game_id = ? AND ev.owner_id IN (${ph})
       ORDER BY ev.id DESC LIMIT 25`
    )
    .all(game.id, ...visible);
  res.json({ total, loans: events.map((e) => ({ ownerName: e.ownerName, borrowerName: e.borrowerName, outAt: e.out_at, returnedAt: e.returned_at })) });
});

// ---------- game nights (propose a night, RSVP, vote on what to play) ----------

const RSVP_VALUES = ['in', 'maybe', 'out'];
const timeOrNull = (v) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v ?? '').trim()) ? String(v).trim() : null);

// one loader for every events response so create/RSVP/vote all round-trip the
// same shape the list view renders
function eventsFor(crewId, userId, onlyEventId = null) {
  const events = db
    .prepare(
      `SELECT e.*, cu.display_name AS created_name, hu.display_name AS host_name
       FROM events e JOIN users cu ON cu.id = e.created_by
       LEFT JOIN users hu ON hu.id = e.host_user_id
       WHERE e.crew_id = ? AND (? IS NULL OR e.id = ?)
       ORDER BY e.event_date, e.id`
    )
    .all(crewId, onlyEventId, onlyEventId);
  if (!events.length) return [];
  const ids = events.map((e) => e.id);
  const ph = ids.map(() => '?').join(',');
  const rsvps = db
    .prepare(
      `SELECT r.event_id, r.response, u.id, u.display_name FROM event_rsvps r
       JOIN users u ON u.id = r.user_id WHERE r.event_id IN (${ph}) ORDER BY r.updated_at, u.id`
    )
    .all(...ids);
  const votes = db
    .prepare(
      `SELECT v.event_id, v.game_id, g.title, g.image_url, v.user_id, u.display_name
       FROM event_votes v JOIN games g ON g.id = v.game_id JOIN users u ON u.id = v.user_id
       WHERE v.event_id IN (${ph}) ORDER BY g.title COLLATE NOCASE`
    )
    .all(...ids);
  return events.map((e) => {
    const r = { in: [], maybe: [], out: [] };
    let myRsvp = null;
    for (const row of rsvps.filter((x) => x.event_id === e.id)) {
      r[row.response].push({ id: row.id, displayName: row.display_name });
      if (row.id === userId) myRsvp = row.response;
    }
    const byGame = new Map();
    for (const v of votes.filter((x) => x.event_id === e.id)) {
      if (!byGame.has(v.game_id)) byGame.set(v.game_id, { gameId: v.game_id, title: v.title, imageUrl: v.image_url, count: 0, voters: [], mine: false });
      const g = byGame.get(v.game_id);
      g.count++;
      g.voters.push(v.display_name);
      if (v.user_id === userId) g.mine = true;
    }
    return {
      id: e.id,
      title: e.title,
      date: e.event_date,
      time: e.start_time,
      notes: e.notes,
      canceled: !!e.canceled_at,
      createdBy: { id: e.created_by, displayName: e.created_name },
      host: e.host_user_id ? { id: e.host_user_id, displayName: e.host_name } : null,
      rsvps: r,
      myRsvp,
      votes: [...byGame.values()].sort((a, b) => b.count - a.count || a.title.localeCompare(b.title)),
    };
  });
}

app.get('/api/crews/:id/events', requireAuth, (req, res) => {
  const crew = memberOfCrew(req, res);
  if (!crew) return;
  res.json({ events: eventsFor(crew.id, req.user.id) });
});

app.post('/api/crews/:id/events', requireAuth, (req, res) => {
  const crew = memberOfCrew(req, res);
  if (!crew) return;
  const date = dateOrNull(req.body.date);
  if (!date) return res.status(400).json({ error: 'Pick a date for game night' });
  const title = String(req.body.title || '').trim().slice(0, 60) || 'Game night';
  const time = timeOrNull(req.body.time);
  const notes = String(req.body.notes || '').slice(0, 300);
  const hostId = intOrNull(req.body.hostId, 1, 99999999);
  if (hostId != null) {
    const isMember = db.prepare('SELECT 1 FROM crew_members WHERE crew_id = ? AND user_id = ?').get(crew.id, hostId);
    if (!isMember) return res.status(400).json({ error: 'The host must be a member of this crew' });
  }
  let eventId;
  db.transaction(() => {
    eventId = db
      .prepare('INSERT INTO events (crew_id, title, event_date, start_time, host_user_id, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(crew.id, title, date, time, hostId, notes, req.user.id).lastInsertRowid;
    db.prepare("INSERT INTO event_rsvps (event_id, user_id, response) VALUES (?, ?, 'in')").run(eventId, req.user.id); // planning it means you're in
  })();
  res.status(201).json({ event: eventsFor(crew.id, req.user.id, Number(eventId))[0] });
});

// shared guard: event must exist and the caller must be in its crew
function eventOfMine(req, res) {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!event) {
    res.status(404).json({ error: 'Event not found' });
    return null;
  }
  const isMember = db
    .prepare('SELECT 1 FROM crew_members WHERE crew_id = ? AND user_id = ?')
    .get(event.crew_id, req.user.id);
  if (!isMember) {
    res.status(403).json({ error: 'You are not a member of this crew' });
    return null;
  }
  return event;
}

app.patch('/api/events/:id', requireAuth, (req, res) => {
  const event = eventOfMine(req, res);
  if (!event) return;
  if (event.created_by !== req.user.id && event.host_user_id !== req.user.id) {
    return res.status(403).json({ error: 'Only the planner or the host can edit this night' });
  }
  const sets = {};
  if (req.body.title !== undefined) sets.title = String(req.body.title || '').trim().slice(0, 60) || 'Game night';
  if (req.body.date !== undefined) {
    const d = dateOrNull(req.body.date);
    if (!d) return res.status(400).json({ error: 'That date doesn’t look right' });
    sets.event_date = d;
  }
  if (req.body.time !== undefined) sets.start_time = timeOrNull(req.body.time);
  if (req.body.notes !== undefined) sets.notes = String(req.body.notes || '').slice(0, 300);
  if (req.body.hostId !== undefined) {
    const hostId = intOrNull(req.body.hostId, 1, 99999999);
    if (hostId != null) {
      const isMember = db.prepare('SELECT 1 FROM crew_members WHERE crew_id = ? AND user_id = ?').get(event.crew_id, hostId);
      if (!isMember) return res.status(400).json({ error: 'The host must be a member of this crew' });
    }
    sets.host_user_id = hostId;
  }
  if (req.body.canceled !== undefined) sets.canceled_at = req.body.canceled ? new Date().toISOString().replace('T', ' ').slice(0, 19) : null;
  if (Object.keys(sets).length) {
    db.prepare(`UPDATE events SET ${Object.keys(sets).map((k) => k + ' = ?').join(', ')} WHERE id = ?`)
      .run(...Object.values(sets), event.id);
  }
  res.json({ event: eventsFor(event.crew_id, req.user.id, event.id)[0] });
});

app.post('/api/events/:id/rsvp', requireAuth, (req, res) => {
  const event = eventOfMine(req, res);
  if (!event) return;
  if (event.canceled_at) return res.status(400).json({ error: 'This night was called off' });
  const response = String(req.body.response || '');
  if (!RSVP_VALUES.includes(response)) return res.status(400).json({ error: 'RSVP must be in, maybe, or out' });
  db.prepare(
    `INSERT INTO event_rsvps (event_id, user_id, response) VALUES (?, ?, ?)
     ON CONFLICT(event_id, user_id) DO UPDATE SET response = excluded.response, updated_at = datetime('now')`
  ).run(event.id, req.user.id, response);
  res.json({ event: eventsFor(event.crew_id, req.user.id, event.id)[0] });
});

app.post('/api/events/:id/vote', requireAuth, (req, res) => {
  const event = eventOfMine(req, res);
  if (!event) return;
  if (event.canceled_at) return res.status(400).json({ error: 'This night was called off' });
  const gameId = intOrNull(req.body.gameId, 1, 99999999);
  // votes come from the crew's actual shelves — wishes and strangers' games don't count
  const onShelf = gameId && db
    .prepare(
      `SELECT 1 FROM library_entries le JOIN crew_members cm ON cm.user_id = le.user_id AND cm.crew_id = ?
       WHERE le.game_id = ? AND le.status != 'wish' LIMIT 1`
    )
    .get(event.crew_id, gameId);
  if (!onShelf) return res.status(400).json({ error: "Pick a game from the crew's library" });
  const removed = db
    .prepare('DELETE FROM event_votes WHERE event_id = ? AND game_id = ? AND user_id = ?')
    .run(event.id, gameId, req.user.id).changes;
  if (!removed) {
    db.prepare('INSERT INTO event_votes (event_id, game_id, user_id) VALUES (?, ?, ?)').run(event.id, gameId, req.user.id);
  }
  res.json({ event: eventsFor(event.crew_id, req.user.id, event.id)[0] });
});

// ---------- borrow requests (ask → owner one-tap approves → loan opens) ----------

function borrowRequestToJson(r) {
  return {
    id: r.id,
    status: r.status,
    note: r.note,
    createdAt: r.created_at,
    resolvedAt: r.resolved_at,
    game: { id: r.game_id, title: r.title, imageUrl: r.image_url },
    owner: { id: r.owner_id, displayName: r.owner_name },
    requester: { id: r.requester_id, displayName: r.requester_name },
  };
}

const BORROW_SELECT = `
  SELECT br.*, g.title, g.image_url,
         ou.display_name AS owner_name, ru.display_name AS requester_name
  FROM borrow_requests br
  JOIN games g ON g.id = br.game_id
  JOIN users ou ON ou.id = br.owner_id
  JOIN users ru ON ru.id = br.requester_id`;

app.post('/api/games/:id/borrow-requests', requireAuth, (req, res) => {
  const game = db.prepare('SELECT * FROM games WHERE id = ?').get(req.params.id);
  if (!game) return res.status(404).json({ error: 'Game not found' });
  const ownerId = intOrNull(req.body.ownerId, 1, 99999999);
  if (ownerId == null || ownerId === req.user.id) {
    return res.status(400).json({ error: 'Pick whose copy you want to borrow' });
  }
  if (!crewmateIds(req.user.id).includes(ownerId)) {
    return res.status(403).json({ error: 'You can only borrow from members of your crews' });
  }
  const entry = db
    .prepare("SELECT * FROM library_entries WHERE user_id = ? AND game_id = ? AND status != 'wish'")
    .get(ownerId, game.id);
  if (!entry) return res.status(404).json({ error: "They don't have that game on their shelf" });
  if (entry.loaned_to === req.user.id) return res.status(400).json({ error: 'You already have this copy' });
  const dup = db
    .prepare("SELECT 1 FROM borrow_requests WHERE game_id = ? AND owner_id = ? AND requester_id = ? AND status = 'pending'")
    .get(game.id, ownerId, req.user.id);
  if (dup) return res.status(409).json({ error: 'You already asked — give them a minute' });
  const note = String(req.body.note || '').slice(0, 200);
  const info = db
    .prepare('INSERT INTO borrow_requests (game_id, owner_id, requester_id, note) VALUES (?, ?, ?, ?)')
    .run(game.id, ownerId, req.user.id, note);
  const row = db.prepare(`${BORROW_SELECT} WHERE br.id = ?`).get(info.lastInsertRowid);
  res.status(201).json({ request: borrowRequestToJson(row) });
});

app.get('/api/borrow-requests', requireAuth, (req, res) => {
  const incoming = db
    .prepare(`${BORROW_SELECT} WHERE br.owner_id = ? AND br.status = 'pending' ORDER BY br.id DESC`)
    .all(req.user.id)
    .map(borrowRequestToJson);
  // your own asks: everything open plus the last two weeks of answers
  const outgoing = db
    .prepare(
      `${BORROW_SELECT} WHERE br.requester_id = ?
       AND (br.status = 'pending' OR br.resolved_at >= datetime('now', '-14 days'))
       ORDER BY br.id DESC LIMIT 20`
    )
    .all(req.user.id)
    .map(borrowRequestToJson);
  res.json({ incoming, outgoing });
});

app.post('/api/borrow-requests/:id/respond', requireAuth, (req, res) => {
  const r = db.prepare('SELECT * FROM borrow_requests WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Request not found' });
  if (r.owner_id !== req.user.id) return res.status(403).json({ error: 'Only the owner can answer this request' });
  if (r.status !== 'pending') return res.status(409).json({ error: 'This request was already answered' });
  const action = String(req.body.action || '');
  if (action === 'decline') {
    db.prepare("UPDATE borrow_requests SET status = 'declined', resolved_at = datetime('now') WHERE id = ?").run(r.id);
  } else if (action === 'approve') {
    const entry = db
      .prepare("SELECT * FROM library_entries WHERE user_id = ? AND game_id = ? AND status != 'wish'")
      .get(r.owner_id, r.game_id);
    if (!entry) return res.status(409).json({ error: 'That game is no longer on your shelf' });
    if (entry.loaned_to != null && entry.loaned_to !== r.requester_id) {
      return res.status(409).json({ error: 'That copy is already out — mark it returned first' });
    }
    const dueDate = dateOrNull(req.body.dueDate);
    db.transaction(() => {
      db.prepare('UPDATE library_entries SET loaned_to = ?, due_date = ? WHERE id = ?').run(r.requester_id, dueDate, entry.id);
      logLoanChange(r.game_id, r.owner_id, entry.loaned_to, r.requester_id);
      db.prepare("UPDATE borrow_requests SET status = 'approved', resolved_at = datetime('now') WHERE id = ?").run(r.id);
      // same copy can't go two places: other open asks for it close out
      db.prepare(
        "UPDATE borrow_requests SET status = 'declined', resolved_at = datetime('now') WHERE game_id = ? AND owner_id = ? AND status = 'pending' AND id != ?"
      ).run(r.game_id, r.owner_id, r.id);
    })();
  } else {
    return res.status(400).json({ error: 'Action must be approve or decline' });
  }
  const row = db.prepare(`${BORROW_SELECT} WHERE br.id = ?`).get(r.id);
  res.json({ request: borrowRequestToJson(row) });
});

app.post('/api/borrow-requests/:id/cancel', requireAuth, (req, res) => {
  const r = db.prepare('SELECT * FROM borrow_requests WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Request not found' });
  if (r.requester_id !== req.user.id) return res.status(403).json({ error: 'Only the asker can cancel a request' });
  if (r.status !== 'pending') return res.status(409).json({ error: 'This request was already answered' });
  db.prepare("UPDATE borrow_requests SET status = 'canceled', resolved_at = datetime('now') WHERE id = ?").run(r.id);
  const row = db.prepare(`${BORROW_SELECT} WHERE br.id = ?`).get(r.id);
  res.json({ request: borrowRequestToJson(row) });
});

// ---------- crew tags ("gateway", "good with grandma") ----------

function normalizeTag(raw) {
  const t = String(raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9 +&'/-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24)
    .trim();
  return t.length >= 2 ? t : null;
}

function tagsFor(crewId, gameId) {
  return db.prepare('SELECT tag FROM game_tags WHERE crew_id = ? AND game_id = ? ORDER BY tag').all(crewId, gameId).map((r) => r.tag);
}

app.post('/api/crews/:id/games/:gameId/tags', requireAuth, (req, res) => {
  const crew = memberOfCrew(req, res);
  if (!crew) return;
  const tag = normalizeTag(req.body.tag);
  if (!tag) return res.status(400).json({ error: 'Tags are 2–24 letters and numbers' });
  const onShelf = db
    .prepare(
      `SELECT 1 FROM library_entries le JOIN crew_members cm ON cm.user_id = le.user_id AND cm.crew_id = ?
       WHERE le.game_id = ? AND le.status != 'wish' LIMIT 1`
    )
    .get(crew.id, req.params.gameId);
  if (!onShelf) return res.status(404).json({ error: "That game isn't in this crew's library" });
  const count = db.prepare('SELECT COUNT(*) AS n FROM game_tags WHERE crew_id = ? AND game_id = ?').get(crew.id, req.params.gameId).n;
  if (count >= 8) return res.status(400).json({ error: 'Eight tags is plenty for one game' });
  db.prepare('INSERT OR IGNORE INTO game_tags (game_id, crew_id, tag, created_by) VALUES (?, ?, ?, ?)')
    .run(req.params.gameId, crew.id, tag, req.user.id);
  res.json({ tags: tagsFor(crew.id, Number(req.params.gameId)) });
});

app.delete('/api/crews/:id/games/:gameId/tags/:tag', requireAuth, (req, res) => {
  const crew = memberOfCrew(req, res);
  if (!crew) return;
  const tag = normalizeTag(req.params.tag);
  if (tag) db.prepare('DELETE FROM game_tags WHERE crew_id = ? AND game_id = ? AND tag = ?').run(crew.id, req.params.gameId, tag);
  res.json({ tags: tagsFor(crew.id, Number(req.params.gameId)) });
});

// gift ideas: every member's wishlist in one place (member-only — the public
// shelf shows wishes too, but this works even for private shelves)
app.get('/api/crews/:id/wishlists', requireAuth, (req, res) => {
  const crew = memberOfCrew(req, res);
  if (!crew) return;
  const rows = db
    .prepare(
      `SELECT u.id AS uid, u.display_name, g.id AS gid, g.title, g.year, g.image_url
       FROM crew_members cm
       JOIN library_entries le ON le.user_id = cm.user_id AND le.status = 'wish'
       JOIN users u ON u.id = cm.user_id
       JOIN games g ON g.id = le.game_id
       WHERE cm.crew_id = ? ORDER BY u.display_name, g.title COLLATE NOCASE`
    )
    .all(crew.id);
  const byMember = new Map();
  for (const r of rows) {
    if (!byMember.has(r.uid)) byMember.set(r.uid, { id: r.uid, displayName: r.display_name, items: [] });
    byMember.get(r.uid).items.push({ gameId: r.gid, title: r.title, year: r.year, imageUrl: r.image_url });
  }
  res.json({ wishlists: [...byMember.values()] });
});

// ---------- crew activity feed (derived — no new data entry) ----------

app.get('/api/crews/:id/activity', requireAuth, (req, res) => {
  const crew = memberOfCrew(req, res);
  if (!crew) return;
  const rows = db
    .prepare(
      `SELECT * FROM (
         SELECT 'add' AS kind, le.added_at AS ts, u.display_name AS who, g.title AS title, g.id AS game_id, NULL AS extra
         FROM library_entries le
         JOIN crew_members cm ON cm.user_id = le.user_id AND cm.crew_id = @crew
         JOIN users u ON u.id = le.user_id JOIN games g ON g.id = le.game_id
         WHERE le.status != 'wish'
         UNION ALL
         SELECT 'wish', le.added_at, u.display_name, g.title, g.id, NULL
         FROM library_entries le
         JOIN crew_members cm ON cm.user_id = le.user_id AND cm.crew_id = @crew
         JOIN users u ON u.id = le.user_id JOIN games g ON g.id = le.game_id
         WHERE le.status = 'wish'
         UNION ALL
         SELECT 'loan', ev.out_at, ou.display_name, g.title, g.id, bu.display_name
         FROM loan_events ev
         JOIN crew_members cmo ON cmo.user_id = ev.owner_id AND cmo.crew_id = @crew
         JOIN crew_members cmb ON cmb.user_id = ev.borrower_id AND cmb.crew_id = @crew
         JOIN users ou ON ou.id = ev.owner_id JOIN users bu ON bu.id = ev.borrower_id
         JOIN games g ON g.id = ev.game_id
         UNION ALL
         SELECT 'return', ev.returned_at, ou.display_name, g.title, g.id, bu.display_name
         FROM loan_events ev
         JOIN crew_members cmo ON cmo.user_id = ev.owner_id AND cmo.crew_id = @crew
         JOIN crew_members cmb ON cmb.user_id = ev.borrower_id AND cmb.crew_id = @crew
         JOIN users ou ON ou.id = ev.owner_id JOIN users bu ON bu.id = ev.borrower_id
         JOIN games g ON g.id = ev.game_id
         WHERE ev.returned_at IS NOT NULL
         UNION ALL
         SELECT 'play', p.created_at, COALESCE(u.display_name, 'Someone'), g.title, g.id, p.played_at
         FROM plays p LEFT JOIN users u ON u.id = p.logged_by JOIN games g ON g.id = p.game_id
         WHERE p.crew_id = @crew
         UNION ALL
         SELECT 'night', e.created_at, u.display_name, e.title, NULL, e.event_date
         FROM events e JOIN users u ON u.id = e.created_by
         WHERE e.crew_id = @crew
       ) ORDER BY ts DESC LIMIT 40`
    )
    .all({ crew: crew.id });
  res.json({ activity: rows.map((r) => ({ kind: r.kind, ts: r.ts, who: r.who, title: r.title, gameId: r.game_id, extra: r.extra })) });
});

app.post('/api/crews/:id/leave', requireAuth, (req, res) => {
  const info = db
    .prepare('DELETE FROM crew_members WHERE crew_id = ? AND user_id = ?')
    .run(req.params.id, req.user.id);
  if (info.changes === 0) return res.status(404).json({ error: 'You are not a member of this crew' });
  const remaining = db
    .prepare('SELECT COUNT(*) AS n FROM crew_members WHERE crew_id = ?')
    .get(req.params.id).n;
  if (remaining === 0) db.prepare('DELETE FROM crews WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- static frontend ----------

// no-cache (revalidate-every-load) so phones pick up deploys immediately
app.use(
  express.static(path.join(__dirname, 'public'), {
    setHeaders: (res) => res.set('Cache-Control', 'no-cache'),
  })
);
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api/')) {
    return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
  next();
});
app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

const BASE_PORT = Number(process.env.PORT || 3000);
function listen(port, attempt = 0) {
  const server = app.listen(port, () => {
    console.log(`🎲 Meeple Shelf is up → http://localhost:${port}`);
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && attempt < 10) {
      console.log(`Port ${port} is busy, trying ${port + 1}…`);
      listen(port + 1, attempt + 1);
    } else {
      throw err;
    }
  });
}
listen(BASE_PORT);
