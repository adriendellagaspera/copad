import pcloudSdk from 'pcloud-sdk-js';
import type { Storage } from './types.js';
import type { Fetch } from '../network/types.js';

const FILE_PATH = '/copad/document.yjs';
const STORAGE_KEY = 'storage.pcloud';
const CLIENT_ID_KEY = 'storage.pcloud.clientId';

interface PCloudSession {
  token: string;
  host: string;
}

function session(): PCloudSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PCloudSession) : null;
  } catch {
    return null;
  }
}

function resolveClientId(creds?: Record<string, string>): string {
  return (
    (import.meta.env.VITE_PCLOUD_CLIENT_ID as string | undefined) ||
    creds?.clientId ||
    localStorage.getItem(CLIENT_ID_KEY) ||
    ''
  );
}

export function pcloudStorage(netFetch: Fetch): Storage {
  return {
    id: 'pcloud',
    label: 'pCloud',

    isAuthenticated: () => !!session(),

    get credentialFields() {
      if (resolveClientId()) return undefined;
      return [{ name: 'clientId', label: 'pCloud Client ID', placeholder: 'your-client-id' }];
    },

    async connect(creds?) {
      const clientId = resolveClientId(creds);
      if (!clientId) throw new Error('A pCloud Client ID is required — create one at pcloud.com/oauth2-apps');
      if (creds?.clientId) localStorage.setItem(CLIENT_ID_KEY, creds.clientId);

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

    disconnect() {
      localStorage.removeItem(STORAGE_KEY);
    },

    async load() {
      const s = session();
      if (!s) throw new Error('pCloud: not connected');

      try {
        const meta = await fetch(
          `https://${s.host}/getfilelink?path=${encodeURIComponent(FILE_PATH)}&auth=${s.token}`
        ).then(r => r.json() as Promise<Record<string, unknown>>);

        if (meta['result'] !== 0) return null;

        const hosts = meta['hosts'] as string[];
        const path = meta['path'] as string;
        const contentUrl = `https://${hosts[0]}${path}`;

        const res = await netFetch(contentUrl);
        if (!res.ok) {
          console.warn('pCloud load failed (starting with empty doc):', res.status);
          return null;
        }
        return new Uint8Array(await res.arrayBuffer());
      } catch (e) {
        console.warn('pCloud load failed (starting with empty doc):', e);
        return null;
      }
    },

    async save(bytes) {
      const s = session();
      if (!s) throw new Error('pCloud: not connected');

      const form = new FormData();
      form.append('filename', 'document.yjs');
      form.append('path', '/copad');
      form.append('nopartial', '1');
      form.append('file', new Blob([bytes as BlobPart]));

      const res = await netFetch(
        `https://${s.host}/uploadfile?auth=${s.token}`,
        { method: 'POST', body: form }
      );
      if (!res.ok) throw new Error(`pCloud save failed: ${res.status}`);
    },
  };
}
