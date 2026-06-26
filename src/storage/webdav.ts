import type { Storage, CredentialField, SessionCredentials, DocContent } from './types.js';
import type { StorageAuth } from './auth.js';
import type { Fetch } from '../network/types.js';
import { filenameStore } from './filename.js';
import { readJSON, writeJSON, removeKey } from '../localStore.js';

const fileName = filenameStore('webdav');
const STORAGE_KEY = 'storage.webdav';

interface WebDavConf {
  baseUrl: string;
  auth: string;
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

export function webdavStorage(netFetch: Fetch): { auth: StorageAuth; storage: Storage } {
  const conf = (): WebDavConf | null => readJSON<WebDavConf | null>(STORAGE_KEY, null);

  const auth: StorageAuth = {
    isAuthenticated: () => !!conf(),

    async login(creds: SessionCredentials = {}) {
      const { baseUrl = '', username = '', password = '' } = creds;
      if (!baseUrl.trim() || !username.trim())
        throw new Error('URL and username are required');

      const authHeader = btoa(`${username}:${password}`);

      const res = await netFetch(baseUrl.replace(/\/$/, ''), {
        method: 'HEAD',
        headers: { Authorization: `Basic ${authHeader}` },
      });

      if (res.status === 401) throw new Error('WebDAV: invalid credentials');
      if (!res.ok && res.status !== 404)
        throw new Error(`WebDAV connect failed: ${res.status}`);

      writeJSON(STORAGE_KEY, { baseUrl: baseUrl.replace(/\/$/, ''), auth: authHeader });
    },

    logout() {
      removeKey(STORAGE_KEY);
    },

    credentialFields,
  };

  const storage: Storage = {
    id: 'webdav',
    label: 'WebDAV / Nextcloud',
    blurb: 'Saves to any WebDAV server (Nextcloud, ownCloud…) using a login.',

    filename: () => fileName.get(),
    setFilename: fileName.set,

    contentFormat: 'binary',

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

  return { auth, storage };
}
