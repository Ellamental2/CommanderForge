const EDHREC_PROXY = 'https://noisy-bonus-e3ba.ellammalle-1994.workers.dev';

function toEdhrecSlug(name) {
  return name.toLowerCase()
    .replace(/[',\.!]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function edhrecCommanderUrl(name) {
  return `https://edhrec.com/commanders/${toEdhrecSlug(name)}`;
}

async function fetchCommanderData(commanderName, partnerName) {
  const slug = toEdhrecSlug(commanderName);
  const proxy = EDHREC_PROXY.replace(/\/$/, '');
  if (partnerName) {
    const partnerSlug = toEdhrecSlug(partnerName);
    const [s1, s2] = [slug, partnerSlug].sort();
    try {
      const pairRes = await fetch(`${proxy}/pages/commanders/${s1}-and-${s2}.json`);
      if (pairRes.ok) return parseEdhrecResponse(await pairRes.json());
    } catch (_) { /* fall through */ }
    const [a, b] = await Promise.all([fetchSingleCommander(slug), fetchSingleCommander(partnerSlug)]);
    return mergeEdhrecResults(a, b);
  }
  return fetchSingleCommander(slug);
}

async function fetchSingleCommander(slug) {
  const proxy = EDHREC_PROXY.replace(/\/$/, '');
  try {
    const res = await fetch(`${proxy}/pages/commanders/${slug}.json`);
    if (!res.ok) {
      const bgRes = await fetch(`${proxy}/pages/commanders/${slug}-background.json`);
      if (!bgRes.ok) return [];
      return parseEdhrecResponse(await bgRes.json());
    }
    return parseEdhrecResponse(await res.json());
  } catch (_) { return []; }
}

function mergeEdhrecResults(a, b) {
  const merged = new Map();
  for (const card of [...a, ...b]) {
    const key = card.name.toLowerCase();
    const ex = merged.get(key);
    if (!ex || card.inclusion > ex.inclusion) merged.set(key, card);
  }
  return [...merged.values()]
    .sort((x, y) => y.inclusion - x.inclusion)
    .map((card, i) => ({ ...card, rank: i }));
}

function parseEdhrecResponse(data) {
  const cardlists = data?.container?.json_dict?.cardlists ?? [];
  const cards = [];
  let rank = 0;
  for (const list of cardlists) {
    const isGC = list.tag === 'gamechangers';
    for (const view of list.cardviews ?? []) {
      if (Array.isArray(view)) {
        for (const v of view) {
          if (v?.name) cards.push({ name: v.name, inclusion: v.inclusion ?? 0, synergy: v.synergy ?? 0, rank: rank++, isGameChanger: isGC });
        }
      } else if (view?.name) {
        cards.push({ name: view.name, inclusion: view.inclusion ?? 0, synergy: view.synergy ?? 0, rank: rank++, isGameChanger: isGC });
      }
    }
  }
  return cards;
}
