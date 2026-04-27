import { OwnedCard, ScryfallCard, EdhrecCard, CommanderResult, DeckResponse, DeckCard } from './types';
import { fetchCommanderData, edhrecCommanderUrl } from './edhrec';
import { getCardImageUrl } from './scryfall';

// ── Commander detection ────────────────────────────────────────────────────

function getOracleText(card: ScryfallCard): string {
  if (card.oracle_text) return card.oracle_text;
  return card.card_faces?.map(f => f.oracle_text ?? '').join(' ') ?? '';
}

function getTypeLine(card: ScryfallCard): string {
  if (card.type_line) return card.type_line;
  return card.card_faces?.map(f => f.type_line ?? '').join(' ') ?? '';
}

export function isLegalCommander(card: ScryfallCard): boolean {
  if (card.legalities?.commander !== 'legal') return false;

  const typeLine = getTypeLine(card);
  const oracleText = getOracleText(card);

  return (
    (typeLine.includes('Legendary') && typeLine.includes('Creature')) ||
    oracleText.includes('can be your commander')
  );
}

// ── Color identity check ───────────────────────────────────────────────────

/**
 * Returns true if every colour in `cardColors` is within `commanderColors`.
 * Colourless cards (empty array) are always legal.
 */
function fitsColorIdentity(commanderColors: string[], cardColors: string[]): boolean {
  return cardColors.every(c => commanderColors.includes(c));
}

// ── Commander scoring ──────────────────────────────────────────────────────

export async function scoreCommander(
  commander: ScryfallCard,
  allOwned: OwnedCard[]
): Promise<CommanderResult> {
  const edhrecCards = await fetchCommanderData(commander.name);
  const edhrecNames = new Set(edhrecCards.map(c => c.name.toLowerCase()));

  // Cards that fit within the commander's colour identity (excluding the commander itself)
  const validOwned = allOwned.filter(
    oc =>
      oc.card.id !== commander.id &&
      fitsColorIdentity(commander.color_identity, oc.card.color_identity)
  );

  const matchingOwned = validOwned.filter(oc =>
    edhrecNames.has(oc.card.name.toLowerCase())
  );

  // Score: what fraction of the top-99 EDHRec recommendations do we own?
  const denominator = Math.min(99, edhrecCards.length);
  const matchPercent =
    denominator > 0 ? Math.round((matchingOwned.length / denominator) * 100) : 0;

  return {
    name: commander.name,
    colorIdentity: commander.color_identity,
    matchCount: matchingOwned.length,
    validCardCount: validOwned.length,
    matchPercent,
    edhrecUrl: edhrecCommanderUrl(commander.name),
    imageUrl: getCardImageUrl(commander, 'normal'),
    oracleText: getOracleText(commander),
  };
}

// ── Deck building ──────────────────────────────────────────────────────────

const BASIC_LANDS = new Set([
  'plains', 'island', 'swamp', 'mountain', 'forest',
  'wastes', 'snow-covered plains', 'snow-covered island',
  'snow-covered swamp', 'snow-covered mountain', 'snow-covered forest',
]);

function isBasicLand(card: ScryfallCard): boolean {
  return (
    getTypeLine(card).includes('Basic Land') ||
    BASIC_LANDS.has(card.name.toLowerCase())
  );
}

