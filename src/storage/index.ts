import { pcloudStorage } from './pcloud.js';
import { dropboxStorage } from './dropbox.js';
import { webdavStorage } from './webdav.js';
import { localFsStorage } from './local.js';
import { githubStorage } from './github.js';
import { gitlabStorage } from './gitlab.js';
import { s3Storage } from './s3.js';
import type { Storage } from './types.js';
import type { StorageAuth } from './auth.js';
import type { RoomId } from '../collaboration/types.js';
import { directFetch } from '../network/direct.js';
import { proxiedFetch } from '../network/proxy.js';
import { BACKEND_ENABLED } from './constants.js';

export type { Storage };
export type { StorageAuth };

/** A storage backend's auth and data halves, built together from a single
 *  factory so they share closure state (token, session handle, etc.). */
export interface StorageBackend {
  auth: StorageAuth;
  storage: Storage;
}

/** Returns all storage backends available in this environment, each targeting
 *  `room`'s document (a tab is in exactly one room for its whole lifetime).
 *  A backend disabled via {@link BACKEND_ENABLED} (`VITE_ENABLE_<ID>`) is
 *  filtered out entirely — it never appears as a pill or in Settings. */
export function backends(room: RoomId): StorageBackend[] {
  const proxyUrl = import.meta.env.VITE_PROXY_URL;
  const netFetch = proxyUrl ? proxiedFetch(proxyUrl) : directFetch;

  return [
    pcloudStorage(netFetch, room),
    dropboxStorage(room),
    webdavStorage(netFetch, room),
    githubStorage(room),
    gitlabStorage(room),
    s3Storage(room),
    // Always offer local-file storage; it self-reports availability.ok=false when
    // the File System Access API is absent (e.g. Firefox, Safari, Brave Shields).
    localFsStorage(),
  ].filter(b => BACKEND_ENABLED[b.storage.id]);
}

export const DEFAULT_BACKEND = import.meta.env.VITE_STORAGE_BACKEND ?? '';
