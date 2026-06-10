import express from 'express';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  db,
  verifyPassword,
  newSessionToken,
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
    .map((g) => ({ title: g.t, tl: g.t.toLowerCase(), year: g.y, rank: g.r ?? 1e9, imageUrl: g.im }));
} catch {
  /* dataset not present */
}

const app = express();
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
  res.append('Set-Cookie', `session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=31536000`);
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
  };
}

// ---------- auth routes ----------

app.post('/api/signup', (req, res) => {
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

app.post('/api/login', (req, res) => {
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
  res.json({ user: user ? userToJson(user) : null });
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
    .map((g) => ({ source: 'bgg', title: g.title, year: g.year, imageUrl: g.imageUrl }));

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
    for (const f of ['minPlayers', 'maxPlayers', 'playTime', 'category', 'imageUrl']) ex[f] = ex[f] ?? r[f];
  }
  const results = [...seen.values()].sort(
    (a, b) =>
      Number(b.title.toLowerCase().startsWith(q)) - Number(a.title.toLowerCase().startsWith(q)) ||
      a.title.localeCompare(b.title)
  );
  res.json({ results: results.slice(0, 12) });
});

// ---------- my library ----------

function entryToJson(r) {
  return {
    id: r.entry_id,
    notes: r.notes,
    addedAt: r.added_at,
    loanedTo: r.loaned_to_id ? { id: r.loaned_to_id, displayName: r.loaned_to_name } : null,
    game: gameToJson(r),
  };
}

const ENTRY_SELECT = `
  SELECT le.id AS entry_id, le.notes, le.added_at,
         le.loaned_to AS loaned_to_id, lb.display_name AS loaned_to_name, g.*
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
  let added = 0;
  for (const uid of ownerIds) {
    added += db
      .prepare('INSERT OR IGNORE INTO library_entries (user_id, game_id, notes) VALUES (?, ?, ?)')
      .run(uid, game.id, notes).changes;
  }
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
  // Lend this copy to a crewmate ("loanedTo": userId) or bring it home (null)
  if (req.body.loanedTo !== undefined) {
    const loanedTo = req.body.loanedTo == null || req.body.loanedTo === '' ? null : Number(req.body.loanedTo);
    if (loanedTo != null) {
      const allowed = new Set(crewmateIds(req.user.id));
      if (loanedTo === req.user.id || !allowed.has(loanedTo)) {
        return res.status(400).json({ error: 'You can only lend games to members of your crews' });
      }
    }
    db.prepare('UPDATE library_entries SET loaned_to = ? WHERE id = ?').run(loanedTo, entry.id);
  }
  const updated = db.prepare(`${ENTRY_SELECT} WHERE le.id = ?`).get(entry.id);
  res.json({ entry: entryToJson(updated) });
});

app.delete('/api/library/:id', requireAuth, (req, res) => {
  const info = db
    .prepare('DELETE FROM library_entries WHERE id = ? AND user_id = ?')
    .run(req.params.id, req.user.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Entry not found' });
  res.json({ ok: true });
});

// ---------- public shared shelf ----------

app.get('/api/shared/:slug', (req, res) => {
  const owner = db.prepare('SELECT * FROM users WHERE share_slug = ?').get(req.params.slug);
  if (!owner || !owner.library_public) {
    return res.status(404).json({ error: "This shelf doesn't exist or is private" });
  }
  res.json({ owner: { displayName: owner.display_name }, entries: libraryEntriesFor(owner.id) });
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
          WHERE cm.crew_id = c.id) AS game_count
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
        (SELECT COUNT(*) FROM library_entries le WHERE le.user_id = u.id) AS game_count
       FROM crew_members cm JOIN users u ON u.id = cm.user_id
       WHERE cm.crew_id = ? ORDER BY cm.joined_at, u.id`
    )
    .all(crew.id)
    .map((m) => ({ id: m.id, displayName: m.display_name, gameCount: m.game_count }));

  // The combined library: every game any member owns, with its owners attached
  // (and where each copy physically is, if lent out).
  const rows = db
    .prepare(
      `SELECT g.*, u.id AS owner_id, u.display_name AS owner_name,
              le.loaned_to AS loaned_to_id, lb.display_name AS loaned_to_name
       FROM crew_members cm
       JOIN library_entries le ON le.user_id = cm.user_id
       JOIN games g ON g.id = le.game_id
       JOIN users u ON u.id = cm.user_id
       LEFT JOIN users lb ON lb.id = le.loaned_to
       WHERE cm.crew_id = ?
       ORDER BY g.title COLLATE NOCASE, u.display_name`
    )
    .all(crew.id);
  const byGame = new Map();
  for (const r of rows) {
    if (!byGame.has(r.id)) byGame.set(r.id, { ...gameToJson(r), owners: [] });
    byGame.get(r.id).owners.push({
      id: r.owner_id,
      displayName: r.owner_name,
      loanedTo: r.loaned_to_id ? { id: r.loaned_to_id, displayName: r.loaned_to_name } : null,
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
  // Body: { owners: [{ id, loanedTo? }] } — loanedTo marks where that copy
  // physically is. Legacy { userIds: [...] } still accepted.
  const list = Array.isArray(req.body.owners)
    ? req.body.owners
    : Array.isArray(req.body.userIds)
      ? req.body.userIds.map((id) => ({ id }))
      : [];
  const want = new Map();
  for (const o of list) {
    const id = Number(o.id);
    const loanedTo = o.loanedTo == null || o.loanedTo === '' ? null : Number(o.loanedTo);
    if (!memberIds.includes(id)) return res.status(400).json({ error: 'All owners must be members of this crew' });
    if (loanedTo != null && (loanedTo === id || !memberIds.includes(loanedTo))) {
      return res.status(400).json({ error: 'Games can only be lent to other members of this crew' });
    }
    want.set(id, loanedTo);
  }

  db.transaction(() => {
    for (const uid of memberIds) {
      if (want.has(uid)) {
        db.prepare('INSERT OR IGNORE INTO library_entries (user_id, game_id) VALUES (?, ?)').run(uid, game.id);
        db.prepare('UPDATE library_entries SET loaned_to = ? WHERE user_id = ? AND game_id = ?').run(want.get(uid), uid, game.id);
      } else {
        db.prepare('DELETE FROM library_entries WHERE user_id = ? AND game_id = ?').run(uid, game.id);
      }
    }
  })();

  const owners = db
    .prepare(
      `SELECT u.id, u.display_name, le.loaned_to AS loaned_to_id, lb.display_name AS loaned_to_name
       FROM library_entries le JOIN users u ON u.id = le.user_id
       LEFT JOIN users lb ON lb.id = le.loaned_to
       WHERE le.game_id = ? AND le.user_id IN (${memberIds.map(() => '?').join(',')}) ORDER BY u.display_name`
    )
    .all(game.id, ...memberIds);
  res.json({
    owners: owners.map((o) => ({
      id: o.id,
      displayName: o.display_name,
      loanedTo: o.loaned_to_id ? { id: o.loaned_to_id, displayName: o.loaned_to_name } : null,
    })),
  });
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

app.use(express.static(path.join(__dirname, 'public')));
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
