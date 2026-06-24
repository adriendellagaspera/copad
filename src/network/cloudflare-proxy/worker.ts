/**
 * Generic CORS proxy for Copad.
 *
 * Forwards requests to the URL in `x-target-url`.
 * Set ALLOWED_HOSTS (comma-separated suffix list) in wrangler.toml / secrets
 * to prevent this from being used as an open relay.
 *
 * Route: /__proxy  (GET, POST, PUT, DELETE, HEAD, PROPFIND)
 */

interface Env {
  ALLOWED_HOSTS?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== '/__proxy') {
      return new Response('Not found', { status: 404 });
    }

    const target = request.headers.get('x-target-url');
    if (!target) {
      return new Response('Missing x-target-url header', { status: 400 });
    }

    const allowed = (env.ALLOWED_HOSTS ?? '').split(',').map(h => h.trim()).filter(Boolean);
    if (allowed.length > 0) {
      const targetHost = new URL(target).hostname;
      const ok = allowed.some(suffix => targetHost === suffix || targetHost.endsWith(`.${suffix}`));
      if (!ok) return new Response('Host not allowed', { status: 403 });
    }

    const headers = new Headers(request.headers);
    headers.delete('x-target-url');
    headers.delete('origin');

    const proxied = await fetch(target, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
    });

    const responseHeaders = new Headers(proxied.headers);
    responseHeaders.set('Access-Control-Allow-Origin', '*');
    responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, HEAD, PROPFIND, OPTIONS');
    responseHeaders.set('Access-Control-Allow-Headers', '*');

    return new Response(proxied.body, {
      status: proxied.status,
      headers: responseHeaders,
    });
  },
} satisfies ExportedHandler<Env>;