const LAND_CARE_RE = /landfall|whenever a land|land enters|sacrifice a land|land card|search your library for a.*land|domain/i;
const MANA_SOURCE_RE = /\{T\}[^.]*Add|\bAdd\s+\{[WUBRGC2]/;

function caresAboutLands(card: ScryfallCard): boolean {
  return LAND_CARE_RE.test(getOracleText(card));
}

function isNonLandManaSource(card: ScryfallCard): boolean {
  return !getTypeLine(card).includes('Land') && MANA_SOURCE_RE.test(getOracleText(card));
}

const BASE_LANDS = 38;

function calculateTargetLands(commander: ScryfallCard, ownedNonLands: OwnedCard[]): number {
  // Sample the top cards we'd realistically include to gauge deck composition
  const sample = ownedNonLands.slice(0, 61);
  const landCaringCount = sample.filter(oc => caresAboutLands(oc.card)).length;
  const manaSourceCount = sample.filter(oc => isNonLandManaSource(oc.card)).length;

  let target = BASE_LANDS;

  // Commander cares heavily about lands → +3; many deck cards do → up to +4
  if (caresAboutLands(commander)) {
    target += 3;
  } else if (landCaringCount >= 5) {
    target += Math.min(Math.floor(landCaringCount / 3), 4);
  }

  // Each pair of non-land mana sources (rocks, dorks) frees up one land slot
  target -= Math.floor(manaSourceCount / 2);

  return Math.max(30, Math.min(45, target));
}

// ── Basic land distribution ────────────────────────────────────────────────

const MANA_COLORS = new Set(['W', 'U', 'B', 'R', 'G']);

const COLOR_BASICS: Record<string, string[]> = {
  W: ['plains', 'snow-covered plains'],
  U: ['island', 'snow-covered island'],
  B: ['swamp', 'snow-covered swamp'],
  R: ['mountain', 'snow-covered mountain'],
  G: ['forest', 'snow-covered forest'],
};

type BasicPool = Map<string, { card: ScryfallCard; qty: number }>;

function buildBasicPool(ownedLands: OwnedCard[]): BasicPool {
  const pool: BasicPool = new Map();
  for (const oc of ownedLands) {
    if (!isBasicLand(oc.card)) continue;
    const key = oc.card.name.toLowerCase();
    const entry = pool.get(key);
    if (entry) entry.qty += oc.quantity;
    else pool.set(key, { card: oc.card, qty: oc.quantity });
  }
  return pool;
}

function roundToIntegers(values: Record<string, number>, target: number): Record<string, number> {
  const entries = Object.entries(values).map(([k, v]) => ({ k, floor: Math.floor(v), frac: v % 1 }));
  const remainder = target - entries.reduce((s, e) => s + e.floor, 0);
  entries.sort((a, b) => b.frac - a.frac);
  const result: Record<string, number> = {};
  entries.forEach((e, i) => { result[e.k] = e.floor + (i < remainder ? 1 : 0); });
  return result;
}

function buildProportionalBasics(
  slotsAvailable: number,
  commanderColors: string[],
  basicPool: BasicPool,
  selectedNonLands: DeckCard[],
  edhrecMap: Map<string, EdhrecCard>
): DeckCard[] {
  if (slotsAvailable <= 0) return [];

  const colors = commanderColors.filter(c => MANA_COLORS.has(c));

  // Colorless commander: just add Wastes
  if (colors.length === 0) {
    const wastes = basicPool.get('wastes');
    if (!wastes) return [];
    return [makeDeckCard(wastes.card, Math.min(wastes.qty, slotsAvailable), edhrecMap)];
  }

  // Count how many times each mana color appears across selected non-land cards
  const counts: Record<string, number> = {};
  for (const c of colors) counts[c] = 0;
  for (const dc of selectedNonLands) {
    for (const c of dc.colorIdentity) {
      if (c in counts) counts[c]++;
    }
  }

  // If no colored cards at all, split evenly
  const countTotal = Object.values(counts).reduce((s, n) => s + n, 0);
  if (countTotal === 0) for (const c of colors) counts[c] = 1;
  const weightTotal = Object.values(counts).reduce((s, n) => s + n, 0);

  const rawAllocations: Record<string, number> = {};
  for (const c of colors) rawAllocations[c] = (counts[c] / weightTotal) * slotsAvailable;
  const allocations = roundToIntegers(rawAllocations, slotsAvailable);

  const result: DeckCard[] = [];
  for (const color of colors) {
    let remaining = allocations[color];
    for (const name of COLOR_BASICS[color]) {
      if (remaining <= 0) break;
      const entry = basicPool.get(name);
      if (!entry || entry.qty <= 0) continue;
      const qty = Math.min(entry.qty, remaining);
      result.push(makeDeckCard(entry.card, qty, edhrecMap));
      remaining -= qty;
    }
  }
  return result;
}

/** Categorise a card for display grouping */
export function categoriseCard(typeLine: string): string {
  if (typeLine.includes('Creature')) return 'Creatures';
  if (typeLine.includes('Planeswalker')) return 'Planeswalkers';
  if (typeLine.includes('Land')) return 'Lands';
  if (typeLine.includes('Enchantment')) return 'Enchantments';
  if (typeLine.includes('Artifact')) return 'Artifacts';
  if (typeLine.includes('Instant')) return 'Instants';
  if (typeLine.includes('Sorcery')) return 'Sorceries';
  return 'Other';
}

/**
 * Build the best possible 100-card Commander deck from the owned cards.
 * Prioritises cards that appear on EDHRec's recommendation list by inclusion %.
 * Basic lands are allowed in multiples; everything else is singleton.
 */
export async function buildDeck(
  commander: ScryfallCard,
  allOwned: OwnedCard[]
): Promise<DeckResponse> {
  const edhrecCards = await fetchCommanderData(commander.name);
  const edhrecMap = new Map<string, EdhrecCard>(
    edhrecCards.map(c => [c.name.toLowerCase(), c])
  );

  // Filter to colour-identity-legal cards, excluding the commander
  const validOwned = allOwned.filter(
    oc =>
      oc.card.id !== commander.id &&
      fitsColorIdentity(commander.color_identity, oc.card.color_identity)
  );

  const edhrecSort = (a: OwnedCard, b: OwnedCard) => {
    const aRec = edhrecMap.get(a.card.name.toLowerCase());
    const bRec = edhrecMap.get(b.card.name.toLowerCase());
    if (aRec && !bRec) return -1;
    if (!aRec && bRec) return 1;
    if (aRec && bRec) return aRec.rank - bRec.rank;
    return (a.card.cmc ?? 0) - (b.card.cmc ?? 0);
  };

  const ownedLands = validOwned.filter(oc => getTypeLine(oc.card).includes('Land')).sort(edhrecSort);
  const ownedNonLands = validOwned.filter(oc => !getTypeLine(oc.card).includes('Land')).sort(edhrecSort);

  const targetLands = calculateTargetLands(commander, ownedNonLands);
  const nonLandSlots = 99 - targetLands;

  const deckCards: DeckCard[] = [];
  const usedNames = new Set<string>();

  // Phase 1: fill non-land slots with best non-land cards
  for (const oc of ownedNonLands) {
    if (deckCards.length >= nonLandSlots) break;
    const nameLower = oc.card.name.toLowerCase();
    if (usedNames.has(nameLower)) continue;
    usedNames.add(nameLower);
    deckCards.push(makeDeckCard(oc.card, 1, edhrecMap));
  }

  // Snapshot non-land cards for color proportion calculation
  const selectedNonLands = [...deckCards];

  // Phase 2a: non-basic lands (EDHRec priority, singleton)
  for (const oc of ownedLands) {
    if (deckCards.length >= 99) break;
    if (isBasicLand(oc.card)) continue;
    const nameLower = oc.card.name.toLowerCase();
    if (usedNames.has(nameLower)) continue;
    usedNames.add(nameLower);
    deckCards.push(makeDeckCard(oc.card, 1, edhrecMap));
  }

  // Phase 2b: fill remaining slots with proportionally distributed basic lands
  const basicPool = buildBasicPool(ownedLands);
  const basicCards = buildProportionalBasics(
    99 - deckCards.length,
    commander.color_identity,
    basicPool,
    selectedNonLands,
    edhrecMap
  );
  deckCards.push(...basicCards);

  const slotsRemaining = 99 - deckCards.reduce((s, c) => s + c.quantity, 0);

  return {
    commander: {
      name: commander.name,
      imageUrl: getCardImageUrl(commander, 'normal'),
      colorIdentity: commander.color_identity,
      oracleText: getOracleText(commander),
    },
    cards: deckCards,
    totalCards: 1 + deckCards.reduce((s, c) => s + c.quantity, 0),
    slotsRemaining,
  };
}

function makeDeckCard(
  card: ScryfallCard,
  qty: number,
  edhrecMap: Map<string, EdhrecCard>
): DeckCard {
  const rec = edhrecMap.get(card.name.toLowerCase());
  return {
    name: card.name,
    quantity: qty,
    typeLine: getTypeLine(card),
    colorIdentity: card.color_identity,
    imageUrl: getCardImageUrl(card, 'small'),
    edhrecRank: rec?.rank,
    isRecommended: rec !== undefined,
    inclusion: rec?.inclusion,
  };
}
