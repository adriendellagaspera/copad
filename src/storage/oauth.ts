// Shared OAuth helpers for the authorization-code (PKCE) flow used by Dropbox.
// The popup lands on /redirect.html, which posts the code back here.

function base64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function randomString(len = 64): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return base64url(bytes.buffer).slice(0, len);
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return base64url(digest);
}

// Opens the provider's consent screen in a popup and resolves with the returned
// authorization code (rejecting on state mismatch or if the popup is closed).
export function openOAuthPopup(authUrl: string, expectedState: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const popup = window.open(authUrl, "oauth", "width=600,height=720");
    if (!popup) {
      reject(new Error("Popup blocked by the browser"));
      return;
    }

    const onMessage = (ev: MessageEvent) => {
      if (ev.origin !== location.origin) return;
      const data = ev.data as { type?: string; code?: string; state?: string };
      if (!data || data.type !== "oauth-code") return;
      cleanup();
      if (expectedState && data.state !== expectedState) {
        reject(new Error("OAuth: invalid state"));
        return;
      }
      if (!data.code) {
        reject(new Error("OAuth: missing code"));
        return;
      }
      resolve(data.code);
    };

    const timer = setInterval(() => {
      if (popup.closed) {
        cleanup();
        reject(new Error("OAuth window closed"));
      }
    }, 500);

    const cleanup = () => {
      clearInterval(timer);
      window.removeEventListener("message", onMessage);
      try {
        popup.close();
      } catch {
        /* ignore */
      }
    };

    window.addEventListener("message", onMessage);
  });
}
