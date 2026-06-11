// Builds the public read-only page from data/shelf-snapshot.json + public/styles.css
// into site/ (index.html, manifest, service worker, icons). Pure Node, zero
// dependencies, no database — safe to run in CI
// (.github/workflows/publish-pages.yml deploys site/ to GitHub Pages on push).
//
//   npm run build-page   # or: npm run export (snapshot + build together)

import { mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let data;
try {
  data = JSON.parse(readFileSync(path.join(__dirname, 'data', 'shelf-snapshot.json'), 'utf8'));
} catch {
  console.error('data/shelf-snapshot.json not found — run `npm run snapshot` first.');
  process.exit(1);
}

const css = readFileSync(path.join(__dirname, 'public', 'styles.css'), 'utf8');
const dataJson = JSON.stringify(data).replace(/</g, '\\u003c');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#181412">
<meta name="robots" content="noindex">
<title>${data.crewName} — Meeple Shelf</title>
<link rel="manifest" href="./manifest.webmanifest">
<link rel="apple-touch-icon" href="./icon-180.png">
<link rel="icon" href="./icon.svg" type="image/svg+xml">
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
function expShortTitle(g) {
  const sep = g.title.indexOf(' — ');
  return sep === -1 ? g.title : g.title.slice(sep + 3);
}
function groupExpansions(list) {
  const present = new Set(list.map((g) => g.id));
  const top = [], exps = new Map();
  for (const g of list) {
    if (g.expansionOf && present.has(g.expansionOf)) {
      if (!exps.has(g.expansionOf)) exps.set(g.expansionOf, []);
      exps.get(g.expansionOf).push(g);
    } else top.push(g);
  }
  return { top, exps };
}

const state = { q: '', players: 'any', time: 'any', owner: 'all', category: 'all', view: 'grid', expanded: new Set(), packedOnly: false };
// "Packed" = games physically along for a trip/game night. Stored on this device
// (localStorage) so it works fully offline — perfect for campsites.
const packed = new Set(JSON.parse(localStorage.getItem('meeple-packed') || '[]'));
function savePacked() {
  localStorage.setItem('meeple-packed', JSON.stringify([...packed]));
  const n = document.getElementById('packed-n');
  if (n) n.textContent = packed.size;
}
const categories = [...new Set(DATA.games.map((g) => g.category).filter(Boolean))].sort();
const multiOwned = DATA.games.filter((g) => g.owners.length > 1).length;
const titleById = new Map(DATA.games.map((g) => [g.id, g.title]));

document.getElementById('app').innerHTML = \`
<div class="container">
  <div class="page-head">
    <div>
      <h1>🎲 \${esc(DATA.crewName)}</h1>
      <div class="sub">The combined board game library · <span class="snapshot-note">read-only snapshot, updated \${DATA.generated}</span></div>
    </div>
  </div>
  <div class="members-wrap">
    <div class="members-row" id="members-scroll">
      \${DATA.members.map((m) => \`<button class="member" data-member="\${m.id}" style="--c:\${memberColor(m.id)}"><span class="avatar">\${esc(m.displayName.slice(0, 2).toUpperCase())}</span><span class="m-name">\${esc(m.displayName)}</span><span class="m-count">\${m.gameCount}</span></button>\`).join('')}
    </div>
    <div class="members-fade" id="members-fade">›</div>
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
    <button class="chip-btn" id="f-packed" title="Show only games marked as packed">🎒 Packed (<span id="packed-n">0</span>)</button>
    <button class="btn" id="surprise-btn">🎲 Surprise me</button>
    <div class="segmented">
      <button data-view="grid" class="active">Grid</button>
      <button data-view="matrix">Who has what</button>
    </div>
  </div>
  <div id="surprise-result" style="display:none"></div>
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
  if (state.packedOnly) list = list.filter((g) => packed.has(g.id));
  list.sort((a, b) => a.title.localeCompare(b.title));
  return list;
}

function card(g, expansions, expanded) {
  const grad = COVER_GRADS[hashStr(g.title) % COVER_GRADS.length];
  const players = fmtPlayers(g), time = fmtTime(g);
  return \`<div class="game-card" data-game="\${g.id}">
    <div class="cover" style="background:linear-gradient(135deg, \${grad[0]}, \${grad[1]})">
      <span class="cover-letter">\${esc(g.title[0].toUpperCase())}</span><span class="cover-die">🎲</span>
      \${g.imageUrl ? \`<img loading="lazy" src="\${esc(g.imageUrl)}" alt="" onerror="this.remove()">\` : ''}
    </div>
    <button class="pack-btn\${packed.has(g.id) ? ' on' : ''}" data-pack="\${g.id}" title="Toggle packed">🎒</button>
    <div class="card-body">
      <div class="card-title">\${esc(g.title)}\${g.year ? \` <span style="color:var(--faint);font-weight:400">(\${g.year})</span>\` : ''}</div>
      <div class="card-meta">\${players ? \`<span class="badge">\${players}</span>\` : ''}\${time ? \`<span class="badge">\${time}</span>\` : ''}\${g.category ? \`<span class="badge">\${esc(g.category)}</span>\` : ''}</div>
      <div class="card-owners">\${g.owners.map((o) => \`<span class="owner-chip" style="--c:\${memberColor(o.id)}">\${esc(o.displayName)}\${o.loanedToName ? ' → ' + esc(o.loanedToName) : ''}</span>\`).join('')}</div>
      \${expansions?.length ? \`<button class="exp-line" data-toggle="\${g.id}" title="\${esc(expansions.map((e) => expShortTitle(e) + ' (' + e.owners.map((o) => o.displayName).join(', ') + ')').join('\\n'))}">＋ \${expansions.length} expansion\${expansions.length > 1 ? 's' : ''} \${expanded ? '▾' : '▸'}</button>\` : ''}
    </div>
  </div>\`;
}

function render() {
  const list = filtered();
  document.getElementById('f-count').textContent = list.length + ' of ' + DATA.games.length + ' games';
  document.querySelectorAll('#members-scroll .member').forEach((c) => c.classList.toggle('active', String(state.owner) === c.dataset.member));
  const el = document.getElementById('games');
  if (!list.length) {
    el.innerHTML = '<div class="empty"><div class="e-emoji">🫥</div><h2>No games match</h2><p>Try loosening the filters.</p></div>';
    return;
  }
  if (state.view === 'grid') {
    const { top, exps } = groupExpansions(list);
    const cards = [];
    for (const g of top) {
      const kids = exps.get(g.id);
      const expanded = state.expanded.has(g.id);
      cards.push(card(g, kids, expanded));
      if (kids && expanded) for (const e of kids) cards.push(card(e));
    }
    el.innerHTML = '<div class="grid">' + cards.join('') + '</div>';
  } else {
    const msorted = [...list].sort((a, b) => {
      const ka = a.expansionOf && titleById.has(a.expansionOf) ? titleById.get(a.expansionOf) : a.title;
      const kb = b.expansionOf && titleById.has(b.expansionOf) ? titleById.get(b.expansionOf) : b.title;
      return ka.localeCompare(kb) || (a.expansionOf ? 1 : 0) - (b.expansionOf ? 1 : 0) || a.title.localeCompare(b.title);
    });
    el.innerHTML = \`<div class="matrix-wrap"><table class="matrix">
      <thead><tr><th>Game</th>\${DATA.members.map((m) => \`<th><span class="dot" style="background:\${memberColor(m.id)}"></span>\${esc(m.displayName)}</th>\`).join('')}</tr></thead>
      <tbody>\${msorted.map((g) => {
        const isExp = g.expansionOf && titleById.has(g.expansionOf);
        return \`<tr><td>\${isExp ? '<span class="exp-arrow">↳ </span>' : ''}<span class="g-title">\${esc(isExp ? expShortTitle(g) : g.title)}</span>\${fmtPlayers(g) ? \`<span class="g-meta">\${fmtPlayers(g)}</span>\` : ''}</td>\${DATA.members.map((m) => \`<td>\${g.owners.some((o) => o.id === m.id) ? \`<span class="check" style="color:\${memberColor(m.id)}">✓</span>\` : ''}</td>\`).join('')}</tr>\`;
      }).join('')}</tbody>
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
// tap a card → description + links
const gameById = new Map(DATA.games.map((g) => [g.id, g]));
function openDetail(g) {
  const grad = COVER_GRADS[hashStr(g.title) % COVER_GRADS.length];
  const root = document.createElement('div');
  root.className = 'modal-backdrop';
  root.innerHTML = \`
    <div class="modal">
      <div class="modal-head"><h2>\${esc(g.title)}\${g.year ? \` <span style="color:var(--faint);font-weight:400">(\${g.year})</span>\` : ''}</h2><button class="modal-close">×</button></div>
      <div class="modal-body">
        <div class="gd-top">
          <div class="gd-cover" style="background:linear-gradient(135deg, \${grad[0]}, \${grad[1]})">
            \${g.imageUrl ? \`<img src="\${esc(g.imageUrl)}" alt="" onerror="this.remove()">\` : \`<span class="cover-letter" style="font-size:42px">\${esc(g.title[0].toUpperCase())}</span>\`}
          </div>
          <div class="gd-meta">
            <div class="card-meta">
              \${fmtPlayers(g) ? \`<span class="badge">\${fmtPlayers(g)}</span>\` : ''}
              \${fmtTime(g) ? \`<span class="badge">\${fmtTime(g)}</span>\` : ''}
              \${g.category ? \`<span class="badge">\${esc(g.category)}</span>\` : ''}
            </div>
            <div class="card-owners" style="margin-top:10px">\${g.owners.map((o) => \`<span class="owner-chip" style="--c:\${memberColor(o.id)}">\${esc(o.displayName)}\${o.loanedToName ? ' → ' + esc(o.loanedToName) : ''}</span>\`).join('')}</div>
          </div>
        </div>
        <p class="gd-desc">\${g.description ? esc(g.description) : '<em>No description available.</em>'}</p>
        <div class="gd-links">
          \${g.websiteUrl ? \`<a class="btn" href="\${esc(g.websiteUrl)}" target="_blank" rel="noopener">Official site ↗</a>\` : ''}
          \${g.bggId ? \`<a class="btn" href="https://boardgamegeek.com/boardgame/\${g.bggId}" target="_blank" rel="noopener">BoardGameGeek ↗</a>\` : ''}
        </div>
      </div>
    </div>\`;
  root.addEventListener('mousedown', (e) => { if (e.target === root) root.remove(); });
  root.querySelector('.modal-close').onclick = () => root.remove();
  document.body.appendChild(root);
}

document.getElementById('games').addEventListener('click', (e) => {
  const pack = e.target.closest('[data-pack]');
  if (pack) {
    const id = Number(pack.dataset.pack);
    packed.has(id) ? packed.delete(id) : packed.add(id);
    savePacked();
    render();
    return;
  }
  const tog = e.target.closest('[data-toggle]');
  if (tog) {
    const id = Number(tog.dataset.toggle);
    state.expanded.has(id) ? state.expanded.delete(id) : state.expanded.add(id);
    render();
    return;
  }
  const card = e.target.closest('[data-game]');
  if (card && !e.target.closest('button, a')) {
    const g = gameById.get(Number(card.dataset.game));
    if (g) openDetail(g);
  }
});
document.getElementById('f-packed').onclick = () => {
  state.packedOnly = !state.packedOnly;
  document.getElementById('f-packed').classList.toggle('active', state.packedOnly);
  render();
};
savePacked();

// ---- game night picker: current filters + dice ----
function surpriseHtml(g, final) {
  return \`<div class="surprise-banner">
    <div class="sb-cover">\${g.imageUrl ? \`<img src="\${esc(g.imageUrl)}" alt="" onerror="this.remove()">\` : '🎲'}</div>
    <div class="sb-body">
      <div class="sb-label">\${final ? "Tonight you're playing" : 'Rolling…'}</div>
      <div class="sb-title">\${esc(g.title)}</div>
      \${final ? \`<div class="sb-meta">\${[fmtPlayers(g), fmtTime(g)].filter(Boolean).join(' · ')}\${g.owners?.length ? ' · owned by ' + esc(g.owners.map((o) => o.displayName).join(', ')) : ''}</div>\` : ''}
    </div>
    \${final ? '<div class="sb-actions"><button class="btn btn-sm" id="sb-again">Roll again</button><button class="icon-btn" id="sb-close" title="Dismiss">✕</button></div>' : ''}
  </div>\`;
}
function rollSurprise() {
  const pool = filtered().filter((g) => !g.expansionOf && g.category !== 'Expansion for Base-game');
  const banner = document.getElementById('surprise-result');
  if (!pool.length) { banner.style.display = 'none'; return; }
  banner.style.display = '';
  let spins = 0;
  const itv = setInterval(() => {
    const g = pool[Math.floor(Math.random() * pool.length)];
    banner.innerHTML = surpriseHtml(g, spins >= 14);
    if (spins++ >= 14) clearInterval(itv);
  }, 70);
}
document.getElementById('surprise-btn').onclick = rollSurprise;
document.getElementById('surprise-result').addEventListener('click', (e) => {
  if (e.target.closest('#sb-again')) rollSurprise();
  if (e.target.closest('#sb-close')) {
    const b = document.getElementById('surprise-result');
    b.style.display = 'none';
    b.innerHTML = '';
  }
});

{
  const scroller = document.getElementById('members-scroll');
  const fade = document.getElementById('members-fade');
  const updateFade = () => {
    fade.style.opacity = scroller.scrollWidth - scroller.clientWidth - scroller.scrollLeft > 8 ? '1' : '0';
  };
  scroller.addEventListener('scroll', updateFade, { passive: true });
  window.addEventListener('resize', updateFade, { passive: true });
  updateFade();

  scroller.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-member]');
    if (!chip) return;
    state.owner = String(state.owner) === chip.dataset.member ? 'all' : chip.dataset.member;
    const sel = document.getElementById('f-owner');
    if (sel) sel.value = String(state.owner);
    render();
  });
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
</script>
</body>
</html>
`;

const manifest = {
  name: `${data.crewName} — Meeple Shelf`,
  short_name: 'Game Shelf',
  description: 'The combined board game library — who has what for game night.',
  display: 'standalone',
  start_url: './',
  scope: './',
  background_color: '#181412',
  theme_color: '#181412',
  icons: [
    { src: './icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: './icon-180.png', sizes: '180x180', type: 'image/png' },
    { src: './icon.svg', sizes: 'any', type: 'image/svg+xml' },
  ],
};

// Network-first with cache fallback: always fresh when online, still opens offline.
const sw = `const CACHE = 'meeple-shelf-v1';
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        const copy = r.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return r;
      })
      .catch(() => caches.match(e.request))
  );
});
`;

const siteDir = path.join(__dirname, 'site');
mkdirSync(siteDir, { recursive: true });
writeFileSync(path.join(siteDir, 'index.html'), html);
writeFileSync(path.join(siteDir, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2));
writeFileSync(path.join(siteDir, 'sw.js'), sw);
for (const f of ['icon.svg', 'icon-180.png', 'icon-512.png']) {
  const src = path.join(__dirname, 'public', f);
  if (existsSync(src)) copyFileSync(src, path.join(siteDir, f));
}
console.log(`Built "${data.crewName}" — ${data.games.length} games (data from ${data.generated}) → site/`);
