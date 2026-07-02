/**
 * Copad ICE-credentials Worker (Cloudflare TURN).
 *
 * Cloudflare's TURN service does not hand out static credentials: you mint
 * short-lived ones from a *secret* API token, which must never reach the
 * browser. This Worker holds that token as a Cloudflare secret, mints fresh
 * `{ iceServers: [...] }` on each request, and returns it to the Copad frontend
 * (pointed here via VITE_ICE_SERVERS_URL). The browser only ever sees ephemeral
 * credentials; the API token stays server-side.
 *
 * Config (see wrangler.toml):
 *   Secret : TURN_API_TOKEN   — Cloudflare TURN API token (wrangler secret put)
 *   Var    : TURN_KEY_ID      — TURN key/token ID (semi-public; it's in the API path)
 *   Var    : TURN_TTL         — credential lifetime in seconds (default 86400)
 *   Var    : ALLOWED_ORIGIN   — CORS origin to allow (default "*"; set to your site)
 */

const CF_TURN_API = 'https://rtc.live.cloudflare.com/v1/turn/keys';

export default {
  async fetch(request, env) {
    const cors = {
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET') {
      return new Response('Method Not Allowed', { status: 405, headers: cors });
    }
    if (!env.TURN_API_TOKEN || !env.TURN_KEY_ID) {
      return new Response('Worker missing TURN_API_TOKEN / TURN_KEY_ID', { status: 500, headers: cors });
    }

    const ttl = Number(env.TURN_TTL) > 0 ? Number(env.TURN_TTL) : 86400;
    const upstream = await fetch(
      `${CF_TURN_API}/${env.TURN_KEY_ID}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.TURN_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ttl }),
      },
    );

    if (!upstream.ok) {
      return new Response('Failed to mint ICE credentials', { status: 502, headers: cors });
    }

    // Pass the { iceServers: [...] } body straight through; it's exactly the
    // shape Copad's parseIceServersResponse() expects. no-store so a CDN/browser
    // never caches short-lived credentials.
    const body = await upstream.text();
    return new Response(body, {
      headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  },
};
