# 🎲 Meeple Shelf

Your board game shelf, your friends' shelves, and one combined library for game night.

**Live app:** https://meeple-shelf.fly.dev · **Public read-only page:** https://justinleedoyle.github.io/meeple-shelf/

Track the games you own, share your shelf with a public link, and pool shelves with
friends in a **crew** — so when five people show up on Friday, you can instantly answer
*"what can we play, and whose house is it at?"*

## Quick start

```bash
npm install
npm start          # → http://localhost:3000
```

Load the real household collection (parsed from `data/collection-sheet.md`, a snapshot
of the shared Google Sheet — 6 households, 109 games, one crew):

```bash
npm run import-sheet   # log in as doyles / stephensons / brocks / harris / bells / snowdens
                       # password: meeple123 (override with PASSWORD=… npm run import-sheet)
```

Or load generic demo data instead: `npm run seed` (justin / sam / riley, password `meeple123`).
To start over with a clean slate, stop the server and delete `data/meeple-shelf.db`.

## Features

- **My Shelf** — add games with instant search over a built-in catalog of ~190 popular
  titles (player counts and play times pre-filled), or enter anything manually with an
  optional cover-image URL. Notes per game ("sleeved", "missing a token", …).
- **Share your shelf** — every account gets a public link (`/#/u/<slug>`) anyone can view
  without an account. Flip the Public toggle off and the link goes dark.
- **Crews** — create a crew, get a 6-character invite code, friends join with it. The crew
  page is the combined library: every game anyone owns, with owner badges on each card.
- **Who has what** — a matrix view (games × members) with color-coded checkmarks, plus
  filters for player count ("we have 5 tonight"), play time, owner, category, and title
  search. Games owned by multiple people are surfaced too.
- **Borrow tracking** — mark where each copy physically is ("Stephensons → Doyles") from
  the edit modal or the crew's "who owns this?" editor. Loans show on cards everywhere.
- **Game night picker** — set the filters to tonight's headcount and time budget, hit
  **🎲 Surprise me**, and let the dice decide (expansions excluded from the roll).
- **Expansion grouping** — expansions named "Base — Expansion" auto-link to their base
  game and nest under its card (click "+N expansions" to expand). The matrix shows them
  indented under the base. Backfill old rows with `npm run link-expansions`.
- **Installable** — the public page is a PWA: add it to a phone home screen and it opens
  like an app (works offline with the last-loaded data).

## How sharing works

| What | How |
| --- | --- |
| Share my library | Copy the public link from the share bar — viewable logged-out |
| Privacy | Public/private toggle per account; private shelves 404 |
| Combined library | Create a crew → share the invite code → everyone's shelves pool automatically |
| Who owns a game | Owner chips on every card + the "Who has what" matrix view |

Two friends adding the same title (case-insensitive) are linked to the same game record,
so the combined view shows one card with both owners rather than duplicates.

## Tech notes

- **Stack:** Node + Express + better-sqlite3, vanilla JS frontend, zero build step.
- **Auth:** username/password with `crypto.scrypt` hashing, HttpOnly session cookies.
- **Database:** a single SQLite file at `data/meeple-shelf.db` (WAL mode). Schema is
  created automatically on first boot — no migrations to run.
- **Game catalog:** `data/popular-games.json`, bundled and editable. Search also matches
  any game already added by someone on your server. (BoardGameGeek's XML API now requires
  registered access, so the app deliberately has no external API dependency.)
- `PORT` env var to change the port (auto-increments if busy), `DB_PATH` to relocate the DB.

## The GitHub Pages snapshot (auto-published)

GitHub can't run the Node server (Pages is static-only), but the combined library is
published as a self-contained read-only page — search, player count / time / category /
owner filters, and the who-has-what matrix all work.

Live page: https://justinleedoyle.github.io/meeple-shelf/

**Publishing is automated.** To refresh it with the latest production data:

```bash
npm run sync
```

That generates `data/shelf-snapshot.json` **on the Fly.io server** (the source of truth),
downloads it, commits it, and pushes. A GitHub Action
([publish-pages.yml](.github/workflows/publish-pages.yml)) then rebuilds the page from the
snapshot and deploys it to Pages, usually in under a minute. Pushing template/CSS changes
redeploys too. (`npm run sync-local` is the variant that snapshots a local database
instead, for anyone running this without Fly.)

Locally, `npm run export` builds the same page to `site/index.html` (gitignored) for preview.

To re-import a fresh copy of the Google Sheet, update `data/collection-sheet.md` and rerun
`npm run import-sheet` (it's idempotent — existing entries are kept, new ✓s become entries).

## Production (Fly.io)

The app runs at **https://meeple-shelf.fly.dev** — one `shared-cpu-1x` machine in `lax`
that auto-stops when idle (wakes in ~1s), with the SQLite database on an encrypted 1GB
volume mounted at `/data` (daily snapshots, 5-day retention). Config: [fly.toml](fly.toml)
and [Dockerfile](Dockerfile).

Day-to-day commands (after `fly auth login`):

```bash
fly deploy                 # ship code changes
fly logs -a meeple-shelf   # tail server logs
fly ssh console -a meeple-shelf            # shell on the machine
fly volumes snapshots list vol_4oj9nn22djd8m0xr   # database snapshots
```

The database on the volume is the source of truth. The local `data/meeple-shelf.db` is
just a dev sandbox now. It would run equally well on any host with a persistent disk
(Railway volume, a DigitalOcean droplet) — avoid platforms with ephemeral filesystems
(e.g. DO App Platform) unless you first migrate off SQLite.

## Ideas for later

- Wishlists and a "borrowed by" tracker (who has my copy of Scythe?)
- Play logging and a crew leaderboard
- BGG import for users who register for API access
- Game-night scheduler: pick a date, see the filtered combined shelf for that headcount
