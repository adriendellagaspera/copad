import type { Storage, DocContent } from './types.js';
import { configStore } from './config.js';
import { pkceChallenge, openOAuthPopup } from './oauth.js';

const FILE_PATH = '/copad/document.yjs';
const STORAGE_KEY = 'storage.dropbox.token';
const AUTH_URL = 'https://www.dropbox.com/oauth2/authorize';
const TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';
const UPLOAD_URL = 'https://content.dropboxapi.com/2/files/upload';
const DOWNLOAD_URL = 'https://content.dropboxapi.com/2/files/download';

function token(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

// Persisted under `storage.dropbox.appKey` — same key the old connect form used.
const cfg = configStore('dropbox', [
  {
    name: 'appKey',
    label: 'App key',
    placeholder: 'your-app-key',
    help: 'Create a scoped app at dropbox.com/developers, then paste its App key here.',
    env: import.meta.env.VITE_DROPBOX_APP_KEY as string | undefined,
  },
]);

export function dropboxStorage(): Storage {
  return {
    id: 'dropbox',
    label: 'Dropbox',
    blurb: 'Saves to an app folder in your Dropbox via OAuth.',

    configFields: cfg.fields,
    config: cfg.config,
    setConfig: cfg.setConfig,
    configLocked: cfg.configLocked,
    configured: cfg.configured,

    isAuthenticated: () => !!token(),

    contentFormat: 'binary',

    async connect() {
      const appKey = cfg.config('appKey');
      if (!appKey) throw new Error('Add a Dropbox app key in Settings first.');

      const REDIRECT_URI =
        import.meta.env.VITE_REDIRECT_URI ?? `${location.origin}/redirect.html`;

      const { verifier, challenge } = await pkceChallenge();
      const state = crypto.randomUUID();

      const params = new URLSearchParams({
        client_id: appKey,
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
          client_id: appKey,
          redirect_uri: REDIRECT_URI,
          code_verifier: verifier,
        }),
      });

      if (!res.ok) throw new Error(`Dropbox token exchange failed: ${res.status}`);
      const data = await res.json() as { access_token: string };
      localStorage.setItem(STORAGE_KEY, data.access_token);
    },

    disconnect() {
      localStorage.removeItem(STORAGE_KEY);
    },

    async load(): Promise<DocContent | null> {
      const tok = token();
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
      return { format: 'binary', bytes: new Uint8Array(await res.arrayBuffer()) };
    },

    async save(content: DocContent): Promise<void> {
      if (content.format !== 'binary') throw new Error('Dropbox storage expects binary content');
      const tok = token();
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
        body: content.bytes as unknown as BodyInit,
      });

      if (!res.ok) throw new Error(`Dropbox save failed: ${res.status}`);
    },
  };
}
