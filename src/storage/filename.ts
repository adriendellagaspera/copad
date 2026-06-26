import type { StorageId, Filename } from './types.js';

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
 * `document.yjs` when unset.
 */
type FilenameStoreKey = `storage.${StorageId}.filename`;

export function filenameStore(backendId: StorageId, fallback: Filename = 'document.yjs' as Filename): FilenameStore {
  const KEY: FilenameStoreKey = `storage.${backendId}.filename`;
  return {
    get(): Filename {
      return (localStorage.getItem(KEY)?.trim() || fallback) as Filename;
    },
    set(name: string): void {
      const trimmed = name.trim();
      if (trimmed) localStorage.setItem(KEY, trimmed);
      else localStorage.removeItem(KEY);
    },
  };
}
