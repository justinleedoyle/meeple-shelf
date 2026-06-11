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

// stroke icon from the sprite — themeable via currentColor, identical on every platform
const icon = (name, cls = '') => `<svg class="icon${cls ? ' ' + cls : ''}" aria-hidden="true"><use href="/icons.svg#i-${name}"/></svg>`;

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
  if (max >= 20) return `${icon('users')} ${min}+`;
  return `${icon('users')} ${min === max ? min : `${min}–${max}`}`;
}

function fmtTime(g) {
  const t = g.playTime;
  if (!t) return null;
  if (t < 90) return `${icon('clock')} ${t} min`;
  const hrs = t / 60;
  return `${icon('clock')} ${Number.isInteger(hrs) ? hrs : hrs.toFixed(1)} hr`;
}

function fmtDate(s) {
  if (!s) return '';
  const d = new Date(s.replace(' ', 'T') + 'Z');
  return isNaN(d) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// date-only strings ('YYYY-MM-DD') — fmtDate would build an invalid date from these
const fmtDay = (s) => {
  const d = new Date(s + 'T00:00');
  return isNaN(d) ? s : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

function localISODate() {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

// compact relative time for feeds: 'now', '5m', '3h', '6d', then a real date
function timeAgo(ts) {
  const d = new Date(String(ts).replace(' ', 'T') + (String(ts).includes('Z') ? '' : 'Z'));
  if (isNaN(d)) return '';
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 90) return 'now';
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  if (s < 86400 * 14) return `${Math.round(s / 86400)}d`;
  return fmtDate(ts);
}

// 'YYYY-MM-DD' → { dow: 'FRI', day: '13', mon: 'Jun' } for event date blocks
function dateParts(s) {
  const d = new Date(s + 'T00:00');
  if (isNaN(d)) return { dow: '?', day: '?', mon: '' };
  return {
    dow: d.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase(),
    day: String(d.getDate()),
    mon: d.toLocaleDateString(undefined, { month: 'short' }),
  };
}

// loan badge for cards: plain when on time, alarmed when past due
function loanBadge(loanedTo, dueDate) {
  if (!loanedTo) return '';
  const overdue = dueDate && dueDate < localISODate();
  return `<span class="badge loan${overdue ? ' overdue' : ''}">${icon(overdue ? 'alarm' : 'pin')} with ${esc(loanedTo.displayName)}${dueDate ? ` · due ${fmtDay(dueDate)}` : ''}</span>`;
}

const milestoneTier = (n) => (n >= 25 ? { label: '25+', n: 25 } : n >= 10 ? { label: '10+', n: 10 } : n >= 5 ? { label: '5+', n: 5 } : null);

// weighted random: unplayed games surface most, heavily-played stay possible
function weightedPick(pool) {
  const weights = pool.map((g) => 1 / (1 + (g.playCount || 0)));
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return pool[i];
  }
  return pool[pool.length - 1];
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
  const dismiss = (e) => { if (e.target === backdrop) closeModal(); };
  backdrop.addEventListener('mousedown', dismiss);
  backdrop.addEventListener('click', dismiss);
  const x = $('.modal-close', backdrop);
  if (x) x.onclick = closeModal;
  return $('.modal', backdrop);
}

// focusing inputs on touch devices pops the keyboard over the modal — only
// auto-focus where a hover-capable pointer (i.e. desktop) is present
const canAutoFocus = window.matchMedia('(hover: hover)').matches;

function closeModal() {
  if (!modalRoot.innerHTML) return;
  modalRoot.innerHTML = '';
  if (modalDirty) { modalDirty = false; route(); }
}

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

// ===================== shared renderers =====================

function emptyState(iconName, title, bodyHtml, ctaHtml = '') {
  return `<div class="empty"><div class="e-emoji">${icon(iconName)}</div><h2>${title}</h2><p>${bodyHtml}</p>${ctaHtml}</div>`;
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

function gameCardHtml(game, { entryId, gameId, notes, addedAt, owners, actions, editOwners, loanedTo, dueDate, playCount, expansions, expanded, extraBadges, gotIt } = {}) {
  const grad = COVER_GRADS[hashStr(game.title) % COVER_GRADS.length];
  const players = fmtPlayers(game);
  const time = fmtTime(game);
  return `
  <div class="game-card"${entryId ? ` data-entry="${entryId}"` : ''}${gameId ? ` data-game="${gameId}"` : ''}>
    <div class="cover" style="background:linear-gradient(135deg, ${grad[0]}, ${grad[1]})">
      <span class="cover-letter">${esc((game.title || '?')[0].toUpperCase())}</span>
      <span class="cover-die">${icon('dice')}</span>
      ${game.imageUrl ? `<img loading="lazy" src="${esc(game.imageUrl)}" alt="" onerror="this.remove()">` : ''}
    </div>
    ${actions ? `<div class="card-actions">
      ${gotIt ? `<button class="icon-btn gotit" data-act="gotit" title="Got it! Move to my shelf">${icon('check')}</button>` : ''}
      <button class="icon-btn" data-act="edit" title="Edit details">${icon('pencil')}</button>
    </div>` : ''}
    ${editOwners ? `<div class="card-actions">
      <button class="icon-btn" data-act="owners" title="Edit who owns this">${icon('pencil')}</button>
    </div>` : ''}
    <div class="card-body">
      <div class="card-title">${esc(game.title)}${game.year ? ` <span style="color:var(--faint);font-weight:400">(${game.year})</span>` : ''}</div>
      <div class="card-meta">
        ${players ? `<span class="badge">${players}</span>` : ''}
        ${time ? `<span class="badge">${time}</span>` : ''}
        ${game.category ? `<span class="badge">${esc(game.category)}</span>` : ''}
        ${(() => { const ms = milestoneTier(playCount || 0); return ms ? `<span class="badge milestone" title="${ms.n}+ crew plays">${icon('award')} ${ms.label}</span>` : ''; })()}
        ${extraBadges || ''}
        ${loanBadge(loanedTo, dueDate)}
      </div>
      ${notes ? `<div class="card-notes">${esc(notes)}</div>` : ''}
      ${owners ? `<div class="card-owners">${owners.map((o) => `<span class="owner-chip" style="--c:${memberColor(o.id)}">${esc(o.displayName)}${o.loanedTo ? ` → ${esc(o.loanedTo.displayName)}${o.dueDate && o.dueDate < localISODate() ? ' ' + icon('alarm') : ''}` : ''}</span>`).join('')}</div>` : ''}
      ${expansions?.length ? `<button class="exp-line" data-act="toggle-exp" title="${esc(expansions.map((e) => `${expShortTitle(e)} (${(e.owners || []).map((o) => o.displayName).join(', ')})`).join('\n'))}">＋ ${expansions.length} expansion${expansions.length > 1 ? 's' : ''} ${expanded ? '▾' : '▸'}</button>` : ''}
      ${addedAt ? `<div class="added-date">Added ${fmtDate(addedAt)}</div>` : ''}
    </div>
  </div>`;
}

// ===================== state & router =====================

const state = { user: null, pending: 0 }; // pending = borrow requests waiting on me
const tabbarEl = $('#tabbar');

async function refreshPending() {
  try {
    state.pending = (await api('/me')).pendingRequests || 0;
  } catch { /* keep the old count */ }
  const badge = $('#tab-account .tab-badge');
  if (badge) badge.remove();
  if (state.pending && $('#tab-account')) {
    $('#tab-account').insertAdjacentHTML('beforeend', `<span class="tab-badge">${state.pending}</span>`);
  }
}

// shimmer placeholders while data loads (only shown if a fetch takes >150ms)
function skeletonHtml() {
  return `<div class="container">
    <div class="skel skel-title"></div>
    <div class="skel skel-line" style="width:38%"></div>
    <div class="skel-grid">${Array.from({ length: 8 }, () => '<div class="skel skel-card"></div>').join('')}</div>
  </div>`;
}

function renderTabbar(active) {
  if (!state.user) {
    tabbarEl.innerHTML = '';
    return;
  }
  tabbarEl.innerHTML = `
    <button class="tab-item ${active === 'library' ? 'active' : ''}" data-go="#/library">${icon('dice')}<span>My Shelf</span></button>
    <button class="tab-item ${active === 'crews' || active === 'crew' ? 'active' : ''}" data-go="#/crews">${icon('users')}<span>Crews</span></button>
    <button class="tab-item" id="tab-account">${icon('user')}<span>Account</span>${state.pending ? `<span class="tab-badge">${state.pending}</span>` : ''}</button>`;
  for (const btn of tabbarEl.querySelectorAll('[data-go]')) {
    btn.onclick = () => { location.hash = btn.dataset.go; };
  }
  $('#tab-account').onclick = openAccountModal;
}

function renderNav(active) {
  renderTabbar(active);
  if (!state.user) {
    navEl.innerHTML = location.hash.startsWith('#/u/')
      ? `<a class="brand" href="#/welcome">${icon('dice', 'accent')} Meeple Shelf</a><span class="nav-spacer"></span><a class="btn btn-primary btn-sm" href="#/welcome">Make your own shelf</a>`
      : '';
    return;
  }
  navEl.innerHTML = `
    <a class="brand" href="#/library">${icon('dice', 'accent')} Meeple Shelf</a>
    <div class="nav-links">
      <a class="nav-link ${active === 'library' ? 'active' : ''}" href="#/library">My Shelf</a>
      <a class="nav-link ${active === 'crews' || active === 'crew' ? 'active' : ''}" href="#/crews">Crews</a>
    </div>
    <span class="nav-spacer"></span>
    <button class="nav-user" id="account-btn" title="Account settings">${icon('user')}<span class="seg-txt"> ${esc(state.user.displayName)} ▾</span></button>
    <button class="btn btn-ghost btn-sm seg-txt" id="logout-btn">Log out</button>`;
  $('#account-btn').onclick = openAccountModal;
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
  // show a skeleton only when a load is actually slow (e.g. server cold-wake)
  const skelTimer = setTimeout(() => { appEl.innerHTML = skeletonHtml(); }, 150);
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
    appEl.innerHTML = `<div class="container">${emptyState('alert', e.status === 404 ? 'Not found' : 'Hmm', esc(e.message), `<a class="btn" href="#/library">Back to my shelf</a>`)}</div>`;
  } finally {
    clearTimeout(skelTimer);
  }
}

async function openAccountModal() {
  let reqs = { incoming: [], outgoing: [] };
  let mates = [];
  try {
    [reqs, { crewmates: mates }] = await Promise.all([api('/borrow-requests'), api('/crewmates')]);
    mates = mates.filter((m) => !m.isMe);
  } catch { /* sections render empty */ }

  const statusChip = (s) =>
    `<span class="badge req-${s}">${s === 'pending' ? 'waiting' : s === 'approved' ? `${icon('check')} lent` : s}</span>`;
  const reqRow = (r, dir) => `
    <div class="result-row" data-req="${r.id}">
      ${r.game.imageUrl ? `<img class="r-thumb" loading="lazy" src="${esc(r.game.imageUrl)}" alt="" onerror="this.remove()">` : ''}
      <div class="r-grow">
        <div class="r-title">${esc(r.game.title)}</div>
        <div class="r-meta">${dir === 'in' ? `${esc(r.requester.displayName)} wants to borrow it` : `you asked ${esc(r.owner.displayName)}`}${r.note ? ` · “${esc(r.note)}”` : ''} · ${timeAgo(r.createdAt)}</div>
        ${dir === 'in' ? `<div class="req-actions">
          <input type="date" class="req-due" min="${localISODate()}" title="Due back (optional)">
          <button class="btn btn-sm btn-primary" data-respond="approve">${icon('check')} Lend it</button>
          <button class="btn btn-sm" data-respond="decline">Decline</button>
        </div>` : ''}
      </div>
      ${dir === 'out' ? (r.status === 'pending' ? `<button class="btn btn-sm" data-cancel-req>Cancel</button>` : statusChip(r.status)) : ''}
    </div>`;

  openModal(`
    <div class="modal-head"><h2>Account</h2><button class="modal-close" aria-label="Close">${icon('x')}</button></div>
    <div class="modal-body">
      <div style="color:var(--muted);font-size:14px">Signed in as <strong style="color:var(--text)">${esc(state.user.displayName)}</strong> (@${esc(state.user.username)})</div>

      ${reqs.incoming.length ? `
      <h3 class="acct-h">${icon('bell')} Borrow requests</h3>
      <div class="search-results" style="max-height:none" id="req-in">${reqs.incoming.map((r) => reqRow(r, 'in')).join('')}</div>` : ''}

      ${reqs.outgoing.length ? `
      <h3 class="acct-h">${icon('backpack')} Your asks</h3>
      <div class="search-results" style="max-height:none" id="req-out">${reqs.outgoing.map((r) => reqRow(r, 'out')).join('')}</div>` : ''}

      ${mates.length ? `
      <h3 class="acct-h">${icon('key')} Help a crewmate back in</h3>
      <div class="r-meta" style="margin-bottom:8px">Locked out? A crewmate generates a one-time code and hands it over — no email needed.</div>
      <div style="display:flex;gap:8px">
        <select id="rc-who" style="flex:1">${mates.map((m) => `<option value="${m.id}">${esc(m.displayName)}</option>`).join('')}</select>
        <button class="btn" id="rc-gen">Generate code</button>
      </div>
      <div id="rc-result"></div>` : ''}

      <h3 class="acct-h">Change password</h3>
      <label>Current password</label>
      <input type="password" id="p-current" autocomplete="current-password">
      <label>New password</label>
      <input type="password" id="p-new" autocomplete="new-password" placeholder="At least 6 characters">
      <div class="form-error" id="p-error"></div>
      <button class="btn btn-primary" id="p-save" style="margin-top:14px">Update password</button>
      <hr style="border:none;border-top:1px solid var(--line);margin:20px 0">
      <button class="btn" id="p-logout">Log out</button>
    </div>`);

  if ($('#req-in')) {
    $('#req-in').addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-respond]');
      if (!btn) return;
      const row = e.target.closest('[data-req]');
      btn.disabled = true;
      try {
        const { request } = await api(`/borrow-requests/${row.dataset.req}/respond`, {
          method: 'POST',
          body: { action: btn.dataset.respond, dueDate: row.querySelector('.req-due')?.value || null },
        });
        toast(request.status === 'approved' ? `Lent to ${request.requester.displayName} — it's on their loan list now` : 'Declined');
        modalDirty = true;
        await refreshPending();
        openAccountModal(); // re-render with the row resolved
      } catch (err) {
        btn.disabled = false;
        toast(err.message);
      }
    });
  }
  if ($('#req-out')) {
    $('#req-out').addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-cancel-req]');
      if (!btn) return;
      btn.disabled = true;
      try {
        await api(`/borrow-requests/${e.target.closest('[data-req]').dataset.req}/cancel`, { method: 'POST' });
        toast('Request canceled');
        openAccountModal();
      } catch (err) {
        btn.disabled = false;
        toast(err.message);
      }
    });
  }
  if ($('#rc-gen')) {
    $('#rc-gen').onclick = async () => {
      $('#rc-gen').disabled = true;
      try {
        const r = await api(`/crewmates/${$('#rc-who').value}/reset-code`, { method: 'POST' });
        $('#rc-result').innerHTML = `
          <div class="big-code" style="margin:12px 0 6px">${esc(r.code)}</div>
          <div class="r-meta">For <strong>${esc(r.displayName)}</strong> (username: <strong>${esc(r.username)}</strong>) · expires in ${r.expiresMinutes} min · one use.
          They tap “Forgot password?” on the login screen.</div>
          <button class="btn btn-sm" id="rc-copy" style="margin-top:8px">Copy code</button>`;
        $('#rc-copy').onclick = () => copyText(r.code);
      } catch (err) {
        toast(err.message);
      }
      $('#rc-gen').disabled = false;
    };
  }
  $('#p-logout').onclick = async () => {
    await api('/logout', { method: 'POST' });
    state.user = null;
    closeModal();
    location.hash = '#/welcome';
  };
  $('#p-save').onclick = async () => {
    $('#p-error').textContent = '';
    try {
      await api('/me/password', {
        method: 'POST',
        body: { currentPassword: $('#p-current').value, newPassword: $('#p-new').value },
      });
      toast('Password updated — other devices were signed out');
      closeModal();
    } catch (err) {
      $('#p-error').textContent = err.message;
    }
  };
}

