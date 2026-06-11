# Meeple Shelf — Roadmap

Synthesized 2026-06-11 from a five-agent competitive audit (BG Stats, NemeStats,
ScorePal, geekgroup.app, Kallax.io, MeepleStats, CLZ Games, Libib, myTurn,
Lend Engine, What2Play, Playpick, Dized, BGG itself, plus Reddit/BGG community
threads) cross-referenced against what Meeple Shelf already does.

## Tier 1 — "The Rivalry Pack" (mostly small; zero new data entry)

All computed from the plays/games tables that already exist. Together they make
the leaderboard the page people open on idle Tuesdays.

1. **Champion & Nemesis callouts** *(small — NemeStats' signature)*
   Each game shows its reigning Champion household (best record, dethroned on
   loss). Each household's Nemesis (who beats them most) appears on the
   leaderboard. Instant rivalry narrative, no new inputs.
2. **Shelf of Shame + smarter Surprise** *(small — geekgroup.app / community ritual)*
   "Never played" and "not played in 12+ months" filters; Surprise-me option
   weighted toward dusty games. Groups buy faster than they play — this is the
   beloved fix.
3. **H-index, milestones, 52-week heatmap** *(small — BG Stats / geekgroup)*
   Crew + household H-index, fives/dimes/quarters badges per game, GitHub-style
   play heatmap on the stats view.
4. **Per-game stats on the detail card** *(small)*
   "Played 4× · Bells won 3 · last played May 12" under the description.
5. **Host/location on plays** *(small — one tap: which house)*
   Unlocks "most plays hosted" and per-house stats.

## Tier 2 — The big sticky features

6. **Numeric scores + per-game record book** *(medium — BG Stats/ScorePal's
   stickiest feature; 3 of 5 researchers converged)*
   Optional point values at log time, per-game scoring direction
   (highest/lowest/co-op), records: best score, averages, closest game.
7. **Game night events: RSVP + voting + who-brings-what** *(large — the #1
   community ask; Kallax/What2Play)*
   Propose dates → households RSVP → shortlist auto-filtered to the locked
   headcount → vote during the week → backup pick. Converts the library into
   attendance.
8. **Crew Wrapped / shareable stat images** *(medium — BG Stats' most-shared
   feature)* Year-in-review recap per household + crew; also post-trip recaps
   via play tagging (tag plays "Cabin Trip 2026" → combined stats).
9. **Loan upgrades** *(small-medium — Libib/myTurn)*
   Due dates + overdue badges + "out longest" sort; append-only loan history
   ("borrowed 4×, last by Harris"); borrow-request button with one-tap
   approve. The audit: due dates are "the entire reason clubs pay for lending
   software."
10. **Crew activity feed** *(medium)* — game added / loan out / play logged as
    a reverse-chron feed; makes the shelf feel alive between nights.

## Tier 3 — Cataloging & table tools (cherry-pick as wanted)

11. **Custom crew tags** ("gateway", "good with grandma") as filter chips *(medium — CLZ)*
12. **Condition & missing-pieces flags** per copy, prompted at loan return *(small;
    pairs with #9)*
13. **Barcode scan-to-add** via camera + free GameUPC API *(medium — CLZ's
    most-praised feature)*
14. **"Best with N players" community votes + weight** — needs the live BGG API
    (token pending); upgrades the player filter from "supports 5" to "actually
    good with 5". Most-repeated filter request in BGG threads.
15. **Teach-it panel**: how-to-play video link per game *(small — Dized-lite)*
16. **First-player picker** (Chwazi-style finger circle) *(small, pure delight)*
17. **Score pad + play timer** that pre-fill the play log *(medium)*
18. **"Up for grabs" tag** for culled games — friends get first dibs *(small)*
19. **Missing-expansion finder**: expansions for owned base games that nobody
    owns — wishlist/gift fodder *(small)*
20. **Individual-player layer** (named people within households, per-player
    win rates) *(large; revisit if household-level stats start feeling coarse)*

## Infrastructure (unchanged, still first among equals)

- **Nightly off-machine DB backups** (Fly Tigris/R2) + **password reset** flow
- Auto-refresh of the public Pages snapshot (scheduled Action with a scoped Fly token)
- BGG live integration when the API token arrives (full-size art, weight,
  player-count polls, collection import)

## Suggested order

Rivalry Pack (1-5) + loan due dates in one session → scores & record book (6)
→ backups/reset → game night events (7) → Crew Wrapped before December (8).
