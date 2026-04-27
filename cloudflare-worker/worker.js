// Cloudflare Worker — EDHRec CORS proxy
// Deploy at: https://dash.cloudflare.com → Workers & Pages → Create Worker
// Paste this file, deploy, then copy the worker URL into docs/index.html (EDHREC_PROXY).

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const target = `https://json.edhrec.com${url.pathname}${url.search}`;

    const response = await fetch(target, {
      headers: { 'User-Agent': 'commander-forge/1.0' },
    });

    const body = await response.arrayBuffer();
    return new Response(body, {
      status: response.status,
      headers: {
        'Content-Type': response.headers.get('Content-Type') ?? 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  },
};
