function parseCardList(content) {
  const lines = content
    .split('\n')
    .map(l => l.trim().replace(/\s+\*\w+\*(\s+\*\w+\*)*$/, ''))
    .filter(l => l.length > 0 && !l.startsWith('//') && !l.startsWith('#'));
  const cards = [];
  for (const line of lines) {
    const arenaMatch = line.match(/^(\d+)\s+(.+?)\s+\(([A-Z0-9]+)\)\s+(\S+).*$/i);
    if (arenaMatch) {
      cards.push({ quantity: parseInt(arenaMatch[1], 10), name: arenaMatch[2].trim(), set: arenaMatch[3].toUpperCase(), collectorNumber: arenaMatch[4] });
      continue;
    }
    const qtyMatch = line.match(/^(\d+)\s+(.+)$/);
    if (qtyMatch) {
      cards.push({ quantity: parseInt(qtyMatch[1], 10), name: qtyMatch[2].trim(), set: '', collectorNumber: '' });
      continue;
    }
    cards.push({ quantity: 1, name: line.trim(), set: '', collectorNumber: '' });
  }
  return cards;
}
