import { ParsedCard } from './types';

/**
 * Parses a card list where each line is in Arena/MTGO export format:
 *   2 Sure Strike (FDN) 209
 *   1 Lightning Bolt (M11) 149
 *
 * Also handles simpler formats:
 *   1 Lightning Bolt
 *   Lightning Bolt
 */
export function parseCardList(content: string): ParsedCard[] {
  const lines = content
    .split('\n')
    .map(l => l.trim().replace(/\s+\*\w+\*(\s+\*\w+\*)*$/, ''))
    .filter(l => l.length > 0 && !l.startsWith('//') && !l.startsWith('#'));

  const cards: ParsedCard[] = [];

  for (const line of lines) {
    // Full Arena format: "2 Sure Strike (FDN) 209" or "2 Sure Strike (FDN) 209 *F*"
    const arenaMatch = line.match(/^(\d+)\s+(.+?)\s+\(([A-Z0-9]+)\)\s+(\d+[a-z]?)(?:\s+\*\w+\*)*$/i);
    if (arenaMatch) {
      cards.push({
        quantity: parseInt(arenaMatch[1], 10),
        name: arenaMatch[2].trim(),
        set: arenaMatch[3].toUpperCase(),
        collectorNumber: arenaMatch[4],
      });
      continue;
    }

    // With quantity but no set: "2 Lightning Bolt"
    const qtyMatch = line.match(/^(\d+)\s+(.+)$/);
    if (qtyMatch) {
      cards.push({
        quantity: parseInt(qtyMatch[1], 10),
        name: qtyMatch[2].trim(),
        set: '',
        collectorNumber: '',
      });
      continue;
    }

    // Just a name: "Lightning Bolt"
    cards.push({
      quantity: 1,
      name: line.trim(),
      set: '',
      collectorNumber: '',
    });
  }

  return cards;
}
