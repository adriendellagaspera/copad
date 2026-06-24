import pcloudSdk from 'pcloud-sdk-js';
import type { Storage } from './types.js';
import { netFetch, hasProxy } from './net.js';

const FILE_PATH = '/copad/document.yjs';
const STORAGE_KEY = 'storage.pcloud';

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

export function pcloudStorage(): Storage {
  return {
    id: 'pcloud',
    label: 'pCloud',

    isAuthenticated: () => !!session(),

    async connect() {
      await new Promise<void>((resolve, reject) => {
        pcloudSdk.oauth.popup(
          import.meta.env.VITE_PCLOUD_CLIENT_ID,
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

      if (!hasProxy) {
        console.warn(
          'pCloud save: no VITE_PROXY_URL set — request may fail due to CORS'
        );
      }

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
