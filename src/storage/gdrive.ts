import type { Storage, DocContent, Filename } from './types.js';
import { DocFormat, StorageAccess } from './types.js';
import type { StorageAuth } from './auth.js';
import { configStore } from './config.js';
import { filenameStore } from './filename.js';
import { extensionOf } from '../format/types.js';
import { pkceChallenge, openOAuthPopup } from './oauth.js';
import {
  parseGDriveTokenResponse,
  parseGDriveFileList,
  parseGDriveCreatedFile,
  parseGDriveCanEdit,
  parseGDriveClientId,
} from './parse.js';
import { localStore } from '../persistence/local.js';
import type { RoomId } from '../collaboration/types.js';
import {
  STORAGE_ID,
  DEFAULT_FILENAME,
  GDRIVE_AUTH_URL,
  GDRIVE_TOKEN_URL,
  GDRIVE_FILES_URL,
  GDRIVE_UPLOAD_URL,
  GDRIVE_SCOPE,
  GDRIVE_TOKEN_KEY,
  oauthRedirectUri,
} from './constants.js';

// ── Branded types ─────────────────────────────────────────────────────────────

/** The id of a file in Google Drive. */
export type GDriveFileId = string & { readonly _brand: 'GDriveFileId' };

/** An OAuth2 access token issued by Google for the `drive.file` scope. */
export type GDriveToken = string & { readonly _brand: 'GDriveToken' };

/** A Google Cloud OAuth 2.0 Client ID (`*.apps.googleusercontent.com`). */
export type GDriveClientId = string & { readonly _brand: 'GDriveClientId' };

// ── Config ────────────────────────────────────────────────────────────────────

const tokenStore = localStore<GDriveToken | null>(
  GDRIVE_TOKEN_KEY,
  (raw) => raw as GDriveToken | null,
  (v) => v,
);

const cfg = configStore(STORAGE_ID.gdrive, [
  {
    name: 'clientId',
    label: 'Client ID',
    placeholder: 'your-client-id.apps.googleusercontent.com',
    help: 'Create an OAuth 2.0 Web App credential at console.cloud.google.com and enable the Drive API.',
    env: import.meta.env.VITE_GDRIVE_CLIENT_ID,
  },
]);

// ── Helpers ───────────────────────────────────────────────────────────────────

function authHeaders(token: GDriveToken): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

