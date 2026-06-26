/** Generate a random base64url string of `len` bytes. */
function randomString(len = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Return { verifier, challenge } for OAuth 2 PKCE. */
export async function pkceChallenge(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomString(48);
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return { verifier, challenge };
}

import { parseOAuthCode } from './parse.js';
import { OAUTH_TIMEOUT_MS, OAUTH_POPUP_FEATURES } from './constants.js';

/** Open an OAuth popup and wait for the code to be posted back. */
export function openOAuthPopup(authUrl: string, expectedState: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const popup = window.open(authUrl, 'oauth', OAUTH_POPUP_FEATURES);
    if (!popup) {
      reject(new Error('Popup blocked — allow popups for this site'));
      return;
    }

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('OAuth timed out'));
    }, OAUTH_TIMEOUT_MS);

    function onMessage(event: MessageEvent) {
      if (event.origin !== location.origin) return;
      const data = event.data as Record<string, unknown>;
      if (data?.['state'] !== expectedState) return;
      const code = parseOAuthCode(data);
      if (!code) return;
      cleanup();
      resolve(code);
    }

    function cleanup() {
      clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
      popup!.close();
    }

    window.addEventListener('message', onMessage);
  });
}
