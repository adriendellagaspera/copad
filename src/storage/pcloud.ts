import pcloudSdk from 'pcloud-sdk-js';
import type { Storage, DocContent, StorageId } from './types.js';
import type { StorageAuth } from './auth.js';
import { configStore } from './config.js';
import { filenameStore } from './filename.js';
import type { Fetch } from '../network/types.js';

const FOLDER = '/copad';
const fileName = filenameStore('pcloud' as StorageId);
const filePath = () => `${FOLDER}/${fileName.get()}`;
const STORAGE_KEY = 'storage.pcloud';

interface PCloudSession {
  token: string;
  host: string;
}

// Persisted under `storage.pcloud.clientId` — same key the old connect form used.
const cfg = configStore('pcloud' as StorageId, [
  {
    name: 'clientId',
    label: 'Client ID',
    placeholder: 'your-client-id',
    help: 'Register an OAuth app at pcloud.com/oauth2-apps, then paste its Client ID here.',
    env: import.meta.env.VITE_PCLOUD_CLIENT_ID as string | undefined,
  },
]);

interface PCloudFileLinkResponse {
  result: number;
  hosts: string[];
  path: string;
}

export function pcloudStorage(netFetch: Fetch): { auth: StorageAuth; storage: Storage } {
  const session = (): PCloudSession | null => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as PCloudSession) : null;
    } catch {
      return null;
    }
  };

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
              (locationid ?? 1) === 2 ? 'eapi.pcloud.com' : 'api.pcloud.com';
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ token, host }));
            resolve();
          },
          (err: unknown) => reject(new Error(`pCloud auth failed: ${String(err)}`))
        );
      });
    },

    logout() {
      localStorage.removeItem(STORAGE_KEY);
    },

    configFields: cfg.fields,
    config: cfg.config,
    setConfig: cfg.setConfig,
    configLocked: cfg.configLocked,
    configured: cfg.configured,
  };

  const storage: Storage = {
    id: 'pcloud' as StorageId,
    label: 'pCloud',
    blurb: 'Saves to a /copad folder in your pCloud via OAuth.',
    availability: { ok: true },

    filename: () => fileName.get(),
    setFilename: fileName.set,

    contentFormat: 'binary',

    async load(): Promise<DocContent | null> {
      const s = session();
      if (!s) throw new Error('pCloud: not connected');

      try {
        const meta = await fetch(
          `https://${s.host}/getfilelink?path=${encodeURIComponent(filePath())}&auth=${s.token}`
        ).then(r => r.json() as Promise<PCloudFileLinkResponse>);

        if (meta.result !== 0) return null;

        const contentUrl = `https://${meta.hosts[0]}${meta.path}`;

        const res = await netFetch(contentUrl);
        if (!res.ok) {
          console.warn('pCloud load failed (starting with empty doc):', res.status);
          return null;
        }
        return { format: 'binary', bytes: new Uint8Array(await res.arrayBuffer()) };
      } catch (e) {
        console.warn('pCloud load failed (starting with empty doc):', e);
        return null;
      }
    },

    async save(content: DocContent): Promise<void> {
      if (content.format !== 'binary') throw new Error('pCloud storage expects binary content');
      const s = session();
      if (!s) throw new Error('pCloud: not connected');

      const form = new FormData();
      form.append('filename', fileName.get());
      form.append('path', FOLDER);
      form.append('nopartial', '1');
      form.append('file', new Blob([content.bytes as BlobPart]));

      const res = await netFetch(
        `https://${s.host}/uploadfile?auth=${s.token}`,
        { method: 'POST', body: form }
      );
      if (!res.ok) throw new Error(`pCloud save failed: ${res.status}`);
    },
  };

  return { auth, storage };
}
