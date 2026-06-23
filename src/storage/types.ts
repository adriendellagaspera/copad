// A storage backend is anything that can durably hold one opaque blob (the Yjs
// document snapshot) and authenticate the user. The collaboration layer never
// looks inside the blob, so adapters stay completely CRDT-agnostic.

export interface CredentialField {
  name: string;
  label: string;
  type?: "text" | "password";
  placeholder?: string;
}

export interface StorageAdapter {
  /** Stable id, e.g. "pcloud". */
  readonly id: string;
  /** Human-facing label for the picker. */
  readonly label: string;

  /** Ready to read/write (token/credentials present)? */
  isAuthenticated(): boolean;

  /**
   * Credential inputs a UI should collect before calling connect().
   * Present for credential adapters (WebDAV); omitted for OAuth adapters that
   * authenticate through a popup (pCloud, Dropbox).
   */
  readonly credentialFields?: CredentialField[];

  /** Establish auth. OAuth adapters open a popup and ignore `creds`. */
  connect(creds?: Record<string, string>): Promise<void>;

  /** Drop stored auth. */
  disconnect(): void;

  /** Read the stored snapshot, or null if none exists / it's unreadable. */
  load(): Promise<Uint8Array | null>;

  /** Overwrite the stored snapshot. */
  save(bytes: Uint8Array): Promise<void>;
}
