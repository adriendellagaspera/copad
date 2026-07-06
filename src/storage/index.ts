import { pcloudStorage } from './pcloud.js';
import { dropboxStorage } from './dropbox.js';
import { webdavStorage } from './webdav.js';
import { localFsStorage } from './local.js';
import { githubStorage } from './github.js';
import { gdriveStorage } from './gdrive.js';
import { gitlabStorage } from './gitlab.js';
import { sharepointStorage } from './sharepoint.js';
import { s3Storage } from './s3.js';
import type { Storage } from './types.js';
import type { StorageAuth } from './auth.js';
import { directFetch } from '../network/direct.js';
import { proxiedFetch } from '../network/proxy.js';

export type { Storage };
export type { StorageAuth };

/** A storage backend's auth and data halves, built together from a single
 *  factory so they share closure state (token, session handle, etc.). */
export interface StorageBackend {
  auth: StorageAuth;
  storage: Storage;
}

/** Returns all storage backends available in this environment. */
export function backends(): StorageBackend[] {
  const proxyUrl = import.meta.env.VITE_PROXY_URL;
  const netFetch = proxyUrl ? proxiedFetch(proxyUrl) : directFetch;

  return [
    pcloudStorage(netFetch),
    dropboxStorage(),
    webdavStorage(netFetch),
    githubStorage(),
    gdriveStorage(),
    gitlabStorage(),
    sharepointStorage(),
    s3Storage(),
    // Always offer local-file storage; it self-reports availability.ok=false when
    // the File System Access API is absent (e.g. Firefox, Safari, Brave Shields).
    localFsStorage(),
  ];
}

export const DEFAULT_BACKEND = import.meta.env.VITE_STORAGE_BACKEND ?? '';