// ===================== welcome / auth =====================

function viewWelcome() {
  if (state.user) { location.hash = '#/library'; return; }
  appEl.innerHTML = `
  <div class="auth-wrap">
    <div class="auth-card">
      <div class="auth-logo">${icon('dice', 'accent')}</div>
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
        <div id="pw-wrap">
          <label>Password</label>
          <input type="password" id="a-password" autocomplete="current-password">
        </div>
        <div id="reset-extra" style="display:none">
          <label>Reset code <span style="font-weight:400">(ask a crewmate to generate one)</span></label>
          <input type="text" id="a-code" autocomplete="one-time-code" placeholder="XXXX-XXXX" style="text-transform:uppercase;font-family:ui-monospace,Menlo,monospace;letter-spacing:2px">
          <label>New password</label>
          <input type="password" id="a-newpw" autocomplete="new-password" placeholder="At least 6 characters">
        </div>
        <div class="form-error" id="a-error"></div>
        <button class="btn btn-primary" type="submit" id="a-submit">Log in</button>
        <button class="link-btn" type="button" id="forgot-link">Forgot password?</button>
      </form>
    </div>
  </div>`;

  let mode = 'login';
  const applyMode = () => {
    $('#signup-extra').style.display = mode === 'signup' ? '' : 'none';
    $('#pw-wrap').style.display = mode === 'reset' ? 'none' : '';
    $('#reset-extra').style.display = mode === 'reset' ? '' : 'none';
    $('#a-submit').textContent = mode === 'signup' ? 'Create my shelf' : mode === 'reset' ? 'Reset & log in' : 'Log in';
    $('#forgot-link').textContent = mode === 'reset' ? '← Back to log in' : 'Forgot password?';
    $('#a-error').textContent = '';
  };
  for (const tab of appEl.querySelectorAll('.tab')) {
    tab.onclick = () => {
      mode = tab.dataset.tab;
      appEl.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
      applyMode();
    };
  }
  $('#forgot-link').onclick = () => {
    mode = mode === 'reset' ? 'login' : 'reset';
    if (mode !== 'reset') appEl.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === 'login'));
    applyMode();
  };
  $('#auth-form').onsubmit = async (e) => {
    e.preventDefault();
    $('#a-error').textContent = '';
    try {
      let user;
      if (mode === 'reset') {
        ({ user } = await api('/reset-password', {
          method: 'POST',
          body: { username: $('#a-username').value, code: $('#a-code').value, newPassword: $('#a-newpw').value },
        }));
        toast('Password reset — welcome back!');
      } else {
        const body = { username: $('#a-username').value, password: $('#a-password').value };
        if (mode === 'signup') body.displayName = $('#a-display').value;
        ({ user } = await api(mode === 'signup' ? '/signup' : '/login', { method: 'POST', body }));
        if (mode === 'signup') toast('Welcome to Meeple Shelf!');
      }
      state.user = user;
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
  const owned = entries.filter((en) => en.status !== 'wish');
  const wishes = entries.filter((en) => en.status === 'wish');

  appEl.innerHTML = `
  <div class="container">
    <div class="page-head">
      <div>
        <h1>My Shelf</h1>
        <div class="sub">${owned.length} game${owned.length === 1 ? '' : 's'} on your shelf${wishes.length ? ` · ${wishes.length} wished for` : ''}</div>
      </div>
      <button class="btn btn-primary" id="add-game-btn">+ Add a game</button>
    </div>

    <div class="share-bar ${state.user.libraryPublic ? '' : 'is-private'}">
      <span class="share-label">${icon('link')} Share your shelf</span>
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
          <option value="out" ${libState.sort === 'out' ? 'selected' : ''}>Out longest</option>
        </select>
      </div>
    </div>
    <div id="lib-grid"></div>` : emptyState('dice', 'Your shelf is empty', 'Add the games you own — then share your shelf or pool it with friends in a crew.', '<button class="btn btn-primary" id="empty-add-btn">+ Add your first game</button>')}
  </div>`;

  const byId = new Map(entries.map((en) => [String(en.id), en]));
  const openAdd = () => openAddModal();

  const entryCard = (en) =>
    gameCardHtml(en.game, {
      entryId: en.id,
      gameId: en.game.id,
      notes: en.notes,
      addedAt: en.addedAt,
      actions: true,
      loanedTo: en.loanedTo,
      dueDate: en.dueDate,
      gotIt: en.status === 'wish',
      extraBadges: en.status === 'grabs' ? `<span class="badge grabs">${icon('gift')} up for grabs</span>` : '',
    });

  function renderGrid() {
    const grid = $('#lib-grid');
    if (!grid) return;
    const q = libState.q.trim().toLowerCase();
    const match = (en) => !q || en.game.title.toLowerCase().includes(q);
    let list = owned.filter(match);
    const wl = wishes.filter(match);
    if (libState.sort === 'title') list.sort((a, b) => a.game.title.localeCompare(b.game.title));
    else if (libState.sort === 'out') {
      // lent copies first, longest-out first (out_at ISO strings sort chronologically)
      list.sort(
        (a, b) =>
          (a.loanedOutAt ? 0 : 1) - (b.loanedOutAt ? 0 : 1) ||
          String(a.loanedOutAt || '').localeCompare(String(b.loanedOutAt || '')) ||
          a.game.title.localeCompare(b.game.title)
      );
    }
    grid.innerHTML =
      (list.length
        ? `<div class="grid">${list.map(entryCard).join('')}</div>`
        : emptyState('search', 'No matches', 'No games on your shelf match that search.')) +
      (wl.length
        ? `<h2 class="section-h">${icon('gift', 'accent')} Wishlist <span class="count">${wl.length}</span></h2>
           <div class="grid">${wl.map(entryCard).join('')}</div>`
        : '');
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
      if (!btn) {
        const card = e.target.closest('[data-game]');
        if (card && !clickedControl(e)) openGameModal(Number(card.dataset.game));
        return;
      }
      const card = e.target.closest('[data-entry]');
      const entry = byId.get(card.dataset.entry);
      if (!entry) return;
      if (btn.dataset.act === 'edit') openEditModal(entry);
      if (btn.dataset.act === 'gotit') {
        btn.disabled = true;
        try {
          await api(`/library/${entry.id}`, { method: 'PATCH', body: { status: 'owned' } });
          toast(`${entry.game.title} moved to your shelf — congrats!`);
          route();
        } catch (err) {
          btn.disabled = false;
          toast(err.message);
        }
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
  let addStatus = 'owned';

  openModal(`
    <div class="modal-head"><h2>Add a game</h2><button class="modal-close" aria-label="Close">${icon('x')}</button></div>
    <div class="modal-body">
      <div class="tabs">
        <button class="tab active" data-tab="search">Search</button>
        <button class="tab" data-tab="bulk">Bulk add</button>
        <button class="tab" data-tab="manual">Manual entry</button>
      </div>
      ${showOwners ? `<div class="owner-pick" id="owner-pick">
        <span class="glabel">Whose shelf?</span>
        ${ownersCtx.members.map((m) => `<button class="chip-btn ${selectedOwners.has(m.id) ? 'active' : ''}" data-owner="${m.id}">${esc(m.displayName)}${m.id === state.user.id ? ' (me)' : ''}</button>`).join('')}
      </div>` : ''}
      <div class="owner-pick" id="status-pick">
        <span class="glabel">Add to</span>
        <button class="chip-btn active" data-status="owned">${icon('dice')} Shelf</button>
        <button class="chip-btn" data-status="wish">${icon('gift')} Wishlist</button>
      </div>
      <div id="tab-search">
        <input type="text" id="game-q" placeholder="Start typing a game name…" autocomplete="off">
        <div class="search-results" id="game-results"></div>
        <div class="search-hint">Searches a built-in catalog of popular games plus everything already added by people on this server. Missing something? Use Manual entry.</div>
      </div>
      <div id="tab-bulk" style="display:none">
        <label>One game per line</label>
        <textarea id="bulk-input" rows="7" placeholder="Wingspan&#10;Catan&#10;Azul: Summer Pavilion&#10;…"></textarea>
        <button class="btn" id="bulk-match" style="margin-top:10px">Match titles</button>
        <div class="search-results" id="bulk-results"></div>
        <button class="btn btn-primary" id="bulk-add" style="margin-top:10px;display:none">Add selected</button>
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
      for (const name of ['search', 'bulk', 'manual']) {
        $('#tab-' + name).style.display = tab.dataset.tab === name ? '' : 'none';
      }
    };
  }

  // ---- bulk add: paste titles, match each against search, add the lot ----
  let bulkRows = [];
  function renderBulk() {
    $('#bulk-results').innerHTML = bulkRows.map((row, i) => `
      <div class="result-row ${row.checked ? '' : 'added'}">
        ${row.match?.imageUrl ? `<img class="r-thumb" loading="lazy" src="${esc(row.match.imageUrl)}" alt="" onerror="this.remove()">` : ''}
        <div class="r-grow">
          <div class="r-title">${esc(row.match ? row.match.title : row.line)}${row.match?.year ? `<span class="r-year">(${row.match.year})</span>` : ''}</div>
          <div class="r-meta">${row.match ? ([fmtPlayers(row.match), fmtTime(row.match)].filter(Boolean).join(' · ') || 'matched') : 'no match — will be added with this title as-is'}</div>
        </div>
        <input type="checkbox" data-bulk="${i}" ${row.checked ? 'checked' : ''} style="width:17px;height:17px;accent-color:var(--accent)">
      </div>`).join('');
  }
  $('#bulk-results').addEventListener('change', (e) => {
    const cb = e.target.closest('[data-bulk]');
    if (!cb) return;
    bulkRows[Number(cb.dataset.bulk)].checked = cb.checked;
    renderBulk();
  });
  $('#bulk-match').onclick = async () => {
    const lines = [...new Set($('#bulk-input').value.split('\n').map((s) => s.trim()).filter((s) => s.length >= 2))].slice(0, 100);
    if (!lines.length) return;
    const btn = $('#bulk-match');
    btn.disabled = true;
    bulkRows = [];
    const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    for (const [i, line] of lines.entries()) {
      btn.textContent = `Matching… ${i + 1}/${lines.length}`;
      let match = null;
      try {
        const { results } = await api('/games/search?q=' + encodeURIComponent(line));
        match = results.find((r) => norm(r.title) === norm(line)) || results[0] || null;
      } catch { /* leave unmatched */ }
      bulkRows.push({ line, match, checked: true });
      renderBulk();
    }
    btn.disabled = false;
    btn.textContent = 'Match titles';
    $('#bulk-add').style.display = '';
  };
  $('#bulk-add').onclick = async () => {
    const rows = bulkRows.filter((r) => r.checked);
    if (!rows.length) return;
    const btn = $('#bulk-add');
    btn.disabled = true;
    let ok = 0, dup = 0, done = 0;
    for (const row of rows) {
      btn.textContent = `Adding… ${++done}/${rows.length}`;
      try {
        const ownerIds = [...selectedOwners];
        const m = row.match;
        const body = m?.gameId
          ? { gameId: m.gameId, ownerIds, status: addStatus }
          : m
            ? { title: m.title, year: m.year, minPlayers: m.minPlayers, maxPlayers: m.maxPlayers, playTime: m.playTime, category: m.category, imageUrl: m.imageUrl, ownerIds, status: addStatus }
            : { title: row.line, ownerIds, status: addStatus };
        const { added } = await api('/library', { method: 'POST', body });
        added ? ok++ : dup++;
      } catch { /* keep going */ }
    }
    modalDirty = true;
    toast(`Added ${ok} game${ok === 1 ? '' : 's'}${dup ? ` · ${dup} already on the shelf` : ''}`);
    closeModal();
  };

  $('#status-pick').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-status]');
    if (!btn) return;
    addStatus = btn.dataset.status;
    $('#status-pick').querySelectorAll('.chip-btn').forEach((b) => b.classList.toggle('active', b === btn));
  });

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
  if (canAutoFocus) $('#game-q').focus();

  resultsEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-add]');
    if (!btn || btn.disabled) return;
    const r = lastResults[Number(btn.dataset.add)];
    if (!r) return;
    btn.disabled = true;
    try {
      const ownerIds = [...selectedOwners];
      const body = r.gameId
        ? { gameId: r.gameId, ownerIds, status: addStatus }
        : { title: r.title, year: r.year, minPlayers: r.minPlayers, maxPlayers: r.maxPlayers, playTime: r.playTime, category: r.category, imageUrl: r.imageUrl, ownerIds, status: addStatus };
      const { game, added, requested } = await api('/library', { method: 'POST', body });
      btn.textContent = added ? '✓ Added' : 'On shelf';
      btn.closest('.result-row').classList.add('added');
      if (added) {
        modalDirty = true;
        toast(addStatus === 'wish'
          ? `${game.title} → wishlist`
          : `${game.title} added to ${added === 1 ? (requested === 1 ? 'the shelf' : '1 shelf') : added + ' shelves'}`);
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
      body.status = addStatus;
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
    <div class="modal-head"><h2>${esc(g.title)}</h2><button class="modal-close" aria-label="Close">${icon('x')}</button></div>
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
      <label>This copy is</label>
      <select id="e-status" style="width:100%">
        <option value="owned" ${(entry.status || 'owned') === 'owned' ? 'selected' : ''}>On my shelf</option>
        <option value="wish" ${entry.status === 'wish' ? 'selected' : ''}>On my wishlist (don't own it yet)</option>
        <option value="grabs" ${entry.status === 'grabs' ? 'selected' : ''}>Up for grabs (culling it — first dibs)</option>
      </select>
      <label>Scoring</label>
      <select id="e-dir" style="width:100%">
        <option value="">Not set</option>
        <option value="high" ${g.scoreDir === 'high' ? 'selected' : ''}>Highest score wins</option>
        <option value="low" ${g.scoreDir === 'low' ? 'selected' : ''}>Lowest score wins</option>
        <option value="coop" ${g.scoreDir === 'coop' ? 'selected' : ''}>Co-op (team score)</option>
      </select>
      <label>Cover image URL</label>
      <input type="url" id="e-img" value="${esc(g.imageUrl || '')}" placeholder="https://…">
      ${mates.length || entry.loanedTo ? `<label>Currently at</label>
      <select id="e-loan" style="width:100%">
        <option value="">Home</option>
        ${entry.loanedTo && !mates.some((m) => m.id === entry.loanedTo.id) ? `<option value="${entry.loanedTo.id}" selected>with ${esc(entry.loanedTo.displayName)} (other crew)</option>` : ''}
        ${mates.map((m) => `<option value="${m.id}" ${entry.loanedTo?.id === m.id ? 'selected' : ''}>with ${esc(m.displayName)}</option>`).join('')}
      </select>
      <div id="e-due-wrap" style="${entry.loanedTo ? '' : 'display:none'}">
        <label>Due back <span style="font-weight:400">(optional)</span></label>
        <input type="date" id="e-due" value="${esc(entry.dueDate || '')}">
      </div>` : ''}
      <label>Notes <span style="font-weight:400">(visible on your public shelf)</span></label>
      <input type="text" id="e-notes" value="${esc(entry.notes)}" placeholder="e.g. sleeved, missing a token…">
      <div class="form-error" id="e-error"></div>
      <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap">
        <button class="btn btn-primary" id="e-save">Save</button>
        <span class="nav-spacer"></span>
        <button class="btn btn-ghost btn-danger" id="e-remove">Remove from shelf</button>
      </div>
    </div>`);
  $('#e-remove').onclick = async () => {
    if (!window.confirm(`Remove "${g.title}" from your shelf?`)) return;
    await api(`/library/${entry.id}`, { method: 'DELETE' });
    toast(`Removed ${g.title}`);
    modalDirty = true;
    closeModal();
  };
  if ($('#e-loan')) {
    $('#e-loan').onchange = (e) => {
      $('#e-due-wrap').style.display = e.target.value ? '' : 'none';
      if (!e.target.value) $('#e-due').value = '';
    };
  }
  // a wish isn't a physical copy: hide the loan controls while wish is selected
  $('#e-status').onchange = (e) => {
    if (!$('#e-loan')) return;
    const showLoan = e.target.value !== 'wish';
    $('#e-loan').style.display = showLoan ? '' : 'none';
    $('#e-loan').previousElementSibling.style.display = showLoan ? '' : 'none'; // its "Currently at" label
    if (!showLoan) { $('#e-loan').value = ''; $('#e-due-wrap').style.display = 'none'; $('#e-due').value = ''; }
  };
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
          scoreDir: $('#e-dir').value || null,
          status: $('#e-status').value,
          ...($('#e-loan') ? { loanedTo: $('#e-loan').value || null, dueDate: $('#e-due').value || null } : {}),
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
      : emptyState('users', 'No crews yet', 'Create a crew and send the invite code to your game group — or join one with a code a friend sent you.')}
  </div>`;

  $('#create-form').onsubmit = async (e) => {
    e.preventDefault();
    const name = $('#crew-name').value.trim();
    if (!name) return;
    try {
      const { crew } = await api('/crews', { method: 'POST', body: { name } });
      modalDirty = true;
      openModal(`
        <div class="modal-head"><h2>${esc(crew.name)} is ready!</h2><button class="modal-close" aria-label="Close">${icon('x')}</button></div>
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
      toast(alreadyMember ? `You're already in ${crew.name}` : `Welcome to ${crew.name}!`);
      location.hash = `#/crew/${crew.id}`;
    } catch (err) {
      toast(err.message);
    }
  };
}

// ---------- crew detail: the combined library ----------

// filters start open on desktop, tucked away on phones
const filtersOpenDefault = !window.matchMedia('(max-width: 640px)').matches;
const crewState = { id: null, q: '', players: 'any', time: 'any', owner: 'all', category: 'all', tag: 'all', sort: 'title', view: 'grid', expanded: new Set(), filtersOpen: filtersOpenDefault, neverPlayed: false };

async function viewCrewDetail(id) {
  if (crewState.id !== id) Object.assign(crewState, { id, q: '', players: 'any', time: 'any', owner: 'all', category: 'all', tag: 'all', sort: 'title', view: 'grid', expanded: new Set(), filtersOpen: filtersOpenDefault, neverPlayed: false });
  const { crew, members, games } = await api('/crews/' + id);
  const multiOwned = games.filter((g) => g.owners.length > 1).length;
  const categories = [...new Set(games.map((g) => g.category).filter(Boolean))].sort();
  const crewTags = [...new Set(games.flatMap((g) => g.tags || []))].sort();
  let eventsCache = null; // nights view data, fetched on first visit

  appEl.innerHTML = `
  <div class="container">
    <div class="page-head">
      <div>
        <h1>${esc(crew.name)}</h1>
        <div class="sub">${games.length} games · ${members.length} shelves${multiOwned ? ` · ${multiOwned} shared` : ''}</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <button class="btn btn-primary" id="crew-add-btn">+ Add<span class="seg-txt"> a game</span></button>
        <button class="btn" id="crew-menu-btn" title="Crew menu">${icon('menu')} Menu</button>
      </div>
    </div>

    <div class="members-wrap">
      <div class="members-row" id="members-scroll">
        ${members.map((m) => `
          <button class="member" data-member="${m.id}" title="Show only ${esc(m.displayName)}' games" style="--c:${memberColor(m.id)}">
            <span class="avatar">${esc(m.displayName.slice(0, 2).toUpperCase())}</span>
            <span class="m-name">${esc(m.displayName)}</span>
            <span class="m-count">${m.gameCount}</span>
          </button>`).join('')}
      </div>
      <div class="members-fade" id="members-fade">›</div>
    </div>

    <div class="filter-bar" id="cw-toolbar">
      <input type="text" class="search" id="cw-q" placeholder="Search games…" value="${esc(crewState.q)}">
      <button class="chip-btn" id="cw-filtertoggle"></button>
      <span class="nav-spacer"></span>
      <button class="btn" id="surprise-btn">${icon('dice')}<span class="seg-txt"> Surprise me</span></button>
      <div class="segmented">
        <button data-view="grid" class="${crewState.view === 'grid' ? 'active' : ''}">Grid</button>
        <button data-view="matrix" class="${crewState.view === 'matrix' ? 'active' : ''}">Who has what</button>
        <button data-view="nights" class="${crewState.view === 'nights' ? 'active' : ''}">${icon('calendar')}<span class="seg-txt"> Nights</span></button>
        <button data-view="stats" class="${crewState.view === 'stats' ? 'active' : ''}">${icon('trophy')}<span class="seg-txt"> Leaderboard</span></button>
      </div>
    </div>

    <div class="filter-bar" id="cw-filterctl" style="${crewState.filtersOpen ? '' : 'display:none'}">
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
      ${crewTags.length ? `<div class="filter-group" id="tag-chips">
        <span class="glabel">${icon('tag')}</span>
        ${crewTags.map((t) => `<button class="chip-btn ${crewState.tag === t ? 'active' : ''}" data-tag="${esc(t)}">${esc(t)}</button>`).join('')}
      </div>` : ''}
      <div class="filter-group">
        <span class="glabel">Show</span>
        <button class="chip-btn ${crewState.neverPlayed ? 'active' : ''}" id="cw-never">${icon('ghost')} Never played</button>
      </div>
      <div class="filter-group">
        <span class="glabel">Sort</span>
        <select id="cw-sort">
          <option value="title" ${crewState.sort === 'title' ? 'selected' : ''}>Title A–Z</option>
          <option value="owners" ${crewState.sort === 'owners' ? 'selected' : ''}>Most owners</option>
          <option value="lastPlayed" ${crewState.sort === 'lastPlayed' ? 'selected' : ''}>Dustiest first</option>
          <option value="out" ${crewState.sort === 'out' ? 'selected' : ''}>Out longest</option>
        </select>
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
    if (crewState.tag !== 'all') {
      list = list.filter((g) => (g.tags || []).includes(crewState.tag));
    }
    if (crewState.neverPlayed) {
      list = list.filter((g) => !g.playCount && !g.expansionOf && g.category !== 'Expansion for Base-game');
    }
    const earliestOut = (g) => {
      const outs = g.owners.filter((o) => o.loanedTo && o.loanedOutAt).map((o) => o.loanedOutAt);
      return outs.length ? outs.sort()[0] : null;
    };
    if (crewState.sort === 'owners') list.sort((a, b) => b.owners.length - a.owners.length || a.title.localeCompare(b.title));
    else if (crewState.sort === 'lastPlayed') {
      // dustiest first: never-played, then oldest lastPlayedAt
      list.sort(
        (a, b) =>
          (a.lastPlayedAt ? 1 : 0) - (b.lastPlayedAt ? 1 : 0) ||
          String(a.lastPlayedAt || '').localeCompare(String(b.lastPlayedAt || '')) ||
          a.title.localeCompare(b.title)
      );
    } else if (crewState.sort === 'out') {
      list.sort((a, b) => {
        const ao = earliestOut(a);
        const bo = earliestOut(b);
        return (ao ? 0 : 1) - (bo ? 0 : 1) || String(ao || '').localeCompare(String(bo || '')) || a.title.localeCompare(b.title);
      });
    } else list.sort((a, b) => a.title.localeCompare(b.title));
    return list;
  }

  function activeFilterCount() {
    return (
      (crewState.q.trim() ? 1 : 0) +
      (crewState.players !== 'any' ? 1 : 0) +
      (crewState.time !== 'any' ? 1 : 0) +
      (crewState.owner !== 'all' ? 1 : 0) +
      (crewState.category !== 'all' ? 1 : 0) +
      (crewState.tag !== 'all' ? 1 : 0) +
      (crewState.neverPlayed ? 1 : 0) +
      (crewState.sort !== 'title' ? 1 : 0)
    );
  }

  function syncToolbar() {
    // nights & stats are full-page views — the game search/filter bar steps aside
    const statsMode = crewState.view === 'stats' || crewState.view === 'nights';
    for (const el of [$('#cw-q'), $('#cw-filtertoggle'), $('#surprise-btn')]) {
      el.style.display = statsMode ? 'none' : '';
    }
    $('#cw-filterctl').style.display = !statsMode && crewState.filtersOpen ? '' : 'none';
    const n = activeFilterCount();
    $('#cw-filtertoggle').textContent = `Filters${n ? ' · ' + n : ''} ${crewState.filtersOpen ? '▴' : '▾'}`;
    $('#cw-filtertoggle').classList.toggle('active', n > 0);
    for (const chip of appEl.querySelectorAll('#members-scroll .member')) {
      chip.classList.toggle('active', String(crewState.owner) === chip.dataset.member);
    }
  }

  function renderGames() {
    const container = $('#cw-games');
    const banner = $('#surprise-result');
    syncToolbar();
    if (crewState.view === 'stats' || crewState.view === 'nights') {
      banner.style.display = 'none';
      $('#cw-count').textContent = '';
      if (crewState.view === 'stats') renderStats(container);
      else renderNights(container);
      return;
    }
    if (banner.innerHTML) banner.style.display = '';
    const list = filtered();
    $('#cw-count').textContent = `${list.length} of ${games.length} games`;
    if (!list.length) {
      container.innerHTML = emptyState('ghost', 'No games match', 'Try loosening the filters — or get someone to buy more games.');
      return;
    }
    if (crewState.view === 'grid') {
      const { top, exps } = groupExpansions(list);
      const grabsBadge = (g) => {
        const names = g.owners.filter((o) => o.grabs).map((o) => o.displayName);
        return names.length ? `<span class="badge grabs" title="Being culled — ask ${esc(names.join(', '))} for first dibs">${icon('gift')} up for grabs</span>` : '';
      };
      const cards = [];
      for (const g of top) {
        const kids = exps.get(g.id);
        const expanded = crewState.expanded.has(g.id);
        cards.push(gameCardHtml(g, { owners: g.owners, gameId: g.id, editOwners: true, expansions: kids, expanded, playCount: g.playCount, extraBadges: grabsBadge(g) }));
        if (kids && expanded) {
          for (const e of kids) cards.push(gameCardHtml(e, { owners: e.owners, gameId: e.id, editOwners: true, playCount: e.playCount, extraBadges: grabsBadge(e) }));
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
              const o = g.owners.find((x) => x.id === m.id);
              if (!o) return '<td></td>';
              const overdue = o.dueDate && o.dueDate < localISODate();
              return `<td><span class="check" style="color:${memberColor(m.id)}">✓</span>${o.loanedTo ? `<span class="m-loan${overdue ? ' overdue' : ''}" title="with ${esc(o.loanedTo.displayName)}${o.dueDate ? ' · due ' + fmtDay(o.dueDate) : ''}">→${esc(o.loanedTo.displayName.slice(0, 2).toUpperCase())}${overdue ? icon('alarm') : ''}</span>` : ''}</td>`;
            }).join('')}
          </tr>`;
          }).join('')}
        </tbody>
      </table></div>`;
    }
  }
  renderGames();

  $('#cw-filtertoggle').onclick = () => {
    crewState.filtersOpen = !crewState.filtersOpen;
    syncToolbar();
  };
  $('#cw-q').oninput = debounce((e) => { crewState.q = e.target.value; renderGames(); }, 150);
  $('#players-chips').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-p]');
    if (!btn) return;
    crewState.players = btn.dataset.p;
    $('#players-chips').querySelectorAll('.chip-btn').forEach((b) => b.classList.toggle('active', b === btn));
    renderGames();
  });
  $('#cw-never').onclick = () => {
    crewState.neverPlayed = !crewState.neverPlayed;
    $('#cw-never').classList.toggle('active', crewState.neverPlayed);
    renderGames();
  };
  if ($('#tag-chips')) {
    $('#tag-chips').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-tag]');
      if (!btn) return;
      crewState.tag = crewState.tag === btn.dataset.tag ? 'all' : btn.dataset.tag;
      $('#tag-chips').querySelectorAll('.chip-btn').forEach((b) => b.classList.toggle('active', b.dataset.tag === crewState.tag));
      renderGames();
    });
  }
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
    if (btn) {
      const card = e.target.closest('[data-game]');
      const game = games.find((g) => g.id === Number(card.dataset.game));
      if (game) openOwnersModal(crew, game, members);
      return;
    }
    const card = e.target.closest('[data-game]');
    if (card && !clickedControl(e)) {
      const game = games.find((g) => g.id === Number(card.dataset.game));
      openGameModal(Number(card.dataset.game), { owners: game?.owners, crewId: id, tags: game?.tags || [], allTags: crewTags });
    }
  });

  // ---- leaderboard ----
  async function renderStats(container) {
    container.innerHTML = `<div class="skel skel-line" style="width:34%;height:22px"></div><div class="skel skel-card" style="aspect-ratio:auto;height:200px;margin-top:14px"></div><div class="skel skel-line" style="width:50%;margin-top:18px"></div>`;
    let plays, stats;
    try {
      [{ plays }, stats] = await Promise.all([api(`/crews/${id}/plays`), api(`/crews/${id}/stats`)]);
    } catch (e) {
      container.innerHTML = emptyState('alert', 'Hmm', esc(e.message));
      return;
    }
    if (crewState.view !== 'stats') return; // user switched away while loading

    const medalIcon = (i) => icon('award', ['gold', 'silver', 'bronze'][i]);
    const tierChip = (t) => (t ? `<span class="badge milestone">${icon('award')} ${t === 'quarter' ? '25+' : t === 'dime' ? '10+' : '5+'}</span>` : '');
    container.innerHTML = `
      <div class="stats-head">
        <div class="stats-blurb">${stats.totalPlays} play${stats.totalPlays === 1 ? '' : 's'} · ${stats.distinctGames || 0} game${stats.distinctGames === 1 ? '' : 's'} · crew H-index <strong>${stats.hIndex || 0}</strong></div>
        <button class="btn btn-primary" id="log-play-btn">${icon('clipboard')} Log a play</button>
      </div>

      ${stats.totalPlays === 0 ? emptyState('dice', 'No plays yet', 'Log your first game and the standings begin. Every rivalry starts somewhere.') : `
      <div class="stats-section">
        <h3>Standings</h3>
        <div class="matrix-wrap"><table class="matrix">
          <thead><tr><th style="text-align:left">Household</th><th>Plays</th><th>Wins</th><th>Win %</th><th title="H-index">H</th><th title="Plays hosted">${icon('home')}</th></tr></thead>
          <tbody>
            ${stats.standings.map((s, i) => `<tr>
              <td>
                <span class="medal">${s.wins > 0 && i < 3 ? medalIcon(i) : ''}</span> <span class="avatar" style="--c:${memberColor(s.id)};background:${memberColor(s.id)};display:inline-flex;width:22px;height:22px;font-size:10px;vertical-align:middle">${esc(s.displayName.slice(0, 2).toUpperCase())}</span> <span class="g-title">${esc(s.displayName)}</span>
                ${s.nemesis ? `<div class="nemesis-line">${icon('swords')} nemesis: ${esc(s.nemesis.displayName)} (${s.nemesis.losses})</div>` : ''}
              </td>
              <td>${s.plays}</td>
              <td>${s.wins}</td>
              <td>${s.plays ? s.winRate + '%' : '—'}</td>
              <td>${s.hIndex || '—'}</td>
              <td>${s.hosted || '—'}</td>
            </tr>`).join('')}
          </tbody>
        </table></div>
      </div>

      <div class="stats-section">
        <h3>Play activity — last 52 weeks</h3>
        <div class="hm-scroll">${heatmapHtml(stats.heatmap || {})}</div>
      </div>

      ${stats.records?.length ? `
      <div class="stats-section">
        <h3>Record book</h3>
        <div class="search-results" style="max-height:none">
          ${stats.records.map((r) => `
          <div class="result-row">
            ${r.imageUrl ? `<img class="r-thumb" loading="lazy" src="${esc(r.imageUrl)}" alt="" onerror="this.remove()">` : ''}
            <div class="r-grow">
              <div class="r-title">${esc(r.title)}</div>
              <div class="r-meta">${icon('trophy')} ${r.best.score}${r.scoreDir === 'low' ? ' (low wins)' : ''} — ${esc(r.best.displayName)}, ${fmtDay(r.best.playedAt)} · avg ${r.avg} · ${r.scoredPlays} scored</div>
            </div>
          </div>`).join('')}
        </div>
      </div>` : ''}

      ${stats.milestones?.length ? `
      <div class="stats-section">
        <h3>Milestone wall</h3>
        <div class="search-results" style="max-height:none">
          ${stats.milestones.map((m) => `
          <div class="result-row">
            ${m.imageUrl ? `<img class="r-thumb" loading="lazy" src="${esc(m.imageUrl)}" alt="" onerror="this.remove()">` : ''}
            <div class="r-grow">
              <div class="r-title">${esc(m.title)}</div>
              <div class="r-meta">${m.plays} plays${m.champion ? ` · ${icon('crown')} ${esc(m.champion.displayName)} (${m.champion.wins})` : ''}</div>
            </div>
            ${tierChip(m.tier)}
          </div>`).join('')}
        </div>
      </div>` : ''}

      <div class="stats-section">
        <h3>Most played</h3>
        <div class="search-results" style="max-height:none">
          ${stats.topGames.map((g) => `
          <div class="result-row">
            ${g.imageUrl ? `<img class="r-thumb" loading="lazy" src="${esc(g.imageUrl)}" alt="" onerror="this.remove()">` : ''}
            <div class="r-grow">
              <div class="r-title">${esc(g.title)}</div>
              ${g.champion ? `<div class="r-meta">${icon('crown')} ${esc(g.champion.displayName)} (${g.champion.wins} win${g.champion.wins === 1 ? '' : 's'})</div>` : ''}
            </div>
            ${tierChip(g.badge)}
            <span class="badge">${g.plays} play${g.plays === 1 ? '' : 's'}</span>
          </div>`).join('')}
        </div>
      </div>

      <div class="stats-section">
        <h3>Recent plays</h3>
        <div class="search-results" style="max-height:none" id="play-feed">
          ${plays.map((p) => `
          <div class="result-row" data-play="${p.id}">
            ${p.game.imageUrl ? `<img class="r-thumb" loading="lazy" src="${esc(p.game.imageUrl)}" alt="" onerror="this.remove()">` : ''}
            <div class="r-grow">
              <div class="r-title">${esc(p.game.title)} <span class="r-year">${fmtDay(p.playedAt)}${p.host ? ` · ${icon('home')} ${esc(p.host.displayName)}` : ''}</span></div>
              ${p.expansions?.length ? `<div class="r-meta">+ ${p.expansions.map((x) => esc(expShortTitle(x))).join(', ')}</div>` : ''}
              <div class="card-owners" style="margin-top:4px">${p.players.map((pl) => `<span class="owner-chip" style="--c:${memberColor(pl.id)}">${pl.won ? icon('crown') + ' ' : ''}${esc(pl.displayName)}${pl.score != null ? ` · ${pl.score}` : ''}</span>`).join('')}</div>
              ${p.notes ? `<div class="card-notes">${esc(p.notes)}</div>` : ''}
            </div>
            <button class="icon-btn danger" data-del-play="${p.id}" title="Delete this play">${icon('x')}</button>
          </div>`).join('')}
        </div>
      </div>`}
    `;

    const hs = container.querySelector('.hm-scroll');
    if (hs) hs.scrollLeft = hs.scrollWidth; // most recent weeks first on phones

    $('#log-play-btn').onclick = () => openLogPlayModal();
    if ($('#play-feed')) {
      $('#play-feed').addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-del-play]');
        if (!btn) return;
        if (!window.confirm('Delete this play?')) return;
        await api(`/crews/${id}/plays/${btn.dataset.delPlay}`, { method: 'DELETE' });
        toast('Play deleted');
        route(); // full refresh so grid play counts / milestones don't go stale
      });
    }
  }

  // ---- game nights: propose a date, RSVP, vote on what to play ----
  async function renderNights(container) {
    container.innerHTML = `<div class="skel skel-line" style="width:34%;height:22px"></div><div class="skel skel-card" style="aspect-ratio:auto;height:180px;margin-top:14px"></div>`;
    if (!eventsCache) {
      try {
        eventsCache = (await api(`/crews/${id}/events`)).events;
      } catch (e) {
        container.innerHTML = emptyState('alert', 'Hmm', esc(e.message));
        return;
      }
    }
    if (crewState.view !== 'nights') return; // switched away while loading
    const today = localISODate();
    const upcoming = eventsCache.filter((ev) => !ev.canceled && ev.date >= today);
    const past = eventsCache.filter((ev) => ev.canceled || ev.date < today).slice(-6).reverse();

    const rsvpBtn = (ev, kind, label, icn) =>
      `<button class="chip-btn rsvp-${kind} ${ev.myRsvp === kind ? 'active' : ''}" data-rsvp="${kind}" data-ev="${ev.id}">${icon(icn)}<span class="seg-txt"> ${label}</span>${ev.rsvps[kind].length ? ` ${ev.rsvps[kind].length}` : ''}</button>`;

    const eventCard = (ev) => {
      const p = dateParts(ev.date);
      const canEdit = ev.createdBy.id === state.user.id || ev.host?.id === state.user.id;
      const isToday = ev.date === today;
      return `
      <div class="event-card${isToday ? ' tonight' : ''}" data-event="${ev.id}">
        <div class="ev-date" aria-hidden="true"><span class="ev-dow">${esc(p.dow)}</span><span class="ev-day">${esc(p.day)}</span><span class="ev-mon">${esc(p.mon)}</span></div>
        <div class="ev-body">
          <div class="ev-title">${esc(ev.title)}${isToday ? ` <span class="badge milestone">tonight!</span>` : ''}
            ${canEdit ? `<button class="icon-btn ev-edit" data-ev-edit="${ev.id}" title="Edit this night">${icon('pencil')}</button>` : ''}
          </div>
          <div class="r-meta">${[ev.time ? `${icon('clock')} ${esc(ev.time)}` : '', ev.host ? `${icon('home')} at the ${esc(ev.host.displayName)}'` : '', `planned by ${esc(ev.createdBy.displayName)}`].filter(Boolean).join(' · ')}</div>
          ${ev.notes ? `<div class="card-notes">${esc(ev.notes)}</div>` : ''}
          <div class="ev-rsvp">
            ${rsvpBtn(ev, 'in', "I'm in", 'check')}${rsvpBtn(ev, 'maybe', 'Maybe', 'clock')}${rsvpBtn(ev, 'out', 'Out', 'x')}
            ${ev.rsvps.in.length ? `<span class="ev-in-row">${ev.rsvps.in.map((u) => `<span class="avatar" title="${esc(u.displayName)}" style="--c:${memberColor(u.id)};background:${memberColor(u.id)}">${esc(u.displayName.slice(0, 2).toUpperCase())}</span>`).join('')}</span>` : ''}
          </div>
          <div class="ev-votes">
            ${ev.votes.length ? ev.votes.map((v) => `
              <div class="vote-row">
                <button class="chip-btn vote ${v.mine ? 'active' : ''}" data-vote="${v.gameId}" data-ev="${ev.id}" title="${esc(v.voters.join(', '))}">${icon('check')} ${v.count}</button>
                ${v.imageUrl ? `<img class="vote-thumb" loading="lazy" src="${esc(v.imageUrl)}" alt="" onerror="this.remove()">` : ''}
                <span class="vote-title">${esc(v.title)}</span>
              </div>`).join('') : `<div class="r-meta">No games proposed yet — what should hit the table?</div>`}
            <button class="chip-btn" data-suggest="${ev.id}">+ Suggest a game</button>
            <div class="sg-wrap" data-sg="${ev.id}" style="display:none">
              <input type="text" class="sg-q" placeholder="Search the crew's games…" autocomplete="off">
              <div class="search-results sg-results"></div>
            </div>
          </div>
        </div>
      </div>`;
    };

    container.innerHTML = `
      <div class="stats-head">
        <div class="stats-blurb">${upcoming.length ? `${upcoming.length} night${upcoming.length === 1 ? '' : 's'} on the calendar` : 'Nothing on the calendar yet'}</div>
        <button class="btn btn-primary" id="ev-new">${icon('calendar')} Plan a night</button>
      </div>
      ${upcoming.length
        ? upcoming.map(eventCard).join('')
        : emptyState('calendar', 'No game night planned', "Pick a date, see who's in, and vote on what hits the table.")}
      ${past.length ? `
      <h3 class="section-h" style="margin-top:26px">Past nights</h3>
      <div class="search-results" style="max-height:none">
        ${past.map((ev) => `
        <div class="result-row" style="${ev.canceled ? 'opacity:.55' : ''}">
          <div class="r-grow">
            <div class="r-title">${esc(ev.title)} <span class="r-year">${fmtDay(ev.date)}</span>${ev.canceled ? ' <span class="badge">called off</span>' : ''}</div>
            <div class="r-meta">${ev.rsvps.in.length ? `${ev.rsvps.in.length} in` : ''}${ev.votes.length ? ` · top vote: ${esc(ev.votes[0].title)}` : ''}</div>
          </div>
        </div>`).join('')}
      </div>` : ''}`;

    const patchCache = (event) => {
      eventsCache = eventsCache.map((x) => (x.id === event.id ? event : x));
      renderNights(container);
    };
    $('#ev-new').onclick = () => openEventModal();
    // delegated once per container element — re-renders must not stack handlers
    if (container.dataset.nightsWired) return;
    container.dataset.nightsWired = '1';
    container.addEventListener('click', async (e) => {
      const rsvp = e.target.closest('[data-rsvp]');
      if (rsvp) {
        try {
          const { event } = await api(`/events/${rsvp.dataset.ev}/rsvp`, { method: 'POST', body: { response: rsvp.dataset.rsvp } });
          patchCache(event);
        } catch (err) { toast(err.message); }
        return;
      }
      const vote = e.target.closest('[data-vote]');
      if (vote) {
        try {
          const { event } = await api(`/events/${vote.dataset.ev}/vote`, { method: 'POST', body: { gameId: Number(vote.dataset.vote) } });
          patchCache(event);
        } catch (err) { toast(err.message); }
        return;
      }
      const sug = e.target.closest('[data-suggest]');
      if (sug) {
        const wrap = container.querySelector(`[data-sg="${sug.dataset.suggest}"]`);
        wrap.style.display = wrap.style.display === 'none' ? '' : 'none';
        if (wrap.style.display === '' && canAutoFocus) wrap.querySelector('.sg-q').focus();
        return;
      }
      const edit = e.target.closest('[data-ev-edit]');
      if (edit) openEventModal(eventsCache.find((x) => x.id === Number(edit.dataset.evEdit)));
    });
    container.addEventListener('input', (e) => {
      const inp = e.target.closest('.sg-q');
      if (!inp) return;
      const wrap = inp.closest('.sg-wrap');
      const evId = wrap.dataset.sg;
      const q = inp.value.trim().toLowerCase();
      const results = wrap.querySelector('.sg-results');
      if (q.length < 2) { results.innerHTML = ''; return; }
      const matches = games.filter((g) => g.title.toLowerCase().includes(q)).slice(0, 6);
      results.innerHTML = matches.length
        ? matches.map((g) => `
          <div class="result-row" data-vote="${g.id}" data-ev="${evId}" style="cursor:pointer">
            ${g.imageUrl ? `<img class="r-thumb" src="${esc(g.imageUrl)}" alt="" onerror="this.remove()">` : ''}
            <div class="r-grow"><div class="r-title">${esc(g.title)}</div></div>
            <span class="badge">vote</span>
          </div>`).join('')
        : `<div class="search-hint">No crew game matches “${esc(inp.value)}”.</div>`;
    });
  }

  function openEventModal(ev = null) {
    const isEdit = !!ev;
    openModal(`
      <div class="modal-head"><h2>${isEdit ? 'Edit game night' : 'Plan game night'}</h2><button class="modal-close" aria-label="Close">${icon('x')}</button></div>
      <div class="modal-body">
        <label>What</label>
        <input type="text" id="ev-title" maxlength="60" value="${esc(ev?.title || 'Game night')}">
        <label>When</label>
        <input type="date" id="ev-date" value="${esc(ev?.date || '')}">
        <label>Time <span style="font-weight:400">(optional)</span></label>
        <input type="time" id="ev-time" value="${esc(ev?.time || '')}">
        <label>Where <span style="font-weight:400">(optional)</span></label>
        <div class="owner-pick" id="ev-host" style="margin-bottom:2px">
          ${members.map((m) => `<button class="chip-btn ${ev?.host?.id === m.id ? 'active' : ''}" data-host="${m.id}">${icon('home')} ${esc(m.displayName)}</button>`).join('')}
        </div>
        <label>Notes <span style="font-weight:400">(optional)</span></label>
        <input type="text" id="ev-notes" value="${esc(ev?.notes || '')}" placeholder="e.g. bring snacks, doors at 6:30…">
        <div class="form-error" id="ev-error"></div>
        <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap">
          <button class="btn btn-primary" id="ev-save">${isEdit ? 'Save' : 'Plan it'}</button>
          <button class="btn" id="ev-cancel">Cancel</button>
          ${isEdit && !ev.canceled ? `<span class="nav-spacer"></span><button class="btn btn-ghost btn-danger" id="ev-off">Call it off</button>` : ''}
        </div>
      </div>`);
    $('#ev-cancel').onclick = closeModal;
    modalRoot.querySelector('#ev-host').addEventListener('click', (e) => {
      const chip = e.target.closest('[data-host]');
      if (!chip) return;
      const was = chip.classList.contains('active');
      modalRoot.querySelectorAll('#ev-host .chip-btn').forEach((b) => b.classList.remove('active'));
      if (!was) chip.classList.add('active');
    });
    if ($('#ev-off')) {
      $('#ev-off').onclick = async () => {
        if (!window.confirm('Call off this game night?')) return;
        try {
          await api(`/events/${ev.id}`, { method: 'PATCH', body: { canceled: true } });
          toast('Night called off');
          modalDirty = true;
          closeModal();
        } catch (err) { $('#ev-error').textContent = err.message; }
      };
    }
    $('#ev-save').onclick = async () => {
      $('#ev-error').textContent = '';
      const hostChip = modalRoot.querySelector('#ev-host .chip-btn.active');
      const body = {
        title: $('#ev-title').value,
        date: $('#ev-date').value,
        time: $('#ev-time').value || null,
        hostId: hostChip ? Number(hostChip.dataset.host) : null,
        notes: $('#ev-notes').value,
      };
      try {
        await api(isEdit ? `/events/${ev.id}` : `/crews/${id}/events`, { method: isEdit ? 'PATCH' : 'POST', body });
        toast(isEdit ? 'Night updated' : 'Game night planned — crew can RSVP now');
        modalDirty = true;
        closeModal();
      } catch (err) {
        $('#ev-error').textContent = err.message;
      }
    };
  }

  function openLogPlayModal(preGame = null) {
    let selectedGame = preGame;
    const pickedExps = new Set(); // expansions played alongside the base game
    const today = new Date();
    const localDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    openModal(`
      <div class="modal-head"><h2>Log a play</h2><button class="modal-close" aria-label="Close">${icon('x')}</button></div>
      <div class="modal-body">
        <label>Game</label>
        <div id="lp-game-area"></div>
        <label>When</label>
        <input type="date" id="lp-date" value="${localDate}" max="${localDate}">
        <label>Hosted at <span style="font-weight:400">(optional)</span></label>
        <div class="owner-pick" id="lp-host" style="margin-bottom:2px">
          ${members.map((m) => `<button class="chip-btn" data-host="${m.id}">${icon('home')} ${esc(m.displayName)}</button>`).join('')}
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <label style="margin-top:14px">Who played? <span style="font-weight:400">(crown the winners)</span></label>
          <button class="chip-btn" id="lp-scores-toggle" style="margin-left:auto">${icon('hash')} Scores</button>
        </div>
        <div id="lp-players">
          ${members.map((m) => `
          <div class="owner-row" style="--c:${memberColor(m.id)}">
            <label class="owner-main">
              <input type="checkbox" value="${m.id}">
              <span class="avatar">${esc(m.displayName.slice(0, 2).toUpperCase())}</span>
              <span class="m-name">${esc(m.displayName)}</span>
            </label>
            <input type="number" class="lp-score" data-score="${m.id}" step="1" placeholder="pts" aria-label="${esc(m.displayName)} score">
            <button class="chip-btn lp-won" data-won="${m.id}" disabled>${icon('crown')}<span class="lp-won-txt"> Won</span></button>
          </div>`).join('')}
        </div>
        <label>Notes <span style="font-weight:400">(optional)</span></label>
        <input type="text" id="lp-notes" placeholder="e.g. closest game of the trip…">
        <div class="form-error" id="lp-error"></div>
        <div style="display:flex;gap:10px;margin-top:14px">
          <button class="btn btn-primary" id="lp-save">Log it</button>
          <button class="btn" id="lp-cancel">Cancel</button>
        </div>
      </div>`);
    $('#lp-cancel').onclick = closeModal;

    function renderGameArea() {
      const area = $('#lp-game-area');
      if (selectedGame) {
        // expansions of this game that live on a crew shelf — toggle what was played
        const kids = games.filter((g) => g.expansionOf === selectedGame.id);
        area.innerHTML = `
          <div class="result-row">
            ${selectedGame.imageUrl ? `<img class="r-thumb" src="${esc(selectedGame.imageUrl)}" alt="" onerror="this.remove()">` : ''}
            <div class="r-grow"><div class="r-title">${esc(selectedGame.title)}</div></div>
            <button class="btn btn-sm" id="lp-change">Change</button>
          </div>
          ${kids.length ? `<div class="owner-pick" id="lp-exps">
            <span class="glabel">With</span>
            ${kids.map((k) => `<button class="chip-btn ${pickedExps.has(k.id) ? 'active' : ''}" data-exp="${k.id}">${esc(expShortTitle(k))}</button>`).join('')}
          </div>` : ''}`;
        $('#lp-change').onclick = () => { selectedGame = null; pickedExps.clear(); renderGameArea(); };
        if (kids.length) {
          $('#lp-exps').addEventListener('click', (e) => {
            const chip = e.target.closest('[data-exp]');
            if (!chip) return;
            const xid = Number(chip.dataset.exp);
            if (pickedExps.has(xid)) pickedExps.delete(xid);
            else pickedExps.add(xid);
            chip.classList.toggle('active', pickedExps.has(xid));
          });
        }
      } else {
        area.innerHTML = `
          <input type="text" id="lp-q" placeholder="Search the crew's games…" autocomplete="off">
          <div class="search-results" id="lp-results"></div>`;
        const resultsEl = $('#lp-results');
        const renderResults = (q) => {
          const ql = q.trim().toLowerCase();
          if (ql.length < 2) { resultsEl.innerHTML = ''; return; }
          const matches = games.filter((g) => g.title.toLowerCase().includes(ql)).slice(0, 8);
          resultsEl.innerHTML = matches.length
            ? matches.map((g, i) => `
              <div class="result-row" data-pick="${g.id}" style="cursor:pointer">
                ${g.imageUrl ? `<img class="r-thumb" src="${esc(g.imageUrl)}" alt="" onerror="this.remove()">` : ''}
                <div class="r-grow"><div class="r-title">${esc(g.title)}</div></div>
              </div>`).join('')
            : `<div class="search-hint">No crew game matches “${esc(q)}”.</div>`;
        };
        $('#lp-q').oninput = (e) => renderResults(e.target.value);
        resultsEl.addEventListener('click', (e) => {
          const row = e.target.closest('[data-pick]');
          if (!row) return;
          let picked = games.find((g) => g.id === Number(row.dataset.pick));
          pickedExps.clear();
          // picking an expansion logs the play against its base game (so stats
          // stay whole) with that expansion pre-checked
          if (picked?.expansionOf) {
            const base = games.find((b) => b.id === picked.expansionOf);
            if (base) {
              pickedExps.add(picked.id);
              picked = base;
            }
          }
          selectedGame = picked;
          renderGameArea();
          suggestCrowns(); // re-evaluate winners under the picked game's scoring direction
        });
        if (canAutoFocus) $('#lp-q').focus();
      }
    }
    renderGameArea();

    for (const cb of modalRoot.querySelectorAll('#lp-players input[type="checkbox"]')) {
      cb.onchange = () => {
        const won = modalRoot.querySelector(`.lp-won[data-won="${cb.value}"]`);
        won.disabled = !cb.checked;
        if (!cb.checked) won.classList.remove('active');
      };
    }
    let crownsTouched = false;
    modalRoot.querySelector('#lp-players').addEventListener('click', (e) => {
      const btn = e.target.closest('.lp-won');
      if (!btn || btn.disabled) return;
      crownsTouched = true;
      btn.classList.toggle('active');
    });

    // scores: hidden until toggled; typing a score auto-checks that household
    // and (until crowns are touched) auto-suggests the winner from the scores
    $('#lp-scores-toggle').onclick = () => {
      modalRoot.querySelector('#lp-players').classList.toggle('show-scores');
      $('#lp-scores-toggle').classList.toggle('active');
    };
    function suggestCrowns() {
      if (crownsTouched) return;
      const dir = selectedGame?.scoreDir || 'high';
      if (dir === 'coop') {
        // co-op: clear any score-based auto-crowns (the team wins together or not at all)
        for (const btn of modalRoot.querySelectorAll('.lp-won')) btn.classList.remove('active');
        return;
      }
      const rows = [...modalRoot.querySelectorAll('#lp-players input[type="checkbox"]:checked')]
        .map((cb) => {
          const v = modalRoot.querySelector(`.lp-score[data-score="${cb.value}"]`).value;
          return { id: cb.value, score: v === '' ? null : Number(v) };
        })
        .filter((r) => r.score != null && Number.isFinite(r.score));
      if (rows.length < 2) return;
      const best = dir === 'low' ? Math.min(...rows.map((r) => r.score)) : Math.max(...rows.map((r) => r.score));
      for (const btn of modalRoot.querySelectorAll('.lp-won')) {
        const row = rows.find((r) => r.id === btn.dataset.won);
        if (!btn.disabled || row) btn.classList.toggle('active', !!row && row.score === best);
      }
    }
    modalRoot.querySelector('#lp-players').addEventListener('input', (e) => {
      const inp = e.target.closest('.lp-score');
      if (!inp) return;
      const cb = modalRoot.querySelector(`#lp-players input[type="checkbox"][value="${inp.dataset.score}"]`);
      if (inp.value !== '' && !cb.checked) {
        cb.checked = true;
        cb.onchange();
      }
      suggestCrowns();
    });

    // host: single-select chips
    modalRoot.querySelector('#lp-host').addEventListener('click', (e) => {
      const chip = e.target.closest('[data-host]');
      if (!chip) return;
      const was = chip.classList.contains('active');
      modalRoot.querySelectorAll('#lp-host .chip-btn').forEach((b) => b.classList.remove('active'));
      if (!was) chip.classList.add('active');
    });

    $('#lp-save').onclick = async () => {
      $('#lp-error').textContent = '';
      if (!selectedGame) { $('#lp-error').textContent = 'Pick the game you played'; return; }
      const players = [...modalRoot.querySelectorAll('#lp-players input[type="checkbox"]:checked')].map((cb) => {
        const sv = modalRoot.querySelector(`.lp-score[data-score="${cb.value}"]`).value;
        const n = sv === '' ? null : Number(sv);
        return {
          id: Number(cb.value),
          won: modalRoot.querySelector(`.lp-won[data-won="${cb.value}"]`).classList.contains('active'),
          score: n != null && Number.isFinite(n) ? Math.round(n) : null,
        };
      });
      if (!players.length) { $('#lp-error').textContent = 'Pick who played'; return; }
      const hostChip = modalRoot.querySelector('#lp-host .chip-btn.active');
      try {
        const { milestone } = await api(`/crews/${id}/plays`, {
          method: 'POST',
          body: { gameId: selectedGame.id, playedAt: $('#lp-date').value, players, notes: $('#lp-notes').value, hostId: hostChip ? Number(hostChip.dataset.host) : null, expansionIds: [...pickedExps] },
        });
        const winners = players.filter((p) => p.won);
        toast(winners.length ? `Logged — crown${winners.length > 1 ? 's' : ''} to ${winners.map((w) => members.find((m) => m.id === w.id)?.displayName).join(', ')}` : `Logged ${selectedGame.title}`);
        if (milestone) {
          const n = milestone === 'quarter' ? 25 : milestone === 'dime' ? 10 : 5;
          setTimeout(() => toast(`Milestone: ${selectedGame.title} just hit ${n} crew plays!`), 1200);
        }
        crewState.view = 'stats';
        modalDirty = true;
        closeModal();
      } catch (err) {
        $('#lp-error').textContent = err.message;
      }
    };
  }

  // ---- the game night picker: current filters + dice ----
  function surpriseHtml(g, final) {
    return `
      <div class="surprise-banner">
        <div class="sb-cover">${g.imageUrl ? `<img src="${esc(g.imageUrl)}" alt="" onerror="this.remove()">` : icon('dice')}</div>
        <div class="sb-body">
          <div class="sb-label">${final ? "Tonight you're playing" : 'Rolling…'}</div>
          <div class="sb-title">${esc(g.title)}</div>
          ${final ? `<div class="sb-meta">${[fmtPlayers(g), fmtTime(g)].filter(Boolean).join(' · ')}${g.owners?.length ? ` · owned by ${esc(g.owners.map((o) => o.displayName).join(', '))}` : ''}</div>` : ''}
        </div>
        ${final ? `<div class="sb-actions"><button class="btn btn-sm btn-primary" id="sb-played">${icon('clipboard')} We played it</button><button class="btn btn-sm" id="sb-again">Roll again</button><button class="icon-btn" id="sb-close" title="Dismiss">${icon('x')}</button></div>` : ''}
      </div>`;
  }
  let lastRoll = null;
  function rollSurprise() {
    const pool = filtered().filter((g) => !g.expansionOf && g.category !== 'Expansion for Base-game');
    if (!pool.length) return toast('No eligible games with these filters');
    const banner = $('#surprise-result');
    banner.style.display = '';
    let spins = 0;
    const winner = weightedPick(pool); // dusty games surface more often
    const itv = setInterval(() => {
      const g = spins >= 14 ? winner : pool[Math.floor(Math.random() * pool.length)];
      banner.innerHTML = surpriseHtml(g, spins >= 14);
      if (spins >= 14) lastRoll = g;
      if (spins++ >= 14) clearInterval(itv);
    }, 70);
  }
  $('#surprise-btn').onclick = rollSurprise;
  $('#surprise-result').addEventListener('click', (e) => {
    if (e.target.closest('#sb-played') && lastRoll) openLogPlayModal(lastRoll);
    if (e.target.closest('#sb-again')) rollSurprise();
    if (e.target.closest('#sb-close')) {
      $('#surprise-result').style.display = 'none';
      $('#surprise-result').innerHTML = '';
    }
  });

  // make the side-scrolling family bar obviously scrollable: a fading edge +
  // chevron that disappears once you've scrolled to the end
  {
    const scroller = $('#members-scroll');
    const fade = $('#members-fade');
    const updateFade = () => {
      fade.style.opacity = scroller.scrollWidth - scroller.clientWidth - scroller.scrollLeft > 8 ? '1' : '0';
    };
    scroller.addEventListener('scroll', updateFade, { passive: true });
    window.addEventListener('resize', updateFade, { passive: true });
    updateFade();

    // tap a family chip → filter to their games (tap again to clear)
    scroller.addEventListener('click', (e) => {
      const chip = e.target.closest('[data-member]');
      if (!chip) return;
      crewState.owner = String(crewState.owner) === chip.dataset.member ? 'all' : chip.dataset.member;
      const sel = $('#cw-owner');
      if (sel) sel.value = String(crewState.owner);
      if (crewState.view === 'stats') {
        crewState.view = 'grid';
        appEl.querySelectorAll('.segmented button').forEach((b) => b.classList.toggle('active', b.dataset.view === 'grid'));
      }
      renderGames();
    });
  }

  // swipe left/right anywhere in the games area to switch views
  {
    const order = ['grid', 'matrix', 'nights', 'stats'];
    let touchStart = null;
    const area = $('#cw-games');
    area.addEventListener('touchstart', (e) => {
      touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY, target: e.target };
    }, { passive: true });
    area.addEventListener('touchend', (e) => {
      const start = touchStart;
      touchStart = null;
      if (!start) return;
      const dx = e.changedTouches[0].clientX - start.x;
      const dy = e.changedTouches[0].clientY - start.y;
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 2) return;
      // inside horizontally-scrolling widgets, only switch views from their scroll edges
      const wrap = start.target.closest?.('.matrix-wrap, .hm-scroll');
      if (wrap) {
        const max = wrap.scrollWidth - wrap.clientWidth;
        if (dx < 0 && wrap.scrollLeft < max - 4) return;
        if (dx > 0 && wrap.scrollLeft > 4) return;
      }
      const i = order.indexOf(crewState.view);
      const next = order[dx < 0 ? Math.min(i + 1, order.length - 1) : Math.max(i - 1, 0)];
      if (next === crewState.view) return;
      crewState.view = next;
      appEl.querySelectorAll('.segmented button').forEach((b) => b.classList.toggle('active', b.dataset.view === next));
      renderGames();
    }, { passive: true });
  }

  $('#crew-menu-btn').onclick = () => {
    openModal(`
      <div class="modal-head"><h2>${esc(crew.name)}</h2><button class="modal-close" aria-label="Close">${icon('x')}</button></div>
      <div class="modal-body">
        <button class="btn btn-primary" id="menu-log" style="width:100%;justify-content:center">${icon('clipboard')} Log a play</button>
        <button class="btn" id="menu-night" style="width:100%;justify-content:center;margin-top:10px">${icon('calendar')} Plan game night</button>
        <button class="btn" id="menu-first" style="width:100%;justify-content:center;margin-top:10px">${icon('crown')} Who goes first?</button>
        <button class="btn" id="menu-activity" style="width:100%;justify-content:center;margin-top:10px">${icon('activity')} Activity</button>
        <button class="btn" id="menu-wishes" style="width:100%;justify-content:center;margin-top:10px">${icon('gift')} Gift ideas</button>
        <a class="btn" href="https://justinleedoyle.github.io/meeple-shelf/" target="_blank" rel="noopener" style="width:100%;justify-content:center;margin-top:10px">${icon('globe')} Public page ${icon('external')}</a>
        <h3 style="font-size:12.5px;color:var(--faint);text-transform:uppercase;letter-spacing:.5px;margin:22px 0 8px">Invite code — friends join with this</h3>
        <div class="big-code" style="margin-top:0">${esc(crew.inviteCode)}</div>
        <button class="btn" id="copy-code" style="width:100%;justify-content:center">Copy code</button>
        <hr style="border:none;border-top:1px solid var(--line);margin:22px 0">
        <button class="btn btn-ghost btn-danger" id="leave-btn" style="width:100%;justify-content:center">Leave crew</button>
      </div>`);
    $('#menu-log').onclick = () => openLogPlayModal();
    $('#menu-night').onclick = () => {
      crewState.view = 'nights';
      openEventModal();
    };
    $('#menu-first').onclick = () => openFirstPlayerModal(members);
    $('#menu-activity').onclick = () => openActivityModal(id);
    $('#menu-wishes').onclick = () => openWishlistsModal(id);
    $('#copy-code').onclick = () => copyText(crew.inviteCode);
    $('#leave-btn').onclick = async () => {
      if (!window.confirm(`Leave "${crew.name}"? If you're the last member, the crew is deleted.`)) return;
      await api(`/crews/${id}/leave`, { method: 'POST' });
      toast(`Left ${crew.name}`);
      closeModal();
      location.hash = '#/crews';
    };
  };
}

