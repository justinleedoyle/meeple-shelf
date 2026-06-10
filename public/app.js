'use strict';

// ===================== helpers =====================

const $ = (sel, root = document) => root.querySelector(sel);
const appEl = $('#app');
const navEl = $('#nav');
const modalRoot = $('#modal-root');
const toastRoot = $('#toast-root');

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const MEMBER_COLORS = ['#e8a33d', '#7fb069', '#5fa8d3', '#c98bdb', '#e07a5f', '#64b6ac', '#d6c25a', '#9aa0d6'];
const memberColor = (id) => MEMBER_COLORS[id % MEMBER_COLORS.length];

// Category vocabulary from the shared sheet — offered as autocomplete suggestions.
const CATEGORY_LIST = ['Abstract Strategy', 'Action / Dexterity', 'Adventure', 'American West', 'Animals', 'Aviation / Flight', 'Bluffing', 'Card Game', "Children's Game", 'City Building', 'Civilization', 'Deduction', 'Dice', 'Economic', 'Educational', 'Environmental', 'Expansion for Base-game', 'Exploration', 'Fantasy', 'Farming', 'Fighting', 'Horror', 'Humor', 'Maze', 'Mature / Adult', 'Medical', 'Medieval', 'Memory', 'Movies / TV / Radio theme', 'Murder / Mystery', 'Music', 'Mythology', 'Nautical', 'Negotiation', 'Novel-based', 'Number', 'Party Game', 'Pirates', 'Political', 'Puzzle', 'Racing', 'Real-time', 'Science Fiction', 'Space Exploration', 'Spies / Secret Agents', 'Sports', 'Territory Building', 'Trains', 'Transportation', 'Travel', 'Trivia', 'Video Game Theme', 'Wargame', 'Word Game'];
const catDatalist = () => `<datalist id="cat-list">${CATEGORY_LIST.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>`;

const COVER_GRADS = [
  ['#5a4632', '#8a6a3f'], ['#3f5a46', '#5f8a62'], ['#374f63', '#5b7d9a'], ['#5d3f5f', '#8a5f8d'],
  ['#5f4032', '#9a6b4f'], ['#32525a', '#4f8a8a'], ['#54324a', '#8a4f6b'], ['#4a4a32', '#7d7d4f'],
];

function fmtPlayers(g) {
  if (g.minPlayers == null && g.maxPlayers == null) return null;
  const min = g.minPlayers ?? g.maxPlayers;
  const max = g.maxPlayers ?? g.minPlayers;
  if (max >= 20) return `👥 ${min}+`;
  return `👥 ${min === max ? min : `${min}–${max}`}`;
}

function fmtTime(g) {
  const t = g.playTime;
  if (!t) return null;
  if (t < 90) return `⏱ ${t} min`;
  const hrs = t / 60;
  return `⏱ ${Number.isInteger(hrs) ? hrs : hrs.toFixed(1)} hr`;
}

function fmtDate(s) {
  if (!s) return '';
  const d = new Date(s.replace(' ', 'T') + 'Z');
  return isNaN(d) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  toastRoot.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 250); }, 2400);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast('Copied to clipboard');
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api' + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// ===================== modal =====================

let modalDirty = false; // something changed inside the modal → re-render page on close

function openModal(innerHtml) {
  modalRoot.innerHTML = `<div class="modal-backdrop"><div class="modal">${innerHtml}</div></div>`;
  const backdrop = $('.modal-backdrop');
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) closeModal(); });
  const x = $('.modal-close', backdrop);
  if (x) x.onclick = closeModal;
  return $('.modal', backdrop);
}

function closeModal() {
  if (!modalRoot.innerHTML) return;
  modalRoot.innerHTML = '';
  if (modalDirty) { modalDirty = false; route(); }
}

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

// ===================== shared renderers =====================

function emptyState(emoji, title, bodyHtml, ctaHtml = '') {
  return `<div class="empty"><div class="e-emoji">${emoji}</div><h2>${title}</h2><p>${bodyHtml}</p>${ctaHtml}</div>`;
}

// Group a filtered list so expansions nest under their base game's card —
// but only when the base is present in the same list; orphans stay standalone.
function groupExpansions(list) {
  const present = new Set(list.map((g) => g.id));
  const top = [];
  const exps = new Map();
  for (const g of list) {
    if (g.expansionOf && present.has(g.expansionOf)) {
      if (!exps.has(g.expansionOf)) exps.set(g.expansionOf, []);
      exps.get(g.expansionOf).push(g);
    } else {
      top.push(g);
    }
  }
  return { top, exps };
}

// "Wingspan — European Expansion" → "European Expansion" (for compact lists)
function expShortTitle(g) {
  const sep = g.title.indexOf(' — ');
  return sep === -1 ? g.title : g.title.slice(sep + 3);
}

