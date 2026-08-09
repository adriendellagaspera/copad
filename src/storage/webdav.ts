import type { Storage, CredentialField, LoginOptions, DocContent } from './types.js';
import { DocFormat, InputType, LoginKind } from './types.js';
import type { StorageAuth } from './auth.js';
import type { Fetch } from '../network/types.js';
import { filenameStore } from './filename.js';
import { type WebDavConf, parseWebDavConf } from './parse.js';
import { localStore } from '../persistence/local.js';
import type { RoomId } from '../collaboration/types.js';
import { landed, writeFailure, classifyHttpStatus, WriteFailureKind, type WriteReceipt } from './writeOutcome.js';
import { STORAGE_ID, WEBDAV_KEY, DEFAULT_FILENAME } from './constants.js';

/** The WebDAV folder URL, normalized (no trailing slash) once accepted at `login()` time. */
export type WebDavBaseUrl = string & { readonly _brand: 'WebDavBaseUrl' };

/** Base64-encoded `username:password` Basic-auth header value, computed once at `login()` time. */
export type WebDavAuthHeader = string & { readonly _brand: 'WebDavAuthHeader' };

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
    help: 'The full DAV endpoint for the target folder, not just your server\'s domain — ' +
      'e.g. Nextcloud\'s is usually .../remote.php/dav/files/USERNAME/FOLDER.',
  },
  {
    name: 'username',
    label: 'Username',
    help: 'Your WebDAV account username — usually the same one you sign into the server\'s web UI with.',
  },
  {
    name: 'password',
    label: 'App password',
    type: InputType.Password,
    help: 'Most servers reject your account password here — generate a dedicated app password in ' +
      'its security settings instead.',
  },
];

export function webdavStorage(netFetch: Fetch, room: RoomId): { auth: StorageAuth; storage: Storage } {
  const fileName = filenameStore(STORAGE_ID.webdav, room);
  const conf = (): WebDavConf | null => confStore.read();

  const auth: StorageAuth = {
    isAuthenticated: () => !!conf(),

    async login(opts?: LoginOptions) {
      const creds = opts?.kind === LoginKind.Credentials ? opts.credentials : {};
      const { baseUrl = '', username = '', password = '' } = creds;
      if (!baseUrl.trim() || !username.trim())
        throw new Error('URL and username are required');

      const authHeader = btoa(`${username}:${password}`) as WebDavAuthHeader;

      const res = await netFetch(baseUrl.replace(/\/$/, ''), {
        method: 'HEAD',
        headers: { Authorization: `Basic ${authHeader}` },
      });

      if (res.status === 401) throw new Error('WebDAV: invalid credentials');
      if (!res.ok && res.status !== 404)
        throw new Error(`WebDAV connect failed: ${res.status}`);

      confStore.write({ baseUrl: baseUrl.replace(/\/$/, '') as WebDavBaseUrl, auth: authHeader });
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
    defaultFilename: () => DEFAULT_FILENAME,

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

    async save(content: DocContent): Promise<WriteReceipt> {
      if (content.format !== DocFormat.Binary) throw writeFailure(WriteFailureKind.Rejected, 'WebDAV storage expects binary content');
      const c = conf();
      if (!c) throw writeFailure(WriteFailureKind.Denied, 'WebDAV: not connected');

      const res = await netFetch(`${c.baseUrl}/${fileName.get()}`, {
        method: 'PUT',
        headers: {
          Authorization: `Basic ${c.auth}`,
          'Content-Type': 'application/octet-stream',
        },
        body: content.bytes as unknown as BodyInit,
      });

      if (![200, 201, 204].includes(res.status))
        throw writeFailure(classifyHttpStatus(res.status), `WebDAV save failed: ${res.status}`);
      return landed();
    },
  };

  return { auth, storage };
}
