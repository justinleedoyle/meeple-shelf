// Shared helpers for pulling game metadata (description, official website,
// cover art) from BGG's open geekitems/images endpoints. Used by the server
// (live, on add) and fetch-missing-art.js (backfill).

const UA = { 'User-Agent': 'MeepleShelf/1.0 (personal board game library)' };

export async function geekJson(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) return null;
  return res.json();
}

export const getThing = (objectId) =>
  geekJson(`https://api.geekdo.com/api/geekitems?objectid=${objectId}&objecttype=thing`).then((d) => d?.item || null);

export async function mediumImageUrl(imageId) {
  const img = await geekJson(`https://api.geekdo.com/api/images/${imageId}`);
  return img?.images?.medium?.url || img?.images?.itempage?.url || null;
}

const ENTITIES = { '&nbsp;': ' ', '&mdash;': '—', '&ndash;': '–', '&amp;': '&', '&quot;': '"', '&#039;': "'", '&apos;': "'", '&rsquo;': '’', '&lsquo;': '‘', '&ldquo;': '“', '&rdquo;': '”', '&hellip;': '…', '&lt;': '<', '&gt;': '>' };

// BGG descriptions arrive as HTML; flatten to readable plain text with
// paragraph breaks, capped at a sentence boundary near `max` chars.
export function cleanDescription(html, max = 1500) {
  if (!html) return null;
  let text = String(html)
    .replace(/<\s*(p|br|li|div)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&[a-z]+;/gi, (e) => ENTITIES[e.toLowerCase()] ?? ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{2,}/g, '\n\n')
    .trim();
  if (text.length > max) {
    const cut = text.slice(0, max);
    const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.\n'));
    text = (lastStop > max * 0.5 ? cut.slice(0, lastStop + 1) : cut) + ' …';
  }
  return text || null;
}

// Fill bgg_id / description / website / (missing) art on a game row from its
// BGG thing. Returns true if anything was written.
export async function applyThingMeta(db, game, objectId) {
  const item = await getThing(objectId);
  if (!item) return false;
  const description = cleanDescription(item.description) || item.short_description || null;
  const websiteUrl = item.website?.url || null;
  let imageUrl = game.image_url;
  if ((!imageUrl || imageUrl.includes('__micro')) && item.imageid) {
    imageUrl = (await mediumImageUrl(item.imageid)) || imageUrl;
  }
  db.prepare('UPDATE games SET bgg_id = ?, description = COALESCE(?, description), website_url = COALESCE(?, website_url), image_url = COALESCE(?, image_url) WHERE id = ?')
    .run(objectId, description, websiteUrl, imageUrl, game.id);
  return true;
}
