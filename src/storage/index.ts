import { pcloudStorage } from './pcloud.js';
import { dropboxStorage } from './dropbox.js';
import { webdavStorage } from './webdav.js';
import { localFsStorage } from './local.js';
import type { Storage } from './types.js';

export type { Storage };

/** Returns all storage backends available in this environment. */
export function backends(): Storage[] {
  const result: Storage[] = [];
  if (import.meta.env.VITE_PCLOUD_CLIENT_ID) result.push(pcloudStorage());
  if (import.meta.env.VITE_DROPBOX_APP_KEY)  result.push(dropboxStorage());
  // WebDAV requires a CORS proxy — hide it when none is configured.
  if (import.meta.env.VITE_PROXY_URL)         result.push(webdavStorage());
  // File System Access API: Chrome/Edge only, no env var needed.
  if (typeof window !== 'undefined' && 'showSaveFilePicker' in window)
    result.push(localFsStorage());
  return result;
}

export const DEFAULT_BACKEND = import.meta.env.VITE_STORAGE_BACKEND ?? '';
