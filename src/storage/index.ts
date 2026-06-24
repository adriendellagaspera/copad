import { pcloudStorage } from './pcloud.js';
import { dropboxStorage } from './dropbox.js';
import { webdavStorage } from './webdav.js';
import { localFsStorage } from './local.js';
import type { Storage } from './types.js';
import { directFetch } from '../network/direct.js';
import { proxiedFetch } from '../network/cloudflare-proxy/index.js';

export type { Storage };

/** Returns all storage backends available in this environment. */
export function backends(): Storage[] {
  const proxyUrl = import.meta.env.VITE_PROXY_URL as string | undefined;
  const netFetch = proxyUrl ? proxiedFetch(proxyUrl) : directFetch;

  const result: Storage[] = [];
  result.push(pcloudStorage(netFetch));
  result.push(dropboxStorage());
  // WebDAV requires a CORS proxy — hide it when none is configured.
  if (proxyUrl) result.push(webdavStorage(netFetch));
  // Always offer local-file storage; it self-reports unavailableReason when
  // the File System Access API is absent (e.g. Firefox, Safari, Brave Shields).
  result.push(localFsStorage());
  return result;
}

export const DEFAULT_BACKEND = import.meta.env.VITE_STORAGE_BACKEND ?? '';
