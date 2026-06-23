const PROXY = (import.meta.env.VITE_PROXY_URL ?? '').replace(/\/$/, '');

export const hasProxy = !!PROXY;

/** Fetch wrapper that forwards the request through the CORS proxy when configured. */
export function netFetch(url: string, init: RequestInit = {}): Promise<Response> {
  if (!PROXY) return fetch(url, init);
  const headers = new Headers(init.headers);
  headers.set('x-target-url', url);
  return fetch(`${PROXY}/__proxy`, { ...init, headers });
}
