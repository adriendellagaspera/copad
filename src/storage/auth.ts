import type { LoginOptions, CredentialField, ConfigField } from './types.js';

/**
 * The authentication and configuration slice of a storage backend — separated
 * from {@link Storage} so the Settings UI can talk to auth without touching
 * bytes, and Editor can hold a pure bytes-only {@link Storage} handle that is
 * only non-null when auth is already established.
 */
export interface StorageAuth {
  isAuthenticated(): boolean;
  /** Initiate authentication. For OAuth backends this opens a popup; for
   *  WebDAV it verifies the supplied credentials against the server; for the
   *  local file backend an `Open` option selects a new vs existing file. */
  login(opts?: LoginOptions): Promise<void>;
  /** Clear the stored token / session. */
  logout(): void;

  // ── Per-session credentials (e.g. WebDAV username/password) ───────────────
  readonly credentialFields?: CredentialField[];

  // ── One-time deployment configuration (e.g. OAuth app keys) ───────────────
  readonly configFields?: ConfigField[];
  config?(name: string): string;
  setConfig?(name: string, value: string): void;
  configLocked?(name: string): boolean;
  configured?(): boolean;
}

/** True when all required one-time configuration is present. */
export function isConfigured(a: StorageAuth): boolean {
  return a.configured ? a.configured() : true;
}
