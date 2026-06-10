# Meeple Shelf — One-Shot Build

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

## In Progress
Nothing — feature-complete as scoped.

## Next Steps (optional follow-ups)
- Deploy (Fly/Railway volume + `DB_PATH`) if real friends should use it
- Wishlists / borrow tracking / play logging (see README "Ideas for later")
- `data/meeple-shelf.db` currently holds the seeded demo data; delete to reset

## References
- Run: `npm start` → http://localhost:3000 (preview server was left running)
- Seed: `npm run seed`
- Workspace-level `/Users/justin/Projects/.claude/launch.json` added so the Claude
  preview panel can launch this app (`npm --prefix meeple-shelf start`).
