import { OwnedCard, ScryfallCard, EdhrecCard, CommanderResult, DeckResponse, DeckCard } from './types';
import { fetchCommanderData, edhrecCommanderUrl } from './edhrec';
import { getCardImageUrl, getCardBackImageUrl, fetchBasicLands } from './scryfall';

// ── Commander detection ────────────────────────────────────────────────────

function getOracleText(card: ScryfallCard): string {
  if (card.oracle_text) return card.oracle_text;
  return card.card_faces?.map(f => f.oracle_text ?? '').join(' ') ?? '';
}

function getTypeLine(card: ScryfallCard): string {
  if (card.type_line) return card.type_line;
  return card.card_faces?.map(f => f.type_line ?? '').join(' ') ?? '';
}

export function getPartnerType(card: ScryfallCard): import('./types').PartnerType {
  const oracle = getOracleText(card);
  const typeLine = getTypeLine(card);
  if (/\bFriends forever\b/i.test(oracle)) return 'friends-forever';
  if (/\bChoose a Background\b/i.test(oracle)) return 'chooses-background';
  if (typeLine.includes('Legendary') && typeLine.includes('Background')) return 'background';
  if (/\bPartner with\b/i.test(oracle)) return 'partner-with';
  if (/\bDoctor's Companion\b/i.test(oracle)) return 'doctors-companion';
  if (/\bPartner\b(?! with)/i.test(oracle)) return 'partner';
  if (typeLine.includes('Legendary') && typeLine.includes('Creature') && /\bDoctor\b/.test(typeLine)) return 'doctor';
  return null;
}

export function getPartnerWithName(card: ScryfallCard): string | null {
  const match = getOracleText(card).match(/\bPartner with ([^(\n]+)/i);
  return match ? match[1].trim() : null;
}

export function isLegalCommander(card: ScryfallCard): boolean {
  if (card.legalities?.commander !== 'legal') return false;

  const typeLine = getTypeLine(card);
  const oracleText = getOracleText(card);

  // Backgrounds are only valid paired with a "Choose a Background" commander, not standalone
  if (typeLine.includes('Background')) return false;

  if (typeLine.includes('Legendary') && typeLine.includes('Creature')) return true;
  if (oracleText.includes('can be your commander')) return true;
  if (getPartnerType(card) === 'doctors-companion') return true;

  // Legendary planeswalkers with generic Partner or Friends Forever can lead a paired command zone
  const partnerType = getPartnerType(card);
  if (
    typeLine.includes('Legendary') &&
    typeLine.includes('Planeswalker') &&
    (partnerType === 'partner' || partnerType === 'friends-forever')
  ) return true;

  return false;
}

export function isValidPartnerPair(a: ScryfallCard, b: ScryfallCard): boolean {
  const aType = getPartnerType(a);
  const bType = getPartnerType(b);

  if (aType === 'partner' && bType === 'partner') return true;
  if (aType === 'friends-forever' && bType === 'friends-forever') return true;
  if (aType === 'partner-with' && getPartnerWithName(a)?.toLowerCase() === b.name.toLowerCase()) return true;
  if (bType === 'partner-with' && getPartnerWithName(b)?.toLowerCase() === a.name.toLowerCase()) return true;
  if (aType === 'chooses-background' && bType === 'background') return true;
  if (aType === 'background' && bType === 'chooses-background') return true;
  if (aType === 'doctors-companion' && bType === 'doctor') return true;
  if (aType === 'doctor' && bType === 'doctors-companion') return true;

  return false;
}

export function findPartnerCandidates(ownedCards: OwnedCard[]): Array<{
  name: string;
  imageUrl: string | null;
  imageUrlBack: string | null;
  oracleText: string;
  colorIdentity: string[];
  typeLine: string;
  partnerType: import('./types').PartnerType;
}> {
  const seen = new Set<string>();
  const results: ReturnType<typeof findPartnerCandidates> = [];
  for (const oc of ownedCards) {
    if (oc.card.legalities?.commander !== 'legal') continue;
    const typeLine = getTypeLine(oc.card);
    if (!typeLine.includes('Legendary') || !typeLine.includes('Background')) continue;
    const key = oc.card.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({
      name: oc.card.name,
      imageUrl: getCardImageUrl(oc.card, 'normal'),
      imageUrlBack: getCardBackImageUrl(oc.card, 'normal'),
      oracleText: getOracleText(oc.card),
      colorIdentity: oc.card.color_identity,
      typeLine,
      partnerType: getPartnerType(oc.card),
    });
  }
  return results;
}

// ── Partner pair merging ───────────────────────────────────────────────────

const COLOR_ORDER = ['W', 'U', 'B', 'R', 'G'];

export function buildPairResults(scores: CommanderResult[]): {
  pairs: CommanderResult[];
  pairedNames: Set<string>;
} {
  const pairs: CommanderResult[] = [];
  const pairedNames = new Set<string>();
  const seen = new Set<string>();

  // Deduplicate scores by name first so multiple printings don't produce phantom entries
  const deduped: CommanderResult[] = [];
  const dedupSeen = new Set<string>();
  for (const s of scores) {
    const k = s.name.toLowerCase();
    if (!dedupSeen.has(k)) { dedupSeen.add(k); deduped.push(s); }
  }

  for (let i = 0; i < deduped.length; i++) {
    for (let j = i + 1; j < deduped.length; j++) {
      const a = deduped[i];
      const b = deduped[j];

      if (a.name === b.name) continue;

      const compatible =
        (a.partnerType === 'partner' && b.partnerType === 'partner') ||
        (a.partnerType === 'friends-forever' && b.partnerType === 'friends-forever') ||
        (a.partnerType === 'partner-with' && a.partnerWith?.toLowerCase() === b.name.toLowerCase()) ||
        (b.partnerType === 'partner-with' && b.partnerWith?.toLowerCase() === a.name.toLowerCase()) ||
        (a.partnerType === 'doctor' && b.partnerType === 'doctors-companion') ||
        (a.partnerType === 'doctors-companion' && b.partnerType === 'doctor');

      if (!compatible) continue;

      const key = [a.name, b.name].sort().join('\0');
      if (seen.has(key)) continue;
      seen.add(key);
      pairedNames.add(a.name.toLowerCase());
      pairedNames.add(b.name.toLowerCase());

      const combinedColors = [...new Set([...a.colorIdentity, ...b.colorIdentity])]
        .sort((x, y) => COLOR_ORDER.indexOf(x) - COLOR_ORDER.indexOf(y));

      pairs.push({
        name: a.name,
        colorIdentity: combinedColors,
        matchCount: Math.round((a.matchCount + b.matchCount) / 2),
        validCardCount: Math.max(a.validCardCount, b.validCardCount),
        matchPercent: Math.round((a.matchPercent + b.matchPercent) / 2),
        edhrecUrl: a.edhrecUrl,
        imageUrl: a.imageUrl,
        imageUrlBack: a.imageUrlBack,
        oracleText: a.oracleText,
        partnerType: a.partnerType,
        partnerWith: a.partnerWith,
        partner: {
          name: b.name,
          imageUrl: b.imageUrl,
          imageUrlBack: b.imageUrlBack,
          oracleText: b.oracleText,
          colorIdentity: b.colorIdentity,
        },
      });
    }
  }

  return { pairs, pairedNames };
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

  // Cards that are Commander-legal and fit within the commander's colour identity
  const validOwned = allOwned.filter(
    oc =>
      oc.card.legalities?.commander === 'legal' &&
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
    imageUrlBack: getCardBackImageUrl(commander, 'normal'),
    oracleText: getOracleText(commander),
    partnerType: getPartnerType(commander),
    partnerWith: getPartnerWithName(commander),
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

const BASE_LANDS = 39;

function calculateTargetLands(commanders: ScryfallCard[], ownedNonLands: OwnedCard[]): number {
  const sample = ownedNonLands.slice(0, 61);
  const landCaringCount = sample.filter(oc => caresAboutLands(oc.card)).length;
  const manaSourceCount = sample.filter(oc => isNonLandManaSource(oc.card)).length;

  let target = BASE_LANDS;

  if (commanders.some(c => caresAboutLands(c))) {
    target += 3;
  } else if (landCaringCount >= 5) {
    target += Math.min(Math.floor(landCaringCount / 3), 4);
  }

  target -= Math.floor(manaSourceCount / 3);

  return Math.max(35, Math.min(100-commanders.length, target));
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

const STANDARD_BASIC_NAMES = new Set(['plains', 'island', 'swamp', 'mountain', 'forest']);

function buildBasicPool(ownedLands: OwnedCard[]): BasicPool {
  const pool: BasicPool = new Map();
  for (const oc of ownedLands) {
    if (!isBasicLand(oc.card)) continue;
    const key = oc.card.name.toLowerCase();
    const entry = pool.get(key);
    if (entry) entry.qty += oc.quantity;
    else pool.set(key, { card: oc.card, qty: oc.quantity });
  }
  // The 5 standard basics are assumed unlimited regardless of listed quantity
  for (const [key, entry] of pool) {
    if (STANDARD_BASIC_NAMES.has(key)) entry.qty = 99;
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
 * Cards banned in Commander (legalities.commander !== 'legal' per Scryfall) are excluded.
 */
export async function buildDeck(
  commander: ScryfallCard,
  allOwned: OwnedCard[],
  partner?: ScryfallCard,
  gcLimit: 'unlimited' | 'max3' | 'none' = 'unlimited',
  targetLandsOverride?: number
): Promise<DeckResponse> {
  const deckSize = partner ? 98 : 99;
  const combinedColors = partner
    ? [...new Set([...commander.color_identity, ...partner.color_identity])]
    : commander.color_identity;

  const edhrecCards = await fetchCommanderData(commander.name, partner?.name);
  const edhrecMap = new Map<string, EdhrecCard>(
    edhrecCards.map(c => [c.name.toLowerCase(), c])
  );

  // Exclude cards banned in Commander (Scryfall sets legalities.commander = 'banned' for these)
  // and cards outside the combined colour identity or already in the command zone.
  const validOwned = allOwned.filter(
    oc =>
      oc.card.legalities?.commander === 'legal' &&
      oc.card.id !== commander.id &&
      (!partner || oc.card.id !== partner.id) &&
      fitsColorIdentity(combinedColors, oc.card.color_identity)
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

  // Inject any standard basic types not in the user's collection so they're always available
  const fetchedBasics = await fetchBasicLands();
  const ownedBasicNames = new Set(
    ownedLands.filter(oc => isBasicLand(oc.card)).map(oc => oc.card.name.toLowerCase())
  );
  for (const basic of fetchedBasics) {
    if (
      !ownedBasicNames.has(basic.card.name.toLowerCase()) &&
      fitsColorIdentity(combinedColors, basic.card.color_identity)
    ) {
      ownedLands.push({ ...basic });
    }
  }

  const targetLands = targetLandsOverride !== undefined
    ? Math.max(0, Math.min(deckSize, targetLandsOverride))
    : calculateTargetLands([commander, ...(partner ? [partner] : [])], ownedNonLands);
  const nonLandSlots = deckSize - targetLands;

  const deckCards: DeckCard[] = [];
  const usedNames = new Set<string>();
  const gcMax = gcLimit === 'none' ? 0 : gcLimit === 'max3' ? 3 : Infinity;
  let gcCount = 0;

  // Phase 1: fill non-land slots with best non-land cards
  for (const oc of ownedNonLands) {
    if (deckCards.length >= nonLandSlots) break;
    const nameLower = oc.card.name.toLowerCase();
    if (usedNames.has(nameLower)) continue;
    const rec = edhrecMap.get(nameLower);
    if (rec?.isGameChanger && gcCount >= gcMax) continue;
    usedNames.add(nameLower);
    const dc = makeDeckCard(oc.card, 1, edhrecMap);
    deckCards.push(dc);
    if (dc.isGameChanger) gcCount++;
  }

  // Snapshot non-land cards for color proportion calculation
  const selectedNonLands = [...deckCards];

  // Phase 2a: non-basic lands (EDHRec priority, singleton)
  // Cap at 55 % of land slots so basics always form a meaningful resilience base.
  const totalLandSlots = deckSize - deckCards.length;
  const nonBasicCap = Math.ceil(totalLandSlots * 0.55);
  let nonBasicFilled = 0;
  for (const oc of ownedLands) {
    if (nonBasicFilled >= nonBasicCap) break;
    if (isBasicLand(oc.card)) continue;
    const nameLower = oc.card.name.toLowerCase();
    if (usedNames.has(nameLower)) continue;
    usedNames.add(nameLower);
    deckCards.push(makeDeckCard(oc.card, 1, edhrecMap));
    nonBasicFilled++;
  }

  // Phase 2b: fill remaining slots with proportionally distributed basic lands
  const basicPool = buildBasicPool(ownedLands);
  const basicCards = buildProportionalBasics(
    deckSize - deckCards.length,
    combinedColors,
    basicPool,
    selectedNonLands,
    edhrecMap
  );
  deckCards.push(...basicCards);

  const cardCount = deckCards.reduce((s, c) => s + c.quantity, 0);

  return {
    commander: {
      name: commander.name,
      imageUrl: getCardImageUrl(commander, 'normal'),
      imageUrlBack: getCardBackImageUrl(commander, 'normal'),
      colorIdentity: commander.color_identity,
      oracleText: getOracleText(commander),
    },
    partner: partner ? {
      name: partner.name,
      imageUrl: getCardImageUrl(partner, 'normal'),
      imageUrlBack: getCardBackImageUrl(partner, 'normal'),
      colorIdentity: partner.color_identity,
      oracleText: getOracleText(partner),
    } : undefined,
    cards: deckCards,
    totalCards: (partner ? 2 : 1) + cardCount,
    slotsRemaining: deckSize - cardCount,
    targetLands,
    deckSize,
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
    imageUrlBack: getCardBackImageUrl(card, 'small'),
    edhrecRank: rec?.rank,
    isRecommended: rec !== undefined,
    isGameChanger: rec?.isGameChanger ?? false,
    inclusion: rec?.inclusion,
  };
}
