import type { Fetch } from '../types.js';

export function proxiedFetch(proxyUrl: string): Fetch {
  const base = proxyUrl.replace(/\/$/, '');
  return (url, init = {}) => {
    const headers = new Headers(init.headers);
    headers.set('x-target-url', url);
    return fetch(`${base}/__proxy`, { ...init, headers });
  };
}
