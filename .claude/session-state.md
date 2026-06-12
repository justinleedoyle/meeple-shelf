# Session State — Meeple Shelf

## Active
(none — push/PWA shipped 2026-06-12; remaining backlog needs external inputs, see below)

## Paused / Recently Completed
- [2026-06-10 Meeple Shelf one-shot build → production](sessions/2026-06-10-meeple-shelf-build.md) — Complete (21 phases).
  Live app: https://meeple-shelf.fly.dev (Fly.io machine v20, 6 households, 158 games, full art).
  Public read-only page: https://justinleedoyle.github.io/meeple-shelf/ (auto-publishes via Actions).
  Shipped: library/shelves/sharing, crews + combined library, leaderboard (Households|Players
  grains), game nights (RSVP+votes+day-of push reminder), live play mode, plays with expansions/
  durations/co-op, loans + borrow requests, wishlists, tags, activity feed, people-within-
  households, **web push notifications + installable PWA** (per-device opt-in, offline shell),
  nightly encrypted backups + page auto-refresh + 60-day schedule keepalive.
  Refresh public page: `npm run sync` (or nightly). Deploy: `fly deploy`. Secrets on Fly:
  VAPID_*, CRON_SECRET (mirrored as GH secret), FLY_API_TOKEN + BACKUP_PASSPHRASE (GH).
  NOTE: never casually rotate VAPID keys — the client self-repairs but every device re-mints.

## Waiting on Justin
- Real-device push test: iPhone → meeple-shelf.fly.dev → Share → Add to Home Screen →
  open from home screen → Account → Turn on notifications → Send a test.
- Nudge families off the shared meeple123 password (reset-code flow exists).

## Waiting on external inputs
- BGG API token (application pending) → live lookups, full-size art, best-with-N-players filter
- Barcode scan-to-add → needs a UPC→game data source (GameUPC or BGG token)
- Crew Wrapped → December, needs a year of plays
- Photos on plays → needs object storage (Tigris/S3)

## Fast-follow candidates
- Player profiles: tap a Players-board row → per-game records, head-to-head vs siblings
