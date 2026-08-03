import pcloudSdk from 'pcloud-sdk-js';
import type { Storage, DocContent } from './types.js';
import { DocFormat } from './types.js';
import type { StorageAuth } from './auth.js';
import { configStore } from './config.js';
import { filenameStore } from './filename.js';
import type { Fetch } from '../network/types.js';
import {
  type PCloudSession,
  parsePCloudSession,
  parsePCloudFileLinkResponse,
  parsePCloudUploadResponse,
  parsePCloudClientId,
} from './parse.js';
import { localStore } from '../persistence/local.js';
import type { RoomId } from '../collaboration/types.js';
import {
  STORAGE_ID,
  CLOUD_FOLDER,
  DEFAULT_FILENAME,
  PCLOUD_SESSION_KEY,
  PCLOUD_API_HOST,
  PCLOUD_EU_API_HOST,
  PCLOUD_GETFILELINK_PATH,
  PCLOUD_UPLOAD_PATH,
  OAUTH_TIMEOUT_MS,
} from './constants.js';

// ── Branded types ─────────────────────────────────────────────────────────────

/** The pCloud OAuth token minted by the SDK's popup callback. */
export type PCloudToken = string & { readonly _brand: 'PCloudToken' };

/** The resolved API host for the session's region — one of the two constant
 *  hosts (`PCLOUD_API_HOST` / `PCLOUD_EU_API_HOST`), branded per session. */
export type PCloudApiHost = string & { readonly _brand: 'PCloudApiHost' };

/** A configured pCloud OAuth app Client ID. */
export type PCloudClientId = string & { readonly _brand: 'PCloudClientId' };

const sessionStore = localStore<PCloudSession | null>(
  PCLOUD_SESSION_KEY,
  parsePCloudSession,
  (s) => (s ? JSON.stringify(s) : null),
);

// Persisted under `storage.pcloud.clientId` — same key the old connect form used.
const cfg = configStore(STORAGE_ID.pcloud, [
  {
    name: 'clientId',
    label: 'Client ID',
    placeholder: 'your-client-id',
    help: 'Register an OAuth app at pcloud.com/oauth2-apps, then paste its Client ID here.',
    env: import.meta.env.VITE_PCLOUD_CLIENT_ID,
  },
]);

export function pcloudStorage(netFetch: Fetch, room: RoomId): { auth: StorageAuth; storage: Storage } {
  const fileName = filenameStore(STORAGE_ID.pcloud, room);
  const filePath = () => `${CLOUD_FOLDER}/${fileName.get()}`;
  const session = (): PCloudSession | null => sessionStore.read();

  // Client ID is validated once here (trim, non-empty), mirroring the other
  // OAuth-popup backends' config resolvers.
  function resolvedClientId(): PCloudClientId | null {
    return parsePCloudClientId(cfg.config('clientId'));
  }

  const auth: StorageAuth = {
    isAuthenticated: () => !!session(),

    async login() {
      const clientId = resolvedClientId();
      if (!clientId) throw new Error('Add a pCloud Client ID in Settings first.');

      await new Promise<void>((resolve, reject) => {
        // Unlike the shared openOAuthPopup() helper the other OAuth backends use,
        // this third-party SDK gives us no popup-blocked signal and no timeout of
        // its own — without one, a blocked popup or a callback the SDK never fires
        // leaves the Connect button stuck on "Connecting…" forever.
        const timeout = setTimeout(() => {
          reject(new Error('pCloud auth timed out — check that popups are allowed for this site.'));
        }, OAUTH_TIMEOUT_MS);

        pcloudSdk.oauth.popup(
          clientId,
          // The SDK callback hands us raw strings with no separate response-parse
          // step to hook into — this callback signature IS the IO boundary, so we
          // brand both fields right here.
          (token: string, locationid?: number) => {
            clearTimeout(timeout);
            const host = ((locationid ?? 1) === 2
              ? PCLOUD_EU_API_HOST
              : PCLOUD_API_HOST) as PCloudApiHost;
            sessionStore.write({ token: token as PCloudToken, host });
            resolve();
          },
          (err: unknown) => {
            clearTimeout(timeout);
            reject(new Error(`pCloud auth failed: ${String(err)}`));
          }
        );
      });
    },

    logout() {
      sessionStore.clear();
    },

    configFields: cfg.fields,
    config: cfg.config,
    setConfig: cfg.setConfig,
    configLocked: cfg.configLocked,
    configured: cfg.configured,
  };

  const storage: Storage = {
    id: STORAGE_ID.pcloud,
    label: 'pCloud',
    blurb: 'Saves to a /copad folder in your pCloud via OAuth.',
    availability: { ok: true },

    filename: () => fileName.get(),
    setFilename: fileName.set,
    defaultFilename: () => DEFAULT_FILENAME,

    contentFormat: DocFormat.Binary,

    async load(): Promise<DocContent | null> {
      const s = session();
      if (!s) throw new Error('pCloud: not connected');

      try {
        const rawMeta: unknown = await fetch(
          `https://${s.host}${PCLOUD_GETFILELINK_PATH}?path=${encodeURIComponent(filePath())}&auth=${s.token}`
        ).then(r => r.json());
        const meta = parsePCloudFileLinkResponse(rawMeta);

        if (meta.result !== 0) return null;

        const contentUrl = `https://${meta.hosts[0]}${meta.path}`;

        const res = await netFetch(contentUrl);
        if (!res.ok) {
          console.warn('pCloud load failed (starting with empty doc):', res.status);
          return null;
        }
        return { format: DocFormat.Binary, bytes: new Uint8Array(await res.arrayBuffer()) };
      } catch (e) {
        console.warn('pCloud load failed (starting with empty doc):', e);
        return null;
      }
    },

    async save(content: DocContent): Promise<void> {
      if (content.format !== DocFormat.Binary) throw new Error('pCloud storage expects binary content');
      const s = session();
      if (!s) throw new Error('pCloud: not connected');

      const form = new FormData();
      form.append('filename', fileName.get());
      form.append('path', CLOUD_FOLDER);
      form.append('nopartial', '1');
      form.append('file', new Blob([content.bytes as BlobPart]));

      const res = await netFetch(
        `https://${s.host}${PCLOUD_UPLOAD_PATH}?auth=${s.token}`,
        { method: 'POST', body: form }
      );
      if (!res.ok) throw new Error(`pCloud save failed: ${res.status}`);

      // pCloud puts API failures in the *body* of a 200 — an expired token, a
      // full quota or a bad path all arrive as `{ result: <non-zero> }` with an
      // HTTP 200. Trusting `res.ok` alone reported every one of them as a
      // successful save while nothing was written. `load()` already knows this
      // (it checks `meta.result !== 0`); the write path has to check too.
      const reply = parsePCloudUploadResponse((await res.json()) as unknown);
      if (reply.result !== 0)
        throw new Error(`pCloud save failed: ${reply.error ?? `error ${reply.result}`}`);
      // A zero result with no file id means the request was accepted and stored
      // nothing — success on the protocol, silent data loss for the user.
      if (reply.fileids.length === 0)
        throw new Error('pCloud save failed: the upload stored no file');
    },
  };

  return { auth, storage };
}
