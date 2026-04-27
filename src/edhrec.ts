import fetch from 'node-fetch';
import { EdhrecCard } from './types';

const EDHREC_BASE = 'https://json.edhrec.com';

/** Convert a card name to the slug EDHRec uses in its URLs */
export function toEdhrecSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[',\.\!]/g, '')          // remove punctuation
    .replace(/\s+/g, '-')              // spaces → hyphens
    .replace(/[^a-z0-9-]/g, '')        // strip anything else
    .replace(/-+/g, '-')               // collapse double hyphens
    .replace(/^-|-$/g, '');            // trim leading/trailing hyphens
}

export function edhrecCommanderUrl(name: string): string {
  return `https://edhrec.com/commanders/${toEdhrecSlug(name)}`;
}

/**
 * Fetches the EDHRec recommendation list for a given commander.
 * Returns an empty array on any failure (network error, 404, unexpected shape).
 */
export async function fetchCommanderData(commanderName: string): Promise<EdhrecCard[]> {
  const slug = toEdhrecSlug(commanderName);
  const url = `${EDHREC_BASE}/pages/commanders/${slug}.json`;

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'mtg-deck-builder/1.0' },
    });

    if (!response.ok) {
      // Try the background (partner) variant path
      const bgUrl = `${EDHREC_BASE}/pages/commanders/${slug}-background.json`;
      const bgRes = await fetch(bgUrl, { headers: { 'User-Agent': 'mtg-deck-builder/1.0' } });
      if (!bgRes.ok) return [];
      return parseEdhrecResponse(await bgRes.json());
    }

    return parseEdhrecResponse(await response.json());
  } catch {
    return [];
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseEdhrecResponse(data: any): EdhrecCard[] {
  const cardlists: unknown[] = data?.container?.json_dict?.cardlists ?? [];
  const cards: EdhrecCard[] = [];
  let rank = 0;

  for (const list of cardlists as Array<{ cardviews?: unknown[] }>) {
    for (const view of list.cardviews ?? []) {
      // cardviews entries can be either a card object or an array of card objects (sub-groups)
      if (Array.isArray(view)) {
        for (const subview of view as Array<{ name?: string; inclusion?: number; synergy?: number }>) {
          if (subview?.name) {
            cards.push({
              name: subview.name,
              inclusion: subview.inclusion ?? 0,
              synergy: subview.synergy ?? 0,
              rank: rank++,
            });
          }
        }
      } else {
        const v = view as { name?: string; inclusion?: number; synergy?: number };
        if (v?.name) {
          cards.push({
            name: v.name,
            inclusion: v.inclusion ?? 0,
            synergy: v.synergy ?? 0,
            rank: rank++,
          });
        }
      }
    }
  }

  return cards;
}