function gameCardHtml(game, { entryId, gameId, notes, addedAt, owners, actions, editOwners, loanedTo, expansions, expanded } = {}) {
  const grad = COVER_GRADS[hashStr(game.title) % COVER_GRADS.length];
  const players = fmtPlayers(game);
  const time = fmtTime(game);
  return `
  <div class="game-card"${entryId ? ` data-entry="${entryId}"` : ''}${gameId ? ` data-game="${gameId}"` : ''}>
    <div class="cover" style="background:linear-gradient(135deg, ${grad[0]}, ${grad[1]})">
      <span class="cover-letter">${esc((game.title || '?')[0].toUpperCase())}</span>
      <span class="cover-die">🎲</span>
      ${game.imageUrl ? `<img loading="lazy" src="${esc(game.imageUrl)}" alt="" onerror="this.remove()">` : ''}
    </div>
    ${actions ? `<div class="card-actions">
      <button class="icon-btn" data-act="edit" title="Edit details">✎</button>
      <button class="icon-btn danger" data-act="remove" title="Remove from shelf">✕</button>
    </div>` : ''}
    ${editOwners ? `<div class="card-actions">
      <button class="icon-btn" data-act="owners" title="Edit who owns this">✎</button>
    </div>` : ''}
    <div class="card-body">
      <div class="card-title">${esc(game.title)}${game.year ? ` <span style="color:var(--faint);font-weight:400">(${game.year})</span>` : ''}</div>
      <div class="card-meta">
        ${players ? `<span class="badge">${players}</span>` : ''}
        ${time ? `<span class="badge">${time}</span>` : ''}
        ${game.category ? `<span class="badge">${esc(game.category)}</span>` : ''}
        ${loanedTo ? `<span class="badge loan">📍 with ${esc(loanedTo.displayName)}</span>` : ''}
      </div>
      ${notes ? `<div class="card-notes">${esc(notes)}</div>` : ''}
      ${owners ? `<div class="card-owners">${owners.map((o) => `<span class="owner-chip" style="--c:${memberColor(o.id)}">${esc(o.displayName)}${o.loanedTo ? ` → ${esc(o.loanedTo.displayName)}` : ''}</span>`).join('')}</div>` : ''}
      ${expansions?.length ? `<button class="exp-line" data-act="toggle-exp" title="${esc(expansions.map((e) => `${expShortTitle(e)} (${(e.owners || []).map((o) => o.displayName).join(', ')})`).join('\n'))}">＋ ${expansions.length} expansion${expansions.length > 1 ? 's' : ''} ${expanded ? '▾' : '▸'}</button>` : ''}
      ${addedAt ? `<div class="added-date">Added ${fmtDate(addedAt)}</div>` : ''}
    </div>
  </div>`;
}

// ===================== state & router =====================

const state = { user: null };

function renderNav(active) {
  if (!state.user) {
    navEl.innerHTML = location.hash.startsWith('#/u/')
      ? `<a class="brand" href="#/welcome">🎲 Meeple Shelf</a><span class="nav-spacer"></span><a class="btn btn-primary btn-sm" href="#/welcome">Make your own shelf</a>`
      : '';
    return;
  }
  navEl.innerHTML = `
    <a class="brand" href="#/library">🎲 Meeple Shelf</a>
    <div class="nav-links">
      <a class="nav-link ${active === 'library' ? 'active' : ''}" href="#/library">My Shelf</a>
      <a class="nav-link ${active === 'crews' || active === 'crew' ? 'active' : ''}" href="#/crews">Crews</a>
    </div>
    <span class="nav-spacer"></span>
    <span class="nav-user">Hi, ${esc(state.user.displayName)}</span>
    <button class="btn btn-ghost btn-sm" id="logout-btn">Log out</button>`;
  $('#logout-btn').onclick = async () => {
    await api('/logout', { method: 'POST' });
    state.user = null;
    location.hash = '#/welcome';
  };
}

