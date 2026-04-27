"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.toEdhrecSlug = toEdhrecSlug;
exports.edhrecCommanderUrl = edhrecCommanderUrl;
exports.fetchCommanderData = fetchCommanderData;
const node_fetch_1 = __importDefault(require("node-fetch"));
const EDHREC_BASE = 'https://json.edhrec.com';
/** Convert a card name to the slug EDHRec uses in its URLs */
function toEdhrecSlug(name) {
    return name
        .toLowerCase()
        .replace(/[',\.\!]/g, '') // remove punctuation
        .replace(/\s+/g, '-') // spaces → hyphens
        .replace(/[^a-z0-9-]/g, '') // strip anything else
        .replace(/-+/g, '-') // collapse double hyphens
        .replace(/^-|-$/g, ''); // trim leading/trailing hyphens
}
function edhrecCommanderUrl(name) {
    return `https://edhrec.com/commanders/${toEdhrecSlug(name)}`;
}
/**
 * Fetches the EDHRec recommendation list for a given commander.
 * Returns an empty array on any failure (network error, 404, unexpected shape).
 */
async function fetchCommanderData(commanderName, partnerName) {
    const slug = toEdhrecSlug(commanderName);
    // For partner pairs, try the combined EDHRec page first (slugs sorted alphabetically)
    if (partnerName) {
        const partnerSlug = toEdhrecSlug(partnerName);
        const [s1, s2] = [slug, partnerSlug].sort();
        const pairUrl = `${EDHREC_BASE}/pages/commanders/${s1}-and-${s2}.json`;
        try {
            const pairRes = await (0, node_fetch_1.default)(pairUrl, { headers: { 'User-Agent': 'mtg-deck-builder/1.0' } });
            if (pairRes.ok)
                return parseEdhrecResponse(await pairRes.json());
        }
        catch { /* fall through to individual commander */ }
    }
    const url = `${EDHREC_BASE}/pages/commanders/${slug}.json`;
    try {
        const response = await (0, node_fetch_1.default)(url, {
            headers: { 'User-Agent': 'mtg-deck-builder/1.0' },
        });
        if (!response.ok) {
            // Try the background (partner) variant path
            const bgUrl = `${EDHREC_BASE}/pages/commanders/${slug}-background.json`;
            const bgRes = await (0, node_fetch_1.default)(bgUrl, { headers: { 'User-Agent': 'mtg-deck-builder/1.0' } });
            if (!bgRes.ok)
                return [];
            return parseEdhrecResponse(await bgRes.json());
        }
        return parseEdhrecResponse(await response.json());
    }
    catch {
        return [];
    }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseEdhrecResponse(data) {
    const cardlists = data?.container?.json_dict?.cardlists ?? [];
    const cards = [];
    let rank = 0;
    for (const list of cardlists) {
        const isGameChangerList = list.tag === 'gamechangers';
        for (const view of list.cardviews ?? []) {
            // cardviews entries can be either a card object or an array of card objects (sub-groups)
            if (Array.isArray(view)) {
                for (const subview of view) {
                    if (subview?.name) {
                        cards.push({
                            name: subview.name,
                            inclusion: subview.inclusion ?? 0,
                            synergy: subview.synergy ?? 0,
                            rank: rank++,
                            isGameChanger: isGameChangerList,
                        });
                    }
                }
            }
            else {
                const v = view;
                if (v?.name) {
                    cards.push({
                        name: v.name,
                        inclusion: v.inclusion ?? 0,
                        synergy: v.synergy ?? 0,
                        rank: rank++,
                        isGameChanger: isGameChangerList,
                    });
                }
            }
        }
    }
    return cards;
}
