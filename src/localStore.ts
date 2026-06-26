// Safe localStorage access.
//
// Every native localStorage call can throw — the user disabled it, the quota is
// full, or it's blocked in private/incognito mode — so each helper wraps the
// call: reads fall back to a default, writes and removes degrade to a no-op.
// This is the single place that touches `localStorage`, so the guard lives here
// once instead of a try/catch at every persistence site (cache prefs, theme,
// storage tokens, backend config, …).

/** Read a raw string, or `null` if absent or storage is unavailable. */
export function readString(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Persist a raw string; a no-op if storage is unavailable. */
export function writeString(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore — storage unavailable */
  }
}

/** Remove a key; a no-op if storage is unavailable. */
export function removeKey(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore — storage unavailable */
  }
}

/** Read and JSON-parse a value, returning `fallback` when absent, unavailable,
 *  or malformed. */
export function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** JSON-stringify and persist a value; a no-op if storage is unavailable. */
export function writeJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore — storage unavailable */
  }
}
