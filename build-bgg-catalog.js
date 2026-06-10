// Builds data/bgg-catalog.json from a BGG rankings CSV snapshot
// (https://github.com/beefsack/bgg-ranking-historicals — daily dumps of
// BoardGameGeek's ranked games: ~30k titles with year and cover thumbnail).
//
//   node build-bgg-catalog.js /path/to/YYYY-MM-DD.csv
//
// Output is a compact array sorted by rank: [{ i: bggId, t: title, y: year,
// r: rank, im: thumbnailUrl }, …] — consumed by server.js game search and
// enrich-images.js.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = process.argv[2];
if (!src) {
  console.error('Usage: node build-bgg-catalog.js <rankings.csv>');
  process.exit(1);
}

function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const rows = parseCSV(readFileSync(src, 'utf8'));
const header = rows[0];
const col = Object.fromEntries(header.map((h, i) => [h, i]));

const games = rows
  .slice(1)
  .filter((r) => r.length >= header.length && r[col.Name] && r[col.Thumbnail])
  .map((r) => ({
    i: Number(r[col.ID]) || null,
    t: r[col.Name],
    y: Number(r[col.Year]) || null,
    r: Number(r[col.Rank]) || null,
    im: r[col.Thumbnail],
  }))
  .sort((a, b) => (a.r ?? 1e9) - (b.r ?? 1e9));

const out = path.join(__dirname, 'data', 'bgg-catalog.json');
writeFileSync(out, JSON.stringify(games));
console.log(`Wrote ${games.length} games → ${out} (source: ${path.basename(src)})`);
