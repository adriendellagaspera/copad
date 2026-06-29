// TURN credential-minting endpoint for Copad (TURN REST API / coturn use-auth-secret).
//
// WHY: with static VITE_TURN_CREDENTIAL the secret is baked into the public client
// bundle and never expires (see turn/README.md). This endpoint keeps the secret
// server-side and hands the browser only a short-lived, derived credential. coturn
// validates it by recomputing the same HMAC — no shared state, no database.
//
// DEPLOY (Cloudflare Workers shown; any edge/serverless runtime with Web Crypto works):
//   1. coturn (turnserver.conf): replace `lt-cred-mech` + `user=` with
//        use-auth-secret
//        static-auth-secret=<LONG_RANDOM>     # the SAME value as TURN_SECRET below
//   2. Deploy this worker with secrets/vars:
//        TURN_SECRET = <LONG_RANDOM>          # never exposed to the browser
//        TURN_URLS   = turns:your-domain:5349 # comma-separated TURN URL(s)
//        TURN_TTL    = 3600                    # optional, seconds (default 3600)
//        ALLOW_ORIGIN= https://your-copad-app # optional, CORS allow-origin (default *)
//   3. Point Copad at it: VITE_TURN_AUTH_URL=https://<worker-host>/
//
// Response shape (parsed by parseTurnCredentialsResponse in src/collaboration/parse.ts):
//   { "urls": ["turns:your-domain:5349"], "username": "<expiry>:copad",
//     "credential": "<base64 hmac>", "ttl": 3600 }

const DEFAULT_TTL = 3600;

async function mintCredentials(env) {
  const ttl = Number(env.TURN_TTL) > 0 ? Number(env.TURN_TTL) : DEFAULT_TTL;
  const urls = (env.TURN_URLS || '')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);

  // TURN REST API: username is "<unix-expiry>:<label>", credential is the
  // base64 HMAC-SHA1 of that username keyed by the shared secret.
  const expiry = Math.floor(Date.now() / 1000) + ttl;
  const username = `${expiry}:copad`;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.TURN_SECRET),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(username));
  const credential = btoa(String.fromCharCode(...new Uint8Array(mac)));

  return { urls, username, credential, ttl };
}

function corsHeaders(env) {
  return {
    'content-type': 'application/json',
    'access-control-allow-origin': env.ALLOW_ORIGIN || '*',
    'access-control-allow-methods': 'GET, OPTIONS',
    // Don't let a shared cache serve one user's (still short-lived) credential to
    // everyone; each request mints a fresh one.
    'cache-control': 'no-store',
  };
}

export default {
  async fetch(request, env) {
    const headers = corsHeaders(env);
    if (request.method === 'OPTIONS') return new Response(null, { headers });
    if (request.method !== 'GET') {
      return new Response(JSON.stringify({ error: 'method not allowed' }), { status: 405, headers });
    }
    if (!env.TURN_SECRET || !env.TURN_URLS) {
      return new Response(JSON.stringify({ error: 'server not configured' }), { status: 500, headers });
    }
    const body = await mintCredentials(env);
    return new Response(JSON.stringify(body), { headers });
  },
};
