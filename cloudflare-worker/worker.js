// Generic CORS proxy for storage backends whose servers don't send CORS headers
// (WebDAV/Nextcloud, pCloud content hosts). Optional — Dropbox doesn't need it.
//
// Contract (see src/storage/net.ts): the app sends every request to
//   POST/GET/PUT <proxy>/__proxy   with header  x-target-url: <real URL>
// and the worker forwards method + body + headers (incl. Authorization) to that
// URL, echoing CORS headers back.
//
// SECURITY: this is a forward proxy. Restrict it with ALLOWED_HOSTS (see
// wrangler.toml) so it can't be abused as an open relay. Credentials you send
// (Basic auth / bearer tokens) transit this worker — only deploy your own.
//
// Deploy free:  cd cloudflare-worker && npx wrangler deploy
//   then point the app at it:  VITE_PROXY_URL=https://<your-worker>.workers.dev

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors(request) });
    }

    const url = new URL(request.url);
    if (url.pathname !== "/__proxy") {
      return new Response("not found", { status: 404, headers: cors(request) });
    }

    const target = request.headers.get("x-target-url");
    if (!target) {
      return new Response("missing x-target-url", {
        status: 400,
        headers: cors(request),
      });
    }

    if (!hostAllowed(target, env)) {
      return new Response("host not allowed", {
        status: 403,
        headers: cors(request),
      });
    }

    const fwd = new Headers(request.headers);
    fwd.delete("x-target-url");
    fwd.delete("host");
    fwd.delete("origin");
    fwd.delete("referer");

    const method = request.method;
    const body =
      method === "GET" || method === "HEAD"
        ? undefined
        : await request.arrayBuffer();

    const upstream = await fetch(target, { method, headers: fwd, body });

    const headers = new Headers(upstream.headers);
    for (const [k, v] of Object.entries(cors(request))) headers.set(k, v);
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  },
};

function hostAllowed(target, env) {
  const allow = (env.ALLOWED_HOSTS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (allow.length === 0) return true; // no allowlist configured → permissive
  let host;
  try {
    host = new URL(target).host;
  } catch {
    return false;
  }
  return allow.some((s) => host === s || host.endsWith("." + s));
}

function cors(request) {
  return {
    "Access-Control-Allow-Origin": request.headers.get("origin") || "*",
    "Access-Control-Allow-Methods":
      "GET, POST, PUT, DELETE, HEAD, PROPFIND, OPTIONS",
    "Access-Control-Allow-Headers":
      request.headers.get("access-control-request-headers") || "*",
    "Access-Control-Max-Age": "86400",
  };
}
