// ── Core domain types ──────────────────────────────────────────────────────

export interface ParsedCard {
  quantity: number;
  name: string;
  set: string;
  collectorNumber: string;
}

export interface ScryfallCard {
  id: string;
  name: string;
  type_line: string;
  oracle_text?: string;
  color_identity: string[];
  colors?: string[];
  legalities: { commander: string };
  image_uris?: { small: string; normal: string; large: string };
  card_faces?: Array<{
    type_line?: string;
    oracle_text?: string;
    image_uris?: { small: string; normal: string; large: string };
  }>;
  set: string;
  collector_number: string;
  cmc: number;
  mana_cost?: string;
}

export interface OwnedCard {
  quantity: number;
  card: ScryfallCard;
}

// ── EDHRec types ───────────────────────────────────────────────────────────

export interface EdhrecCard {
  name: string;
  inclusion: number;   // % of decks that include it (0–100)
  synergy: number;     // synergy score vs. average
  rank: number;        // position in EDHRec recommendation list
  isGameChanger: boolean;
}

// ── Response shapes for the API ────────────────────────────────────────────

export type PartnerType =
  | 'partner'           // generic Partner keyword — pairs with any other 'partner'
  | 'friends-forever'   // Friends forever — pairs with any other 'friends-forever'
  | 'partner-with'      // Partner with X — pairs only with the named card
  | 'chooses-background'// Choose a Background — pairs with any 'background'
  | 'background'        // Background enchantment — pairs with any 'chooses-background'
  | 'doctors-companion' // Doctor's Companion — pairs with any legendary creature with the Doctor subtype
  | 'doctor'           // Legendary creature with Doctor subtype — pairs with any 'doctors-companion'
  | null;

export interface CommanderResult {
  name: string;
  colorIdentity: string[];
  matchCount: number;
  validCardCount: number;
  matchPercent: number;
  edhrecUrl: string;
  imageUrl: string | null;
  imageUrlBack: string | null;
  oracleText: string;
  partnerType: PartnerType;
  partnerWith: string | null; // only set when partnerType === 'partner-with'
  partner?: {
    name: string;
    imageUrl: string | null;
    imageUrlBack: string | null;
    oracleText: string;
    colorIdentity: string[];
  };
}

export interface DeckCard {
  name: string;
  quantity: number;
  typeLine: string;
  colorIdentity: string[];
  imageUrl: string | null;
  imageUrlBack: string | null;
  edhrecRank?: number;
  isRecommended: boolean;
  isGameChanger: boolean;
  inclusion?: number;
}

export interface CommanderInfo {
  name: string;
  imageUrl: string | null;
  imageUrlBack: string | null;
  colorIdentity: string[];
  oracleText: string;
}

export interface DeckResponse {
  commander: CommanderInfo;
  partner?: CommanderInfo;
  cards: DeckCard[];
  totalCards: number;
  slotsRemaining: number;
  targetLands: number;
  deckSize: number;
}
