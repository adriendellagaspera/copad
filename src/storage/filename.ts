import { readString, writeString, removeKey } from '../localStore.js';

/**
 * Persisted target filename for a storage backend. The extension drives which
 * codec (see src/format) is used to read/write the document, so this is how a
 * user picks a format — `notes.md`, `document.html`, … — on a cloud backend.
 *
 * Stored per backend under `storage.<id>.filename`, defaulting to the native
 * `document.yjs` when unset.
 */
export function filenameStore(backendId: string, fallback = 'document.yjs') {
  const KEY = `storage.${backendId}.filename`;
  return {
    get(): string {
      return readString(KEY)?.trim() || fallback;
    },
    set(name: string): void {
      const trimmed = name.trim();
      if (trimmed) writeString(KEY, trimmed);
      else removeKey(KEY);
    },
  };
}