async function route() {
  closeModal();
  const hash = location.hash.replace(/^#\/?/, '');
  const [page, arg] = hash.split('/');
  renderNav(page || 'library');
  try {
    if (page === 'u' && arg) return await viewPublicShelf(arg);
    if (!state.user) return viewWelcome();
    if (page === 'welcome') { location.hash = '#/library'; return; }
    if (page === 'crews') return await viewCrews();
    if (page === 'crew' && arg) return await viewCrewDetail(Number(arg));
    return await viewLibrary();
  } catch (e) {
    if (e.status === 401) {
      state.user = null;
      renderNav();
      viewWelcome();
      return;
    }
    appEl.innerHTML = `<div class="container">${emptyState(e.status === 403 || e.status === 404 ? '🚪' : '⚠️', e.status === 404 ? 'Not found' : 'Hmm', esc(e.message), `<a class="btn" href="#/library">Back to my shelf</a>`)}</div>`;
  }
}

// ===================== welcome / auth =====================

function viewWelcome() {
  if (state.user) { location.hash = '#/library'; return; }
  appEl.innerHTML = `
  <div class="auth-wrap">
    <div class="auth-card">
      <div class="auth-logo">🎲</div>
      <h1>Meeple Shelf</h1>
      <p class="auth-tag">Your board game shelf, your friends' shelves,<br>and one combined library for game night.</p>
      <div class="tabs">
        <button class="tab active" data-tab="login">Log in</button>
        <button class="tab" data-tab="signup">Sign up</button>
      </div>
      <form id="auth-form">
        <label>Username</label>
        <input type="text" id="a-username" autocomplete="username" required>
        <div id="signup-extra" style="display:none">
          <label>Display name <span style="font-weight:400">(what friends see)</span></label>
          <input type="text" id="a-display" autocomplete="name" placeholder="Optional — defaults to username">
        </div>
        <label>Password</label>
        <input type="password" id="a-password" autocomplete="current-password" required>
        <div class="form-error" id="a-error"></div>
        <button class="btn btn-primary" type="submit" id="a-submit">Log in</button>
      </form>
    </div>
  </div>`;

  let mode = 'login';
  for (const tab of appEl.querySelectorAll('.tab')) {
    tab.onclick = () => {
      mode = tab.dataset.tab;
      appEl.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
      $('#signup-extra').style.display = mode === 'signup' ? '' : 'none';
      $('#a-submit').textContent = mode === 'signup' ? 'Create my shelf' : 'Log in';
      $('#a-error').textContent = '';
    };
  }
  $('#auth-form').onsubmit = async (e) => {
    e.preventDefault();
    $('#a-error').textContent = '';
    try {
      const body = { username: $('#a-username').value, password: $('#a-password').value };
      if (mode === 'signup') body.displayName = $('#a-display').value;
      const { user } = await api(mode === 'signup' ? '/signup' : '/login', { method: 'POST', body });
      state.user = user;
      if (mode === 'signup') toast('Welcome to Meeple Shelf 🎲');
      location.hash = '#/library';
    } catch (err) {
      $('#a-error').textContent = err.message;
    }
  };
}

// ===================== my library =====================

const libState = { q: '', sort: 'recent' };

async function viewLibrary() {
  const { entries } = await api('/library');
  const shareUrl = `${location.origin}/#/u/${state.user.shareSlug}`;

  appEl.innerHTML = `
  <div class="container">
    <div class="page-head">
      <div>
        <h1>My Shelf</h1>
        <div class="sub">${entries.length} game${entries.length === 1 ? '' : 's'} on your shelf</div>
      </div>
      <button class="btn btn-primary" id="add-game-btn">+ Add a game</button>
    </div>

    <div class="share-bar ${state.user.libraryPublic ? '' : 'is-private'}">
      <span class="share-label">🔗 Share your shelf</span>
      <span class="share-link" id="share-link">${esc(shareUrl)}</span>
      <button class="btn btn-sm" id="copy-share">Copy link</button>
      <span class="share-spacer"></span>
      <label class="switch">
        <input type="checkbox" id="share-toggle" ${state.user.libraryPublic ? 'checked' : ''}>
        <span class="track"></span>
        <span class="switch-label">${state.user.libraryPublic ? 'Public' : 'Private'}</span>
      </label>
    </div>

    ${entries.length ? `
    <div class="filter-bar">
      <input type="text" class="search" id="lib-q" placeholder="Search your shelf…" value="${esc(libState.q)}">
      <span class="nav-spacer"></span>
      <div class="filter-group">
        <span class="glabel">Sort</span>
        <select id="lib-sort">
          <option value="recent" ${libState.sort === 'recent' ? 'selected' : ''}>Recently added</option>
          <option value="title" ${libState.sort === 'title' ? 'selected' : ''}>Title A–Z</option>
        </select>
      </div>
    </div>
    <div id="lib-grid"></div>` : emptyState('🎲', 'Your shelf is empty', 'Add the games you own — then share your shelf or pool it with friends in a crew.', '<button class="btn btn-primary" id="empty-add-btn">+ Add your first game</button>')}
  </div>`;

  const byId = new Map(entries.map((en) => [String(en.id), en]));
  const openAdd = () => openAddModal();

  function renderGrid() {
    const grid = $('#lib-grid');
    if (!grid) return;
    let list = [...entries];
    const q = libState.q.trim().toLowerCase();
    if (q) list = list.filter((en) => en.game.title.toLowerCase().includes(q));
    if (libState.sort === 'title') list.sort((a, b) => a.game.title.localeCompare(b.game.title));
    grid.innerHTML = list.length
      ? `<div class="grid">${list.map((en) => gameCardHtml(en.game, { entryId: en.id, notes: en.notes, addedAt: en.addedAt, actions: true, loanedTo: en.loanedTo })).join('')}</div>`
      : emptyState('🔍', 'No matches', 'No games on your shelf match that search.');
  }
  renderGrid();

  if ($('#add-game-btn')) $('#add-game-btn').onclick = openAdd;
  if ($('#empty-add-btn')) $('#empty-add-btn').onclick = openAdd;

  if ($('#lib-q')) $('#lib-q').oninput = debounce((e) => { libState.q = e.target.value; renderGrid(); }, 150);
  if ($('#lib-sort')) $('#lib-sort').onchange = (e) => { libState.sort = e.target.value; renderGrid(); };

  $('#copy-share').onclick = () => copyText(shareUrl);
  $('#share-toggle').onchange = async (e) => {
    const { user } = await api('/me/sharing', { method: 'PATCH', body: { isPublic: e.target.checked } });
    state.user = user;
    toast(user.libraryPublic ? 'Your shelf is public — anyone with the link can see it' : 'Your shelf is now private');
    route();
  };

  if ($('#lib-grid')) {
    $('#lib-grid').addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const card = e.target.closest('[data-entry]');
      const entry = byId.get(card.dataset.entry);
      if (!entry) return;
      if (btn.dataset.act === 'remove') {
        if (!window.confirm(`Remove "${entry.game.title}" from your shelf?`)) return;
        await api(`/library/${entry.id}`, { method: 'DELETE' });
        toast(`Removed ${entry.game.title}`);
        route();
      } else if (btn.dataset.act === 'edit') {
        openEditModal(entry);
      }
    });
  }
}

// ---------- add game modal ----------

