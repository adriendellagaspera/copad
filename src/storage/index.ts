import { PCloudAdapter } from './pcloud.js';
import { DropboxAdapter } from './dropbox.js';
import { WebDavAdapter } from './webdav.js';
import type { StorageAdapter } from './types.js';

export type { StorageAdapter };

/** Returns all adapters that have been configured (env vars present). */
export function availableAdapters(): StorageAdapter[] {
  const adapters: StorageAdapter[] = [];
  if (import.meta.env.VITE_PCLOUD_CLIENT_ID) adapters.push(new PCloudAdapter());
  if (import.meta.env.VITE_DROPBOX_APP_KEY) adapters.push(new DropboxAdapter());
  adapters.push(new WebDavAdapter());
  return adapters;
}

export const DEFAULT_BACKEND = import.meta.env.VITE_STORAGE_BACKEND ?? '';
