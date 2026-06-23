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

/** Open an OAuth popup and wait for the code to be posted back. */
export function openOAuthPopup(authUrl: string, expectedState: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const popup = window.open(authUrl, 'oauth', 'width=520,height=640');
    if (!popup) {
      reject(new Error('Popup blocked — allow popups for this site'));
      return;
    }

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('OAuth timed out'));
    }, 5 * 60_000);

    function onMessage(event: MessageEvent) {
      if (event.origin !== location.origin) return;
      if (event.data?.type !== 'oauth-code') return;
      if (event.data.state !== expectedState) return;
      cleanup();
      resolve(event.data.code as string);
    }

    function cleanup() {
      clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
      popup.close();
    }

    window.addEventListener('message', onMessage);
  });
}