async function openAddModal(ownersCtx = null) {
  // Who can this game be added for? Me plus anyone I share a crew with.
  if (!ownersCtx) {
    try {
      const { crewmates } = await api('/crewmates');
      crewmates.sort((a, b) => Number(b.isMe) - Number(a.isMe) || a.displayName.localeCompare(b.displayName));
      ownersCtx = { members: crewmates };
    } catch {
      ownersCtx = { members: [] };
    }
  }
  const showOwners = ownersCtx.members.length > 1;
  const selectedOwners = new Set([state.user.id]);

  openModal(`
    <div class="modal-head"><h2>Add a game</h2><button class="modal-close">×</button></div>
    <div class="modal-body">
      <div class="tabs">
        <button class="tab active" data-tab="search">Search</button>
        <button class="tab" data-tab="manual">Manual entry</button>
      </div>
      ${showOwners ? `<div class="owner-pick" id="owner-pick">
        <span class="glabel">Whose shelf?</span>
        ${ownersCtx.members.map((m) => `<button class="chip-btn ${selectedOwners.has(m.id) ? 'active' : ''}" data-owner="${m.id}">${esc(m.displayName)}${m.id === state.user.id ? ' (me)' : ''}</button>`).join('')}
      </div>` : ''}
      <div id="tab-search">
        <input type="text" id="game-q" placeholder="Start typing a game name…" autocomplete="off">
        <div class="search-results" id="game-results"></div>
        <div class="search-hint">Searches a built-in catalog of popular games plus everything already added by people on this server. Missing something? Use Manual entry.</div>
      </div>
      <div id="tab-manual" style="display:none">
        <label>Title *</label><input type="text" id="m-title">
        <div class="two-col">
          <div><label>Year</label><input type="number" id="m-year" placeholder="2024"></div>
          <div><label>Play time (min)</label><input type="number" id="m-time" placeholder="60"></div>
        </div>
        <div class="two-col">
          <div><label>Min players</label><input type="number" id="m-min" placeholder="2"></div>
          <div><label>Max players</label><input type="number" id="m-max" placeholder="4"></div>
        </div>
        <label>Category <span style="font-weight:400">(optional)</span></label><input type="text" id="m-category" list="cat-list" placeholder="e.g. Party Game, Economic…">
        ${catDatalist()}
        <label>Cover image URL <span style="font-weight:400">(optional)</span></label><input type="url" id="m-img" placeholder="https://…">
        <label>Notes <span style="font-weight:400">(optional)</span></label><input type="text" id="m-notes" placeholder="e.g. sleeved, expansion included…">
        <div class="form-error" id="m-error"></div>
        <button class="btn btn-primary" id="m-add" style="margin-top:14px">Add to my shelf</button>
      </div>
    </div>`);

  for (const tab of modalRoot.querySelectorAll('.tab')) {
    tab.onclick = () => {
      modalRoot.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
      $('#tab-search').style.display = tab.dataset.tab === 'search' ? '' : 'none';
      $('#tab-manual').style.display = tab.dataset.tab === 'manual' ? '' : 'none';
    };
  }

  if (showOwners) {
    $('#owner-pick').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-owner]');
      if (!btn) return;
      const id = Number(btn.dataset.owner);
      if (selectedOwners.has(id)) {
        if (selectedOwners.size === 1) return toast('Pick at least one shelf');
        selectedOwners.delete(id);
      } else {
        selectedOwners.add(id);
      }
      btn.classList.toggle('active', selectedOwners.has(id));
    });
  }

  const resultsEl = $('#game-results');
  let lastResults = [];

  const doSearch = debounce(async (q) => {
    if (q.trim().length < 2) { resultsEl.innerHTML = ''; return; }
    try {
      const { results } = await api('/games/search?q=' + encodeURIComponent(q.trim()));
      lastResults = results;
      resultsEl.innerHTML = results.length
        ? results.map((r, i) => `
          <div class="result-row" data-i="${i}">
            ${r.imageUrl ? `<img class="r-thumb" loading="lazy" src="${esc(r.imageUrl)}" alt="" onerror="this.remove()">` : ''}
            <div class="r-grow">
              <div class="r-title">${esc(r.title)}${r.year ? `<span class="r-year">(${r.year})</span>` : ''}</div>
              <div class="r-meta">${[fmtPlayers(r), fmtTime(r)].filter(Boolean).join(' · ') || '&nbsp;'}</div>
            </div>
            <button class="btn btn-sm btn-primary" data-add="${i}">Add</button>
          </div>`).join('')
        : `<div class="search-hint">Nothing found for “${esc(q)}” — switch to Manual entry to add it.</div>`;
    } catch (err) {
      resultsEl.innerHTML = `<div class="search-hint">${esc(err.message)}</div>`;
    }
  }, 300);

  $('#game-q').oninput = (e) => doSearch(e.target.value);
  $('#game-q').focus();

  resultsEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-add]');
    if (!btn || btn.disabled) return;
    const r = lastResults[Number(btn.dataset.add)];
    if (!r) return;
    btn.disabled = true;
    try {
      const ownerIds = [...selectedOwners];
      const body = r.gameId
        ? { gameId: r.gameId, ownerIds }
        : { title: r.title, year: r.year, minPlayers: r.minPlayers, maxPlayers: r.maxPlayers, playTime: r.playTime, category: r.category, imageUrl: r.imageUrl, ownerIds };
      const { game, added, requested } = await api('/library', { method: 'POST', body });
      btn.textContent = added ? '✓ Added' : 'On shelf';
      btn.closest('.result-row').classList.add('added');
      if (added) {
        modalDirty = true;
        toast(`${game.title} added to ${added === 1 ? (requested === 1 ? 'the shelf' : '1 shelf') : added + ' shelves'}`);
      } else {
        toast(`${game.title} is already on ${requested === 1 ? 'that shelf' : 'those shelves'}`);
      }
    } catch (err) {
      btn.disabled = false;
      toast(err.message);
    }
  });

  $('#m-add').onclick = async () => {
    $('#m-error').textContent = '';
    try {
      const body = {
        title: $('#m-title').value,
        year: $('#m-year').value || null,
        minPlayers: $('#m-min').value || null,
        maxPlayers: $('#m-max').value || null,
        playTime: $('#m-time').value || null,
        category: $('#m-category').value,
        imageUrl: $('#m-img').value,
        notes: $('#m-notes').value,
      };
      ['year', 'minPlayers', 'maxPlayers', 'playTime'].forEach((k) => { if (body[k] != null) body[k] = Number(body[k]) || null; });
      body.ownerIds = [...selectedOwners];
      const { game, added } = await api('/library', { method: 'POST', body });
      modalDirty = true;
      toast(added ? `${game.title} added to ${added === 1 ? 'the shelf' : added + ' shelves'}` : `${game.title} was already there`);
      closeModal();
    } catch (err) {
      $('#m-error').textContent = err.message;
    }
  };
}

