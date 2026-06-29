import type { Storage, CredentialField, LoginOptions, DocContent } from './types.js';
import { DocFormat, InputType, LoginKind } from './types.js';
import type { StorageAuth } from './auth.js';
import type { Fetch } from '../network/types.js';
import { filenameStore } from './filename.js';
import { type WebDavConf, parseWebDavConf } from './parse.js';
import { localStore } from '../persistence/local.js';
import { STORAGE_ID, WEBDAV_KEY } from './constants.js';

const fileName = filenameStore(STORAGE_ID.webdav);
const confStore = localStore<WebDavConf | null>(
  WEBDAV_KEY,
  parseWebDavConf,
  (c) => (c ? JSON.stringify(c) : null),
);

const credentialFields: CredentialField[] = [
  {
    name: 'baseUrl',
    label: 'WebDAV folder URL',
    placeholder:
      import.meta.env.VITE_WEBDAV_URL ||
      'https://cloud.example.com/remote.php/dav/files/USER/Collab',
  },
  { name: 'username', label: 'Username' },
  { name: 'password', label: 'App password', type: InputType.Password },
];

export function webdavStorage(netFetch: Fetch): { auth: StorageAuth; storage: Storage } {
  const conf = (): WebDavConf | null => confStore.read();

  const auth: StorageAuth = {
    isAuthenticated: () => !!conf(),

    async login(opts?: LoginOptions) {
      const creds = opts?.kind === LoginKind.Credentials ? opts.credentials : {};
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

      confStore.write({ baseUrl: baseUrl.replace(/\/$/, ''), auth: authHeader });
    },

    logout() {
      confStore.clear();
    },

    credentialFields,
  };

  const storage: Storage = {
    id: STORAGE_ID.webdav,
    label: 'WebDAV / Nextcloud',
    blurb: 'Saves to any WebDAV server (Nextcloud, ownCloud…) using a login.',
    availability: { ok: true },

    filename: () => fileName.get(),
    setFilename: fileName.set,

    contentFormat: DocFormat.Binary,

    async load(): Promise<DocContent | null> {
      const c = conf();
      if (!c) throw new Error('WebDAV: not connected');

      const res = await netFetch(`${c.baseUrl}/${fileName.get()}`, {
        headers: { Authorization: `Basic ${c.auth}` },
      });

      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`WebDAV load failed: ${res.status}`);
      return { format: DocFormat.Binary, bytes: new Uint8Array(await res.arrayBuffer()) };
    },

    async save(content: DocContent): Promise<void> {
      if (content.format !== DocFormat.Binary) throw new Error('WebDAV storage expects binary content');
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
