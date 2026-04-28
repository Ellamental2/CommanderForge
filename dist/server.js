"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const path_1 = __importDefault(require("path"));
const parser_1 = require("./parser");
const scryfall_1 = require("./scryfall");
const deckbuilder_1 = require("./deckbuilder");
const app = (0, express_1.default)();
app.use(express_1.default.json({ limit: '2mb' }));
app.use(express_1.default.static(path_1.default.join(__dirname, '../public')));
// ── Simple in-memory session store ─────────────────────────────────────────
// Stores fetched Scryfall data so the build-deck endpoint doesn't re-fetch.
const sessions = new Map();
// Prune sessions older than 30 minutes every 10 minutes
setInterval(() => {
    const cutoff = Date.now() - 30 * 60000;
    for (const [id, session] of sessions.entries()) {
        if (session.createdAt < cutoff)
            sessions.delete(id);
    }
}, 10 * 60000);
function newSessionId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
}
// ── POST /api/analyze ──────────────────────────────────────────────────────
// Parse the card list, fetch Scryfall data, score all potential commanders.
app.post('/api/analyze', async (req, res) => {
    const { cardListContent } = req.body;
    if (!cardListContent || cardListContent.trim().length === 0) {
        res.status(400).json({ error: 'No card list provided.' });
        return;
    }
    try {
        const parsed = (0, parser_1.parseCardList)(cardListContent);
        if (parsed.length === 0) {
            res.status(400).json({ error: 'Could not parse any cards from the provided list.' });
            return;
        }
        console.log(`Fetching ${parsed.length} card(s) from Scryfall…`);
        const ownedCards = await (0, scryfall_1.fetchCardsBatch)(parsed);
        console.log(`Retrieved ${ownedCards.length} card(s).`);
        const commanders = ownedCards.filter(oc => (0, deckbuilder_1.isLegalCommander)(oc.card));
        console.log(`Found ${commanders.length} potential commander(s). Scoring via EDHRec…`);
        const scores = [];
        for (const cmd of commanders) {
            const score = await (0, deckbuilder_1.scoreCommander)(cmd.card, ownedCards);
            scores.push(score);
            // Be polite to EDHRec's servers
            await new Promise(r => setTimeout(r, 200));
        }
        scores.sort((a, b) => b.matchPercent - a.matchPercent);
        // Store card data for subsequent deck-build requests
        const partnerCandidates = (0, deckbuilder_1.findPartnerCandidates)(ownedCards);
        const sessionId = newSessionId();
        sessions.set(sessionId, { ownedCards, createdAt: Date.now() });
        res.json({
            sessionId,
            totalCards: ownedCards.length,
            commanderCount: commanders.length,
            commanders: scores,
            partnerCandidates,
        });
    }
    catch (err) {
        console.error('/api/analyze error:', err);
        res.status(500).json({ error: 'Analysis failed. Check server logs for details.' });
    }
});
// ── POST /api/build-deck ───────────────────────────────────────────────────
// Build a 100-card deck for the selected commander.
app.post('/api/build-deck', async (req, res) => {
    const { sessionId, commanderName, partnerName, gcLimit, targetLands } = req.body;
    if (!sessionId || !commanderName) {
        res.status(400).json({ error: 'sessionId and commanderName are required.' });
        return;
    }
    const session = sessions.get(sessionId);
    if (!session) {
        res.status(404).json({ error: 'Session not found or expired. Please re-analyse your card list.' });
        return;
    }
    const { ownedCards } = session;
    const commanderOwned = ownedCards.find(oc => oc.card.name.toLowerCase() === commanderName.toLowerCase());
    if (!commanderOwned) {
        res.status(404).json({ error: `Commander "${commanderName}" not found in your collection.` });
        return;
    }
    let partnerOwned;
    if (partnerName) {
        partnerOwned = ownedCards.find(oc => oc.card.name.toLowerCase() === partnerName.toLowerCase());
        if (!partnerOwned) {
            res.status(404).json({ error: `Partner "${partnerName}" not found in your collection.` });
            return;
        }
        if (!(0, deckbuilder_1.isValidPartnerPair)(commanderOwned.card, partnerOwned.card)) {
            res.status(400).json({ error: `"${commanderName}" and "${partnerName}" are not a valid partner pair.` });
            return;
        }
    }
    try {
        const label = partnerName ? `${commanderName} + ${partnerName}` : commanderName;
        console.log(`Building deck for ${label}…`);
        const deck = await (0, deckbuilder_1.buildDeck)(commanderOwned.card, ownedCards, partnerOwned?.card, gcLimit ?? 'unlimited', typeof targetLands === 'number' ? targetLands : undefined);
        res.json(deck);
    }
    catch (err) {
        console.error('/api/build-deck error:', err);
        res.status(500).json({ error: 'Deck building failed. Check server logs for details.' });
    }
});
// ── Start ──────────────────────────────────────────────────────────────────
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
app.listen(PORT, () => {
    console.log(`\n🃏 MTG Deck Builder running at http://localhost:${PORT}\n`);
});
