// Meeple Shelf service worker — the MAIN app's worker (meeple-shelf.fly.dev).
// NOT the GitHub Pages snapshot's: that one is generated into site/sw.js by
// build-page.js and lives on a different origin. Don't merge them.
//
// Layout: lifecycle → network → push. Freshness after a deploy is structural
// (network-first everywhere + the server serves static with no-cache), so the
// version constant's only real job is garbage-collecting removed SHELL entries.

// Bump only when an entry is REMOVED/renamed from SHELL or you want a clean
// sweep. Routine deploys need NO bump: every fetch below is network-first and
// any byte change to this file already triggers a SW update + re-precache.
const CACHE_VERSION = 'v1';
const CACHE_NAME = 'ms-shell-' + CACHE_VERSION;
const SHELL = ['/', '/app.js', '/styles.css', '/icons.svg'];

const OFFLINE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Meeple Shelf — offline</title><style>
body{background:#181412;color:#f3ece2;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center;padding:24px}
p{color:#a3968a;max-width:300px}button{margin-top:18px;padding:11px 22px;border-radius:10px;border:1px solid #e8a33d;
background:#e8a33d;color:#241a09;font:inherit;font-weight:700;cursor:pointer}</style></head><body>
<svg width="72" height="72" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg"><g transform="rotate(8 256 256)">
<rect x="106" y="106" width="300" height="300" rx="62" fill="#e8a33d"/>
<circle cx="186" cy="186" r="22" fill="#241a09"/><circle cx="326" cy="186" r="22" fill="#241a09"/>
<circle cx="256" cy="256" r="22" fill="#241a09"/><circle cx="186" cy="326" r="22" fill="#241a09"/>
<circle cx="326" cy="326" r="22" fill="#241a09"/></g></svg>
<h1>You're offline</h1><p>Meeple Shelf needs a connection to see the shelves.</p>
<button onclick="location.reload()">Try again</button></body></html>`;

// ---- lifecycle: no skipWaiting — the fetch path is version-agnostic
// pass-through, so a waiting worker costs nothing and never strands a page ----
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
  );
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
      await self.clients.claim(); // first install: control the running page without a reload
      console.log('[ms-sw]', CACHE_VERSION);
    })()
  );
});

// ---- network: network-first for navigations + the 4 shell files; the cache
// is a fallback, never a source while online. /api/* and cross-origin are
// NEVER touched (credentialed JSON and BGG art ride the browser default). ----
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // THE hard rule
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && url.pathname === '/') {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put('/', copy));
          }
          return res;
        })
        .catch(async () =>
          (await caches.match('/')) ||
          new Response(OFFLINE_HTML, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })
        )
    );
    return;
  }
  if (SHELL.includes(url.pathname)) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(async () => (await caches.match(req)) || Response.error())
    );
  }
  // everything else same-origin (manifest, icon PNGs): browser default
});

// ---- push: payload contract { title, body, tag, url } from the server ----
self.addEventListener('push', (event) => {
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch {
    /* non-JSON test push */
  }
  // ALWAYS show something: iOS revokes the subscription after ~3 silent
  // pushes, and Chrome substitutes a generic "site was updated" blob.
  event.waitUntil(
    self.registration.showNotification(d.title || 'Meeple Shelf', {
      body: d.body || '',
      icon: '/icon-512.png',
      // no badge: Android cuts the glyph from the alpha channel, and our
      // opaque icons render as a featureless square — Chrome's default wins
      tag: d.tag || undefined, // collapse key — a re-send replaces the stale banner
      // renotify with the tag: every same-tag re-send here IS a state change
      // (day-of reminder, called off, new date, updated ask count) and must
      // buzz — a silent in-place text swap defeats the reminder entirely.
      // Conditional because Chrome throws if renotify is set without a tag.
      renotify: !!d.tag,
      data: { url: typeof d.url === 'string' && /^\/#\/(library|account|crew\/\d+(\/nights)?)$/.test(d.url) ? d.url : '/#/library' },
    })
  );
});

// ---- click: focus the running SPA and hash-route, else cold-open ----
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/#/library';
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const win = wins.find((w) => w.visibilityState === 'visible') || wins[0];
      if (win) {
        await win.focus().catch(() => {});
        win.postMessage({ kind: 'open', url }); // boot()'s listener routes WITHOUT a reload
      } else {
        await self.clients.openWindow(url); // cold open: boot() reads the hash
      }
    })()
  );
});

// ---- best-effort re-subscribe when the push service rotates the endpoint ----
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const { key } = await (await fetch('/api/push/public-key')).json();
        if (!key) return;
        const sub = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(key),
        });
        await fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(sub.toJSON()),
        });
      } catch {
        /* device re-affirms on next Account-modal open */
      }
    })()
  );
});

// duplicated from app.js on purpose: the SW can't import from a classic
// script, and 7 lines isn't worth inventing a build step
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
