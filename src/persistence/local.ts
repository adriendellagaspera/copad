/**
 * Browser-local persistence primitive — the single module in the app that
 * touches `localStorage`. A {@link LocalStore} binds a key to a parser and a
 * serializer, so domain code reads and writes typed values without ever seeing
 * `localStorage` or a parse function: the IO mechanism *and* the parsing are
 * abstracted away behind read/write/clear.
 */

/** A namespaced localStorage key. Branded so a raw string can't stand in for one. */
export type StorageKey = string & { readonly _brand: 'StorageKey' };

/** Brand a raw string as a {@link StorageKey} — the single cast site for keys. */
export function storageKey(raw: string): StorageKey {
  return raw as StorageKey;
}

/** A typed handle to one persisted value. No IO or parsing details leak out. */
export interface LocalStore<T> {
  /** Current value, parsed from storage (or the parser's default when absent). */
  read(): T;
  /** Persist a value; a serializer returning `null` deletes the entry. */
  write(value: T): void;
  /** Remove the entry entirely. */
  clear(): void;
}

/**
 * Bind a {@link StorageKey} to a `parse`/`serialize` pair. `parse` is the single
 * narrowing site for this key's reads — it receives the raw `string | null` and
 * returns a domain value (it must handle `null` to supply the default).
 * `serialize` maps a value back to a string, or `null` to delete the entry.
 *
 * Every access is wrapped, so a disabled or throwing store (private mode, quota
 * exceeded, SSR) degrades to the parsed default rather than throwing.
 */
export function localStore<T>(
  key: StorageKey,
  parse: (raw: string | null) => T,
  serialize: (value: T) => string | null,
): LocalStore<T> {
  return {
    read() {
      try {
        return parse(localStorage.getItem(key));
      } catch {
        return parse(null);
      }
    },
    write(value) {
      try {
        const raw = serialize(value);
        if (raw === null) localStorage.removeItem(key);
        else localStorage.setItem(key, raw);
      } catch {
        /* ignore — persistence is best-effort */
      }
    },
    clear() {
      try {
        localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    },
  };
}
