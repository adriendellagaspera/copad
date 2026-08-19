import type { Filename, StorageId } from './types.js';
import { storageKey, type StorageKey } from '../persistence/local.js';
import type { Milliseconds } from '../time.js';

// ── Backend ids (single source of truth) ──────────────────────────────────────

function storageIds<const Ids extends readonly string[]>(
  ...ids: Ids
): { readonly [Id in Ids[number]]: StorageId } {
  return Object.fromEntries(ids.map((id) => [id, id])) as {
    readonly [Id in Ids[number]]: StorageId;
  };
}

export const STORAGE_ID = storageIds('dropbox', 'pcloud', 'webdav', 'github', 'gitlab', 's3', 'sharepoint', 'gdrive', 'onedrive', 'local');

export type ConfigFieldName = string & { readonly _brand: 'ConfigFieldName' };

export type KeyPurpose =
  | 'token'
  | 'session'
  | 'conf'
  | 'validated'
  | 'rooms'
  | ConfigFieldName;

export const backendKey = (id: StorageId, purpose: KeyPurpose): StorageKey =>
  storageKey(`storage.${id}.${purpose}`);

// ── Env-override helpers (the env IO boundary for this vertical) ───────────────

const envStr = (raw: string | undefined, fallback: string): string => {
  const v = raw?.trim();
  return v ? v : fallback;
};

