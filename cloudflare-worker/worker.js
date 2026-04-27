// Cloudflare Worker — EDHRec CORS proxy
// Deploy at: https://dash.cloudflare.com → Workers & Pages → Create Worker
// Paste this file, deploy, then copy the worker URL into docs/index.html (EDHREC_PROXY).

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const target = `https://json.edhrec.com${url.pathname}${url.search}`;

    const response = await fetch(target, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://edhrec.com/',
        'Origin': 'https://edhrec.com',
      },
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
