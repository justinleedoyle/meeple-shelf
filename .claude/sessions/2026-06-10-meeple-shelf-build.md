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

## Phase 7 (same day): DEPLOYED TO FLY.IO ✅
- Live at https://meeple-shelf.fly.dev — app "meeple-shelf", region lax (Fly removed
  den/phx/sea regions — lax is closest now), shared-cpu-1x 512MB, auto-stop,
  encrypted 1GB volume "data" (vol_4oj9nn22djd8m0xr) at /data, daily snapshots.
- Account: justin@wallaroomedia.com (personal org). Collection imported on the
  server (109 games / 169 entries / 79 with art / expansions auto-linked at import).
  PRODUCTION CREW INVITE CODE: 98PVGE (differs from local ATEH7W — fresh DB).
- Verified live: anonymous /me, HTTPS login (Secure cookies), crew 106 games,
  search (30k catalog ships in image), frontend 200.
- `npm run sync` now snapshots FROM PRODUCTION (fly ssh console + sftp get) →
  commit → push → Pages rebuild. `npm run sync-local` keeps the old local path.
- Fly source of truth; local DB = dev sandbox. Justin chose Fly over DO for cost
  (likes DigitalOcean; noted DO App Platform unsuitable — ephemeral disk).
- TODO for households: log in at the URL, change passwords (Account menu).

## Phase 6 (same day): hosting prep (Fly.io) — done, superseded by Phase 7
- Built & tested: POST /api/me/password (validates current, kills other sessions),
  Account modal via "Hi, <name> ▾" nav button, login/signup rate limit (10/15min/IP),
  Secure cookies + trust proxy in production. 7/7 curl tests passed.
- Deploy config committed: Dockerfile (node:22-slim, npm ci --omit=dev — better-sqlite3
  uses linux-x64 prebuilds), fly.toml (app "meeple-shelf" — rename if name taken;
  region den; volume "data" → /data; DB_PATH=/data/meeple-shelf.db; auto-stop,
  min_machines_running=0, 512MB shared-cpu-1x). .dockerignore excludes local DB.
- BGG API application SUBMITTED by Justin (awaiting token → then wire live lookups
  behind BGG_API_TOKEN).
- NEXT SESSION: Justin does fly.io signup + `brew install flyctl` + `fly auth login`,
  then: fly launch --no-deploy --copy-config → fly volumes create data --size 1
  --region den → fly deploy → fly ssh console -C "node /app/import-sheet.js" →
  verify → households change passwords → consider retiring/keeping Pages snapshot.

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

## Phase 8 (same day): trip-ready offline packed list
- 🎒 packed toggle per card on the STATIC page (localStorage, offline-first),
  "Packed (n)" filter chip, Surprise me rolls from packed pool. Verified offline
  cache (SW active, page in caches). Live on Pages. Built for Justin's camping
  trip — live app needs signal; snapshot page is the campsite tool.

## Phase 9 (same day): high-res box art
- api.geekdo.com/api/images/<id> is PUBLIC (no auth/Cloudflare) and returns signed
  URLs for all variants. upgrade-images.js swaps __micro (64px) for medium (500px):
  80/80 local, 79/79 prod. Server auto-upgrades new adds (fire-and-forget in POST
  /api/library). npm run enrich chains it. Pages + live app verified serving 500px.
- Trip correction: Airbnb WITH internet — live app usable there; packed list still nice.

## Phase 10 (same day): photo closet import + bulk add
- Bulk add tab shipped (paste titles → match → add; deployed to Fly).
- Read 3 closet photos (HEIC→JPG via sips, rotate, region crops): added 13 base
  games + 6 expansions to Doyles on PRODUCTION via API. Auto-corrections: "Seti
  1979" mismatch → SETI: SfEI (2024); "Catan" duplicate row → joined existing
  "Settlers of Catan". Doyles 39 games; crew 130. Justin had also been adding
  via owners editor himself (Scythe, Wingspan exps, etc.) — real usage!
- Finspan expansion: name unconfirmed, awaiting Justin (box label).
- Naming Q (plural vs singular households): recommended KEEPING plural.

## Phase 11 (same day): Wingspan Asia fix + art completion + WRAP-UP
- Wingspan expansions confirmed by Justin: European, Oceania, Americas, ASIA.
  "South America" row was mislabeled → created "Wingspan — Asia Expansion"
  (Stephensons+Bells, BGG 366161, art filled), retired the South America row.
- fetch-missing-art.js BUILTIN_MAP now covers every known straggler. Art:
  every owned game on prod has 500px covers (only unowned/composite rows lack).
- Heat "All expansions" composite row left as-is pending Justin naming the
  actual Heat expansions.

## BACKLOG (Justin: "pick this up later") — in priority order
1. Play logging + leaderboard (trip provides launch data; "we played it" on
   the Surprise banner; per-crew stats/win rates/head-to-head)