// Tap a card → description, details, and links to learn more about the game.
async function openGameModal(gameId, extras = {}) {
  // open instantly with a skeleton; fill when the data lands
  openModal(`
    <div class="modal-head"><h2>&nbsp;</h2><button class="modal-close" aria-label="Close">${icon('x')}</button></div>
    <div class="modal-body">
      <div class="gd-top"><div class="skel" style="width:124px;height:124px;flex:none"></div>
      <div style="flex:1"><div class="skel skel-line" style="width:70%"></div><div class="skel skel-line" style="width:45%"></div></div></div>
      <div class="skel skel-line"></div><div class="skel skel-line" style="width:85%"></div><div class="skel skel-line" style="width:60%"></div>
    </div>`);
  const statsP = extras.crewId
    ? api(`/crews/${extras.crewId}/games/${gameId}/stats`).then((r) => r.stats).catch(() => null)
    : Promise.resolve(null);
  const loansP = state.user ? api(`/games/${gameId}/loans`).catch(() => null) : Promise.resolve(null);
  let game, gstats, loanData;
  try {
    ({ game } = await api('/games/' + gameId));
    [gstats, loanData] = await Promise.all([statsP, loansP]);
  } catch (err) {
    closeModal();
    toast(err.message);
    return;
  }
  if (!modalRoot.innerHTML) return; // user closed the skeleton before data arrived
  const daysOut = (outAt) => Math.max(0, Math.floor((Date.now() - Date.parse(outAt.replace(' ', 'T') + 'Z')) / 86400000));
  const grad = COVER_GRADS[hashStr(game.title) % COVER_GRADS.length];
  openModal(`
    <div class="modal-head"><h2>${esc(game.title)}${game.year ? ` <span style="color:var(--faint);font-weight:400">(${game.year})</span>` : ''}</h2><button class="modal-close" aria-label="Close">${icon('x')}</button></div>
    <div class="modal-body">
      <div class="gd-top">
        <div class="gd-cover" style="background:linear-gradient(135deg, ${grad[0]}, ${grad[1]})">
          ${game.imageUrl ? `<img src="${esc(game.imageUrl)}" alt="" onerror="this.remove()">` : `<span class="cover-letter" style="font-size:42px">${esc(game.title[0].toUpperCase())}</span>`}
        </div>
        <div class="gd-meta">
          <div class="card-meta">
            ${fmtPlayers(game) ? `<span class="badge">${fmtPlayers(game)}</span>` : ''}
            ${fmtTime(game) ? `<span class="badge">${fmtTime(game)}</span>` : ''}
            ${game.category ? `<span class="badge">${esc(game.category)}</span>` : ''}
          </div>
          ${extras.owners?.length ? `<div class="card-owners" style="margin-top:10px">${extras.owners.map((o) => `<span class="owner-chip" style="--c:${memberColor(o.id)}">${esc(o.displayName)}${o.loanedTo ? ` → ${esc(o.loanedTo.displayName)}` : ''}</span>`).join('')}</div>` : ''}
        </div>
      </div>
      ${gstats?.plays ? `
      <div class="gd-stats">
        <div class="gd-tile"><div class="gd-num">${gstats.plays}</div><div class="gd-lbl">play${gstats.plays === 1 ? '' : 's'}</div></div>
        ${gstats.lastPlayedAt ? `<div class="gd-tile"><div class="gd-num">${fmtDay(gstats.lastPlayedAt)}</div><div class="gd-lbl">last played</div></div>` : ''}
        ${gstats.champion ? `<div class="gd-tile"><div class="gd-num">${icon('crown')} ${esc(gstats.champion.displayName)}</div><div class="gd-lbl">champion · ${gstats.champion.wins} win${gstats.champion.wins === 1 ? '' : 's'}</div></div>` : ''}
        ${gstats.bestScore ? `<div class="gd-tile"><div class="gd-num">${gstats.bestScore.score}${game.scoreDir === 'low' ? ' ↓' : ''}</div><div class="gd-lbl">record — ${esc(gstats.bestScore.displayName)}</div></div>` : ''}
      </div>
      ${gstats.record?.length ? `<div class="card-owners" style="margin:2px 0 8px">${gstats.record.map((r) => `<span class="owner-chip" style="--c:${memberColor(r.id)}">${esc(r.displayName)} ${r.wins}W · ${r.plays}P</span>`).join('')}</div>` : ''}` : ''}
      <p class="gd-desc">${game.description ? esc(game.description) : '<em>No description available yet.</em>'}</p>
      ${loanData?.total ? `
      <div class="gd-loans">
        <h3>Loan history</h3>
        <div class="r-meta" style="margin-bottom:6px">Borrowed ${loanData.total}×${loanData.loans[0] && !loanData.loans[0].returnedAt ? ` · currently with ${esc(loanData.loans[0].borrowerName)} (${daysOut(loanData.loans[0].outAt)} day${daysOut(loanData.loans[0].outAt) === 1 ? '' : 's'} out)` : ''}</div>
        ${loanData.loans.slice(0, 3).map((l) => `<div class="r-meta">• ${esc(l.borrowerName)} ← ${esc(l.ownerName)}, ${fmtDate(l.outAt)}${l.returnedAt ? ` → returned ${fmtDate(l.returnedAt)}` : ' (still out)'}</div>`).join('')}
      </div>` : ''}
      ${extras.crewId ? `
      <div class="gd-tags" id="gd-tags">
        <span class="glabel">${icon('tag')}</span>
        <span id="gd-tag-chips">${(extras.tags || []).map((t) => `<span class="tag-chip">${esc(t)}<button data-untag="${esc(t)}" title="Remove tag" aria-label="Remove ${esc(t)}">${icon('x')}</button></span>`).join('')}</span>
        <input type="text" id="gd-tag-new" list="gd-tag-list" maxlength="24" placeholder="add a tag…">
        <datalist id="gd-tag-list">${(extras.allTags || []).map((t) => `<option value="${esc(t)}">`).join('')}</datalist>
      </div>` : ''}
      ${(() => {
        if (!extras.crewId || !extras.owners?.length) return '';
        if (extras.owners.some((o) => o.id === state.user.id)) return ''; // it's on your own shelf
        const lendable = extras.owners.filter((o) => !o.loanedTo);
        if (!lendable.length) return '';
        return `<div class="gd-borrow" id="gd-borrow">
          ${lendable.map((o) => `<button class="btn btn-sm" data-borrow="${o.id}">${icon('bell')} Ask ${esc(o.displayName)} to borrow</button>`).join('')}
        </div>`;
      })()}
      <div class="gd-links">
        ${game.websiteUrl ? `<a class="btn" href="${esc(game.websiteUrl)}" target="_blank" rel="noopener">Official site ${icon('external')}</a>` : ''}
        ${game.bggId ? `<a class="btn" href="https://boardgamegeek.com/boardgame/${game.bggId}" target="_blank" rel="noopener">BoardGameGeek ${icon('external')}</a>` : ''}
      </div>
    </div>`);

  if ($('#gd-borrow')) {
    $('#gd-borrow').addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-borrow]');
      if (!btn) return;
      btn.disabled = true;
      try {
        const { request } = await api(`/games/${gameId}/borrow-requests`, { method: 'POST', body: { ownerId: Number(btn.dataset.borrow) } });
        btn.innerHTML = `${icon('check')} Asked ${esc(request.owner.displayName)}`;
        toast(`Asked! ${request.owner.displayName} will see it under Account.`);
      } catch (err) {
        btn.disabled = false;
        toast(err.message);
      }
    });
  }
  if ($('#gd-tags')) {
    const renderChips = (tags) => {
      $('#gd-tag-chips').innerHTML = tags.map((t) => `<span class="tag-chip">${esc(t)}<button data-untag="${esc(t)}" title="Remove tag" aria-label="Remove ${esc(t)}">${icon('x')}</button></span>`).join('');
      modalDirty = true; // grid tag chips refresh on close
    };
    $('#gd-tag-new').addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const val = e.target.value.trim();
      if (!val) return;
      try {
        const { tags } = await api(`/crews/${extras.crewId}/games/${gameId}/tags`, { method: 'POST', body: { tag: val } });
        e.target.value = '';
        renderChips(tags);
      } catch (err) { toast(err.message); }
    });
    $('#gd-tag-new').addEventListener('change', async (e) => {
      // datalist pick on mobile fires change without Enter
      const val = e.target.value.trim();
      if (!val) return;
      try {
        const { tags } = await api(`/crews/${extras.crewId}/games/${gameId}/tags`, { method: 'POST', body: { tag: val } });
        e.target.value = '';
        renderChips(tags);
      } catch { /* keydown path already toasted, or invalid — leave the text for editing */ }
    });
    $('#gd-tags').addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-untag]');
      if (!btn) return;
      try {
        const { tags } = await api(`/crews/${extras.crewId}/games/${gameId}/tags/${encodeURIComponent(btn.dataset.untag)}`, { method: 'DELETE' });
        renderChips(tags);
      } catch (err) { toast(err.message); }
    });
  }
}

