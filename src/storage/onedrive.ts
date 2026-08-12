import type { DocContent, Filename, Storage, StorageLabel } from './types.js';
import { DocFormat, StorageAccess } from './types.js';
import type { StorageAuth } from './auth.js';
import { configStore } from './config.js';
import { filenameStore } from './filename.js';
import { extensionOf } from '../format/types.js';
import { pkceChallenge, openOAuthPopup } from './oauth.js';
import {
  parseOneDriveTokenResponse,
  parseOneDriveClientId,
  parseGraphUserId,
  parseGraphOwnerId,
  parseOneDriveChildren,
} from './parse.js';
import { localStore } from '../persistence/local.js';
import type { RoomId } from '../collaboration/types.js';
import { landed, writeFailure, classifyHttpStatus, WriteFailureKind, type WriteReceipt } from './writeOutcome.js';
import {
  STORAGE_ID,
  DEFAULT_FILENAME,
  GRAPH_API_URL,
  ONEDRIVE_AUTH_URL,
  ONEDRIVE_TOKEN_URL,
  ONEDRIVE_SCOPE,
  ONEDRIVE_TOKEN_KEY,
  oauthRedirectUri,
} from './constants.js';

// The `consumers` tenant rejects work/school accounts — those go through sharepoint.ts.

export type OneDriveToken = string & { readonly _brand: 'OneDriveToken' };
export type OneDriveClientId = string & { readonly _brand: 'OneDriveClientId' };

const tokenStore = localStore<OneDriveToken | null>(
  ONEDRIVE_TOKEN_KEY,
  (raw) => raw as OneDriveToken | null,
  (v) => v,
);

const cfg = configStore(STORAGE_ID.onedrive, [
  {
    name: 'clientId',
    label: 'Client ID',
    placeholder: 'your-application-client-id',
    help: 'Register a "personal Microsoft accounts only" app at entra.microsoft.com, add a Single-page application redirect URI, and grant it the Files.ReadWrite.AppFolder delegated permission.',
    env: import.meta.env.VITE_ONEDRIVE_CLIENT_ID,
  },
]);

function authHeaders(token: OneDriveToken): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

// Graph auto-creates this folder on first access; it bounds every request below.
function appFolderRoot(): string {
  return `${GRAPH_API_URL}/me/drive/special/approot`;
}

function itemUrl(filename: Filename): string {
  return `${appFolderRoot()}:/${filename}`;
}

function contentUrl(filename: Filename): string {
  return `${itemUrl(filename)}:/content`;
}

export function onedriveStorage(room: RoomId): { auth: StorageAuth; storage: Storage } {
  const fileName = filenameStore(STORAGE_ID.onedrive, room);
  const token = (): OneDriveToken | null => tokenStore.read();

  function resolvedClientId(): OneDriveClientId | null {
    return parseOneDriveClientId(cfg.config('clientId'));
  }

  const auth: StorageAuth = {
    isAuthenticated: () => !!token(),

    async login() {
      const clientId = resolvedClientId();
      if (!clientId) throw new Error('Add a Microsoft Entra Client ID in Settings first.');

      const REDIRECT_URI = oauthRedirectUri();
      const { verifier, challenge } = await pkceChallenge();
      const state = crypto.randomUUID();

      const params = new URLSearchParams({
        client_id: clientId,
        response_type: 'code',
        redirect_uri: REDIRECT_URI,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
        scope: ONEDRIVE_SCOPE,
      });

      const code = await openOAuthPopup(`${ONEDRIVE_AUTH_URL}?${params}`, state);

      const res = await fetch(ONEDRIVE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          grant_type: 'authorization_code',
          client_id: clientId,
          redirect_uri: REDIRECT_URI,
          code_verifier: verifier,
        }),
      });

      if (!res.ok) throw new Error(`OneDrive token exchange failed: ${res.status}`);
      tokenStore.write(parseOneDriveTokenResponse(await res.json()).access_token);
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
    id: STORAGE_ID.onedrive,
    label: 'OneDrive (personal)' as StorageLabel,
    blurb: 'Saves to a dedicated app folder in your personal OneDrive via OAuth — never the rest of your drive. Requires a Microsoft Entra Client ID in Settings.',
    availability: { ok: true },

    filename: () => fileName.get(),
    setFilename: fileName.set,
    defaultFilename: () => DEFAULT_FILENAME,

    get contentFormat(): DocFormat {
      return extensionOf(fileName.get()) === '.yjs' ? DocFormat.Binary : DocFormat.Text;
    },

    async load(): Promise<DocContent | null> {
      const tok = token();
      if (!tok) throw new Error('OneDrive: not connected');

      const res = await fetch(contentUrl(fileName.get()), { headers: authHeaders(tok) });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`OneDrive load failed: ${res.status}`);

      const bytes = new Uint8Array(await res.arrayBuffer());
      if (storage.contentFormat === DocFormat.Text) {
        return { format: DocFormat.Text, text: new TextDecoder().decode(bytes) };
      }
      return { format: DocFormat.Binary, bytes };
    },

    async save(content: DocContent): Promise<WriteReceipt> {
      const tok = token();
      if (!tok) throw writeFailure(WriteFailureKind.Denied, 'OneDrive: not connected');

      const bytes =
        content.format === DocFormat.Text
          ? new TextEncoder().encode(content.text)
          : content.bytes;
      const mime = content.format === DocFormat.Text
        ? 'text/plain; charset=utf-8'
        : 'application/octet-stream';

      const res = await fetch(contentUrl(fileName.get()), {
        method: 'PUT',
        headers: { ...authHeaders(tok), 'Content-Type': mime },
        body: bytes as unknown as BodyInit,
      });
      if (!res.ok) throw writeFailure(classifyHttpStatus(res.status), `OneDrive save failed: ${res.status}`);
      return landed();
    },

    async access(): Promise<StorageAccess> {
      const tok = token();
      if (!tok) throw new Error('OneDrive: not connected');

      const [meRes, itemRes] = await Promise.all([
        fetch(`${GRAPH_API_URL}/me`, { headers: authHeaders(tok) }),
        fetch(itemUrl(fileName.get()), { headers: authHeaders(tok) }),
      ]);
      if (!meRes.ok || !itemRes.ok) return StorageAccess.Write;

      const meId = parseGraphUserId(await meRes.json());
      const ownerId = parseGraphOwnerId(await itemRes.json());
      return ownerId === meId ? StorageAccess.Owner : StorageAccess.Write;
    },

    async list(): Promise<Filename[]> {
      const tok = token();
      if (!tok) throw new Error('OneDrive: not connected');

      const res = await fetch(`${appFolderRoot()}/children`, { headers: authHeaders(tok) });
      if (!res.ok) throw new Error(`OneDrive list failed: ${res.status}`);
      return parseOneDriveChildren(await res.json());
    },

    async loadFrom(filename: Filename): Promise<DocContent | null> {
      const tok = token();
      if (!tok) throw new Error('OneDrive: not connected');

      const res = await fetch(contentUrl(filename), { headers: authHeaders(tok) });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`OneDrive load failed: ${res.status}`);

      const bytes = new Uint8Array(await res.arrayBuffer());
      // Format follows this filename, not the room's configured target.
      return extensionOf(filename) === '.yjs'
        ? { format: DocFormat.Binary, bytes }
        : { format: DocFormat.Text, text: new TextDecoder().decode(bytes) };
    },
  };

  return { auth, storage };
}
