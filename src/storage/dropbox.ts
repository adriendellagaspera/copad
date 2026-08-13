import type { DocContent, Storage, StorageLabel } from './types.js';
import { DocFormat } from './types.js';
import type { StorageAuth } from './auth.js';
import { configStore } from './config.js';
import { filenameStore } from './filename.js';
import { pkceChallenge, openOAuthPopup } from './oauth.js';
import { parseDropboxTokenResponse, parseDropboxAppKey } from './parse.js';
import { localStore } from '../persistence/local.js';
import type { RoomId } from '../collaboration/types.js';
import { landed, writeFailure, classifyHttpStatus, WriteFailureKind, type WriteReceipt } from './writeOutcome.js';
import {
  STORAGE_ID,
  CLOUD_FOLDER,
  DEFAULT_FILENAME,
  DROPBOX_AUTH_URL,
  DROPBOX_TOKEN_URL,
  DROPBOX_UPLOAD_URL,
  DROPBOX_DOWNLOAD_URL,
  DROPBOX_TOKEN_KEY,
  oauthRedirectUri,
} from './constants.js';

export type DropboxToken = string & { readonly _brand: 'DropboxToken' };
export type DropboxAppKey = string & { readonly _brand: 'DropboxAppKey' };

// Re-hydration cast: parseDropboxTokenResponse is the only mint site.
const tokenStore = localStore<DropboxToken | null>(
  DROPBOX_TOKEN_KEY,
  (raw) => raw as DropboxToken | null,
  (v) => v,
);

const cfg = configStore(STORAGE_ID.dropbox, [
  {
    name: 'appKey',
    label: 'App key',
    placeholder: 'your-app-key',
    help: 'Create a scoped app at dropbox.com/developers, then paste its App key here.',
    env: import.meta.env.VITE_DROPBOX_APP_KEY,
  },
]);

export function dropboxStorage(room: RoomId): { auth: StorageAuth; storage: Storage } {
  const fileName = filenameStore(STORAGE_ID.dropbox, room);
  const filePath = () => `${CLOUD_FOLDER}/${fileName.get()}`;

  const token = (): DropboxToken | null => tokenStore.read();

  const resolvedAppKey = (): DropboxAppKey | null => parseDropboxAppKey(cfg.config('appKey'));

  const auth: StorageAuth = {
    isAuthenticated: () => !!token(),

    async login() {
      const appKey = resolvedAppKey();
      if (!appKey) throw new Error('Add a Dropbox app key in Settings first.');

      const REDIRECT_URI = oauthRedirectUri();

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

      const code = await openOAuthPopup(`${DROPBOX_AUTH_URL}?${params}`, state);

      const res = await fetch(DROPBOX_TOKEN_URL, {
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
      const data = parseDropboxTokenResponse(await res.json());
      tokenStore.write(data.access_token);
    },

    logout() {
      tokenStore.clear();
    },

    configFields: cfg.fields,
    config: cfg.config,
    setConfig: cfg.setConfig,
    configLocked: cfg.configLocked,
    configured: cfg.configured,
  };

  const storage: Storage = {
    id: STORAGE_ID.dropbox,
    label: 'Dropbox' as StorageLabel,
    blurb: 'Saves to an app folder in your Dropbox via OAuth.',
    availability: { ok: true },

    filename: () => fileName.get(),
    setFilename: fileName.set,
    defaultFilename: () => DEFAULT_FILENAME,

    contentFormat: DocFormat.Binary,

    async load(): Promise<DocContent | null> {
      const tok = token();
      if (!tok) throw new Error('Dropbox: not connected');

      const res = await fetch(DROPBOX_DOWNLOAD_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tok}`,
          'Dropbox-API-Arg': JSON.stringify({ path: filePath() }),
        },
      });

      // Dropbox answers 409, not 404, for a missing file.
      if (res.status === 409) return null;
      if (!res.ok) throw new Error(`Dropbox load failed: ${res.status}`);
      return { format: DocFormat.Binary, bytes: new Uint8Array(await res.arrayBuffer()) };
    },

    async save(content: DocContent): Promise<WriteReceipt> {
      if (content.format !== DocFormat.Binary) throw writeFailure(WriteFailureKind.Rejected, 'Dropbox storage expects binary content');
      const tok = token();
      if (!tok) throw writeFailure(WriteFailureKind.Denied, 'Dropbox: not connected');

      const res = await fetch(DROPBOX_UPLOAD_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tok}`,
          'Content-Type': 'application/octet-stream',
          'Dropbox-API-Arg': JSON.stringify({
            path: filePath(),
            mode: 'overwrite',
            mute: true,
          }),
        },
        body: content.bytes as unknown as BodyInit,
      });

      if (!res.ok) throw writeFailure(classifyHttpStatus(res.status), `Dropbox save failed: ${res.status}`);
      return landed();
    },
  };

  return { auth, storage };
}
