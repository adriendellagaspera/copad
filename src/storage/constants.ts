/**
 * Storage-vertical constants: backend endpoints, the shared cloud folder, OAuth
 * popup tuning, default filenames, encoding limits, and the localStorage keys
 * each backend persists under.
 *
 * Every endpoint, host, path, folder, and tunable reads a `VITE_*` override so a
 * deployment can react to a provider rotating a domain or a regional split (e.g.
 * pCloud's US/EU hosts) without a rebuild. Only two kinds stay fixed: the
 * localStorage **keys** (storage identity — changing them orphans saved state)
 * and the default filenames/branch (user-facing content, edited in Settings).
 */

import type { Filename, StorageId } from './types.js';
import { storageKey, type StorageKey } from '../persistence/local.js';

// ── Backend ids (single source of truth) ──────────────────────────────────────

/**
 * Brand a set of backend-id literals, keyed by themselves — the single
 * `as StorageId` site for backend ids. Each id is written once; the cast and the
 * typed `STORAGE_ID.<id>` lookup come for free, and adding a backend is one word.
 */
function storageIds<const Ids extends readonly string[]>(
  ...ids: Ids
): { readonly [Id in Ids[number]]: StorageId } {
  return Object.fromEntries(ids.map((id) => [id, id])) as {
    readonly [Id in Ids[number]]: StorageId;
  };
}

/** The canonical id for each storage backend — the single source of truth. */
export const STORAGE_ID = storageIds('dropbox', 'pcloud', 'webdav', 'github', 'local');

/** localStorage key for one of a backend's persisted values: `storage.<id>.<purpose>`. */
export const backendKey = (id: StorageId, purpose: string): StorageKey =>
  storageKey(`storage.${id}.${purpose}`);

// ── Env-override helpers (the env IO boundary for this vertical) ───────────────

/** Trimmed string override, or `fallback` when the var is unset or blank. */
const envStr = (raw: string | undefined, fallback: string): string => {
  const v = raw?.trim();
  return v ? v : fallback;
};

/** Positive-integer override, or `fallback` when the var is unset or invalid. */
const envInt = (raw: string | undefined, fallback: number): number => {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

// ── Cloud folder + default filenames ──────────────────────────────────────────

/** Folder the cloud backends (Dropbox, pCloud) read and write within. */
export const CLOUD_FOLDER = envStr(import.meta.env.VITE_CLOUD_FOLDER, '/copad');

/** Default target filename for a backend with none saved yet (native CRDT format). */
export const DEFAULT_FILENAME = envStr(import.meta.env.VITE_DEFAULT_FILENAME, 'document.yjs') as Filename;

/** GitHub's default target file — human-readable Markdown rather than `.yjs`. */
export const GITHUB_DEFAULT_FILENAME = envStr(import.meta.env.VITE_GITHUB_DEFAULT_FILENAME, 'notes.md') as Filename;

// ── GitHub ────────────────────────────────────────────────────────────────────

/** GitHub REST API base — override for a GitHub Enterprise host. */
export const GITHUB_API_URL = envStr(import.meta.env.VITE_GITHUB_API_URL, 'https://api.github.com');

/** Branch committed to when none is configured. Already deployment-settable via
 *  the `branch` config field's `VITE_GITHUB_BRANCH` lock, so no separate override here. */
export const GITHUB_DEFAULT_BRANCH = 'main';

/** Marks a GitHub token as validated (set after a successful GET /user). */
export const GITHUB_VALIDATED_KEY: StorageKey = backendKey(STORAGE_ID.github, 'validated');

// ── OAuth redirect ────────────────────────────────────────────────────────────

/**
 * Where the OAuth provider redirects back to — `VITE_REDIRECT_URI` override, else
 * the app's own `redirect.html`. A function rather than a const because it reads
 * `location.origin` at call time (not available at module load under SSR).
 */
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
/** Global (US) API host — accounts in location id 1. Overridable if pCloud moves it. */
export const PCLOUD_API_HOST = envStr(import.meta.env.VITE_PCLOUD_API_HOST, 'api.pcloud.com');
/** EU API host — accounts in location id 2. */
export const PCLOUD_EU_API_HOST = envStr(import.meta.env.VITE_PCLOUD_EU_API_HOST, 'eapi.pcloud.com');
/** API path that resolves a file's download link. */
export const PCLOUD_GETFILELINK_PATH = envStr(import.meta.env.VITE_PCLOUD_GETFILELINK_PATH, '/getfilelink');
/** API path that uploads a file. */
export const PCLOUD_UPLOAD_PATH = envStr(import.meta.env.VITE_PCLOUD_UPLOAD_PATH, '/uploadfile');

// ── WebDAV ────────────────────────────────────────────────────────────────────

export const WEBDAV_KEY: StorageKey = backendKey(STORAGE_ID.webdav, 'conf');

// ── OAuth popup ───────────────────────────────────────────────────────────────

/** How long to wait for the OAuth popup to post its code back before giving up. */
export const OAUTH_TIMEOUT_MS = envInt(import.meta.env.VITE_OAUTH_TIMEOUT_MS, 5 * 60_000);

/** Popup window features for the OAuth flow. */
export const OAUTH_POPUP_FEATURES = envStr(import.meta.env.VITE_OAUTH_POPUP_FEATURES, 'width=520,height=640');

// ── Encoding ──────────────────────────────────────────────────────────────────

/** Chunk size for chunked base64 of large files (stays within stack limits). */
export const BASE64_CHUNK = envInt(import.meta.env.VITE_BASE64_CHUNK, 0x8000);
