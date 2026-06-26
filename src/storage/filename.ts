import type { StorageId, Filename } from './types.js';
import { parseFilename } from './parse.js';
import { localStore, storageKey } from '../persistence/local.js';
import { DEFAULT_FILENAME } from './constants.js';

/** Read/write access to the persisted target filename for one storage backend. */
export interface FilenameStore {
  get(): Filename;
  set(name: string): void;
}

/**
 * Persisted target filename for a storage backend. The extension drives which
 * codec (see src/format) is used to read/write the document, so this is how a
 * user picks a format — `notes.md`, `document.html`, … — on a cloud backend.
 *
 * Stored per backend under `storage.<id>.filename`, defaulting to the native
 * `document.yjs` when unset. localStorage and parsing are abstracted behind the
 * store — this module only reads/writes typed Filenames.
 */
export function filenameStore(backendId: StorageId, fallback: Filename = DEFAULT_FILENAME): FilenameStore {
  const store = localStore<Filename>(
    storageKey(`storage.${backendId}.filename`),
    (raw) => parseFilename(raw, fallback),
    (name) => name.trim() || null,
  );
  return {
    get: () => store.read(),
    set: (name) => store.write(name.trim() as Filename),
  };
}
