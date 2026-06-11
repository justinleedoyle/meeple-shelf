// Exports the biggest crew's combined library to data/shelf-snapshot.json —
// the small, public-safe data file that gets committed and drives the GitHub
// Pages build (see build-page.js and .github/workflows/publish-pages.yml).
//
//   npm run snapshot     # just write the file
//   npm run sync         # write it, commit it, push → Action redeploys the page
//
// Contains only what the public page shows: crew name, member display names,
// and games with owners. No usernames, no password hashes, no notes.

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const crew = db
  .prepare(
    `SELECT c.*, (SELECT COUNT(*) FROM crew_members cm WHERE cm.crew_id = c.id) AS member_count
     FROM crews c ORDER BY member_count DESC, c.id LIMIT 1`
  )
  .get();
if (!crew) {
  console.error('No crew found — run `npm run import-sheet` or `npm run seed` first.');
  process.exit(1);
}

const members = db
  .prepare(
    `SELECT u.id, u.display_name AS displayName,
      (SELECT COUNT(*) FROM library_entries le WHERE le.user_id = u.id AND le.status != 'wish') AS gameCount
     FROM crew_members cm JOIN users u ON u.id = cm.user_id
     WHERE cm.crew_id = ? ORDER BY cm.joined_at, u.id`
  )
  .all(crew.id);

const rows = db
  .prepare(
    `SELECT g.id, g.title, g.year, g.min_players AS minPlayers, g.max_players AS maxPlayers,
            g.play_time AS playTime, g.category, g.expansion_of AS expansionOf, g.image_url AS imageUrl,
            g.bgg_id AS bggId, g.website_url AS websiteUrl, g.description,
            u.id AS ownerId, u.display_name AS ownerName, lb.display_name AS loanedToName
     FROM crew_members cm
     JOIN library_entries le ON le.user_id = cm.user_id
     JOIN games g ON g.id = le.game_id
     JOIN users u ON u.id = cm.user_id
     LEFT JOIN users lb ON lb.id = le.loaned_to
     WHERE cm.crew_id = ? AND le.status != 'wish'
     ORDER BY g.title COLLATE NOCASE, u.display_name`
  )
  .all(crew.id);

const byGame = new Map();
for (const r of rows) {
  if (!byGame.has(r.id)) {
    byGame.set(r.id, {
      id: r.id, title: r.title, year: r.year, minPlayers: r.minPlayers, maxPlayers: r.maxPlayers,
      playTime: r.playTime, category: r.category, expansionOf: r.expansionOf, imageUrl: r.imageUrl,
      bggId: r.bggId, websiteUrl: r.websiteUrl,
      description: r.description ? (r.description.length > 420 ? r.description.slice(0, 420).trimEnd() + ' …' : r.description) : null,
      owners: [],
    });
  }
  byGame.get(r.id).owners.push({ id: r.ownerId, displayName: r.ownerName, loanedToName: r.loanedToName || null });
}

const data = {
  crewName: crew.name,
  generated: new Date().toISOString().slice(0, 10),
  members,
  games: [...byGame.values()],
};

const out = path.join(__dirname, 'data', 'shelf-snapshot.json');
writeFileSync(out, JSON.stringify(data, null, 1));
console.log(`Snapshot: "${data.crewName}" — ${data.games.length} games, ${members.length} members → ${out}`);
