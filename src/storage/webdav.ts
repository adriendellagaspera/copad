import type { Storage, CredentialField, SessionCredentials, DocContent } from './types.js';
import type { Fetch } from '../network/types.js';
import { filenameStore } from './filename.js';

const fileName = filenameStore('webdav');
const STORAGE_KEY = 'storage.webdav';

interface WebDavConf {
  baseUrl: string;
  auth: string;
}

function conf(): WebDavConf | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as WebDavConf) : null;
  } catch {
    return null;
  }
}

const credentialFields: CredentialField[] = [
  {
    name: 'baseUrl',
    label: 'WebDAV folder URL',
    placeholder:
      import.meta.env.VITE_WEBDAV_URL ||
      'https://cloud.example.com/remote.php/dav/files/USER/Collab',
  },
  { name: 'username', label: 'Username' },
  { name: 'password', label: 'App password', type: 'password' },
];

export function webdavStorage(netFetch: Fetch): Storage {
  return {
    id: 'webdav',
    label: 'WebDAV / Nextcloud',
    blurb: 'Saves to any WebDAV server (Nextcloud, ownCloud…) using a login.',
    credentialFields,

    filename: () => fileName.get(),
    setFilename: fileName.set,

    isAuthenticated: () => !!conf(),

    contentFormat: 'binary',

    async connect(creds: SessionCredentials = {}) {
      const { baseUrl = '', username = '', password = '' } = creds;
      if (!baseUrl.trim() || !username.trim())
        throw new Error('URL and username are required');

      const auth = btoa(`${username}:${password}`);

      const res = await netFetch(baseUrl.replace(/\/$/, ''), {
        method: 'HEAD',
        headers: { Authorization: `Basic ${auth}` },
      });

      if (res.status === 401) throw new Error('WebDAV: invalid credentials');
      if (!res.ok && res.status !== 404)
        throw new Error(`WebDAV connect failed: ${res.status}`);

      localStorage.setItem(STORAGE_KEY, JSON.stringify({ baseUrl: baseUrl.replace(/\/$/, ''), auth }));
    },

    disconnect() {
      localStorage.removeItem(STORAGE_KEY);
    },

    async load(): Promise<DocContent | null> {
      const c = conf();
      if (!c) throw new Error('WebDAV: not connected');

      const res = await netFetch(`${c.baseUrl}/${fileName.get()}`, {
        headers: { Authorization: `Basic ${c.auth}` },
      });

      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`WebDAV load failed: ${res.status}`);
      return { format: 'binary', bytes: new Uint8Array(await res.arrayBuffer()) };
    },

    async save(content: DocContent): Promise<void> {
      if (content.format !== 'binary') throw new Error('WebDAV storage expects binary content');
      const c = conf();
      if (!c) throw new Error('WebDAV: not connected');

      const res = await netFetch(`${c.baseUrl}/${fileName.get()}`, {
        method: 'PUT',
        headers: {
          Authorization: `Basic ${c.auth}`,
          'Content-Type': 'application/octet-stream',
        },
        body: content.bytes as unknown as BodyInit,
      });

      if (![200, 201, 204].includes(res.status))
        throw new Error(`WebDAV save failed: ${res.status}`);
    },
  };
}
