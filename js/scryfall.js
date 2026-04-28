const SCRYFALL_BASE  = 'https://api.scryfall.com';
const SCRYFALL_BATCH = 75;
const SCRYFALL_WAIT  = 120;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchCardsBatch(parsedCards, onProgress) {
  const results = [];
  for (let i = 0; i < parsedCards.length; i += SCRYFALL_BATCH) {
    const chunk = parsedCards.slice(i, i + SCRYFALL_BATCH);
    const identifiers = chunk.map(c =>
      c.set && c.collectorNumber
        ? { set: c.set.toLowerCase(), collector_number: c.collectorNumber }
        : { name: c.name }
    );
    const res = await fetch(`${SCRYFALL_BASE}/cards/collection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifiers }),
    });
    if (!res.ok) continue;
    const data = await res.json();
    for (const card of data.data) {
      const orig = chunk.find(c =>
        c.set && c.collectorNumber
          ? c.set.toLowerCase() === card.set.toLowerCase() && c.collectorNumber === card.collector_number
          : c.name.toLowerCase() === card.name.toLowerCase()
      );
      results.push({ quantity: orig?.quantity ?? 1, card });
    }
    if (onProgress) onProgress(Math.min(i + SCRYFALL_BATCH, parsedCards.length) / parsedCards.length);
    if (i + SCRYFALL_BATCH < parsedCards.length) await sleep(SCRYFALL_WAIT);
  }
  return results;
}

let _basicLandsCache = null;
async function fetchBasicLands() {
  if (_basicLandsCache) return _basicLandsCache;
  const res = await fetch(`${SCRYFALL_BASE}/cards/collection`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifiers: ['Plains','Island','Swamp','Mountain','Forest'].map(name => ({ name })) }),
  });
  if (!res.ok) return [];
  const data = await res.json();
  _basicLandsCache = data.data.map(card => ({ quantity: 99, card }));
  return _basicLandsCache;
}

function getCardImageUrl(card, size = 'normal') {
  if (card.image_uris) return card.image_uris[size] ?? null;
  if (card.card_faces?.[0]?.image_uris) return card.card_faces[0].image_uris[size] ?? null;
  return null;
}

function getCardBackImageUrl(card, size = 'normal') {
  if (card.card_faces?.[1]?.image_uris) return card.card_faces[1].image_uris[size] ?? null;
  return null;
}
