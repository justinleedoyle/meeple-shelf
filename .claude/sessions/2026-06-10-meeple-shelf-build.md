# Meeple Shelf — One-Shot Build + Sheet Import + GitHub Pages

**Started:** 2026-06-10
**Status:** Complete

## Goal
One-shot build of a board game library app: personal library, public share links, and
combined "crew" libraries with friends (who has what).

## Accomplished
- Full app built and verified in a single session:
  - `server.js` — Express API (auth, library, search, sharing, crews) on better-sqlite3
  - `db.js` — schema + shared helpers (scrypt auth, invite codes, title-dedupe for games)
  - `public/` — vanilla JS SPA (hash routing), warm dark theme, no build step
  - `data/popular-games.json` — built-in catalog (~190 games) powering add-game search
  - `seed.js` — demo data: justin/sam/riley (password `meeple123`), "Friday Night Crew"
- 24 API checks passed via curl (auth edge cases, ownership checks, privacy toggle,
  crew access control, auto-delete of empty crews, SPA fallback)
- UI verified via preview screenshots: login, My Shelf, crew combined library (grid +
  who-has-what matrix with 5-player filter), add-game search, public shelf view

## Decisions
- **No BoardGameGeek API**: BGG now rejects unregistered XML API clients (confirmed
  live — returns "Unauthorized"; policy page is behind Cloudflare). Built-in JSON
  catalog + manual entry instead. BGG import listed as a future idea.
- Games dedupe by case-insensitive title so crew views merge owners onto one card.
- Crews (invite-code groups) instead of 1:1 friendships — simpler, matches game-night use.
- Express 4 (pinned) + better-sqlite3; Node 20.11 on this machine has no `node:sqlite`.

## Phase 2 (same day): real data + GitHub hosting
- Imported the shared Google Sheet (sheet id 1sVqF_XNnFOV9EIrP6o1bVQ-wklp06ocFGEwecaXQMhs,
  gid 942527957) via `data/collection-sheet.md` snapshot + `import-sheet.js`:
  6 household accounts (stephensons/brocks/harris/bells/snowdens/doyles, password
  meeple123), 109 games, 169 entries, crew "Game Night Crew" (code ATEH7W).
  36 titles enriched from the built-in catalog ("Settlers of Catan" → Catan stats via alias).
- Added `category` to games (sheet's Primary Category): schema migration, card badges,
  crew + static-page filter, manual-entry field.
- GitHub: repo pushed to https://github.com/justinleedoyle/meeple-shelf (PUBLIC — needed
  for Pages on free plan; flagged to Justin). `export-static.js` renders the combined
  library to docs/index.html; Pages serves /docs on main.
  Live: https://justinleedoyle.github.io/meeple-shelf/ (verified: 106 games render,
  matrix = 169 checks = exact entry count; noindex meta set).
- Verified via local render of docs/ (Chrome not running on this machine, so used a
  python http.server preview config "meeple-shelf-snapshot" in workspace launch.json).

## Phase 3 (same day): owner selection, BGG catalog, mobile
- Game search now merges community games + curated catalog + a 30k-game BGG
  dataset (beefsack/bgg-ranking-historicals daily CSV → data/bgg-catalog.json
  via build-bgg-catalog.js; 2026-06-09 snapshot — note: that repo's same-day
  file can be empty, take the latest >100KB one). Thumbnails are BGG "micro"
  64px — soft when upscaled; per-game image override exists.
- Add modal has "Whose shelf?" multi-select (any crewmate; POST /api/library
  ownerIds, 403 for non-crewmates). Crew page: "+ Add a game" + per-card
  "who owns this?" editor (PUT /api/crews/:id/games/:gameId/owners — sets
  exactly which crew members own it). Edit modal now covers
  year/players/time/category.
- enrich-images.js backfilled art for 79/109 imported games (expansions
  mostly unmatched — BGG ranked list excludes them).
- Mobile pass: 16px inputs (iOS zoom), (hover:none) keeps card actions
  visible, stacked filters, larger targets. Verified at 375px (app + static).
- All 10 new-endpoint tests passed on a throwaway DB; UI add/owners-edit
  cycle verified and reverted (real data still matches the sheet exactly).

## Phase 4 (same day): CI auto-publish + BGG API research
- Pages switched from legacy /docs to **workflow build type**. New pipeline:
  `npm run sync` → export-snapshot.js writes data/shelf-snapshot.json (public-safe,
  committed) → push → .github/workflows/publish-pages.yml builds site/index.html
  via dependency-free build-page.js and deploys (~30s). export-static.js and
  committed docs/ removed; site/ gitignored. DB stays local-only (password hashes).
- Action versions bumped to Node-24-ready majors (checkout@v6, setup-node@v6,
  configure-pages@v6, upload-pages-artifact@v5, deploy-pages@v5) — GitHub forces
  Node 24 on runners June 16, 2026. First run with v4s succeeded but warned.
- BGG API (researched, confirmed): since July 2, 2025 ALL XML API use requires
  registration; you apply at boardgamegeek.com/using_the_xml_api (browser, logged
  in to BGG) and get an app token used as `Authorization: Bearer <token>`.
  Wiring live lookups deferred until Justin has a token (BGG_API_TOKEN env var
  planned, fallback to local datasets).

## Phase 5 (same day): loans, picker, expansion grouping, PWA
- Borrow tracking: library_entries.loaned_to (migrated via ALTER). Set from edit
  modal ("Currently at") or the crew owners modal (per-owner location select).
  Owners PUT body is now { owners: [{ id, loanedTo }] } (legacy userIds accepted).
  Loan shows as "Owner → Holder" chips and a 📍 badge on My Shelf.
- Game-night picker: "🎲 Surprise me" on crew page + static page — rolls from the
  CURRENT filtered list, excluding expansions; animated banner with Roll again.
- Expansion grouping: games.expansion_of, autoLinkExpansion() on add (em-dash
  title convention + fuzzy base match), npm run link-expansions backfilled 19/19.
  Crew grid nests expansions under base ("+N expansions" toggle); matrix indents ↳.
  My Shelf intentionally NOT grouped (direct edit/remove access matters there).
- PWA: public/icon.svg → PNGs via qlmanage+sips; manifest + apple-touch-icon on
  app and static page; site/ gets manifest (crew-named), sw.js (network-first).
- All endpoint tests passed (auto-link, loans incl. validations, owners+loans PUT).
  UI verified incl. loan set/revert cycle — real data unchanged.
- BGG application form (boardgamegeek.com/applications/create): field-by-field
  answers drafted for Justin (non-commercial, public app, tiny volume).

## In Progress
Nothing — feature-complete as scoped.

## Next Steps (optional follow-ups)
- Refresh flow when the sheet changes: update data/collection-sheet.md → `npm run
  import-sheet` → `npm run export` → commit/push docs/ (could automate w/ GitHub Action)
- Real interactive hosting (Fly/Railway volume + `DB_PATH`) if households should add
  games themselves; change the default password first (no change-password UI yet — gap)
- Wishlists / borrow tracking / play logging (see README "Ideas for later")

## References
- Local app: `npm start` → http://localhost:3000 (login doyles / meeple123)
- Repo: https://github.com/justinleedoyle/meeple-shelf
- Public page: https://justinleedoyle.github.io/meeple-shelf/
- Workspace-level `/Users/justin/Projects/.claude/launch.json` has two preview configs:
  the app (port 3000) and the static snapshot (python http.server, port 8123).
