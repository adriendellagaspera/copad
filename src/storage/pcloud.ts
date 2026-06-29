import pcloudSdk from 'pcloud-sdk-js';
import type { Storage, DocContent } from './types.js';
import { DocFormat } from './types.js';
import type { StorageAuth } from './auth.js';
import { configStore } from './config.js';
import { filenameStore } from './filename.js';
import type { Fetch } from '../network/types.js';
import { type PCloudSession, parsePCloudSession, parsePCloudFileLinkResponse } from './parse.js';
import { localStore } from '../persistence/local.js';
import {
  STORAGE_ID,
  CLOUD_FOLDER,
  PCLOUD_SESSION_KEY,
  PCLOUD_API_HOST,
  PCLOUD_EU_API_HOST,
  PCLOUD_GETFILELINK_PATH,
  PCLOUD_UPLOAD_PATH,
} from './constants.js';

const fileName = filenameStore(STORAGE_ID.pcloud);
const filePath = () => `${CLOUD_FOLDER}/${fileName.get()}`;
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

export function pcloudStorage(netFetch: Fetch): { auth: StorageAuth; storage: Storage } {
  const session = (): PCloudSession | null => sessionStore.read();

  const auth: StorageAuth = {
    isAuthenticated: () => !!session(),

    async login() {
      const clientId = cfg.config('clientId');
      if (!clientId) throw new Error('Add a pCloud Client ID in Settings first.');

      await new Promise<void>((resolve, reject) => {
        pcloudSdk.oauth.popup(
          clientId,
          (token: string, locationid?: number) => {
            const host =
              (locationid ?? 1) === 2 ? PCLOUD_EU_API_HOST : PCLOUD_API_HOST;
            sessionStore.write({ token, host });
            resolve();
          },
          (err: unknown) => reject(new Error(`pCloud auth failed: ${String(err)}`))
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
    },
  };

  return { auth, storage };
}
