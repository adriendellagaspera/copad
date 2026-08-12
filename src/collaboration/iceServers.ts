// The endpoint (`deploy/ice-worker/`) exists because providers like Cloudflare
// mint short-lived TURN credentials from a secret token that must stay off the
// browser. Empty list on failure: callers fall back to the static ICE config.

import type { IceServer, IceServersUrl } from './types.js';
import { parseIceServersResponse } from './parse.js';
import { ICE_FETCH_TIMEOUT_MS } from './constants.js';

export async function fetchIceServers(url: IceServersUrl): Promise<IceServer[]> {
  try {
    const res = await fetch(url as string, {
      signal: AbortSignal.timeout(ICE_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const body: unknown = await res.json();
    return parseIceServersResponse(body);
  } catch {
    return [];
  }
}
