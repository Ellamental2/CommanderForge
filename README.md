# Commander Forge 🃏

An EDHRec-powered Commander deck builder that analyses your card collection and suggests the strongest commanders you can build around — using only cards you own.

## Features

- **Parses Arena/MTGO export format** — `2 Sure Strike (FDN) 209`
- **Scryfall integration** — fetches full card data in batches (colour identity, legality, type)
- **EDHRec scoring** — for each potential commander, checks how many of your cards appear in EDHRec's recommended list
- **Smart deck builder** — once you select a commander, builds the best 100-card deck from your collection, prioritised by EDHRec inclusion rate
- **Hover previews** — hover any card in the deck list to see its art

## Setup

**Prerequisites:** Node.js 18+

```bash
npm install
```

## Running

```bash
# Development (with hot reload via ts-node)
npm run dev

# Or build then run
npm run build
npm start
```

Then open **http://localhost:3000** in your browser.

## Card List Format

Each line should be in Arena/MTGO export format:

```
2 Sure Strike (FDN) 209
1 Atraxa, Praetors' Voice (2X2) 196
4 Plains (BFZ) 250
```

You can also use simpler formats:
```
1 Lightning Bolt
Lightning Bolt
```

## How It Works

1. **Parse** — your card list is parsed into `{quantity, name, set, collectorNumber}` entries
2. **Scryfall** — cards are fetched in batches of 75 via `/cards/collection` to get colour identity, type line, and legality
3. **Commander detection** — cards that are legendary creatures (or have "can be your commander") and are legal in Commander format are flagged as candidates
4. **EDHRec scoring** — for each candidate, the app fetches `json.edhrec.com/pages/commanders/[slug].json` and counts how many of your cards appear in the recommendation list
5. **Deck building** — cards are sorted by EDHRec inclusion rate, then filtered to the commander's colour identity, filling 99 slots (basic lands in multiples; everything else singleton)

## Notes

- EDHRec's API is unofficial and may change. The app handles failures gracefully (a commander with no EDHRec data will score 0%).
- Scryfall requests are rate-limited to ~120ms between batches as per their guidelines.
- Session data (card list) is cached in memory for 30 minutes so re-selecting a commander doesn't re-fetch from Scryfall.
