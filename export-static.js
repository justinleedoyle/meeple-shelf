// Exports a self-contained, read-only snapshot of the biggest crew's combined
// library to docs/index.html — suitable for GitHub Pages:
//
//   npm run export        # then commit & push; Pages serves /docs
//
// The page has no backend: it's the combined library with search and filters
// (players / time / category / owner), grid + "who has what" matrix views.

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const crew = db
  .prepare(
    `SELECT c.*, (SELECT COUNT(*) FROM crew_members cm WHERE cm.crew_id = c.id) AS member_count
     FROM crews c ORDER BY member_count DESC, c.id LIMIT 1`
  )
  .get();
if (!crew) {
  console.error('No crew found — run `npm run import-sheet` or `npm run seed` first.');
  process.exit(1);
}

const members = db
  .prepare(
    `SELECT u.id, u.display_name AS displayName,
      (SELECT COUNT(*) FROM library_entries le WHERE le.user_id = u.id) AS gameCount
     FROM crew_members cm JOIN users u ON u.id = cm.user_id
     WHERE cm.crew_id = ? ORDER BY cm.joined_at, u.id`
  )
  .all(crew.id);

const rows = db
  .prepare(
    `SELECT g.id, g.title, g.year, g.min_players AS minPlayers, g.max_players AS maxPlayers,
            g.play_time AS playTime, g.category, g.image_url AS imageUrl,
            u.id AS ownerId, u.display_name AS ownerName
     FROM crew_members cm
     JOIN library_entries le ON le.user_id = cm.user_id
     JOIN games g ON g.id = le.game_id
     JOIN users u ON u.id = cm.user_id
     WHERE cm.crew_id = ?
     ORDER BY g.title COLLATE NOCASE, u.display_name`
  )
  .all(crew.id);

const byGame = new Map();
for (const r of rows) {
  if (!byGame.has(r.id)) {
    byGame.set(r.id, {
      title: r.title, year: r.year, minPlayers: r.minPlayers, maxPlayers: r.maxPlayers,
      playTime: r.playTime, category: r.category, imageUrl: r.imageUrl, owners: [],
    });
  }
  byGame.get(r.id).owners.push({ id: r.ownerId, displayName: r.ownerName });
}

const data = {
  crewName: crew.name,
  generated: new Date().toISOString().slice(0, 10),
  members,
  games: [...byGame.values()],
};

const css = readFileSync(path.join(__dirname, 'public', 'styles.css'), 'utf8');
const dataJson = JSON.stringify(data).replace(/</g, '\\u003c');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${data.crewName} — Meeple Shelf</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🎲</text></svg>">
<style>
${css}
.snapshot-note { color: var(--faint); font-size: 13px; }
</style>
</head>
<body>
<main id="app"></main>
<script>
const DATA = ${dataJson};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hashStr = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return Math.abs(h); };
const MEMBER_COLORS = ['#e8a33d', '#7fb069', '#5fa8d3', '#c98bdb', '#e07a5f', '#64b6ac', '#d6c25a', '#9aa0d6'];
const memberColor = (id) => MEMBER_COLORS[id % MEMBER_COLORS.length];
const COVER_GRADS = [['#5a4632','#8a6a3f'],['#3f5a46','#5f8a62'],['#374f63','#5b7d9a'],['#5d3f5f','#8a5f8d'],['#5f4032','#9a6b4f'],['#32525a','#4f8a8a'],['#54324a','#8a4f6b'],['#4a4a32','#7d7d4f']];

function fmtPlayers(g) {
  if (g.minPlayers == null && g.maxPlayers == null) return null;
  const min = g.minPlayers ?? g.maxPlayers, max = g.maxPlayers ?? g.minPlayers;
  if (max >= 20) return '👥 ' + min + '+';
  return '👥 ' + (min === max ? min : min + '–' + max);
}
function fmtTime(g) {
  const t = g.playTime;
  if (!t) return null;
  if (t < 90) return '⏱ ' + t + ' min';
  const h = t / 60;
  return '⏱ ' + (Number.isInteger(h) ? h : h.toFixed(1)) + ' hr';
}

