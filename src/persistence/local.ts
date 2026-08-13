// Lint-gated: the only module allowed to touch `localStorage`.

export type StorageKey = string & { readonly _brand: 'StorageKey' };

export function storageKey(raw: string): StorageKey {
  return raw as StorageKey;
}

export interface LocalStore<T> {
  read(): T;
  write(value: T): void;
  clear(): void;
}

// `parse(null)` supplies the default: private mode, quota errors and SSR all throw here.
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
        /* best-effort */
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
