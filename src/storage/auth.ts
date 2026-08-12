import type { LoginOptions, CredentialField, ConfigField } from './types.js';

export interface StorageAuth {
  isAuthenticated(): boolean;
  login(opts?: LoginOptions): Promise<void>;
  logout(): void;

  // Per-session credentials (e.g. WebDAV username/password).
  readonly credentialFields?: CredentialField[];

  // One-time deployment configuration (e.g. OAuth app keys).
  readonly configFields?: ConfigField[];
  config?(name: string): string;
  setConfig?(name: string, value: string): void;
  configLocked?(name: string): boolean;
  configured?(): boolean;
}

export function isConfigured(a: StorageAuth): boolean {
  return a.configured ? a.configured() : true;
}