const state = { q: '', players: 'any', time: 'any', owner: 'all', category: 'all', sort: 'title', view: 'grid' };
const categories = [...new Set(DATA.games.map((g) => g.category).filter(Boolean))].sort();
const multiOwned = DATA.games.filter((g) => g.owners.length > 1).length;

document.getElementById('app').innerHTML = \`
<div class="container">
  <div class="page-head">
    <div>
      <h1>🎲 \${esc(DATA.crewName)}</h1>
      <div class="sub">The combined board game library · <span class="snapshot-note">read-only snapshot, updated \${DATA.generated}</span></div>
    </div>
  </div>
  <div class="members-row">
    \${DATA.members.map((m) => \`<span class="member" style="--c:\${memberColor(m.id)}"><span class="avatar">\${esc(m.displayName.slice(0, 2).toUpperCase())}</span><span class="m-name">\${esc(m.displayName)}</span><span class="m-count">\${m.gameCount}</span></span>\`).join('')}
  </div>
  <div class="stats-line">\${DATA.games.length} unique games across \${DATA.members.length} shelves\${multiOwned ? ' · ' + multiOwned + ' owned by more than one household' : ''}</div>
  <div class="filter-bar">
    <input type="text" class="search" id="f-q" placeholder="Search games…">
    <div class="filter-group" id="f-players">
      <span class="glabel">Players</span>
      \${['any','2','3','4','5','6+'].map((p) => \`<button class="chip-btn\${p === 'any' ? ' active' : ''}" data-p="\${p}">\${p === 'any' ? 'Any' : p}</button>\`).join('')}
    </div>
    <div class="filter-group"><span class="glabel">Time</span>
      <select id="f-time"><option value="any">Any</option><option value="30">Under 30 min</option><option value="60">30–60 min</option><option value="120">1–2 hr</option><option value="121">2 hr+</option></select>
    </div>
    <div class="filter-group"><span class="glabel">Owner</span>
      <select id="f-owner"><option value="all">Everyone</option>\${DATA.members.map((m) => \`<option value="\${m.id}">\${esc(m.displayName)}</option>\`).join('')}</select>
    </div>
    \${categories.length ? \`<div class="filter-group"><span class="glabel">Category</span><select id="f-category"><option value="all">All</option>\${categories.map((c) => \`<option value="\${esc(c)}">\${esc(c)}</option>\`).join('')}</select></div>\` : ''}
    <span class="nav-spacer"></span>
    <div class="segmented">
      <button data-view="grid" class="active">Grid</button>
      <button data-view="matrix">Who has what</button>
    </div>
  </div>
  <div class="result-count" id="f-count"></div>
  <div id="games"></div>
  <div class="public-footer">Built with <strong>Meeple Shelf</strong> 🎲</div>
</div>\`;

function filtered() {
  let list = [...DATA.games];
  const q = state.q.trim().toLowerCase();
  if (q) list = list.filter((g) => g.title.toLowerCase().includes(q));
  if (state.players !== 'any') {
    list = list.filter((g) => {
      if (g.minPlayers == null && g.maxPlayers == null) return true;
      const min = g.minPlayers ?? 1, max = g.maxPlayers ?? min;
      if (state.players === '6+') return max >= 6;
      const n = Number(state.players);
      return min <= n && n <= max;
    });
  }
  if (state.time !== 'any') {
    list = list.filter((g) => {
      if (!g.playTime) return true;
      if (state.time === '30') return g.playTime < 30;
      if (state.time === '60') return g.playTime >= 30 && g.playTime <= 60;
      if (state.time === '120') return g.playTime > 60 && g.playTime <= 120;
      return g.playTime > 120;
    });
  }
  if (state.owner !== 'all') list = list.filter((g) => g.owners.some((o) => String(o.id) === String(state.owner)));
  if (state.category !== 'all') list = list.filter((g) => g.category === state.category);
  list.sort((a, b) => a.title.localeCompare(b.title));
  return list;
}

function card(g) {
  const grad = COVER_GRADS[hashStr(g.title) % COVER_GRADS.length];
  const players = fmtPlayers(g), time = fmtTime(g);
  return \`<div class="game-card">
    <div class="cover" style="background:linear-gradient(135deg, \${grad[0]}, \${grad[1]})">
      <span class="cover-letter">\${esc(g.title[0].toUpperCase())}</span><span class="cover-die">🎲</span>
      \${g.imageUrl ? \`<img loading="lazy" src="\${esc(g.imageUrl)}" alt="" onerror="this.remove()">\` : ''}
    </div>
    <div class="card-body">
      <div class="card-title">\${esc(g.title)}\${g.year ? \` <span style="color:var(--faint);font-weight:400">(\${g.year})</span>\` : ''}</div>
      <div class="card-meta">\${players ? \`<span class="badge">\${players}</span>\` : ''}\${time ? \`<span class="badge">\${time}</span>\` : ''}\${g.category ? \`<span class="badge">\${esc(g.category)}</span>\` : ''}</div>
      <div class="card-owners">\${g.owners.map((o) => \`<span class="owner-chip" style="--c:\${memberColor(o.id)}">\${esc(o.displayName)}</span>\`).join('')}</div>
    </div>
  </div>\`;
}

function render() {
  const list = filtered();
  document.getElementById('f-count').textContent = list.length + ' of ' + DATA.games.length + ' games';
  const el = document.getElementById('games');
  if (!list.length) {
    el.innerHTML = '<div class="empty"><div class="e-emoji">🫥</div><h2>No games match</h2><p>Try loosening the filters.</p></div>';
    return;
  }
  if (state.view === 'grid') {
    el.innerHTML = '<div class="grid">' + list.map(card).join('') + '</div>';
  } else {
    el.innerHTML = \`<div class="matrix-wrap"><table class="matrix">
      <thead><tr><th>Game</th>\${DATA.members.map((m) => \`<th><span class="dot" style="background:\${memberColor(m.id)}"></span>\${esc(m.displayName)}</th>\`).join('')}</tr></thead>
      <tbody>\${list.map((g) => \`<tr><td><span class="g-title">\${esc(g.title)}</span>\${fmtPlayers(g) ? \`<span class="g-meta">\${fmtPlayers(g)}</span>\` : ''}</td>\${DATA.members.map((m) => \`<td>\${g.owners.some((o) => o.id === m.id) ? \`<span class="check" style="color:\${memberColor(m.id)}">✓</span>\` : ''}</td>\`).join('')}</tr>\`).join('')}</tbody>
    </table></div>\`;
  }
}
render();

document.getElementById('f-q').oninput = (e) => { state.q = e.target.value; render(); };
document.getElementById('f-players').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-p]');
  if (!btn) return;
  state.players = btn.dataset.p;
  document.querySelectorAll('#f-players .chip-btn').forEach((b) => b.classList.toggle('active', b === btn));
  render();
});
document.getElementById('f-time').onchange = (e) => { state.time = e.target.value; render(); };
document.getElementById('f-owner').onchange = (e) => { state.owner = e.target.value; render(); };
const fc = document.getElementById('f-category');
if (fc) fc.onchange = (e) => { state.category = e.target.value; render(); };
document.querySelector('.segmented').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-view]');
  if (!btn) return;
  state.view = btn.dataset.view;
  document.querySelectorAll('.segmented button').forEach((b) => b.classList.toggle('active', b === btn));
  render();
});
</script>
</body>
</html>
`;

const docsDir = path.join(__dirname, 'docs');
mkdirSync(docsDir, { recursive: true });
writeFileSync(path.join(docsDir, 'index.html'), html);
writeFileSync(path.join(docsDir, '.nojekyll'), '');
console.log(`Exported "${data.crewName}" — ${data.games.length} games, ${members.length} members → docs/index.html`);
