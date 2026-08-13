import type { CredentialField, DocContent, Filename, LoginOptions, Storage, StorageLabel } from './types.js';
import { DocFormat, InputType, LoginKind, StorageAccess } from './types.js';
import type { StorageAuth } from './auth.js';
import { filenameStore } from './filename.js';
import { extensionOf } from '../format/types.js';
import {
  type SharePointConf,
  parseSharePointConf,
  parseSharePointFolder,
  parseGraphUserId,
  parseGraphSiteId,
  parseGraphOwnerId,
} from './parse.js';
import { localStore } from '../persistence/local.js';
import type { RoomId } from '../collaboration/types.js';
import { landed, writeFailure, classifyHttpStatus, WriteFailureKind, type WriteReceipt } from './writeOutcome.js';
import { STORAGE_ID, DEFAULT_FILENAME, GRAPH_API_URL, SHAREPOINT_FOLDER, SHAREPOINT_KEY } from './constants.js';

// Microsoft Graph auth: a delegated Files.ReadWrite.All/Sites.ReadWrite.All token pasted by the user, short-lived like a WebDAV app password.

export type GraphUserId = string & { readonly _brand: 'GraphUserId' };
export type GraphSiteId = string & { readonly _brand: 'GraphSiteId' };
export type SharePointToken = string & { readonly _brand: 'SharePointToken' };
export type SharePointFolder = string & { readonly _brand: 'SharePointFolder' };

const confStore = localStore<SharePointConf | null>(
  SHAREPOINT_KEY,
  parseSharePointConf,
  (c) => (c ? JSON.stringify(c) : null),
);

const credentialFields: CredentialField[] = [
  {
    name: 'token',
    label: 'Access token',
    type: InputType.Password,
    placeholder: 'eyJ0eXAi…',
    help: 'A delegated Microsoft Graph token (Files.ReadWrite.All), pasted from Graph ' +
      'Explorer or your IT admin. Short-lived, expires after about an hour, so you\'ll ' +
      'need to reconnect with a fresh one periodically.',
  },
  {
    name: 'siteUrl',
    label: 'SharePoint site URL (blank = OneDrive)',
    placeholder: 'https://contoso.sharepoint.com/sites/mysite',
    help: 'Leave blank to use your personal OneDrive instead of a SharePoint site.',
  },
  {
    name: 'folder',
    label: 'Folder',
    placeholder: SHAREPOINT_FOLDER,
    help: `Drive folder to store the document in. Defaults to "${SHAREPOINT_FOLDER}".`,
  },
];

function authHeaders(token: SharePointToken): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

function driveRoot(c: SharePointConf): string {
  return c.siteId ? `${GRAPH_API_URL}/sites/${c.siteId}/drive` : `${GRAPH_API_URL}/me/drive`;
}

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

// A pasted Graph token lasts ~1h, so a mid-session 401/403 means expiry, not denial.
function graphErrorMessage(action: string, status: number): string {
  return status === 401 || status === 403
    ? 'SharePoint: your session has expired. Reconnect with a fresh access token in Settings.'
    : `SharePoint ${action} failed: ${status}`;
}

async function resolveSiteId(token: SharePointToken, siteUrl: string): Promise<GraphSiteId> {
  const url = new URL(siteUrl);
  const res = await fetch(`${GRAPH_API_URL}/sites/${url.hostname}:${url.pathname}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`SharePoint: cannot resolve site ${siteUrl} (${res.status})`);
  return parseGraphSiteId(await res.json());
}

export function sharepointStorage(room: RoomId): { auth: StorageAuth; storage: Storage } {
  const fileName = filenameStore(STORAGE_ID.sharepoint, room);
  const conf = (): SharePointConf | null => confStore.read();

  const auth: StorageAuth = {
    isAuthenticated: () => !!conf(),

    async login(opts?: LoginOptions) {
      const creds = opts?.kind === LoginKind.Credentials ? opts.credentials : {};
      const { token = '', siteUrl = '', folder = '' } = creds;
      const rawToken = token.trim();
      if (!rawToken) throw new Error('An access token is required');

      // Raw string on purpose: this call is what brands the token.
      const meRes = await fetch(`${GRAPH_API_URL}/me`, { headers: { Authorization: `Bearer ${rawToken}` } });
      if (meRes.status === 401) throw new Error('SharePoint: invalid or expired token');
      if (!meRes.ok) throw new Error(`SharePoint connect failed: ${meRes.status}`);
      const validToken = rawToken as SharePointToken;

      const siteId = siteUrl.trim() ? await resolveSiteId(validToken, siteUrl.trim()) : null;
      confStore.write({
        token: validToken,
        siteId,
        folder: parseSharePointFolder(folder),
      });
    },

    logout() {
      confStore.clear();
    },

    credentialFields,
  };

  const storage: Storage = {
    id: STORAGE_ID.sharepoint,
    label: 'SharePoint / OneDrive' as StorageLabel,
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
      if (!res.ok) throw writeFailure(classifyHttpStatus(res.status), graphErrorMessage('load', res.status));

      const bytes = new Uint8Array(await res.arrayBuffer());
      if (storage.contentFormat === DocFormat.Text) {
        return { format: DocFormat.Text, text: new TextDecoder().decode(bytes) };
      }
      return { format: DocFormat.Binary, bytes };
    },

    async save(content: DocContent): Promise<WriteReceipt> {
      const c = conf();
      if (!c) throw writeFailure(WriteFailureKind.Denied, 'SharePoint: not connected');

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
      if (!res.ok) throw writeFailure(classifyHttpStatus(res.status), graphErrorMessage('save', res.status));
      return landed();
    },

    async access(): Promise<StorageAccess> {
      const c = conf();
      if (!c) throw new Error('SharePoint: not connected');

      const [meRes, itemRes] = await Promise.all([
        fetch(`${GRAPH_API_URL}/me`, { headers: authHeaders(c.token) }),
        fetch(driveItemUrl(c, fileName.get()), { headers: authHeaders(c.token) }),
      ]);
      if (!meRes.ok || !itemRes.ok) return StorageAccess.Write;

      const meId = parseGraphUserId(await meRes.json());
      const ownerId = parseGraphOwnerId(await itemRes.json());
      return ownerId === meId ? StorageAccess.Owner : StorageAccess.Write;
    },
  };

  return { auth, storage };
}