2. BGG ratings + rank from data/bgg-catalog.json (badge + sort) — quick win
3. Nightly encrypted DB backup off-machine (Fly Tigris bucket) + password reset
4. Auto-sync Pages nightly (scoped Fly token in GH Actions secret + cron)
5. Wishlists per household (gift coordination between families)
6. "Recently added" strip + game detail view (big art, owners, loans, BGG link)
7. When BGG API token arrives: full-size art, live lookups (BGG_API_TOKEN env
   var w/ fallback), BGG collection import

## Phase 12 (same day): LEADERBOARD shipped
- plays + play_players tables; POST/GET/DELETE /api/crews/:id/plays and GET
  /api/crews/:id/stats (standings all-members zero-filled, topGames, totalPlays).
- Crew page third view "🏆 Leaderboard": standings w/ medals, most played,
  recent plays feed w/ delete. "📝 Log a play" modal: game search (crew games),
  date, per-household played + 👑 won toggles (co-op = everyone wins), notes.
  Surprise banner gained "📝 We played it" pre-filled logging.
- Plays are HOUSEHOLD-level by design (accounts = households; trip = one per).
- 8/8 API tests passed; UI verified locally (logged+deleted test play); prod
  smoke-tested (log/stats/delete) — board left at 0 plays for the trip.
- Backlog item 1 done; static page stats view = future enhancement.

## Phase 13 (same day): game detail view — descriptions + links
- games += bgg_id, description, website_url (migrations). bgg-meta.js shared
  module: geekitems fetch + HTML→text cleaner + applyThingMeta.
- fetch-missing-art.js now fills id/description/website/art in one pass
  (110/113 local, 156/158 prod — leftovers are the 2 known intentional rows).
- GET /api/games/:id (public). Search results carry bggId; adds store it; live
  upgradeGameMeta enriches new games (desc+site+art) fire-and-forget.
- Tap any card (My Shelf / crew / public shelf / STATIC page) → detail modal:
  big art, badges, owners+loans, description, Official site ↗ + BGG ↗ links.
  Snapshot carries 420-char descriptions (~154KB total).
- Verified: local UI modal (Wingspan → stonemaiergames.com), prod endpoint
  smoke (7 Wonders → rprod.com), static overlay via dispatched click.

## Phase 14: competitive audit (5-agent workflow)
- Audited BG Stats, NemeStats, ScorePal, geekgroup.app, Kallax.io, MeepleStats,
  CLZ, Libib, myTurn, Lend Engine, What2Play, Playpick, Dized, BGG + community
  threads. ~40 transferable ideas → synthesized into ROADMAP.md (tiered).
- Strongest converging signals: numeric scores/record book, Champion+Nemesis,
  shelf-of-shame + weighted Surprise, game-night events w/ voting, loan due
  dates, best-with-N-players filter (needs BGG token).

## Phase 15: RIVALRY PACK + scores + loans — workflow-assisted build, DEPLOYED
- Process: 4 spec agents (parallel, read live repo) → serial implementation →
  4 adversarial reviewers → all findings fixed → 52/52 tests → deployed v14.
- Shipped: play_players.score + games.score_dir (+lazy infer, edit-modal set),
  plays.host_user_id, per-game Champion + per-household Nemesis (current-members
  only), crew+household H-index, milestones 5/10/25 (badges/wall/toast), 52-week
  heatmap, playCount/lastPlayedAt in crew payload (Never-played chip, Dustiest
  sort, weighted Surprise 1/(1+n)), per-game crew stats endpoint, loan due_date +
  loan_events journal (logLoanChange; backfill from added_at), overdue badges,
  out-longest sorts, loan history endpoint (SQL-side visibility + real COUNT).
- Review fixes of note: preserve-dont-wipe loan semantics (cross-crew/legacy
  bodies), "(other crew)" select options, unchanged-loan validation bypass,
  score rounding, future-date clamp, real-calendar dueDate validation, scoreDir
  garbage guard, transactional PATCH/DELETE loans, public shared route strips
  dueDate/loanedOutAt, .owner-row input[type=checkbox] CSS scoping (critical).
- Declined 1 finding (heatmap back-swipe at right edge = correct edge-aware
  behavior, symmetric with matrix). Prod smoke: log/verify/delete left 0 plays.

## Phase 16: emoji → stroke icon set, DEPLOYED
- public/icons.svg: 24-symbol SVG sprite (Lucide-style, 24x24, stroke=currentColor):
  dice, users, user, clock, alarm, pin, award, crown, trophy, swords, home,
  menu, globe, clipboard, hash, link, ghost, search, external, backpack,
  pencil, x, alert, eye.
- icon(name, cls) helper in app.js + build-page.js template (./icons.svg in
  static page); ~70 emoji sites replaced across nav, tab bar, card meta,
  leaderboard (medals gold/silver/bronze, crowns, swords, home host marker),
  loan badges (pin/alarm), log-play modal (home chips, hash Scores, crown Won),
  game detail (external links), empty states, crew menu, surprise box.
