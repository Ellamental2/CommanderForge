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
}

// ── Response shapes for the API ────────────────────────────────────────────

export interface CommanderResult {
  name: string;
  colorIdentity: string[];
  matchCount: number;
  validCardCount: number;
  matchPercent: number;
  edhrecUrl: string;
  imageUrl: string | null;
  oracleText: string;
}

export interface DeckCard {
  name: string;
  quantity: number;
  typeLine: string;
  colorIdentity: string[];
  imageUrl: string | null;
  edhrecRank?: number;
  isRecommended: boolean;
  inclusion?: number;
}

export interface DeckResponse {
  commander: {
    name: string;
    imageUrl: string | null;
    colorIdentity: string[];
    oracleText: string;
  };
  cards: DeckCard[];
  totalCards: number;
  slotsRemaining: number;
}
