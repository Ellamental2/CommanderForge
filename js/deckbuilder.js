// Commander detection
function getOracleText(card) {
  return card.oracle_text ?? card.card_faces?.map(f => f.oracle_text ?? '').join(' ') ?? '';
}

function getTypeLine(card) {
  return card.type_line ?? card.card_faces?.map(f => f.type_line ?? '').join(' ') ?? '';
}

function getPartnerType(card) {
  const oracle = getOracleText(card);
  const tl = getTypeLine(card);
  if (/\bFriends forever\b/i.test(oracle)) return 'friends-forever';
  if (/\bChoose a Background\b/i.test(oracle)) return 'chooses-background';
  if (tl.includes('Legendary') && tl.includes('Background')) return 'background';
  if (/\bPartner with\b/i.test(oracle)) return 'partner-with';
  if (/\bDoctor's Companion\b/i.test(oracle)) return 'doctors-companion';
  if (/\bPartner\b(?! with)/i.test(oracle)) return 'partner';
  if (tl.includes('Legendary') && tl.includes('Creature') && /\bDoctor\b/.test(tl)) return 'doctor';
  return null;
}

function getPartnerWithName(card) {
  const m = getOracleText(card).match(/\bPartner with ([^(\n]+)/i);
  return m ? m[1].trim() : null;
}

function isLegalCommander(card) {
  if (card.legalities?.commander !== 'legal') return false;
  const tl = getTypeLine(card);
  const oracle = getOracleText(card);
  if (tl.includes('Background')) return false;
  if (tl.includes('Legendary') && tl.includes('Creature')) return true;
  if (oracle.includes('can be your commander')) return true;
  if (getPartnerType(card) === 'doctors-companion') return true;
  const pt = getPartnerType(card);
  if (tl.includes('Legendary') && tl.includes('Planeswalker') && (pt === 'partner' || pt === 'friends-forever')) return true;
  return false;
}

function fitsColorIdentity(cmdColors, cardColors) {
  return cardColors.every(c => cmdColors.includes(c));
}

function findPartnerCandidates(cards) {
  const seen = new Set();
  const results = [];
  for (const oc of cards) {
    if (oc.card.legalities?.commander !== 'legal') continue;
    const tl = getTypeLine(oc.card);
    if (!tl.includes('Legendary') || !tl.includes('Background')) continue;
    const key = oc.card.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({
      name: oc.card.name,
      imageUrl: getCardImageUrl(oc.card, 'normal'),
      imageUrlBack: getCardBackImageUrl(oc.card, 'normal'),
      oracleText: getOracleText(oc.card),
      colorIdentity: oc.card.color_identity,
      typeLine: tl,
      partnerType: getPartnerType(oc.card),
    });
  }
  return results;
}

const COLOR_ORDER = ['W','U','B','R','G'];

function buildPairResults(scores, cards) {
  const pairs = [], pairedNames = new Set(), seen = new Set();
  const deduped = [], ds = new Set();
  for (const s of scores) { const k = s.name.toLowerCase(); if (!ds.has(k)) { ds.add(k); deduped.push(s); } }
  for (let i = 0; i < deduped.length; i++) {
    for (let j = i + 1; j < deduped.length; j++) {
      const a = deduped[i], b = deduped[j];
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
      const pairValidCount = cards.filter(oc =>
        oc.card.legalities?.commander === 'legal' &&
        oc.card.name.toLowerCase() !== a.name.toLowerCase() &&
        oc.card.name.toLowerCase() !== b.name.toLowerCase() &&
        fitsColorIdentity(combinedColors, oc.card.color_identity)
      ).length;
      pairs.push({
        name: a.name, colorIdentity: combinedColors,
        matchCount: Math.round((a.matchCount + b.matchCount) / 2),
        validCardCount: pairValidCount,
        matchPercent: Math.round((a.matchPercent + b.matchPercent) / 2),
        edhrecUrl: a.edhrecUrl, imageUrl: a.imageUrl, imageUrlBack: a.imageUrlBack,
        oracleText: a.oracleText, partnerType: a.partnerType, partnerWith: a.partnerWith,
        partner: { name: b.name, imageUrl: b.imageUrl, imageUrlBack: b.imageUrlBack, oracleText: b.oracleText, colorIdentity: b.colorIdentity },
      });
    }
  }
  return { pairs, pairedNames };
}

// Commander scoring
async function scoreCommander(commander, allOwned) {
  const edhrecCards = await fetchCommanderData(commander.name);
  const edhrecNames = new Set(edhrecCards.map(c => c.name.toLowerCase()));
  const validOwned = allOwned.filter(oc =>
    oc.card.legalities?.commander === 'legal' &&
    oc.card.id !== commander.id &&
    fitsColorIdentity(commander.color_identity, oc.card.color_identity)
  );
  const matchingOwned = validOwned.filter(oc => edhrecNames.has(oc.card.name.toLowerCase()));
  const denominator = Math.min(99, edhrecCards.length);
  return {
    name: commander.name,
    colorIdentity: commander.color_identity,
    matchCount: matchingOwned.length,
    validCardCount: validOwned.length,
    matchPercent: denominator > 0 ? Math.round((matchingOwned.length / denominator) * 100) : 0,
    edhrecUrl: edhrecCommanderUrl(commander.name),
    imageUrl: getCardImageUrl(commander, 'normal'),
    imageUrlBack: getCardBackImageUrl(commander, 'normal'),
    oracleText: getOracleText(commander),
    partnerType: getPartnerType(commander),
    partnerWith: getPartnerWithName(commander),
  };
}

// Deck building
const BASIC_LAND_NAMES = new Set(['plains','island','swamp','mountain','forest','wastes',
  'snow-covered plains','snow-covered island','snow-covered swamp','snow-covered mountain','snow-covered forest']);
const LAND_CARE_RE = /landfall|whenever a land|land enters|sacrifice a land|land card|search your library for a.*land|domain/i;
const MANA_SRC_RE  = /\{T\}[^.]*Add|\bAdd\s+\{[WUBRGC2]/;
const MANA_COLORS  = new Set(['W','U','B','R','G']);
const COLOR_BASICS = { W:['plains','snow-covered plains'], U:['island','snow-covered island'], B:['swamp','snow-covered swamp'], R:['mountain','snow-covered mountain'], G:['forest','snow-covered forest'] };
const STD_BASICS   = new Set(['plains','island','swamp','mountain','forest']);

function isBasicLand(card) { return getTypeLine(card).includes('Basic Land') || BASIC_LAND_NAMES.has(card.name.toLowerCase()); }
function caresAboutLands(card) { return LAND_CARE_RE.test(getOracleText(card)); }
function isNonLandManaSource(card) { return !getTypeLine(card).includes('Land') && MANA_SRC_RE.test(getOracleText(card)); }

function calculateTargetLands(commanders, ownedNonLands) {
  const sample = ownedNonLands.slice(0, 61);
  const landCaring = sample.filter(oc => caresAboutLands(oc.card)).length;
  const manaSrc    = sample.filter(oc => isNonLandManaSource(oc.card)).length;
  let target = 39;
  if (commanders.some(c => caresAboutLands(c))) target += 3;
  else if (landCaring >= 5) target += Math.min(Math.floor(landCaring / 3), 4);
  target -= Math.floor(manaSrc / 3);
  return Math.max(35, Math.min(100 - commanders.length, target));
}

function buildBasicPool(ownedLands) {
  const pool = new Map();
  for (const oc of ownedLands) {
    if (!isBasicLand(oc.card)) continue;
    const key = oc.card.name.toLowerCase();
    const e = pool.get(key);
    if (e) e.qty += oc.quantity; else pool.set(key, { card: oc.card, qty: oc.quantity });
  }
  for (const [key, e] of pool) if (STD_BASICS.has(key)) e.qty = 99;
  return pool;
}

function capBasicRatio(alloc, maxRatio) {
  const result = { ...alloc };
  const colors = Object.keys(result);
  if (colors.length <= 1) return result;
  for (let iter = 0; iter < 200; iter++) {
    let minV = Infinity, maxV = -Infinity, minC = '', maxC = '';
    for (const c of colors) {
      if (result[c] < minV) { minV = result[c]; minC = c; }
      if (result[c] > maxV) { maxV = result[c]; maxC = c; }
    }
    if (maxV <= maxRatio * minV) break;
    result[maxC]--; result[minC]++;
  }
  return result;
}

function roundToIntegers(values, target) {
  const entries = Object.entries(values).map(([k, v]) => ({ k, floor: Math.floor(v), frac: v % 1 }));
  const rem = target - entries.reduce((s, e) => s + e.floor, 0);
  entries.sort((a, b) => b.frac - a.frac);
  const result = {};
  entries.forEach((e, i) => { result[e.k] = e.floor + (i < rem ? 1 : 0); });
  return result;
}

function buildProportionalBasics(slots, cmdColors, basicPool, selectedNonLands, edhrecMap) {
  if (slots <= 0) return [];
  const colors = cmdColors.filter(c => MANA_COLORS.has(c));
  if (colors.length === 0) {
    const w = basicPool.get('wastes');
    return w ? [makeDeckCard(w.card, Math.min(w.qty, slots), edhrecMap)] : [];
  }
  const counts = {};
  for (const c of colors) counts[c] = 0;
  for (const dc of selectedNonLands) for (const c of dc.colorIdentity) if (c in counts) counts[c]++;
  const total = Object.values(counts).reduce((s, n) => s + n, 0);
  if (total === 0) for (const c of colors) counts[c] = 1;
  const wt = Object.values(counts).reduce((s, n) => s + n, 0);
  const raw = {};
  for (const c of colors) raw[c] = (counts[c] / wt) * slots;
  const alloc = capBasicRatio(roundToIntegers(raw, slots), 2);
  const result = [];
  for (const color of colors) {
    let rem = alloc[color];
    for (const name of COLOR_BASICS[color]) {
      if (rem <= 0) break;
      const e = basicPool.get(name);
      if (!e || e.qty <= 0) continue;
      const qty = Math.min(e.qty, rem);
      result.push(makeDeckCard(e.card, qty, edhrecMap));
      rem -= qty;
    }
  }
  return result;
}

function makeDeckCard(card, qty, edhrecMap) {
  const rec = edhrecMap.get(card.name.toLowerCase());
  return {
    name: card.name, quantity: qty,
    typeLine: getTypeLine(card), colorIdentity: card.color_identity,
    imageUrl: getCardImageUrl(card, 'small'), imageUrlBack: getCardBackImageUrl(card, 'small'),
    edhrecRank: rec?.rank, isRecommended: rec !== undefined,
    isGameChanger: rec?.isGameChanger ?? false, inclusion: rec?.inclusion,
  };
}

async function buildDeck(commander, allOwned, partner, gcLimit = 'unlimited', targetLandsOverride) {
  const deckSize = partner ? 98 : 99;
  const combinedColors = partner
    ? [...new Set([...commander.color_identity, ...partner.color_identity])]
    : commander.color_identity;

  const edhrecCards = await fetchCommanderData(commander.name, partner?.name);
  const edhrecMap = new Map(edhrecCards.map(c => [c.name.toLowerCase(), c]));

  const validOwned = allOwned.filter(oc =>
    oc.card.legalities?.commander === 'legal' &&
    oc.card.id !== commander.id &&
    (!partner || oc.card.id !== partner.id) &&
    fitsColorIdentity(combinedColors, oc.card.color_identity)
  );
  const edhrecSort = (a, b) => {
    const ar = edhrecMap.get(a.card.name.toLowerCase()), br = edhrecMap.get(b.card.name.toLowerCase());
    if (ar && !br) return -1; if (!ar && br) return 1;
    if (ar && br) return ar.rank - br.rank;
    return (a.card.cmc ?? 0) - (b.card.cmc ?? 0);
  };
  const ownedLands    = validOwned.filter(oc =>  getTypeLine(oc.card).includes('Land')).sort(edhrecSort);
  const ownedNonLands = validOwned.filter(oc => !getTypeLine(oc.card).includes('Land')).sort(edhrecSort);

  const fetchedBasics = await fetchBasicLands();
  const ownedBasicNames = new Set(ownedLands.filter(oc => isBasicLand(oc.card)).map(oc => oc.card.name.toLowerCase()));
  for (const basic of fetchedBasics) {
    if (!ownedBasicNames.has(basic.card.name.toLowerCase()) && fitsColorIdentity(combinedColors, basic.card.color_identity))
      ownedLands.push({ ...basic });
  }

  const targetLandsVal = targetLandsOverride !== undefined
    ? Math.max(0, Math.min(deckSize, targetLandsOverride))
    : calculateTargetLands([commander, ...(partner ? [partner] : [])], ownedNonLands);
  const nonLandSlots = deckSize - targetLandsVal;

  const deckCards = [], usedNames = new Set();
  const gcMax = gcLimit === 'none' ? 0 : gcLimit === 'max3' ? 3 : Infinity;
  let gcCount = 0;

  for (const oc of ownedNonLands) {
    if (deckCards.length >= nonLandSlots) break;
    const nl = oc.card.name.toLowerCase();
    if (usedNames.has(nl)) continue;
    const rec = edhrecMap.get(nl);
    if (rec?.isGameChanger && gcCount >= gcMax) continue;
    usedNames.add(nl);
    const dc = makeDeckCard(oc.card, 1, edhrecMap);
    deckCards.push(dc);
    if (dc.isGameChanger) gcCount++;
  }

  const selectedNonLands = [...deckCards];
  const totalLandSlots = deckSize - deckCards.length;
  const nonBasicCap = Math.ceil(totalLandSlots * 0.55);
  let nonBasicFilled = 0;
  for (const oc of ownedLands) {
    if (nonBasicFilled >= nonBasicCap) break;
    if (isBasicLand(oc.card)) continue;
    const nl = oc.card.name.toLowerCase();
    if (usedNames.has(nl)) continue;
    usedNames.add(nl);
    deckCards.push(makeDeckCard(oc.card, 1, edhrecMap));
    nonBasicFilled++;
  }

  const basicPool  = buildBasicPool(ownedLands);
  const basicCards = buildProportionalBasics(deckSize - deckCards.length, combinedColors, basicPool, selectedNonLands, edhrecMap);
  deckCards.push(...basicCards);

  const cardCount = deckCards.reduce((s, c) => s + c.quantity, 0);
  return {
    commander: { name: commander.name, imageUrl: getCardImageUrl(commander, 'normal'), imageUrlBack: getCardBackImageUrl(commander, 'normal'), colorIdentity: commander.color_identity, oracleText: getOracleText(commander) },
    partner: partner ? { name: partner.name, imageUrl: getCardImageUrl(partner, 'normal'), imageUrlBack: getCardBackImageUrl(partner, 'normal'), colorIdentity: partner.color_identity, oracleText: getOracleText(partner) } : undefined,
    cards: deckCards,
    totalCards: (partner ? 2 : 1) + cardCount,
    slotsRemaining: deckSize - cardCount,
    targetLands: targetLandsVal,
    deckSize,
  };
}
