// Optional shared CORS proxy (your Cloudflare Worker). When VITE_PROXY_URL is set,
// requests are tunnelled through it: the real target goes in the `x-target-url`
// header and the worker echoes CORS headers back. Needed for backends whose servers
// don't send CORS headers themselves (WebDAV/Nextcloud, pCloud content hosts).
const PROXY = (import.meta.env.VITE_PROXY_URL || "").replace(/\/$/, "");

export const hasProxy = !!PROXY;

export function netFetch(url: string, init: RequestInit = {}): Promise<Response> {
  if (!PROXY) return fetch(url, init);
  const headers = new Headers(init.headers);
  headers.set("x-target-url", url);
  return fetch(`${PROXY}/__proxy`, { ...init, headers });
}