async function openEditModal(entry) {
  const g = entry.game;
  let mates = [];
  try {
    mates = (await api('/crewmates')).crewmates.filter((m) => !m.isMe);
  } catch {
    /* not in any crew yet */
  }
  openModal(`
    <div class="modal-head"><h2>${esc(g.title)}</h2><button class="modal-close">×</button></div>
    <div class="modal-body">
      <div class="two-col">
        <div><label>Year</label><input type="number" id="e-year" value="${g.year ?? ''}"></div>
        <div><label>Play time (min)</label><input type="number" id="e-time" value="${g.playTime ?? ''}"></div>
      </div>
      <div class="two-col">
        <div><label>Min players</label><input type="number" id="e-min" value="${g.minPlayers ?? ''}"></div>
        <div><label>Max players</label><input type="number" id="e-max" value="${g.maxPlayers ?? ''}"></div>
      </div>
      <label>Category</label>
      <input type="text" id="e-category" list="cat-list" value="${esc(g.category || '')}" placeholder="e.g. Party Game…">
      ${catDatalist()}
      <label>Cover image URL</label>
      <input type="url" id="e-img" value="${esc(g.imageUrl || '')}" placeholder="https://…">
      ${mates.length ? `<label>Currently at</label>
      <select id="e-loan" style="width:100%">
        <option value="">Home</option>
        ${mates.map((m) => `<option value="${m.id}" ${entry.loanedTo?.id === m.id ? 'selected' : ''}>with ${esc(m.displayName)}</option>`).join('')}
      </select>` : ''}
      <label>Notes <span style="font-weight:400">(visible on your public shelf)</span></label>
      <input type="text" id="e-notes" value="${esc(entry.notes)}" placeholder="e.g. sleeved, missing a token…">
      <div class="form-error" id="e-error"></div>
      <button class="btn btn-primary" id="e-save" style="margin-top:14px">Save</button>
    </div>`);
  $('#e-save').onclick = async () => {
    try {
      await api(`/library/${entry.id}`, {
        method: 'PATCH',
        body: {
          notes: $('#e-notes').value,
          imageUrl: $('#e-img').value,
          year: $('#e-year').value || null,
          minPlayers: $('#e-min').value || null,
          maxPlayers: $('#e-max').value || null,
          playTime: $('#e-time').value || null,
          category: $('#e-category').value,
          ...($('#e-loan') ? { loanedTo: $('#e-loan').value || null } : {}),
        },
      });
      modalDirty = true;
      toast('Saved');
      closeModal();
    } catch (err) {
      $('#e-error').textContent = err.message;
    }
  };
}

// ===================== crews =====================

async function viewCrews() {
  const { crews } = await api('/crews');
  appEl.innerHTML = `
  <div class="container">
    <div class="page-head">
      <div>
        <h1>Game Night Crews</h1>
        <div class="sub">Pool shelves with friends — see every game your group owns and who has it.</div>
      </div>
    </div>

    <div class="two-col" style="margin-bottom:26px">
      <div class="panel">
        <h3>Start a crew</h3>
        <div class="panel-sub">You'll get an invite code to share with friends.</div>
        <form id="create-form" style="display:flex;gap:8px">
          <input type="text" id="crew-name" placeholder="e.g. Friday Night Crew" maxlength="40">
          <button class="btn btn-primary" type="submit">Create</button>
        </form>
      </div>
      <div class="panel">
        <h3>Join a crew</h3>
        <div class="panel-sub">Got a code from a friend? Enter it here.</div>
        <form id="join-form" style="display:flex;gap:8px">
          <input type="text" id="join-code" placeholder="e.g. K7Q2MX" maxlength="6" style="text-transform:uppercase;font-family:ui-monospace,Menlo,monospace;letter-spacing:2px">
          <button class="btn" type="submit">Join</button>
        </form>
      </div>
    </div>

    ${crews.length ? `<div class="tile-list">${crews.map((c) => `
      <a class="tile" href="#/crew/${c.id}">
        <h3>${esc(c.name)}</h3>
        <div class="tile-sub">${c.memberCount} member${c.memberCount === 1 ? '' : 's'} · ${c.gameCount} game${c.gameCount === 1 ? '' : 's'} combined</div>
        <div style="margin-top:10px"><span class="code-chip">${esc(c.inviteCode)}</span></div>
      </a>`).join('')}</div>`
      : emptyState('👥', 'No crews yet', 'Create a crew and send the invite code to your game group — or join one with a code a friend sent you.')}
  </div>`;

  $('#create-form').onsubmit = async (e) => {
    e.preventDefault();
    const name = $('#crew-name').value.trim();
    if (!name) return;
    try {
      const { crew } = await api('/crews', { method: 'POST', body: { name } });
      modalDirty = true;
      openModal(`
        <div class="modal-head"><h2>${esc(crew.name)} is ready 🎉</h2><button class="modal-close">×</button></div>
        <div class="modal-body">
          <p style="color:var(--muted)">Send this invite code to your friends. When they join, everyone's shelves pool into one combined library.</p>
          <div class="big-code">${esc(crew.inviteCode)}</div>
          <div style="display:flex;gap:10px">
            <button class="btn btn-primary" id="copy-code">Copy code</button>
            <a class="btn" href="#/crew/${crew.id}">Open crew</a>
          </div>
        </div>`);
      $('#copy-code').onclick = () => copyText(crew.inviteCode);
    } catch (err) {
      toast(err.message);
    }
  };

  $('#join-form').onsubmit = async (e) => {
    e.preventDefault();
    const code = $('#join-code').value.trim().toUpperCase();
    if (!code) return;
    try {
      const { crew, alreadyMember } = await api('/crews/join', { method: 'POST', body: { code } });
      toast(alreadyMember ? `You're already in ${crew.name}` : `Welcome to ${crew.name}! 🎲`);
      location.hash = `#/crew/${crew.id}`;
    } catch (err) {
      toast(err.message);
    }
  };
}

