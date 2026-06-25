import type { Storage, DocContent, StorageAccess } from './types.js';
import { configStore } from './config.js';
import { pkceChallenge, openOAuthPopup } from './oauth.js';

// Google Drive storage — stores the document as a plain-text file in the
// user's Drive (app-data folder if scope allows, otherwise root).
// One-time setup: register an OAuth app in Google Cloud Console and paste
// the Client ID in Settings. Scope: drive.file (access only to files
// created by this app).

const FILE_NAME = 'copad.md';
const STORAGE_KEY = 'storage.gdrive';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';

interface GDriveConf {
  readonly accessToken: string;
  // Google Drive file ID, obtained after first save and reused for updates.
  readonly fileId: string | null;
}

function conf(): GDriveConf | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as GDriveConf) : null;
  } catch {
    return null;
  }
}

function persistConf(c: GDriveConf): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
}

const cfg = configStore('gdrive', [
  {
    name: 'clientId',
    label: 'Client ID',
    placeholder: 'your-client-id.apps.googleusercontent.com',
    help: 'Create an OAuth 2.0 Web App credential at console.cloud.google.com and enable the Drive API.',
    env: import.meta.env.VITE_GDRIVE_CLIENT_ID as string | undefined,
  },
]);

// Response shapes at the Google Drive API IO boundary.
interface DriveFile {
  readonly id: string;
  readonly name: string;
  readonly capabilities?: { readonly canEdit?: boolean };
}

interface DriveFileList {
  readonly files: readonly DriveFile[];
}

interface TokenResponse {
  readonly access_token: string;
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

async function findExistingFile(token: string): Promise<string | null> {
  const q = encodeURIComponent(`name='${FILE_NAME}' and trashed=false`);
  const res = await fetch(`${DRIVE_FILES}?q=${q}&fields=files(id)`, { headers: authHeaders(token) });
  if (!res.ok) return null;
  const data = await res.json() as DriveFileList;
  return data.files[0]?.id ?? null;
}

export function gdriveStorage(): Storage {
  return {
    id: 'gdrive',
    label: 'Google Drive',
    blurb: 'Saves to a Google Drive file via OAuth. Requires a Google Cloud Client ID in Settings.',

    configFields: cfg.fields,
    config: cfg.config,
    setConfig: cfg.setConfig,
    configLocked: cfg.configLocked,
    configured: cfg.configured,

    isAuthenticated: () => !!conf(),

    contentFormat: 'text',

    async connect() {
      const clientId = cfg.config('clientId');
      if (!clientId) throw new Error('Add a Google Cloud Client ID in Settings first.');

      const REDIRECT_URI =
        import.meta.env.VITE_REDIRECT_URI ?? `${location.origin}/redirect.html`;

      const { verifier, challenge } = await pkceChallenge();
      const state = crypto.randomUUID();

      const params = new URLSearchParams({
        client_id: clientId,
        response_type: 'code',
        redirect_uri: REDIRECT_URI,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
        scope: SCOPE,
        access_type: 'offline',
        prompt: 'consent',
      });

      const code = await openOAuthPopup(`${AUTH_URL}?${params}`, state);

      const tokenRes = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          grant_type: 'authorization_code',
          client_id: clientId,
          redirect_uri: REDIRECT_URI,
          code_verifier: verifier,
        }),
      });

      if (!tokenRes.ok) throw new Error(`Google Drive token exchange failed: ${tokenRes.status}`);
      const { access_token } = await tokenRes.json() as TokenResponse;

      const fileId = await findExistingFile(access_token);
      persistConf({ accessToken: access_token, fileId });
    },

    disconnect() {
      localStorage.removeItem(STORAGE_KEY);
    },

    async load(): Promise<DocContent | null> {
      const c = conf();
      if (!c) throw new Error('Google Drive: not connected');

      // Refresh file ID in case a previous session created the file.
      const fileId = c.fileId ?? await findExistingFile(c.accessToken);
      if (!fileId) return null;

      const res = await fetch(`${DRIVE_FILES}/${fileId}?alt=media`, { headers: authHeaders(c.accessToken) });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Google Drive load failed: ${res.status}`);

      persistConf({ ...c, fileId });
      return { format: 'text', text: await res.text() };
    },

    async save(content: DocContent): Promise<void> {
      if (content.format !== 'text') throw new Error('Google Drive storage expects text content');
      const c = conf();
      if (!c) throw new Error('Google Drive: not connected');

      const body = content.text;
      const mime = 'text/plain';

      if (c.fileId) {
        // Update existing file (simple upload — file is small).
        const res = await fetch(`${DRIVE_UPLOAD}/${c.fileId}?uploadType=media`, {
          method: 'PATCH',
          headers: { ...authHeaders(c.accessToken), 'Content-Type': mime },
          body,
        });
        if (!res.ok) throw new Error(`Google Drive save failed: ${res.status}`);
      } else {
        // Create file with metadata + content via multipart upload.
        const boundary = '-------copad_boundary';
        const meta = JSON.stringify({ name: FILE_NAME, mimeType: mime });
        const multipart =
          `--${boundary}\r\n` +
          `Content-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
          `--${boundary}\r\n` +
          `Content-Type: ${mime}\r\n\r\n${body}\r\n` +
          `--${boundary}--`;

        const res = await fetch(`${DRIVE_UPLOAD}?uploadType=multipart&fields=id`, {
          method: 'POST',
          headers: {
            ...authHeaders(c.accessToken),
            'Content-Type': `multipart/related; boundary="${boundary}"`,
          },
          body: multipart,
        });
        if (!res.ok) throw new Error(`Google Drive create failed: ${res.status}`);
        const data = await res.json() as DriveFile;
        persistConf({ ...c, fileId: data.id });
      }
    },

    async access(): Promise<StorageAccess> {
      const c = conf();
      if (!c) throw new Error('Google Drive: not connected');
      if (!c.fileId) return 'write';

      const res = await fetch(
        `${DRIVE_FILES}/${c.fileId}?fields=capabilities(canEdit)`,
        { headers: authHeaders(c.accessToken) }
      );
      if (!res.ok) return 'read';

      const data = await res.json() as DriveFile;
      return data.capabilities?.canEdit ? 'write' : 'read';
    },
  };
}