// GitHub-style activity heatmap from a sparse { 'YYYY-MM-DD': count } map.
// Built from LOCAL dates (played_at is the logger's local date).
function heatmapHtml(map) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(start.getDate() - 363);
  start.setDate(start.getDate() - start.getDay()); // snap back to that week's Sunday
  const cells = [];
  const cur = new Date(start);
  while (cur <= today) {
    const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`;
    const n = map[key] || 0;
    const lvl = n >= 5 ? 4 : n >= 3 ? 3 : n;
    cells.push(`<div class="hm-cell l${lvl}"${n ? ` title="${key} · ${n} play${n > 1 ? 's' : ''}"` : ''}></div>`);
    cur.setDate(cur.getDate() + 1);
  }
  return `<div class="hm-grid">${cells.join('')}</div>`;
}

// shared helper: was this card click on an interactive control?
function clickedControl(e) {
  return e.target.closest('button, a, input, select, [data-act], [data-add], [data-pack]');
}

// Set exactly who in the crew owns a game — mirrors editing a row of the old spreadsheet.
function openOwnersModal(crew, game, members) {
  openModal(`
    <div class="modal-head"><h2>Who owns ${esc(game.title)}?</h2><button class="modal-close" aria-label="Close">${icon('x')}</button></div>
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
            ${cur && !members.some((x) => x.id === cur) ? `<option value="${cur}" selected>with ${esc(owner.loanedTo.displayName)} (other crew)</option>` : ''}
            ${members.filter((x) => x.id !== m.id).map((x) => `<option value="${x.id}" ${cur === x.id ? 'selected' : ''}>with ${esc(x.displayName)}</option>`).join('')}
          </select>
          <label class="due-wrap" data-due-for="${m.id}" style="${cur ? '' : 'display:none'}">${icon('alarm')} Due back
            <input type="date" class="due" data-owner-due="${m.id}" value="${esc(owner?.dueDate || '')}">
          </label>
        </div>`;
        }).join('')}
      </div>
      <div class="form-error" id="o-error"></div>
      <button class="btn btn-primary" id="o-save" style="margin-top:10px">Save</button>
    </div>`);
  const syncDue = (id) => {
    const sel = modalRoot.querySelector(`.loc[data-owner="${id}"]`);
    const wrap = modalRoot.querySelector(`.due-wrap[data-due-for="${id}"]`);
    wrap.style.display = sel.value && !sel.disabled ? '' : 'none';
    if (!sel.value || sel.disabled) modalRoot.querySelector(`.due[data-owner-due="${id}"]`).value = '';
  };
  for (const cb of modalRoot.querySelectorAll('#owner-rows input[type="checkbox"]')) {
    cb.onchange = () => {
      const sel = modalRoot.querySelector(`.loc[data-owner="${cb.value}"]`);
      sel.disabled = !cb.checked;
      if (!cb.checked) sel.value = '';
      syncDue(cb.value);
    };
  }
  for (const sel of modalRoot.querySelectorAll('#owner-rows .loc')) {
    sel.addEventListener('change', () => syncDue(sel.dataset.owner));
  }
  $('#o-save').onclick = async () => {
    const owners = [...modalRoot.querySelectorAll('#owner-rows input:checked')].map((i) => ({
      id: Number(i.value),
      loanedTo: modalRoot.querySelector(`.loc[data-owner="${i.value}"]`).value || null,
      dueDate: modalRoot.querySelector(`.due[data-owner-due="${i.value}"]`).value || null,
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

// crew activity feed: adds, wishes, loans, returns, plays, planned nights
async function openActivityModal(crewId) {
  openModal(`
    <div class="modal-head"><h2>${icon('activity')} Activity</h2><button class="modal-close" aria-label="Close">${icon('x')}</button></div>
    <div class="modal-body"><div class="skel skel-line"></div><div class="skel skel-line" style="width:80%"></div><div class="skel skel-line" style="width:65%"></div></div>`);
  let activity;
  try {
    ({ activity } = await api(`/crews/${crewId}/activity`));
  } catch (err) {
    closeModal();
    toast(err.message);
    return;
  }
  if (!modalRoot.innerHTML) return;
  const KIND = {
    add: { icn: 'dice', line: (a) => `<strong>${esc(a.who)}</strong> added <strong>${esc(a.title)}</strong>` },
    wish: { icn: 'gift', line: (a) => `<strong>${esc(a.who)}</strong> wished for <strong>${esc(a.title)}</strong>` },
    loan: { icn: 'backpack', line: (a) => `<strong>${esc(a.who)}</strong> lent <strong>${esc(a.title)}</strong> to ${esc(a.extra)}` },
    return: { icn: 'home', line: (a) => `<strong>${esc(a.extra)}</strong> returned <strong>${esc(a.title)}</strong> to ${esc(a.who)}` },
    play: { icn: 'clipboard', line: (a) => `<strong>${esc(a.who)}</strong> logged a play of <strong>${esc(a.title)}</strong>${a.extra ? ` (${fmtDay(a.extra)})` : ''}` },
    night: { icn: 'calendar', line: (a) => `<strong>${esc(a.who)}</strong> planned <strong>${esc(a.title)}</strong>${a.extra ? ` for ${fmtDay(a.extra)}` : ''}` },
  };
  openModal(`
    <div class="modal-head"><h2>${icon('activity')} Activity</h2><button class="modal-close" aria-label="Close">${icon('x')}</button></div>
    <div class="modal-body">
      ${activity.length ? activity.map((a) => {
        const k = KIND[a.kind] || KIND.add;
        return `<div class="act-row"><span class="act-icn">${icon(k.icn)}</span><span class="act-txt">${k.line(a)}</span><span class="act-ago">${timeAgo(a.ts)}</span></div>`;
      }).join('') : emptyState('activity', 'All quiet', 'Adds, loans, plays, and planned nights will show up here.')}
    </div>`);
}

// every member's wishlist in one place — quietly useful before birthdays
async function openWishlistsModal(crewId) {
  openModal(`
    <div class="modal-head"><h2>${icon('gift')} Gift ideas</h2><button class="modal-close" aria-label="Close">${icon('x')}</button></div>
    <div class="modal-body"><div class="skel skel-line"></div><div class="skel skel-line" style="width:80%"></div></div>`);
  let wishlists;
  try {
    ({ wishlists } = await api(`/crews/${crewId}/wishlists`));
  } catch (err) {
    closeModal();
    toast(err.message);
    return;
  }
  if (!modalRoot.innerHTML) return;
  openModal(`
    <div class="modal-head"><h2>${icon('gift')} Gift ideas</h2><button class="modal-close" aria-label="Close">${icon('x')}</button></div>
    <div class="modal-body">
      ${wishlists.length ? wishlists.map((w) => `
        <h3 class="acct-h" style="margin-top:14px"><span class="avatar" style="--c:${memberColor(w.id)};background:${memberColor(w.id)};display:inline-flex;width:22px;height:22px;font-size:10px;vertical-align:middle">${esc(w.displayName.slice(0, 2).toUpperCase())}</span> ${esc(w.displayName)} wishes for</h3>
        <div class="search-results" style="max-height:none">
          ${w.items.map((it) => `
          <div class="result-row">
            ${it.imageUrl ? `<img class="r-thumb" loading="lazy" src="${esc(it.imageUrl)}" alt="" onerror="this.remove()">` : ''}
            <div class="r-grow"><div class="r-title">${esc(it.title)}${it.year ? `<span class="r-year">(${it.year})</span>` : ''}</div></div>
          </div>`).join('')}
        </div>`).join('') : emptyState('gift', 'No wishes yet', 'When crewmates add games to their wishlists, they show up here — perfect before birthdays.')}
    </div>`);
}

// the tiny ritual-ender: tap go, the spinner picks who goes first
function openFirstPlayerModal(members) {
  const picked = new Set(members.map((m) => m.id));
  let guests = [];
  const namePool = () => [
    ...members.filter((m) => picked.has(m.id)).map((m) => m.displayName),
    ...guests,
  ];
  openModal(`
    <div class="modal-head"><h2>${icon('crown')} Who goes first?</h2><button class="modal-close" aria-label="Close">${icon('x')}</button></div>
    <div class="modal-body">
      <div class="owner-pick" id="fp-pick">
        ${members.map((m) => `<button class="chip-btn active" data-fp="${m.id}">${esc(m.displayName)}</button>`).join('')}
      </div>
      <div style="display:flex;gap:8px;margin-top:6px">
        <input type="text" id="fp-guest" placeholder="Add a guest…" maxlength="20" style="flex:1">
        <button class="btn" id="fp-add">Add</button>
      </div>
      <div class="fp-stage" id="fp-stage">?</div>
      <button class="btn btn-primary" id="fp-go" style="width:100%;justify-content:center">Spin</button>
    </div>`);
  $('#fp-pick').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-fp]');
    if (!btn) return;
    const mid = Number(btn.dataset.fp);
    if (picked.has(mid)) picked.delete(mid);
    else picked.add(mid);
    btn.classList.toggle('active', picked.has(mid));
  });
  const addGuest = () => {
    const name = $('#fp-guest').value.trim();
    if (!name || guests.includes(name)) return;
    guests.push(name);
    $('#fp-guest').value = '';
    $('#fp-pick').insertAdjacentHTML('beforeend', `<button class="chip-btn active" data-guest="${esc(name)}">${esc(name)}</button>`);
  };
  $('#fp-add').onclick = addGuest;
  $('#fp-guest').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addGuest(); } });
  $('#fp-pick').addEventListener('click', (e) => {
    const g = e.target.closest('[data-guest]');
    if (!g) return;
    guests = guests.filter((n) => n !== g.dataset.guest);
    g.remove();
  });
  let spinning = false;
  $('#fp-go').onclick = () => {
    if (spinning) return;
    const pool = namePool();
    if (pool.length < 2) return toast('Pick at least two players');
    spinning = true;
    const stage = $('#fp-stage');
    stage.classList.remove('winner');
    let i = 0;
    const total = 18 + Math.floor(Math.random() * pool.length); // land on a random name
    const tick = (n) => {
      if (!modalRoot.innerHTML) return; // modal closed mid-spin
      stage.textContent = pool[n % pool.length];
      if (n >= total) {
        stage.classList.add('winner');
        stage.innerHTML = `${icon('crown', 'gold')} ${esc(pool[n % pool.length])}`;
        spinning = false;
        return;
      }
      setTimeout(() => tick(n + 1), 50 + Math.pow(n / total, 2) * 220); // ease out
    };
    tick(i);
  };
}