// ---------- crew detail: the combined library ----------

const crewState = { id: null, q: '', players: 'any', time: 'any', owner: 'all', category: 'all', sort: 'title', view: 'grid', expanded: new Set() };

async function viewCrewDetail(id) {
  if (crewState.id !== id) Object.assign(crewState, { id, q: '', players: 'any', time: 'any', owner: 'all', category: 'all', sort: 'title', view: 'grid', expanded: new Set() });
  const { crew, members, games } = await api('/crews/' + id);
  const multiOwned = games.filter((g) => g.owners.length > 1).length;
  const categories = [...new Set(games.map((g) => g.category).filter(Boolean))].sort();

  appEl.innerHTML = `
  <div class="container">
    <div class="page-head">
      <div>
        <h1>${esc(crew.name)}</h1>
        <div class="sub" style="display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-top:5px">
          Invite code <span class="code-chip">${esc(crew.inviteCode)}</span>
          <button class="btn btn-sm" id="copy-code">Copy</button>
        </div>
      </div>
      <div style="display:flex;gap:10px;align-items:center">
        <button class="btn btn-primary" id="crew-add-btn">+ Add a game</button>
        <button class="btn btn-ghost btn-danger btn-sm" id="leave-btn">Leave crew</button>
      </div>
    </div>

    <div class="members-row">
      ${members.map((m) => `
        <span class="member" style="--c:${memberColor(m.id)}">
          <span class="avatar">${esc(m.displayName.slice(0, 2).toUpperCase())}</span>
          <span class="m-name">${esc(m.displayName)}</span>
          <span class="m-count">${m.gameCount}</span>
        </span>`).join('')}
    </div>

    <div class="stats-line">${games.length} unique game${games.length === 1 ? '' : 's'} across ${members.length} shel${members.length === 1 ? 'f' : 'ves'}${multiOwned ? ` · ${multiOwned} owned by more than one person` : ''}</div>

    <div class="filter-bar">
      <input type="text" class="search" id="cw-q" placeholder="Search games…" value="${esc(crewState.q)}">
      <div class="filter-group" id="players-chips">
        <span class="glabel">Players</span>
        ${['any', '2', '3', '4', '5', '6+'].map((p) => `<button class="chip-btn ${crewState.players === p ? 'active' : ''}" data-p="${p}">${p === 'any' ? 'Any' : p}</button>`).join('')}
      </div>
      <div class="filter-group">
        <span class="glabel">Time</span>
        <select id="cw-time">
          <option value="any" ${crewState.time === 'any' ? 'selected' : ''}>Any</option>
          <option value="30" ${crewState.time === '30' ? 'selected' : ''}>Under 30 min</option>
          <option value="60" ${crewState.time === '60' ? 'selected' : ''}>30–60 min</option>
          <option value="120" ${crewState.time === '120' ? 'selected' : ''}>1–2 hr</option>
          <option value="121" ${crewState.time === '121' ? 'selected' : ''}>2 hr+</option>
        </select>
      </div>
      <div class="filter-group">
        <span class="glabel">Owner</span>
        <select id="cw-owner">
          <option value="all">Everyone</option>
          ${members.map((m) => `<option value="${m.id}" ${String(crewState.owner) === String(m.id) ? 'selected' : ''}>${esc(m.displayName)}</option>`).join('')}
        </select>
      </div>
      ${categories.length ? `<div class="filter-group">
        <span class="glabel">Category</span>
        <select id="cw-category">
          <option value="all">All</option>
          ${categories.map((c) => `<option value="${esc(c)}" ${crewState.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
        </select>
      </div>` : ''}
      <div class="filter-group">
        <span class="glabel">Sort</span>
        <select id="cw-sort">
          <option value="title" ${crewState.sort === 'title' ? 'selected' : ''}>Title A–Z</option>
          <option value="owners" ${crewState.sort === 'owners' ? 'selected' : ''}>Most owners</option>
        </select>
      </div>
      <span class="nav-spacer"></span>
      <button class="btn" id="surprise-btn">🎲 Surprise me</button>
      <div class="segmented">
        <button data-view="grid" class="${crewState.view === 'grid' ? 'active' : ''}">Grid</button>
        <button data-view="matrix" class="${crewState.view === 'matrix' ? 'active' : ''}">Who has what</button>
      </div>
    </div>

    <div id="surprise-result" style="display:none"></div>
    <div class="result-count" id="cw-count"></div>
    <div id="cw-games"></div>
  </div>`;

  function filtered() {
    let list = [...games];
    const q = crewState.q.trim().toLowerCase();
    if (q) list = list.filter((g) => g.title.toLowerCase().includes(q));
    if (crewState.players !== 'any') {
      list = list.filter((g) => {
        if (g.minPlayers == null && g.maxPlayers == null) return true; // unknown → don't exclude
        const min = g.minPlayers ?? 1;
        const max = g.maxPlayers ?? min;
        if (crewState.players === '6+') return max >= 6;
        const n = Number(crewState.players);
        return min <= n && n <= max;
      });
    }
    if (crewState.time !== 'any') {
      list = list.filter((g) => {
        if (!g.playTime) return true;
        if (crewState.time === '30') return g.playTime < 30;
        if (crewState.time === '60') return g.playTime >= 30 && g.playTime <= 60;
        if (crewState.time === '120') return g.playTime > 60 && g.playTime <= 120;
        return g.playTime > 120;
      });
    }
    if (crewState.owner !== 'all') {
      list = list.filter((g) => g.owners.some((o) => String(o.id) === String(crewState.owner)));
    }
    if (crewState.category !== 'all') {
      list = list.filter((g) => g.category === crewState.category);
    }
    if (crewState.sort === 'owners') list.sort((a, b) => b.owners.length - a.owners.length || a.title.localeCompare(b.title));
    else list.sort((a, b) => a.title.localeCompare(b.title));
    return list;
  }

  function renderGames() {
    const list = filtered();
    $('#cw-count').textContent = `${list.length} of ${games.length} games`;
    const container = $('#cw-games');
    if (!list.length) {
      container.innerHTML = emptyState('🫥', 'No games match', 'Try loosening the filters — or get someone to buy more games.');
      return;
    }
    if (crewState.view === 'grid') {
      const { top, exps } = groupExpansions(list);
      const cards = [];
      for (const g of top) {
        const kids = exps.get(g.id);
        const expanded = crewState.expanded.has(g.id);
        cards.push(gameCardHtml(g, { owners: g.owners, gameId: g.id, editOwners: true, expansions: kids, expanded }));
        if (kids && expanded) {
          for (const e of kids) cards.push(gameCardHtml(e, { owners: e.owners, gameId: e.id, editOwners: true }));
        }
      }
      container.innerHTML = `<div class="grid">${cards.join('')}</div>`;
    } else {
      // expansions sort directly under their base game
      const titleById = new Map(games.map((g) => [g.id, g.title]));
      const msorted = [...list].sort((a, b) => {
        const ka = a.expansionOf && titleById.has(a.expansionOf) ? titleById.get(a.expansionOf) : a.title;
        const kb = b.expansionOf && titleById.has(b.expansionOf) ? titleById.get(b.expansionOf) : b.title;
        return ka.localeCompare(kb) || (a.expansionOf ? 1 : 0) - (b.expansionOf ? 1 : 0) || a.title.localeCompare(b.title);
      });
      container.innerHTML = `
      <div class="matrix-wrap"><table class="matrix">
        <thead><tr>
          <th>Game</th>
          ${members.map((m) => `<th><span class="dot" style="background:${memberColor(m.id)}"></span>${esc(m.displayName)}</th>`).join('')}
        </tr></thead>
        <tbody>
          ${msorted.map((g) => {
            const isExp = g.expansionOf && titleById.has(g.expansionOf);
            return `<tr>
            <td>${isExp ? '<span class="exp-arrow">↳ </span>' : ''}<span class="g-title">${esc(isExp ? expShortTitle(g) : g.title)}</span>${fmtPlayers(g) ? `<span class="g-meta">${fmtPlayers(g)}</span>` : ''}</td>
            ${members.map((m) => {
              const owns = g.owners.some((o) => o.id === m.id);
              return `<td>${owns ? `<span class="check" style="color:${memberColor(m.id)}">✓</span>` : ''}</td>`;
            }).join('')}
          </tr>`;
          }).join('')}
        </tbody>
      </table></div>`;
    }
  }
  renderGames();

  $('#cw-q').oninput = debounce((e) => { crewState.q = e.target.value; renderGames(); }, 150);
  $('#players-chips').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-p]');
    if (!btn) return;
    crewState.players = btn.dataset.p;
    $('#players-chips').querySelectorAll('.chip-btn').forEach((b) => b.classList.toggle('active', b === btn));
    renderGames();
  });
  $('#cw-time').onchange = (e) => { crewState.time = e.target.value; renderGames(); };
  $('#cw-owner').onchange = (e) => { crewState.owner = e.target.value; renderGames(); };
  if ($('#cw-category')) $('#cw-category').onchange = (e) => { crewState.category = e.target.value; renderGames(); };
  $('#cw-sort').onchange = (e) => { crewState.sort = e.target.value; renderGames(); };
  appEl.querySelector('.segmented').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-view]');
    if (!btn) return;
    crewState.view = btn.dataset.view;
    appEl.querySelectorAll('.segmented button').forEach((b) => b.classList.toggle('active', b === btn));
    renderGames();
  });

  $('#crew-add-btn').onclick = () =>
    openAddModal({ members: members.map((m) => ({ id: m.id, displayName: m.displayName, isMe: m.id === state.user.id })) });

  $('#cw-games').addEventListener('click', (e) => {
    const tog = e.target.closest('[data-act="toggle-exp"]');
    if (tog) {
      const id = Number(tog.closest('[data-game]').dataset.game);
      if (crewState.expanded.has(id)) crewState.expanded.delete(id);
      else crewState.expanded.add(id);
      renderGames();
      return;
    }
    const btn = e.target.closest('[data-act="owners"]');
    if (!btn) return;
    const card = e.target.closest('[data-game]');
    const game = games.find((g) => g.id === Number(card.dataset.game));
    if (game) openOwnersModal(crew, game, members);
  });

  // ---- the game night picker: current filters + dice ----
  function surpriseHtml(g, final) {
    return `
      <div class="surprise-banner">
        <div class="sb-cover">${g.imageUrl ? `<img src="${esc(g.imageUrl)}" alt="" onerror="this.remove()">` : '🎲'}</div>
        <div class="sb-body">
          <div class="sb-label">${final ? "Tonight you're playing" : 'Rolling…'}</div>
          <div class="sb-title">${esc(g.title)}</div>
          ${final ? `<div class="sb-meta">${[fmtPlayers(g), fmtTime(g)].filter(Boolean).join(' · ')}${g.owners?.length ? ` · owned by ${esc(g.owners.map((o) => o.displayName).join(', '))}` : ''}</div>` : ''}
        </div>
        ${final ? `<div class="sb-actions"><button class="btn btn-sm" id="sb-again">Roll again</button><button class="icon-btn" id="sb-close" title="Dismiss">✕</button></div>` : ''}
      </div>`;
  }
  function rollSurprise() {
    const pool = filtered().filter((g) => !g.expansionOf && g.category !== 'Expansion for Base-game');
    if (!pool.length) return toast('No eligible games with these filters');
    const banner = $('#surprise-result');
    banner.style.display = '';
    let spins = 0;
    const itv = setInterval(() => {
      const g = pool[Math.floor(Math.random() * pool.length)];
      banner.innerHTML = surpriseHtml(g, spins >= 14);
      if (spins++ >= 14) clearInterval(itv);
    }, 70);
  }
  $('#surprise-btn').onclick = rollSurprise;
  $('#surprise-result').addEventListener('click', (e) => {
    if (e.target.closest('#sb-again')) rollSurprise();
    if (e.target.closest('#sb-close')) {
      $('#surprise-result').style.display = 'none';
      $('#surprise-result').innerHTML = '';
    }
  });

  $('#copy-code').onclick = () => copyText(crew.inviteCode);
  $('#leave-btn').onclick = async () => {
    if (!window.confirm(`Leave "${crew.name}"? If you're the last member, the crew is deleted.`)) return;
    await api(`/crews/${id}/leave`, { method: 'POST' });
    toast(`Left ${crew.name}`);
    location.hash = '#/crews';
  };
}

