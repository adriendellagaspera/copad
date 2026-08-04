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
import { landed, writeFailure, classifyHttpStatus, WriteFailureKind, type WriteReceipt } from './writeOutcome.js';
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

export type PCloudToken = string & { readonly _brand: 'PCloudToken' };
export type PCloudApiHost = string & { readonly _brand: 'PCloudApiHost' };
export type PCloudClientId = string & { readonly _brand: 'PCloudClientId' };

const sessionStore = localStore<PCloudSession | null>(
  PCLOUD_SESSION_KEY,
  parsePCloudSession,
  (s) => (s ? JSON.stringify(s) : null),
);

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

  function resolvedClientId(): PCloudClientId | null {
    return parsePCloudClientId(cfg.config('clientId'));
  }

  const auth: StorageAuth = {
    isAuthenticated: () => !!session(),

    async login() {
      const clientId = resolvedClientId();
      if (!clientId) throw new Error('Add a pCloud Client ID in Settings first.');

      await new Promise<void>((resolve, reject) => {
        // The SDK signals neither a blocked popup nor a callback it never fires.
        const timeout = setTimeout(() => {
          reject(new Error('pCloud auth timed out — check that popups are allowed for this site.'));
        }, OAUTH_TIMEOUT_MS);

        pcloudSdk.oauth.popup(
          clientId,
          // This callback signature is the IO boundary — no response to parse.
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

    async save(content: DocContent): Promise<WriteReceipt> {
      if (content.format !== DocFormat.Binary) throw writeFailure(WriteFailureKind.Rejected, 'pCloud storage expects binary content');
      const s = session();
      if (!s) throw writeFailure(WriteFailureKind.Denied, 'pCloud: not connected');

      const form = new FormData();
      form.append('filename', fileName.get());
      form.append('path', CLOUD_FOLDER);
      form.append('nopartial', '1');
      form.append('file', new Blob([content.bytes as BlobPart]));

      const res = await netFetch(
        `https://${s.host}${PCLOUD_UPLOAD_PATH}?auth=${s.token}`,
        { method: 'POST', body: form }
      );
      if (!res.ok) throw writeFailure(classifyHttpStatus(res.status), `pCloud save failed: ${res.status}`);

      // pCloud reports API failures inside an HTTP 200, so `res.ok` proves nothing.
      const reply = parsePCloudUploadResponse((await res.json()) as unknown);
      if (reply.result !== 0)
        throw writeFailure(WriteFailureKind.Unknown, `pCloud save failed: ${reply.error ?? `error ${reply.result}`}`);
      if (reply.fileids.length === 0)
        throw writeFailure(WriteFailureKind.Unknown, 'pCloud save failed: the upload stored no file');
      return landed();
    },
  };

  return { auth, storage };
}