// ===================== public shared shelf =====================

async function viewPublicShelf(slug) {
  const { owner, entries, wishlist = [] } = await api('/shared/' + slug);
  const isMine = state.user && state.user.shareSlug === slug;
  appEl.innerHTML = `
  <div class="container">
    ${isMine ? `<div class="public-banner">${icon('eye')} This is your public shelf, exactly as others see it.</div>` : ''}
    <div class="page-head">
      <div>
        <h1>${icon('dice', 'accent')} ${esc(owner.displayName)}'s Shelf</h1>
        <div class="sub">${entries.length} game${entries.length === 1 ? '' : 's'}${wishlist.length ? ` · ${wishlist.length} wished for` : ''}</div>
      </div>
    </div>
    ${entries.length
      ? `<div class="grid" id="pub-grid">${entries.map((en) => gameCardHtml(en.game, { gameId: en.game.id, notes: en.notes, extraBadges: en.status === 'grabs' ? `<span class="badge grabs">${icon('gift')} up for grabs</span>` : '' })).join('')}</div>`
      : emptyState('dice', 'Nothing here yet', `${esc(owner.displayName)} hasn't added any games.`)}
    ${wishlist.length ? `
    <h2 class="section-h">${icon('gift', 'accent')} Wishlist <span class="count">${wishlist.length}</span></h2>
    <div class="grid" id="pub-wishes">${wishlist.map((en) => gameCardHtml(en.game, { gameId: en.game.id })).join('')}</div>` : ''}
    <div class="public-footer">
      Shared with <strong>Meeple Shelf</strong> — your board game shelf, your friends' shelves, one combined library.
      ${state.user ? `<a href="#/library">Back to my shelf</a>` : `<a href="#/welcome">Make your own →</a>`}
    </div>
  </div>`;
  for (const gridId of ['#pub-grid', '#pub-wishes']) {
    if ($(gridId)) {
      $(gridId).addEventListener('click', (e) => {
        const card = e.target.closest('[data-game]');
        if (card && !clickedControl(e)) openGameModal(Number(card.dataset.game));
      });
    }
  }
}

// ===================== boot =====================

(async function boot() {
  try {
    const me = await api('/me');
    state.user = me.user;
    state.pending = me.pendingRequests || 0;
  } catch {
    state.user = null;
  }
  window.addEventListener('hashchange', route);
  if (!location.hash) location.hash = state.user ? '#/library' : '#/welcome';
  else route();
})();
