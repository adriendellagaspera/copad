// Fetch dynamic ICE servers from an HTTP endpoint.
//
// Some TURN providers (notably Cloudflare) don't hand out a static username /
// password: you mint short-lived credentials from a *secret* API token, which
// must never reach the browser. The pattern is a tiny server-side endpoint (a
// Cloudflare Worker, see `deploy/ice-worker/`) that holds the API token and
// returns freshly-minted `{ iceServers: [...] }` JSON. This module fetches from
// that endpoint; `App.svelte` uses the result in place of the static VITE_TURN_*
// config when `VITE_ICE_SERVERS_URL` is set.
//
// Failures are swallowed to an empty list: a missing/slow/broken endpoint must
// degrade to the env/public-default ICE path, never break the app.

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
