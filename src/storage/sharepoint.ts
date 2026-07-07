import type { Storage, CredentialField, LoginOptions, DocContent, Filename } from './types.js';
import { DocFormat, InputType, LoginKind, StorageAccess } from './types.js';
import type { StorageAuth } from './auth.js';
import { filenameStore } from './filename.js';
import { extensionOf } from '../format/types.js';
import {
  type SharePointConf,
  parseSharePointConf,
  parseGraphId,
  parseGraphOwnerId,
} from './parse.js';
import { localStore } from '../persistence/local.js';
import type { RoomId } from '../collaboration/types.js';
import { STORAGE_ID, DEFAULT_FILENAME, GRAPH_API_URL, SHAREPOINT_FOLDER, SHAREPOINT_KEY } from './constants.js';

// Microsoft Graph — SharePoint / OneDrive for Business.
// Auth: a delegated access token with Files.ReadWrite.All (or Sites.ReadWrite.All)
// scope, obtained from Graph Explorer or an IT admin. A pasted token is
// short-lived (like a WebDAV app password); a full MSAL popup flow can be added
// later behind configFields without changing this port.

const confStore = localStore<SharePointConf | null>(
  SHAREPOINT_KEY,
  parseSharePointConf,
  (c) => (c ? JSON.stringify(c) : null),
);

const credentialFields: CredentialField[] = [
  { name: 'token', label: 'Access token', type: InputType.Password, placeholder: 'eyJ0eXAi…' },
  {
    name: 'siteUrl',
    label: 'SharePoint site URL (blank = OneDrive)',
    placeholder: 'https://contoso.sharepoint.com/sites/mysite',
  },
  { name: 'folder', label: 'Folder', placeholder: SHAREPOINT_FOLDER },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

/** The drive root — a SharePoint site's default drive, or the user's OneDrive. */
function driveRoot(c: SharePointConf): string {
  return c.siteId ? `${GRAPH_API_URL}/sites/${c.siteId}/drive` : `${GRAPH_API_URL}/me/drive`;
}

/** Path to the target file, relative to the drive root (folder + per-room name). */
function itemPath(c: SharePointConf, filename: Filename): string {
  const folder = c.folder.replace(/^\/+|\/+$/g, '');
  return [folder, filename].filter(Boolean).join('/');
}

function driveItemUrl(c: SharePointConf, filename: Filename): string {
  return `${driveRoot(c)}/root:/${itemPath(c, filename)}`;
}

function driveContentUrl(c: SharePointConf, filename: Filename): string {
  return `${driveItemUrl(c, filename)}:/content`;
}

/** Resolve a SharePoint site URL to its Graph site id. */
async function resolveSiteId(token: string, siteUrl: string): Promise<string> {
  const url = new URL(siteUrl);
  const res = await fetch(`${GRAPH_API_URL}/sites/${url.hostname}:${url.pathname}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`SharePoint: cannot resolve site ${siteUrl} (${res.status})`);
  return parseGraphId(await res.json());
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function sharepointStorage(room: RoomId): { auth: StorageAuth; storage: Storage } {
  const fileName = filenameStore(STORAGE_ID.sharepoint, room);
  const conf = (): SharePointConf | null => confStore.read();

  const auth: StorageAuth = {
    isAuthenticated: () => !!conf(),

    async login(opts?: LoginOptions) {
      const creds = opts?.kind === LoginKind.Credentials ? opts.credentials : {};
      const { token = '', siteUrl = '', folder = '' } = creds;
      if (!token.trim()) throw new Error('An access token is required');

      // Validate the token works.
      const meRes = await fetch(`${GRAPH_API_URL}/me`, { headers: authHeaders(token.trim()) });
      if (meRes.status === 401) throw new Error('SharePoint: invalid or expired token');
      if (!meRes.ok) throw new Error(`SharePoint connect failed: ${meRes.status}`);

      const siteId = siteUrl.trim() ? await resolveSiteId(token.trim(), siteUrl.trim()) : null;
      confStore.write({
        token: token.trim(),
        siteId,
        folder: folder.trim() || SHAREPOINT_FOLDER,
      });
    },

    logout() {
      confStore.clear();
    },

    credentialFields,
  };

  const storage: Storage = {
    id: STORAGE_ID.sharepoint,
    label: 'SharePoint / OneDrive',
    blurb: 'Saves to a file in SharePoint or OneDrive for Business via Microsoft Graph.',
    availability: { ok: true },

    filename: () => fileName.get(),
    setFilename: fileName.set,
    defaultFilename: () => DEFAULT_FILENAME,

    get contentFormat(): DocFormat {
      return extensionOf(fileName.get()) === '.yjs' ? DocFormat.Binary : DocFormat.Text;
    },

    async load(): Promise<DocContent | null> {
      const c = conf();
      if (!c) throw new Error('SharePoint: not connected');

      const res = await fetch(driveContentUrl(c, fileName.get()), { headers: authHeaders(c.token) });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`SharePoint load failed: ${res.status}`);

      const bytes = new Uint8Array(await res.arrayBuffer());
      if (storage.contentFormat === DocFormat.Text) {
        return { format: DocFormat.Text, text: new TextDecoder().decode(bytes) };
      }
      return { format: DocFormat.Binary, bytes };
    },

    async save(content: DocContent): Promise<void> {
      const c = conf();
      if (!c) throw new Error('SharePoint: not connected');

      const bytes =
        content.format === DocFormat.Text
          ? new TextEncoder().encode(content.text)
          : content.bytes;
      const mime = content.format === DocFormat.Text
        ? 'text/plain; charset=utf-8'
        : 'application/octet-stream';

      const res = await fetch(driveContentUrl(c, fileName.get()), {
        method: 'PUT',
        headers: { ...authHeaders(c.token), 'Content-Type': mime },
        body: bytes as unknown as BodyInit,
      });
      if (!res.ok) throw new Error(`SharePoint save failed: ${res.status}`);
    },

    async access(): Promise<StorageAccess> {
      const c = conf();
      if (!c) throw new Error('SharePoint: not connected');

      const [meRes, itemRes] = await Promise.all([
        fetch(`${GRAPH_API_URL}/me`, { headers: authHeaders(c.token) }),
        fetch(driveItemUrl(c, fileName.get()), { headers: authHeaders(c.token) }),
      ]);
      if (!meRes.ok || !itemRes.ok) return StorageAccess.Write;

      const meId = parseGraphId(await meRes.json());
      const ownerId = parseGraphOwnerId(await itemRes.json());
      return ownerId === meId ? StorageAccess.Owner : StorageAccess.Write;
    },
  };

  return { auth, storage };
}
