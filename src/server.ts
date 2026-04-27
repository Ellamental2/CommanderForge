import express, { Request, Response } from 'express';
import path from 'path';
import { parseCardList } from './parser';
import { fetchCardsBatch } from './scryfall';
import { isLegalCommander, scoreCommander, buildDeck } from './deckbuilder';
import { OwnedCard } from './types';

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '../public')));

// ── Simple in-memory session store ─────────────────────────────────────────
// Stores fetched Scryfall data so the build-deck endpoint doesn't re-fetch.

const sessions = new Map<string, { ownedCards: OwnedCard[]; createdAt: number }>();

// Prune sessions older than 30 minutes every 10 minutes
setInterval(() => {
  const cutoff = Date.now() - 30 * 60_000;
  for (const [id, session] of sessions.entries()) {
    if (session.createdAt < cutoff) sessions.delete(id);
  }
}, 10 * 60_000);

function newSessionId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// ── POST /api/analyze ──────────────────────────────────────────────────────
// Parse the card list, fetch Scryfall data, score all potential commanders.

app.post('/api/analyze', async (req: Request, res: Response): Promise<void> => {
  const { cardListContent } = req.body as { cardListContent?: string };

  if (!cardListContent || cardListContent.trim().length === 0) {
    res.status(400).json({ error: 'No card list provided.' });
    return;
  }

  try {
    const parsed = parseCardList(cardListContent);
    if (parsed.length === 0) {
      res.status(400).json({ error: 'Could not parse any cards from the provided list.' });
      return;
    }

    console.log(`Fetching ${parsed.length} card(s) from Scryfall…`);
    const ownedCards = await fetchCardsBatch(parsed);
    console.log(`Retrieved ${ownedCards.length} card(s).`);

    const commanders = ownedCards.filter(oc => isLegalCommander(oc.card));
    console.log(`Found ${commanders.length} potential commander(s). Scoring via EDHRec…`);

    const scores = [];
    for (const cmd of commanders) {
      const score = await scoreCommander(cmd.card, ownedCards);
      scores.push(score);
      // Be polite to EDHRec's servers
      await new Promise(r => setTimeout(r, 200));
    }

    scores.sort((a, b) => b.matchPercent - a.matchPercent);

    // Store card data for subsequent deck-build requests
    const sessionId = newSessionId();
    sessions.set(sessionId, { ownedCards, createdAt: Date.now() });

    res.json({
      sessionId,
      totalCards: ownedCards.length,
      commanderCount: commanders.length,
      commanders: scores,
    });
  } catch (err) {
    console.error('/api/analyze error:', err);
    res.status(500).json({ error: 'Analysis failed. Check server logs for details.' });
  }
});

// ── POST /api/build-deck ───────────────────────────────────────────────────
// Build a 100-card deck for the selected commander.

app.post('/api/build-deck', async (req: Request, res: Response): Promise<void> => {
  const { sessionId, commanderName } = req.body as {
    sessionId?: string;
    commanderName?: string;
  };

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
  const commanderOwned = ownedCards.find(
    oc => oc.card.name.toLowerCase() === commanderName.toLowerCase()
  );

  if (!commanderOwned) {
    res.status(404).json({ error: `Commander "${commanderName}" not found in your collection.` });
    return;
  }

  try {
    console.log(`Building deck for ${commanderName}…`);
    const deck = await buildDeck(commanderOwned.card, ownedCards);
    res.json(deck);
  } catch (err) {
    console.error('/api/build-deck error:', err);
    res.status(500).json({ error: 'Deck building failed. Check server logs for details.' });
  }
});

// ── Start ──────────────────────────────────────────────────────────────────

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
app.listen(PORT, () => {
  console.log(`\n🃏 MTG Deck Builder running at http://localhost:${PORT}\n`);
});