// Set exactly who in the crew owns a game — mirrors editing a row of the old spreadsheet.
function openOwnersModal(crew, game, members) {
  openModal(`
    <div class="modal-head"><h2>Who owns ${esc(game.title)}?</h2><button class="modal-close">×</button></div>
    <div class="modal-body">
      <div id="owner-rows">
        ${members.map((m) => {
          const owner = game.owners.find((o) => o.id === m.id);
          const cur = owner?.loanedTo?.id ?? '';
          return `
        <div class="owner-row" style="--c:${memberColor(m.id)}">
          <label class="owner-main">
            <input type="checkbox" value="${m.id}" ${owner ? 'checked' : ''}>
            <span class="avatar">${esc(m.displayName.slice(0, 2).toUpperCase())}</span>
            <span class="m-name">${esc(m.displayName)}</span>
          </label>
          <select class="loc" data-owner="${m.id}" ${owner ? '' : 'disabled'} title="Where is this copy right now?">
            <option value="">at home</option>
            ${members.filter((x) => x.id !== m.id).map((x) => `<option value="${x.id}" ${cur === x.id ? 'selected' : ''}>with ${esc(x.displayName)}</option>`).join('')}
          </select>
        </div>`;
        }).join('')}
      </div>
      <div class="form-error" id="o-error"></div>
      <button class="btn btn-primary" id="o-save" style="margin-top:10px">Save</button>
    </div>`);
  for (const cb of modalRoot.querySelectorAll('#owner-rows input[type="checkbox"]')) {
    cb.onchange = () => {
      const sel = modalRoot.querySelector(`.loc[data-owner="${cb.value}"]`);
      sel.disabled = !cb.checked;
      if (!cb.checked) sel.value = '';
    };
  }
  $('#o-save').onclick = async () => {
    const owners = [...modalRoot.querySelectorAll('#owner-rows input:checked')].map((i) => ({
      id: Number(i.value),
      loanedTo: modalRoot.querySelector(`.loc[data-owner="${i.value}"]`).value || null,
    }));
    try {
      await api(`/crews/${crew.id}/games/${game.id}/owners`, { method: 'PUT', body: { owners } });
      modalDirty = true;
      toast(owners.length ? 'Saved' : `${game.title} is no longer on anyone's shelf here`);
      closeModal();
    } catch (err) {
      $('#o-error').textContent = err.message;
    }
  };
}

