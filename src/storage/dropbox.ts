import type { StorageAdapter } from "./types";
import { netFetch } from "./net";
import { openOAuthPopup, pkceChallenge, randomString } from "./oauth";

// Dropbox officially supports the PKCE flow for SPAs: the code exchange and the
// content endpoints accept cross-origin browser requests, so no backend is needed.
const APP_KEY = import.meta.env.VITE_DROPBOX_APP_KEY;
const REDIRECT_URI =
  import.meta.env.VITE_REDIRECT_URI || `${location.origin}/redirect.html`;
const FILE_PATH = import.meta.env.VITE_DROPBOX_FILE_PATH || "/collab-doc.ydoc";
const TOKEN_KEY = "storage.dropbox.token";

export class DropboxAdapter implements StorageAdapter {
  readonly id = "dropbox";
  readonly label = "Dropbox";

  isAuthenticated(): boolean {
    return !!localStorage.getItem(TOKEN_KEY);
  }

  async connect(): Promise<void> {
    if (!APP_KEY) throw new Error("VITE_DROPBOX_APP_KEY is not set");

    const verifier = randomString();
    const state = randomString(24);
    const authUrl = new URL("https://www.dropbox.com/oauth2/authorize");
    authUrl.searchParams.set("client_id", APP_KEY);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("code_challenge", await pkceChallenge(verifier));
    authUrl.searchParams.set("code_challenge_method", "S256");
    authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
    authUrl.searchParams.set("state", state);

    const code = await openOAuthPopup(authUrl.toString(), state);
    await this.exchangeCode(code, verifier);
  }

  private async exchangeCode(code: string, verifier: string): Promise<void> {
    const body = new URLSearchParams({
      code,
      grant_type: "authorization_code",
      client_id: APP_KEY!,
      code_verifier: verifier,
      redirect_uri: REDIRECT_URI,
    });
    const res = await netFetch("https://api.dropboxapi.com/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) throw new Error(`Dropbox token (${res.status})`);
    const json = (await res.json()) as { access_token: string };
    localStorage.setItem(TOKEN_KEY, json.access_token);
  }

  disconnect(): void {
    localStorage.removeItem(TOKEN_KEY);
  }

  private token(): string {
    const t = localStorage.getItem(TOKEN_KEY);
    if (!t) throw new Error("Dropbox: not connected");
    return t;
  }

  async save(bytes: Uint8Array): Promise<void> {
    const res = await netFetch("https://content.dropboxapi.com/2/files/upload", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token()}`,
        "Dropbox-API-Arg": JSON.stringify({
          path: FILE_PATH,
          mode: "overwrite",
          mute: true,
        }),
        "Content-Type": "application/octet-stream",
      },
      body: new Blob([bytes as BlobPart]),
    });
    if (!res.ok) throw new Error(`Dropbox upload (${res.status})`);
  }

  async load(): Promise<Uint8Array | null> {
    try {
      const res = await netFetch(
        "https://content.dropboxapi.com/2/files/download",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.token()}`,
            "Dropbox-API-Arg": JSON.stringify({ path: FILE_PATH }),
          },
        },
      );
      if (res.status === 409) return null; // path/not_found (normal first run)
      if (!res.ok) {
        console.warn(`Dropbox download (${res.status})`);
        return null;
      }
      return new Uint8Array(await res.arrayBuffer());
    } catch (err) {
      console.warn("Dropbox load failed (starting with empty doc):", err);
      return null;
    }
  }
}