const envInt = (raw: string | undefined, fallback: number): number => {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

const envBool = (raw: string | undefined, fallback: boolean): boolean => {
  const v = raw?.trim().toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes') return true;
  if (v === '0' || v === 'false' || v === 'no') return false;
  return fallback;
};

// ── Backend enable/disable ──────────────────────────────────────────────────────

// Defaults to disabled outside production until connected to a real account; flip to true in its own PR then.
export const BACKEND_ENABLED: Record<StorageId, boolean> = {
  [STORAGE_ID.dropbox]: envBool(import.meta.env.VITE_ENABLE_DROPBOX, false),
  [STORAGE_ID.pcloud]: envBool(import.meta.env.VITE_ENABLE_PCLOUD, false),
  [STORAGE_ID.webdav]: envBool(import.meta.env.VITE_ENABLE_WEBDAV, true),
  [STORAGE_ID.github]: envBool(import.meta.env.VITE_ENABLE_GITHUB, false),
  [STORAGE_ID.local]: envBool(import.meta.env.VITE_ENABLE_LOCAL, true),
  [STORAGE_ID.gitlab]: envBool(import.meta.env.VITE_ENABLE_GITLAB, false),
  [STORAGE_ID.s3]: envBool(import.meta.env.VITE_ENABLE_S3, false),
  [STORAGE_ID.sharepoint]: envBool(import.meta.env.VITE_ENABLE_SHAREPOINT, false),
  [STORAGE_ID.gdrive]: envBool(import.meta.env.VITE_ENABLE_GDRIVE, false),
  [STORAGE_ID.onedrive]: envBool(import.meta.env.VITE_ENABLE_ONEDRIVE, false),
};

// ── Cloud folder + default filenames ──────────────────────────────────────────

export const CLOUD_FOLDER = envStr(import.meta.env.VITE_CLOUD_FOLDER, '/copad');
export const DEFAULT_FILENAME = envStr(import.meta.env.VITE_DEFAULT_FILENAME, 'document.yjs') as Filename;
export const GITHUB_DEFAULT_FILENAME = envStr(import.meta.env.VITE_GITHUB_DEFAULT_FILENAME, 'notes.md') as Filename;
export const GITLAB_DEFAULT_FILENAME = envStr(import.meta.env.VITE_GITLAB_DEFAULT_FILENAME, 'notes.md') as Filename;

// ── GitHub ────────────────────────────────────────────────────────────────────

export const GITHUB_API_URL = envStr(import.meta.env.VITE_GITHUB_API_URL, 'https://api.github.com');
export const GITHUB_DEFAULT_BRANCH = 'main';
export const GITHUB_VALIDATED_KEY: StorageKey = backendKey(STORAGE_ID.github, 'validated');

// ── GitLab ──────────────────────────────────────────────────────────────────

export const GITLAB_DEFAULT_HOST = envStr(import.meta.env.VITE_GITLAB_HOST, 'https://gitlab.com');
export const GITLAB_API_PATH = envStr(import.meta.env.VITE_GITLAB_API_PATH, '/api/v4');
export const GITLAB_DEFAULT_BRANCH = 'main';
export const GITLAB_VALIDATED_KEY: StorageKey = backendKey(STORAGE_ID.gitlab, 'validated');

// ── S3-compatible ───────────────────────────────────────────────────────────

export const S3_PREFIX = envStr(import.meta.env.VITE_S3_PREFIX, 'copad');
export const S3_KEY: StorageKey = backendKey(STORAGE_ID.s3, 'conf');

// ── SharePoint / OneDrive (Microsoft Graph) ─────────────────────────────────

export const GRAPH_API_URL = envStr(import.meta.env.VITE_GRAPH_API_URL, 'https://graph.microsoft.com/v1.0');
export const SHAREPOINT_FOLDER = envStr(import.meta.env.VITE_SHAREPOINT_FOLDER, 'Documents');
export const SHAREPOINT_KEY: StorageKey = backendKey(STORAGE_ID.sharepoint, 'conf');

// ── Google Drive ────────────────────────────────────────────────────────────

export const GDRIVE_AUTH_URL = envStr(import.meta.env.VITE_GDRIVE_AUTH_URL, 'https://accounts.google.com/o/oauth2/v2/auth');
export const GDRIVE_TOKEN_URL = envStr(import.meta.env.VITE_GDRIVE_TOKEN_URL, 'https://oauth2.googleapis.com/token');
export const GDRIVE_FILES_URL = envStr(import.meta.env.VITE_GDRIVE_FILES_URL, 'https://www.googleapis.com/drive/v3/files');
export const GDRIVE_UPLOAD_URL = envStr(import.meta.env.VITE_GDRIVE_UPLOAD_URL, 'https://www.googleapis.com/upload/drive/v3/files');
export const GDRIVE_SCOPE = envStr(import.meta.env.VITE_GDRIVE_SCOPE, 'https://www.googleapis.com/auth/drive.file');
export const GDRIVE_TOKEN_KEY: StorageKey = backendKey(STORAGE_ID.gdrive, 'token');

// ── OneDrive (personal — Microsoft identity platform "consumers" tenant) ────
// `consumers` accepts only personal accounts; sharepointStorage() handles OneDrive-for-Business, no overlap.

export const ONEDRIVE_AUTH_URL = envStr(import.meta.env.VITE_ONEDRIVE_AUTH_URL, 'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize');
export const ONEDRIVE_TOKEN_URL = envStr(import.meta.env.VITE_ONEDRIVE_TOKEN_URL, 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token');
export const ONEDRIVE_SCOPE = envStr(import.meta.env.VITE_ONEDRIVE_SCOPE, 'Files.ReadWrite.AppFolder offline_access');
export const ONEDRIVE_TOKEN_KEY: StorageKey = backendKey(STORAGE_ID.onedrive, 'token');

// ── OAuth redirect ────────────────────────────────────────────────────────────

// A function, not a const: reads location.origin at call time, unavailable at module load under SSR.
export function oauthRedirectUri(): string {
  return envStr(import.meta.env.VITE_REDIRECT_URI, `${location.origin}/redirect.html`);
}

// ── Dropbox ───────────────────────────────────────────────────────────────────

export const DROPBOX_AUTH_URL = envStr(import.meta.env.VITE_DROPBOX_AUTH_URL, 'https://www.dropbox.com/oauth2/authorize');
export const DROPBOX_TOKEN_URL = envStr(import.meta.env.VITE_DROPBOX_TOKEN_URL, 'https://api.dropboxapi.com/oauth2/token');
export const DROPBOX_UPLOAD_URL = envStr(import.meta.env.VITE_DROPBOX_UPLOAD_URL, 'https://content.dropboxapi.com/2/files/upload');
export const DROPBOX_DOWNLOAD_URL = envStr(import.meta.env.VITE_DROPBOX_DOWNLOAD_URL, 'https://content.dropboxapi.com/2/files/download');
export const DROPBOX_TOKEN_KEY: StorageKey = backendKey(STORAGE_ID.dropbox, 'token');

// ── pCloud ────────────────────────────────────────────────────────────────────

export const PCLOUD_SESSION_KEY: StorageKey = backendKey(STORAGE_ID.pcloud, 'session');
export const PCLOUD_API_HOST = envStr(import.meta.env.VITE_PCLOUD_API_HOST, 'api.pcloud.com');
export const PCLOUD_EU_API_HOST = envStr(import.meta.env.VITE_PCLOUD_EU_API_HOST, 'eapi.pcloud.com');
export const PCLOUD_GETFILELINK_PATH = envStr(import.meta.env.VITE_PCLOUD_GETFILELINK_PATH, '/getfilelink');
export const PCLOUD_UPLOAD_PATH = envStr(import.meta.env.VITE_PCLOUD_UPLOAD_PATH, '/uploadfile');

// ── WebDAV ────────────────────────────────────────────────────────────────────

export const WEBDAV_KEY: StorageKey = backendKey(STORAGE_ID.webdav, 'conf');

// ── OAuth popup ───────────────────────────────────────────────────────────────

export const OAUTH_TIMEOUT_MS = envInt(import.meta.env.VITE_OAUTH_TIMEOUT_MS, 5 * 60_000) as Milliseconds;
export const OAUTH_POPUP_FEATURES = envStr(import.meta.env.VITE_OAUTH_POPUP_FEATURES, 'width=520,height=640');

// ── Encoding ──────────────────────────────────────────────────────────────────

export const BASE64_CHUNK = envInt(import.meta.env.VITE_BASE64_CHUNK, 0x8000);
