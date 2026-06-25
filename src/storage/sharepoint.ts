import type { Storage, CredentialField, SessionCredentials, DocContent, StorageAccess } from './types.js';

// Microsoft Graph API — SharePoint / OneDrive for Business.
// Auth: a delegated access token with Files.ReadWrite.All (or Sites.ReadWrite.All) scope.
// The user obtains it from https://developer.microsoft.com/en-us/graph/graph-explorer
// or via their IT admin. OAuth2 MSAL popup support can be added later via configFields.

const STORAGE_KEY = 'storage.sharepoint';
const GRAPH = 'https://graph.microsoft.com/v1.0';

interface SharePointConf {
  readonly token: string;
  // When set, targets a SharePoint site. When absent, targets the user's OneDrive.
  readonly siteId: string | null;
  readonly path: string;     // file path relative to the drive root
}

function conf(): SharePointConf | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SharePointConf) : null;
  } catch {
    return null;
  }
}

function persistConf(c: SharePointConf): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

// Graph endpoint for a drive item's content, relative to the drive root.
function driveContentUrl(conf: SharePointConf): string {
  const base = conf.siteId
    ? `${GRAPH}/sites/${conf.siteId}/drive`
    : `${GRAPH}/me/drive`;
  return `${base}/root:/${conf.path}:/content`;
}

function driveItemUrl(conf: SharePointConf): string {
  const base = conf.siteId
    ? `${GRAPH}/sites/${conf.siteId}/drive`
    : `${GRAPH}/me/drive`;
  return `${base}/root:/${conf.path}`;
}

// Response shapes at the Microsoft Graph API IO boundary.
interface GraphSiteResponse {
  readonly id: string;
}

interface GraphItemResponse {
  readonly createdBy?: { readonly user?: { readonly id?: string } };
  readonly parentReference?: { readonly siteId?: string };
}

interface GraphMeResponse {
  readonly id: string;
}

const credentialFields: CredentialField[] = [
  {
    name: 'token',
    label: 'Access token',
    type: 'password',
    placeholder: 'eyJ0eXAi…',
  },
  {
    name: 'siteUrl',
    label: 'SharePoint site URL (leave blank for OneDrive)',
    placeholder: 'https://contoso.sharepoint.com/sites/mysite',
  },
  { name: 'path', label: 'File path', placeholder: 'Documents/copad.md' },
];

async function resolveSiteId(token: string, siteUrl: string): Promise<string> {
  const url = new URL(siteUrl);
  const res = await fetch(
    `${GRAPH}/sites/${url.hostname}:${url.pathname}`,
    { headers: authHeaders(token) }
  );
  if (!res.ok) throw new Error(`SharePoint: cannot resolve site ${siteUrl} (${res.status})`);
  return ((await res.json()) as GraphSiteResponse).id;
}

export function sharepointStorage(): Storage {
  return {
    id: 'sharepoint',
    label: 'SharePoint / OneDrive',
    blurb: 'Saves to a file in SharePoint or OneDrive for Business via Microsoft Graph.',
    credentialFields,

    isAuthenticated: () => !!conf(),

    contentFormat: 'text',

    async connect(creds: SessionCredentials = {}) {
      const { token = '', siteUrl = '', path = '' } = creds;
      if (!token.trim() || !path.trim()) throw new Error('Access token and file path are required');

      // Validate the token works.
      const meRes = await fetch(`${GRAPH}/me`, { headers: authHeaders(token) });
      if (meRes.status === 401) throw new Error('SharePoint: invalid or expired token');
      if (!meRes.ok) throw new Error(`SharePoint connect failed: ${meRes.status}`);
      await meRes.json() as GraphMeResponse;

      const siteId = siteUrl.trim()
        ? await resolveSiteId(token, siteUrl.trim())
        : null;

      persistConf({ token, siteId, path: path.replace(/^\//, '') });
    },

    disconnect() {
      localStorage.removeItem(STORAGE_KEY);
    },

    async load(): Promise<DocContent | null> {
      const c = conf();
      if (!c) throw new Error('SharePoint: not connected');

      const res = await fetch(driveContentUrl(c), { headers: authHeaders(c.token) });

      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`SharePoint load failed: ${res.status}`);

      const text = await res.text();
      return { format: 'text', text };
    },

    async save(content: DocContent): Promise<void> {
      if (content.format !== 'text') throw new Error('SharePoint storage expects text content');
      const c = conf();
      if (!c) throw new Error('SharePoint: not connected');

      const res = await fetch(driveContentUrl(c), {
        method: 'PUT',
        headers: { ...authHeaders(c.token), 'Content-Type': 'text/plain; charset=utf-8' },
        body: content.text,
      });

      if (!res.ok) throw new Error(`SharePoint save failed: ${res.status}`);
    },

    async access(): Promise<StorageAccess> {
      const c = conf();
      if (!c) throw new Error('SharePoint: not connected');

      // Resolve the current user's id to compare against the file's createdBy.
      const [meRes, itemRes] = await Promise.all([
        fetch(`${GRAPH}/me`, { headers: authHeaders(c.token) }),
        fetch(driveItemUrl(c), { headers: authHeaders(c.token) }),
      ]);

      if (!meRes.ok || !itemRes.ok) return 'read';

      const me = await meRes.json() as GraphMeResponse;
      const item = await itemRes.json() as GraphItemResponse;

      if (item.createdBy?.user?.id === me.id) return 'owner';
      return 'write';
    },
  };
}
