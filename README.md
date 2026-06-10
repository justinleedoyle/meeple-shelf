# 🎲 Meeple Shelf

Your board game shelf, your friends' shelves, and one combined library for game night.

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
  filters for player count ("we have 5 tonight"), play time, owner, and title search.
  Games owned by multiple people are surfaced too — useful for deciding who's allowed
  to buy the next expansion.

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

## The GitHub Pages snapshot

GitHub can't run the Node server (Pages is static-only), but `npm run export` renders the
combined library to `docs/index.html` as a self-contained read-only page — search, player
count / time / category / owner filters, and the who-has-what matrix all work. Pages serves
it from `/docs` on `main`, so updating the public page is:

```bash
npm run export
git add docs && git commit -m "Refresh shelf snapshot" && git push
```

Live page: https://justinleedoyle.github.io/meeple-shelf/

To re-import a fresh copy of the Google Sheet, update `data/collection-sheet.md` and rerun
`npm run import-sheet` (it's idempotent — existing entries are kept, new ✓s become entries).

## Deploying the interactive app for real friends

It runs anywhere Node runs. The only requirement is a persistent disk for the SQLite file:

- **Fly.io / Railway:** add a volume, mount it, and set `DB_PATH` to a path on the volume.
- **A spare machine / home server:** `npm start` behind Tailscale or a reverse proxy is
  honestly the easiest way to share with a handful of friends.
- Render's free tier wipes local disk on deploy — use a paid disk or another host.

## Ideas for later

- Wishlists and a "borrowed by" tracker (who has my copy of Scythe?)
- Play logging and a crew leaderboard
- BGG import for users who register for API access
- Game-night scheduler: pick a date, see the filtered combined shelf for that headcount
