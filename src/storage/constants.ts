/**
 * Storage-vertical constants: backend endpoints, the shared cloud folder, OAuth
 * popup tuning, default filenames, encoding limits, and the localStorage keys
 * each backend persists under. Values that legitimately vary by deployment
 * (GitHub Enterprise's API host, a custom cloud folder) read a `VITE_*` override;
 * the rest are fixed provider/protocol constants, centralized so no endpoint or
 * key is hardcoded inside an adapter.
 */

import type { Filename } from './types.js';
import { storageKey, type StorageKey } from '../persistence/local.js';

// ── Cloud folder + default filenames ──────────────────────────────────────────

/** Folder the cloud backends (Dropbox, pCloud) read and write within. */
export const CLOUD_FOLDER = import.meta.env.VITE_CLOUD_FOLDER ?? '/copad';

/** Default target filename for a backend with none saved yet (native CRDT format). */
export const DEFAULT_FILENAME = 'document.yjs' as Filename;

/** GitHub's default target file — human-readable Markdown rather than `.yjs`. */
export const GITHUB_DEFAULT_FILENAME = 'notes.md' as Filename;

// ── GitHub ────────────────────────────────────────────────────────────────────

/** GitHub REST API base — override for a GitHub Enterprise host. */
export const GITHUB_API_URL = import.meta.env.VITE_GITHUB_API_URL ?? 'https://api.github.com';

/** Branch committed to when none is configured. */
export const GITHUB_DEFAULT_BRANCH = 'main';

/** Marks a GitHub token as validated (set after a successful GET /user). */
export const GITHUB_VALIDATED_KEY: StorageKey = storageKey('storage.github.validated');

// ── Dropbox ───────────────────────────────────────────────────────────────────

/**
 * Where the OAuth provider redirects back to — `VITE_REDIRECT_URI` override, else
 * the app's own `redirect.html`. A function rather than a const because it reads
 * `location.origin` at call time (not available at module load under SSR).
 */
export function oauthRedirectUri(): string {
  return import.meta.env.VITE_REDIRECT_URI ?? `${location.origin}/redirect.html`;
}

export const DROPBOX_AUTH_URL = 'https://www.dropbox.com/oauth2/authorize';
export const DROPBOX_TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';
export const DROPBOX_UPLOAD_URL = 'https://content.dropboxapi.com/2/files/upload';
export const DROPBOX_DOWNLOAD_URL = 'https://content.dropboxapi.com/2/files/download';
export const DROPBOX_TOKEN_KEY: StorageKey = storageKey('storage.dropbox.token');

// ── pCloud ────────────────────────────────────────────────────────────────────

export const PCLOUD_SESSION_KEY: StorageKey = storageKey('storage.pcloud');
/** Global (US) API host, used for accounts in location id 1. */
export const PCLOUD_API_HOST = 'api.pcloud.com';
/** EU API host, used for accounts in location id 2. */
export const PCLOUD_EU_API_HOST = 'eapi.pcloud.com';

// ── WebDAV ────────────────────────────────────────────────────────────────────

export const WEBDAV_KEY: StorageKey = storageKey('storage.webdav');

// ── OAuth popup ───────────────────────────────────────────────────────────────

/** How long to wait for the OAuth popup to post its code back before giving up. */
export const OAUTH_TIMEOUT_MS = 5 * 60_000;

/** Popup window features for the OAuth flow. */
export const OAUTH_POPUP_FEATURES = 'width=520,height=640';

// ── Encoding ──────────────────────────────────────────────────────────────────

/** Chunk size for chunked base64 of large files (stays within stack limits). */
export const BASE64_CHUNK = 0x8000;