- All modal-close buttons converted from text × to icon('x') (+aria-label);
  ✕ delete-play / sb-close too; 🎉 removed from crew-created modal; favicon
  now /icon.svg. CSS: .icon base (currentColor, 1.05em) + size/color variants;
  .modal-close .icon 19px.
- Kept intentionally: typographic arrows (→ ↳ ↓ ← in loan chips/expansion rows/
  score dir) and text ✓ (textContent button + matrix cells) — typography, not
  emoji; render monochrome everywhere.
- Verified on mobile preview (375x812): crew grid, leaderboard, log-play modal,
  game detail; sprite fetch OK, 8+ icons per view, zero emoji left. Deployed to
  Fly (machine v15); live checks: /icons.svg 24 symbols, app.js icon refs OK.

## Phase 17: BACKLOG PACK — nights, requests, wishlists, reset, tags, feed, backups. DEPLOYED
- Scope: every non-BGG-token backlog item. Deferred: barcode scan (needs a UPC
  data source), Crew Wrapped (needs a year of plays — December), individual
  players (architecture change).
- Schema: events/event_rsvps/event_votes, borrow_requests, reset_codes,
  game_tags, library_entries.status ('owned'|'wish'|'grabs').
- Game nights: 4th "Nights" segment (calendar icon, swipe order grid→matrix→
  nights→stats). Date-block cards, RSVP in/maybe/out (upsert, avatars), vote
  toggles + suggest-a-game from crew shelf (server rejects wish/foreign games),
  planner-or-host edit + call-off, creator auto-RSVPs. eventsCache per crew
  view; wired-once delegation guard (re-render must not stack listeners).
- Borrow requests: ask per lendable owner on the game card; account inbox
  approve (one-tap loan + due date via logLoanChange txn) / decline; rival
  pendings auto-decline on approve; requester cancel; /api/me carries
  pendingRequests → tab badge (refreshPending()).
- Wishlists: add-modal Shelf|Wishlist toggle, status select in edit modal
  (loan controls hidden for wish; wish+return-in-same-save allowed), My Shelf
  wishlist section + got-it action, public shelf wishlist section, crew Gift
  ideas modal (/crews/:id/wishlists). Crew library/matrix/snapshot/gameCounts
  all exclude wish; owners PUT can't delete wish rows and upgrades them when
  an owner is checked; re-adding a wish as owned upgrades it. grabs = badge
  on cards (own shelf, crew grid, public).
- Password reset: crewmate-vouched one-time codes (XXXX-XXXX, scrypt-hashed,
  1h expiry, newest-only, generator in Account modal incl. target username);
  /api/reset-password rate-limited, kills all sessions, auto-login; login-card
  Forgot password? mode (required attr dropped from hidden pw input).
- Tags: per-crew game_tags, normalize lowercase 2-24 chars, 8/game cap; chips
  in filter bar (toggle), editor in game detail (Enter + datalist change,
  works pre-keyboard on mobile); member-only.
- Activity feed: single UNION query (adds, wishes, loans, returns w/ borrower,
  plays via created_at, planned nights) LIMIT 40, member-only; act-rows with
  per-kind icons + timeAgo(). First-player picker: member chips + guests,
  ease-out roulette (~3s; bg tabs throttle to 1s ticks — foreground fine).
- Infra: nightly.yml (02:17 PT + dispatch) — wake machine (dynamic id, retry),
  backup-prep.js WAL checkpoint, sftp db + snapshot, openssl aes-256-cbc
  (pbkdf2 200k) artifact 30d retention, snapshot commit ONLY on real change
  (generated-line-insensitive diff), explicit publish-pages dispatch (bot
  pushes don't trigger on:push). Scoped deploy token tested locally (machine
  start + ssh) before set; secrets FLY_API_TOKEN + BACKUP_PASSPHRASE; local
  .backup-passphrase gitignored; BACKUPS.md restore drill.
- Icons: +7 symbols (calendar gift key bell tag activity check) → 31.
- Fixed during preview verification: RSVP/vote active chips were orange-on-
  orange (my .ev-rsvp override) → outlined active style.
- Tests: /tmp/backlog-test.mjs 78 green (wish semantics incl. A7b/A8, reset
  lifecycle, events perms/upsert/votes, borrow conflicts + auto-decline, tag
  cap/normalize, activity kinds/order/403). Rivalry 34 + regression 18 still
  green. One real bug found by suite: newInviteCode missing from server.js
  imports (reset route 500).
- Prod: backup-pre-backlog-pack.db on volume + /tmp/prod-pre-backlog.db local
  (158 games), deploy = machine v16, smoke: all new endpoints 200, payload has
  tags/grabs, pendingRequests present, 31 sprite symbols live, no writes.
