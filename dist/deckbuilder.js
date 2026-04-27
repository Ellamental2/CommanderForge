"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPartnerType = getPartnerType;
exports.getPartnerWithName = getPartnerWithName;
exports.isLegalCommander = isLegalCommander;
exports.scoreCommander = scoreCommander;
exports.categoriseCard = categoriseCard;
exports.buildDeck = buildDeck;
const edhrec_1 = require("./edhrec");
const scryfall_1 = require("./scryfall");
// ── Commander detection ────────────────────────────────────────────────────
function getOracleText(card) {
    if (card.oracle_text)
        return card.oracle_text;
    return card.card_faces?.map(f => f.oracle_text ?? '').join(' ') ?? '';
}
function getTypeLine(card) {
    if (card.type_line)
        return card.type_line;
    return card.card_faces?.map(f => f.type_line ?? '').join(' ') ?? '';
}
function getPartnerType(card) {
    const oracle = getOracleText(card);
    const typeLine = getTypeLine(card);
    if (/\bFriends forever\b/i.test(oracle))
        return 'friends-forever';
    if (/\bChoose a Background\b/i.test(oracle))
        return 'chooses-background';
    if (typeLine.includes('Legendary') && typeLine.includes('Background'))
        return 'background';
    if (/\bPartner with\b/i.test(oracle))
        return 'partner-with';
    if (/\bPartner\b(?! with)/i.test(oracle))
        return 'partner';
    return null;
}
function getPartnerWithName(card) {
    const match = getOracleText(card).match(/\bPartner with ([^(\n]+)/i);
    return match ? match[1].trim() : null;
}
function isLegalCommander(card) {
    if (card.legalities?.commander !== 'legal')
        return false;
    const typeLine = getTypeLine(card);
    const oracleText = getOracleText(card);
    return ((typeLine.includes('Legendary') && typeLine.includes('Creature')) ||
        oracleText.includes('can be your commander') ||
        // Background enchantments can be in the command zone alongside a "Choose a Background" commander
        (typeLine.includes('Legendary') && typeLine.includes('Background')));
}
// ── Color identity check ───────────────────────────────────────────────────
/**
 * Returns true if every colour in `cardColors` is within `commanderColors`.
 * Colourless cards (empty array) are always legal.
 */
function fitsColorIdentity(commanderColors, cardColors) {
    return cardColors.every(c => commanderColors.includes(c));
}
// ── Commander scoring ──────────────────────────────────────────────────────
async function scoreCommander(commander, allOwned) {
    const edhrecCards = await (0, edhrec_1.fetchCommanderData)(commander.name);
    const edhrecNames = new Set(edhrecCards.map(c => c.name.toLowerCase()));
    // Cards that are Commander-legal and fit within the commander's colour identity
    const validOwned = allOwned.filter(oc => oc.card.legalities?.commander === 'legal' &&
        oc.card.id !== commander.id &&
        fitsColorIdentity(commander.color_identity, oc.card.color_identity));
    const matchingOwned = validOwned.filter(oc => edhrecNames.has(oc.card.name.toLowerCase()));
    // Score: what fraction of the top-99 EDHRec recommendations do we own?
    const denominator = Math.min(99, edhrecCards.length);
    const matchPercent = denominator > 0 ? Math.round((matchingOwned.length / denominator) * 100) : 0;
    return {
        name: commander.name,
        colorIdentity: commander.color_identity,
        matchCount: matchingOwned.length,
        validCardCount: validOwned.length,
        matchPercent,
        edhrecUrl: (0, edhrec_1.edhrecCommanderUrl)(commander.name),
        imageUrl: (0, scryfall_1.getCardImageUrl)(commander, 'normal'),
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
function isBasicLand(card) {
    return (getTypeLine(card).includes('Basic Land') ||
        BASIC_LANDS.has(card.name.toLowerCase()));
}
const LAND_CARE_RE = /landfall|whenever a land|land enters|sacrifice a land|land card|search your library for a.*land|domain/i;
const MANA_SOURCE_RE = /\{T\}[^.]*Add|\bAdd\s+\{[WUBRGC2]/;
function caresAboutLands(card) {
    return LAND_CARE_RE.test(getOracleText(card));
}
function isNonLandManaSource(card) {
    return !getTypeLine(card).includes('Land') && MANA_SOURCE_RE.test(getOracleText(card));
}
const BASE_LANDS = 38;
function calculateTargetLands(commanders, ownedNonLands) {
    const sample = ownedNonLands.slice(0, 61);
    const landCaringCount = sample.filter(oc => caresAboutLands(oc.card)).length;
    const manaSourceCount = sample.filter(oc => isNonLandManaSource(oc.card)).length;
    let target = BASE_LANDS;
    if (commanders.some(c => caresAboutLands(c))) {
        target += 3;
    }
    else if (landCaringCount >= 5) {
        target += Math.min(Math.floor(landCaringCount / 3), 4);
    }
    target -= Math.floor(manaSourceCount / 2);
    return Math.max(30, Math.min(45, target));
}
// ── Basic land distribution ────────────────────────────────────────────────
const MANA_COLORS = new Set(['W', 'U', 'B', 'R', 'G']);
const COLOR_BASICS = {
    W: ['plains', 'snow-covered plains'],
    U: ['island', 'snow-covered island'],
    B: ['swamp', 'snow-covered swamp'],
    R: ['mountain', 'snow-covered mountain'],
    G: ['forest', 'snow-covered forest'],
};
function buildBasicPool(ownedLands) {
    const pool = new Map();
    for (const oc of ownedLands) {
        if (!isBasicLand(oc.card))
            continue;
        const key = oc.card.name.toLowerCase();
        const entry = pool.get(key);
        if (entry)
            entry.qty += oc.quantity;
        else
            pool.set(key, { card: oc.card, qty: oc.quantity });
    }
    return pool;
}
function roundToIntegers(values, target) {
    const entries = Object.entries(values).map(([k, v]) => ({ k, floor: Math.floor(v), frac: v % 1 }));
    const remainder = target - entries.reduce((s, e) => s + e.floor, 0);
    entries.sort((a, b) => b.frac - a.frac);
    const result = {};
    entries.forEach((e, i) => { result[e.k] = e.floor + (i < remainder ? 1 : 0); });
    return result;
}
function buildProportionalBasics(slotsAvailable, commanderColors, basicPool, selectedNonLands, edhrecMap) {
    if (slotsAvailable <= 0)
        return [];
    const colors = commanderColors.filter(c => MANA_COLORS.has(c));
    // Colorless commander: just add Wastes
    if (colors.length === 0) {
        const wastes = basicPool.get('wastes');
        if (!wastes)
            return [];
        return [makeDeckCard(wastes.card, Math.min(wastes.qty, slotsAvailable), edhrecMap)];
    }
    // Count how many times each mana color appears across selected non-land cards
    const counts = {};
    for (const c of colors)
        counts[c] = 0;
    for (const dc of selectedNonLands) {
        for (const c of dc.colorIdentity) {
            if (c in counts)
                counts[c]++;
        }
    }
    // If no colored cards at all, split evenly
    const countTotal = Object.values(counts).reduce((s, n) => s + n, 0);
    if (countTotal === 0)
        for (const c of colors)
            counts[c] = 1;
    const weightTotal = Object.values(counts).reduce((s, n) => s + n, 0);
    const rawAllocations = {};
    for (const c of colors)
        rawAllocations[c] = (counts[c] / weightTotal) * slotsAvailable;
    const allocations = roundToIntegers(rawAllocations, slotsAvailable);
    const result = [];
    for (const color of colors) {
        let remaining = allocations[color];
        for (const name of COLOR_BASICS[color]) {
            if (remaining <= 0)
                break;
            const entry = basicPool.get(name);
            if (!entry || entry.qty <= 0)
                continue;
            const qty = Math.min(entry.qty, remaining);
            result.push(makeDeckCard(entry.card, qty, edhrecMap));
            remaining -= qty;
        }
    }
    return result;
}
/** Categorise a card for display grouping */
function categoriseCard(typeLine) {
    if (typeLine.includes('Creature'))
        return 'Creatures';
    if (typeLine.includes('Planeswalker'))
        return 'Planeswalkers';
    if (typeLine.includes('Land'))
        return 'Lands';
    if (typeLine.includes('Enchantment'))
        return 'Enchantments';
    if (typeLine.includes('Artifact'))
        return 'Artifacts';
    if (typeLine.includes('Instant'))
        return 'Instants';
    if (typeLine.includes('Sorcery'))
        return 'Sorceries';
    return 'Other';
}
/**
 * Build the best possible 100-card Commander deck from the owned cards.
 * Prioritises cards that appear on EDHRec's recommendation list by inclusion %.
 * Basic lands are allowed in multiples; everything else is singleton.
 */
async function buildDeck(commander, allOwned, partner) {
    const deckSize = partner ? 98 : 99;
    const combinedColors = partner
        ? [...new Set([...commander.color_identity, ...partner.color_identity])]
        : commander.color_identity;
    const edhrecCards = await (0, edhrec_1.fetchCommanderData)(commander.name, partner?.name);
    const edhrecMap = new Map(edhrecCards.map(c => [c.name.toLowerCase(), c]));
    // Filter to Commander-legal cards that fit the combined colour identity, excluding commanders
    const validOwned = allOwned.filter(oc => oc.card.legalities?.commander === 'legal' &&
        oc.card.id !== commander.id &&
        (!partner || oc.card.id !== partner.id) &&
        fitsColorIdentity(combinedColors, oc.card.color_identity));
    const edhrecSort = (a, b) => {
        const aRec = edhrecMap.get(a.card.name.toLowerCase());
        const bRec = edhrecMap.get(b.card.name.toLowerCase());
        if (aRec && !bRec)
            return -1;
        if (!aRec && bRec)
            return 1;
        if (aRec && bRec)
            return aRec.rank - bRec.rank;
        return (a.card.cmc ?? 0) - (b.card.cmc ?? 0);
    };
    const ownedLands = validOwned.filter(oc => getTypeLine(oc.card).includes('Land')).sort(edhrecSort);
    const ownedNonLands = validOwned.filter(oc => !getTypeLine(oc.card).includes('Land')).sort(edhrecSort);
    const targetLands = calculateTargetLands([commander, ...(partner ? [partner] : [])], ownedNonLands);
    const nonLandSlots = deckSize - targetLands;
    const deckCards = [];
    const usedNames = new Set();
    // Phase 1: fill non-land slots with best non-land cards
    for (const oc of ownedNonLands) {
        if (deckCards.length >= nonLandSlots)
            break;
        const nameLower = oc.card.name.toLowerCase();
        if (usedNames.has(nameLower))
            continue;
        usedNames.add(nameLower);
        deckCards.push(makeDeckCard(oc.card, 1, edhrecMap));
    }
    // Snapshot non-land cards for color proportion calculation
    const selectedNonLands = [...deckCards];
    // Phase 2a: non-basic lands (EDHRec priority, singleton)
    // Cap at 55 % of land slots so basics always form a meaningful resilience base.
    const totalLandSlots = deckSize - deckCards.length;
    const nonBasicCap = Math.ceil(totalLandSlots * 0.55);
    let nonBasicFilled = 0;
    for (const oc of ownedLands) {
        if (nonBasicFilled >= nonBasicCap)
            break;
        if (isBasicLand(oc.card))
            continue;
        const nameLower = oc.card.name.toLowerCase();
        if (usedNames.has(nameLower))
            continue;
        usedNames.add(nameLower);
        deckCards.push(makeDeckCard(oc.card, 1, edhrecMap));
        nonBasicFilled++;
    }
    // Phase 2b: fill remaining slots with proportionally distributed basic lands
    const basicPool = buildBasicPool(ownedLands);
    const basicCards = buildProportionalBasics(deckSize - deckCards.length, combinedColors, basicPool, selectedNonLands, edhrecMap);
    deckCards.push(...basicCards);
    const cardCount = deckCards.reduce((s, c) => s + c.quantity, 0);
    return {
        commander: {
            name: commander.name,
            imageUrl: (0, scryfall_1.getCardImageUrl)(commander, 'normal'),
            colorIdentity: commander.color_identity,
            oracleText: getOracleText(commander),
        },
        partner: partner ? {
            name: partner.name,
            imageUrl: (0, scryfall_1.getCardImageUrl)(partner, 'normal'),
            colorIdentity: partner.color_identity,
            oracleText: getOracleText(partner),
        } : undefined,
        cards: deckCards,
        totalCards: (partner ? 2 : 1) + cardCount,
        slotsRemaining: deckSize - cardCount,
    };
}
function makeDeckCard(card, qty, edhrecMap) {
    const rec = edhrecMap.get(card.name.toLowerCase());
    return {
        name: card.name,
        quantity: qty,
        typeLine: getTypeLine(card),
        colorIdentity: card.color_identity,
        imageUrl: (0, scryfall_1.getCardImageUrl)(card, 'small'),
        edhrecRank: rec?.rank,
        isRecommended: rec !== undefined,
        isGameChanger: rec?.isGameChanger ?? false,
        inclusion: rec?.inclusion,
    };
}
