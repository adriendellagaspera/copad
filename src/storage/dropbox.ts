import type { StorageAdapter } from './types.js';
import { pkceChallenge, openOAuthPopup } from './oauth.js';

const FILE_PATH = '/copad/document.yjs';
const STORAGE_KEY = 'storage.dropbox.token';
const AUTH_URL = 'https://www.dropbox.com/oauth2/authorize';
const TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';
const UPLOAD_URL = 'https://content.dropboxapi.com/2/files/upload';
const DOWNLOAD_URL = 'https://content.dropboxapi.com/2/files/download';

export class DropboxAdapter implements StorageAdapter {
  readonly id = 'dropbox';
  readonly label = 'Dropbox';

  private token(): string | null {
    return localStorage.getItem(STORAGE_KEY);
  }

  isAuthenticated(): boolean {
    return !!this.token();
  }

  async connect(): Promise<void> {
    const APP_KEY = import.meta.env.VITE_DROPBOX_APP_KEY;
    if (!APP_KEY) throw new Error('VITE_DROPBOX_APP_KEY is not set');

    const REDIRECT_URI =
      import.meta.env.VITE_REDIRECT_URI ?? `${location.origin}/redirect.html`;

    const { verifier, challenge } = await pkceChallenge();
    const state = crypto.randomUUID();

    const params = new URLSearchParams({
      client_id: APP_KEY,
      response_type: 'code',
      redirect_uri: REDIRECT_URI,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
      token_access_type: 'offline',
    });

    const code = await openOAuthPopup(`${AUTH_URL}?${params}`, state);

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        grant_type: 'authorization_code',
        client_id: APP_KEY,
        redirect_uri: REDIRECT_URI,
        code_verifier: verifier,
      }),
    });

    if (!res.ok) throw new Error(`Dropbox token exchange failed: ${res.status}`);
    const data = await res.json() as { access_token: string };
    localStorage.setItem(STORAGE_KEY, data.access_token);
  }

  disconnect(): void {
    localStorage.removeItem(STORAGE_KEY);
  }

  async load(): Promise<Uint8Array | null> {
    const tok = this.token();
    if (!tok) throw new Error('Dropbox: not connected');

    const res = await fetch(DOWNLOAD_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tok}`,
        'Dropbox-API-Arg': JSON.stringify({ path: FILE_PATH }),
      },
    });

    if (res.status === 409) return null; // file not found
    if (!res.ok) throw new Error(`Dropbox load failed: ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async save(bytes: Uint8Array): Promise<void> {
    const tok = this.token();
    if (!tok) throw new Error('Dropbox: not connected');

    const res = await fetch(UPLOAD_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tok}`,
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': JSON.stringify({
          path: FILE_PATH,
          mode: 'overwrite',
          mute: true,
        }),
      },
      body: bytes as unknown as BodyInit,
    });

    if (!res.ok) throw new Error(`Dropbox save failed: ${res.status}`);
  }
}