// ===================== public shared shelf =====================

async function viewPublicShelf(slug) {
  const { owner, entries } = await api('/shared/' + slug);
  const isMine = state.user && state.user.shareSlug === slug;
  appEl.innerHTML = `
  <div class="container">
    ${isMine ? `<div class="public-banner">👀 This is your public shelf, exactly as others see it.</div>` : ''}
    <div class="page-head">
      <div>
        <h1>🎲 ${esc(owner.displayName)}'s Shelf</h1>
        <div class="sub">${entries.length} game${entries.length === 1 ? '' : 's'}</div>
      </div>
    </div>
    ${entries.length
      ? `<div class="grid">${entries.map((en) => gameCardHtml(en.game, { notes: en.notes })).join('')}</div>`
      : emptyState('🎲', 'Nothing here yet', `${esc(owner.displayName)} hasn't added any games.`)}
    <div class="public-footer">
      Shared with <strong>Meeple Shelf</strong> — your board game shelf, your friends' shelves, one combined library.
      ${state.user ? `<a href="#/library">Back to my shelf</a>` : `<a href="#/welcome">Make your own →</a>`}
    </div>
  </div>`;
}

// ===================== boot =====================

(async function boot() {
  try {
    state.user = (await api('/me')).user;
  } catch {
    state.user = null;
  }
  window.addEventListener('hashchange', route);
  if (!location.hash) location.hash = state.user ? '#/library' : '#/welcome';
  else route();
})();