/** Find the id of a non-trashed Drive file with this exact name, or null. */
async function findFile(token: GDriveToken, name: Filename): Promise<GDriveFileId | null> {
  const q = encodeURIComponent(`name='${name.replace(/'/g, "\\'")}' and trashed=false`);
  const res = await fetch(`${GDRIVE_FILES_URL}?q=${q}&fields=files(id)`, {
    headers: authHeaders(token),
  });
  if (!res.ok) return null;
  return parseGDriveFileList(await res.json());
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function gdriveStorage(room: RoomId): { auth: StorageAuth; storage: Storage } {
  const fileName = filenameStore(STORAGE_ID.gdrive, room);
  // Id of the Drive file for the current filename — resolved by name (drive.file
  // scope is name-based), cached in-memory, reset when the target filename changes.
  let fileId: GDriveFileId | null = null;
  // Guard against concurrent in-flight saves: without it, two overlapping calls
  // (e.g. autosave firing again before a slow save resolves) could each see no
  // fileId yet and both create a same-named file — Drive doesn't enforce unique
  // names, so that would silently leave two duplicate files behind.
  let committing = false;

  const token = (): GDriveToken | null => tokenStore.read();

  /** The configured OAuth Client ID, parsed at the config boundary. */
  function resolvedClientId(): GDriveClientId | null {
    return parseGDriveClientId(cfg.config('clientId'));
  }

  const auth: StorageAuth = {
    isAuthenticated: () => !!token(),

    async login() {
      const clientId = resolvedClientId();
      if (!clientId) throw new Error('Add a Google Cloud Client ID in Settings first.');

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
        scope: GDRIVE_SCOPE,
        access_type: 'offline',
        prompt: 'consent',
      });

      const code = await openOAuthPopup(`${GDRIVE_AUTH_URL}?${params}`, state);

      const res = await fetch(GDRIVE_TOKEN_URL, {
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

      if (!res.ok) throw new Error(`Google Drive token exchange failed: ${res.status}`);
      tokenStore.write(parseGDriveTokenResponse(await res.json()).access_token);
    },

    logout() {
      tokenStore.clear();
      fileId = null;
    },

    configFields: cfg.fields,
    config: cfg.config,
    setConfig: cfg.setConfig,
    configLocked: cfg.configLocked,
    configured: cfg.configured,
  };

  const storage: Storage = {
    id: STORAGE_ID.gdrive,
    label: 'Google Drive',
    blurb: 'Saves to a file in your Google Drive via OAuth. Requires a Google Cloud Client ID in Settings.',
    availability: { ok: true },

    filename: () => fileName.get(),
    setFilename: (name) => { fileId = null; fileName.set(name); },
    defaultFilename: () => DEFAULT_FILENAME,

    get contentFormat(): DocFormat {
      return extensionOf(fileName.get()) === '.yjs' ? DocFormat.Binary : DocFormat.Text;
    },

    async load(): Promise<DocContent | null> {
      const tok = token();
      if (!tok) throw new Error('Google Drive: not connected');

      fileId = fileId ?? await findFile(tok, fileName.get());
      if (!fileId) return null;

      const res = await fetch(`${GDRIVE_FILES_URL}/${fileId}?alt=media`, {
        headers: authHeaders(tok),
      });
      if (res.status === 404) { fileId = null; return null; }
      if (!res.ok) throw new Error(`Google Drive load failed: ${res.status}`);

      const bytes = new Uint8Array(await res.arrayBuffer());
      if (storage.contentFormat === DocFormat.Text) {
        return { format: DocFormat.Text, text: new TextDecoder().decode(bytes) };
      }
      return { format: DocFormat.Binary, bytes };
    },

    async save(content: DocContent): Promise<void> {
      if (committing) return;
      const tok = token();
      if (!tok) throw new Error('Google Drive: not connected');

      const bytes =
        content.format === DocFormat.Text
          ? new TextEncoder().encode(content.text)
          : content.bytes;
      const mime = content.format === DocFormat.Text ? 'text/plain' : 'application/octet-stream';

      committing = true;
      try {
        // Resolve (or create) the target file, then upload its media.
        fileId = fileId ?? await findFile(tok, fileName.get());
        if (!fileId) {
          const res = await fetch(`${GDRIVE_FILES_URL}?fields=id`, {
            method: 'POST',
            headers: { ...authHeaders(tok), 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: fileName.get() }),
          });
          if (!res.ok) throw new Error(`Google Drive create failed: ${res.status}`);
          fileId = parseGDriveCreatedFile(await res.json());
        }

        const res = await fetch(`${GDRIVE_UPLOAD_URL}/${fileId}?uploadType=media`, {
          method: 'PATCH',
          headers: { ...authHeaders(tok), 'Content-Type': mime },
          body: bytes as unknown as BodyInit,
        });
        if (!res.ok) throw new Error(`Google Drive save failed: ${res.status}`);
      } finally {
        committing = false;
      }
    },

    async access(): Promise<StorageAccess> {
      const tok = token();
      if (!tok) throw new Error('Google Drive: not connected');

      fileId = fileId ?? await findFile(tok, fileName.get());
      if (!fileId) return StorageAccess.Write; // no file yet — user can create one

      const res = await fetch(`${GDRIVE_FILES_URL}/${fileId}?fields=capabilities(canEdit)`, {
        headers: authHeaders(tok),
      });
      if (!res.ok) return StorageAccess.Read;
      return parseGDriveCanEdit(await res.json()) ? StorageAccess.Write : StorageAccess.Read;
    },
  };

  return { auth, storage };
}
