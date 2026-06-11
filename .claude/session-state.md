# Session State — Meeple Shelf

## Active
(none — backlog pack shipped 2026-06-11; remaining items need external inputs, see below)

## Paused / Recently Completed
- [2026-06-10 Meeple Shelf one-shot build → production](sessions/2026-06-10-meeple-shelf-build.md) — Complete (17 phases).
  Live app: https://meeple-shelf.fly.dev (Fly.io, 6 households, 148 games, full art).
  Public read-only PWA: https://justinleedoyle.github.io/meeple-shelf/ (auto-publishes via Actions).
  Shipped through Phase 17: leaderboard/Rivalry Pack, stroke icon set, game nights (RSVP+votes),
  borrow requests, wishlists/up-for-grabs, crewmate password-reset codes, crew tags, activity
  feed, first-player picker, nightly encrypted off-machine DB backups + page auto-refresh
  (02:17 PT; restore drill verified — see BACKUPS.md; passphrase in .backup-passphrase, NOT in git).
  Refresh public page: `npm run sync` (or wait for the nightly). Deploy code: `fly deploy`.

## Waiting on external inputs
- BGG API token (application pending) → live lookups, full-size art, best-with-N-players filter
- Barcode scan-to-add → needs a UPC→game data source (GameUPC or BGG token)
- Crew Wrapped → December, needs a year of plays
- Individual-player layer → big architecture change, revisit if household stats feel coarse
