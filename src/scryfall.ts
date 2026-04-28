import fetch from 'node-fetch';
import { ParsedCard, ScryfallCard, OwnedCard } from './types';

const SCRYFALL_BASE = 'https://api.scryfall.com';
const BATCH_SIZE = 75;
const RATE_LIMIT_MS = 120; // Scryfall asks for ~100ms between requests

interface CollectionResponse {
  data: ScryfallCard[];
  not_found: Array<{ name?: string; set?: string; collector_number?: string }>;
}

/** Delay helper */
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Fetch all cards from a ParsedCard list using Scryfall's /cards/collection endpoint.
 * Batches requests to stay within the 75-card limit per call.
 */
export async function fetchCardsBatch(parsedCards: ParsedCard[]): Promise<OwnedCard[]> {
  const results: OwnedCard[] = [];
  const notFound: string[] = [];

  for (let i = 0; i < parsedCards.length; i += BATCH_SIZE) {
    const chunk = parsedCards.slice(i, i + BATCH_SIZE);

    const identifiers = chunk.map(c => {
      if (c.set && c.collectorNumber) {
        return { set: c.set.toLowerCase(), collector_number: c.collectorNumber };
      }
      return { name: c.name };
    });

    const response = await fetch(`${SCRYFALL_BASE}/cards/collection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifiers }),
    });

    if (!response.ok) {
      console.error(`Scryfall batch error: ${response.status}`);
      continue;
    }

    const data = (await response.json()) as CollectionResponse;

    for (const scryfallCard of data.data) {
      // Match back to original parsed card to retrieve quantity
      const original = chunk.find(c => {
        if (c.set && c.collectorNumber) {
          return (
            c.set.toLowerCase() === scryfallCard.set.toLowerCase() &&
            c.collectorNumber === scryfallCard.collector_number
          );
        }
        return c.name.toLowerCase() === scryfallCard.name.toLowerCase();
      });

      results.push({
        quantity: original?.quantity ?? 1,
        card: scryfallCard,
      });
    }

    for (const nf of data.not_found) {
      notFound.push(nf.name ?? JSON.stringify(nf));
    }

    if (i + BATCH_SIZE < parsedCards.length) {
      await sleep(RATE_LIMIT_MS);
    }
  }

  if (notFound.length > 0) {
    console.warn(`Scryfall: ${notFound.length} card(s) not found:`, notFound.slice(0, 10));
  }

  return results;
}

const STANDARD_BASICS = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'];
let _basicLandsCache: OwnedCard[] | null = null;

/**
 * Returns the 5 standard basic land cards with quantity 99, fetched once and cached.
 * Used so decks can always fill basic land slots regardless of what the user listed.
 */
export async function fetchBasicLands(): Promise<OwnedCard[]> {
  if (_basicLandsCache) return _basicLandsCache;
  const response = await fetch(`${SCRYFALL_BASE}/cards/collection`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifiers: STANDARD_BASICS.map(name => ({ name })) }),
  });
  if (!response.ok) return [];
  const data = (await response.json()) as CollectionResponse;
  _basicLandsCache = data.data.map(card => ({ quantity: 99, card }));
  return _basicLandsCache;
}

/** Get a card image URL, handling double-faced cards */
export function getCardImageUrl(
  card: ScryfallCard,
  size: 'small' | 'normal' | 'large' = 'normal'
): string | null {
  if (card.image_uris) return card.image_uris[size] ?? null;
  if (card.card_faces?.[0]?.image_uris) return card.card_faces[0].image_uris[size] ?? null;
  return null;
}

/** Get the back face image URL for double-faced cards; null for single-faced cards */
export function getCardBackImageUrl(
  card: ScryfallCard,
  size: 'small' | 'normal' | 'large' = 'normal'
): string | null {
  if (card.card_faces?.[1]?.image_uris) return card.card_faces[1].image_uris[size] ?? null;
  return null;
}
