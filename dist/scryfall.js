"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchCardsBatch = fetchCardsBatch;
exports.getCardImageUrl = getCardImageUrl;
exports.getCardBackImageUrl = getCardBackImageUrl;
const node_fetch_1 = __importDefault(require("node-fetch"));
const SCRYFALL_BASE = 'https://api.scryfall.com';
const BATCH_SIZE = 75;
const RATE_LIMIT_MS = 120; // Scryfall asks for ~100ms between requests
/** Delay helper */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
/**
 * Fetch all cards from a ParsedCard list using Scryfall's /cards/collection endpoint.
 * Batches requests to stay within the 75-card limit per call.
 */
async function fetchCardsBatch(parsedCards) {
    const results = [];
    const notFound = [];
    for (let i = 0; i < parsedCards.length; i += BATCH_SIZE) {
        const chunk = parsedCards.slice(i, i + BATCH_SIZE);
        const identifiers = chunk.map(c => {
            if (c.set && c.collectorNumber) {
                return { set: c.set.toLowerCase(), collector_number: c.collectorNumber };
            }
            return { name: c.name };
        });
        const response = await (0, node_fetch_1.default)(`${SCRYFALL_BASE}/cards/collection`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identifiers }),
        });
        if (!response.ok) {
            console.error(`Scryfall batch error: ${response.status}`);
            continue;
        }
        const data = (await response.json());
        for (const scryfallCard of data.data) {
            // Match back to original parsed card to retrieve quantity
            const original = chunk.find(c => {
                if (c.set && c.collectorNumber) {
                    return (c.set.toLowerCase() === scryfallCard.set.toLowerCase() &&
                        c.collectorNumber === scryfallCard.collector_number);
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
/** Get a card image URL, handling double-faced cards */
function getCardImageUrl(card, size = 'normal') {
    if (card.image_uris)
        return card.image_uris[size] ?? null;
    if (card.card_faces?.[0]?.image_uris)
        return card.card_faces[0].image_uris[size] ?? null;
    return null;
}
/** Get the back face image URL for double-faced cards; null for single-faced cards */
function getCardBackImageUrl(card, size = 'normal') {
    if (card.card_faces?.[1]?.image_uris)
        return card.card_faces[1].image_uris[size] ?? null;
    return null;
}
