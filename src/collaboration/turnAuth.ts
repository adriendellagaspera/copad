// Short-lived TURN credentials via the TURN REST API (coturn `use-auth-secret`).
//
// The credential-minting endpoint holds the static auth secret server-side and
// returns time-limited credentials, so — unlike VITE_TURN_* — no secret is baked
// into the client bundle. This is the single place that fetches them; the network
// boundary is parsed by `parseTurnCredentialsResponse` in `parse.ts`.

import type { IceServer, TurnAuthUrl } from './types.js';
import { parseTurnCredentialsResponse } from './parse.js';

/** Fetch short-lived TURN credentials and shape them as an {@link IceServer} list
 *  ready for `webrtcCollab({ iceServers })`. Returns null on any failure (network
 *  error, non-2xx, malformed body) so the caller can fall back to static/default
 *  ICE rather than losing connectivity when the endpoint is down. */
export async function fetchTurnIceServers(url: TurnAuthUrl): Promise<IceServer[] | null> {
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    const creds = parseTurnCredentialsResponse(await res.json());
    if (!creds) return null;
    return [{ urls: creds.urls, username: creds.username, credential: creds.credential }];
  } catch {
    return null;
  }
}
