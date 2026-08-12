import { pcloudStorage } from './pcloud.js';
import { dropboxStorage } from './dropbox.js';
import { webdavStorage } from './webdav.js';
import { localFsStorage } from './local.js';
import { githubStorage } from './github.js';
import { gitlabStorage } from './gitlab.js';
import { s3Storage } from './s3.js';
import { sharepointStorage } from './sharepoint.js';
import { gdriveStorage } from './gdrive.js';
import { onedriveStorage } from './onedrive.js';
import type { Storage } from './types.js';
import type { StorageAuth } from './auth.js';
import type { RoomId } from '../collaboration/types.js';
import { directFetch } from '../network/direct.js';
import { proxiedFetch } from '../network/proxy.js';
import { BACKEND_ENABLED } from './constants.js';

export type { Storage };
export type { StorageAuth };

export interface StorageBackend {
  auth: StorageAuth;
  storage: Storage;
}

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
    sharepointStorage(room),
    gdriveStorage(room),
    onedriveStorage(room),
    // Listed unconditionally: it self-reports availability when the FS Access API is absent.
    localFsStorage(),
  ].filter(b => BACKEND_ENABLED[b.storage.id]);
}

export const DEFAULT_BACKEND = import.meta.env.VITE_STORAGE_BACKEND ?? '';
