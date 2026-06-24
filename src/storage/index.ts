import { PCloudAdapter } from './pcloud.js';
import { DropboxAdapter } from './dropbox.js';
import { WebDavAdapter } from './webdav.js';
import { LocalAdapter } from './local.js';
import type { StorageAdapter } from './types.js';

export type { StorageAdapter };

/** Returns all adapters available in this environment. */
export function availableAdapters(): StorageAdapter[] {
  const adapters: StorageAdapter[] = [];
  if (import.meta.env.VITE_PCLOUD_CLIENT_ID) adapters.push(new PCloudAdapter());
  if (import.meta.env.VITE_DROPBOX_APP_KEY)  adapters.push(new DropboxAdapter());
  // WebDAV requires a CORS proxy — hide it when none is configured.
  if (import.meta.env.VITE_PROXY_URL)         adapters.push(new WebDavAdapter());
  // File System Access API: Chrome/Edge only, no env var needed.
  if (typeof window !== 'undefined' && 'showSaveFilePicker' in window)
    adapters.push(new LocalAdapter());
  return adapters;
}

export const DEFAULT_BACKEND = import.meta.env.VITE_STORAGE_BACKEND ?? '';
