/**
 * The document content exchanged between the Editor and a Storage backend.
 * Binary backends (Dropbox, pCloud, WebDAV, local) use the Yjs state snapshot.
 * Text backends (GitHub, SharePoint…) use the file's raw text so the stored
 * file remains human-readable and committable.
 */
export type DocContent =
  | { readonly format: 'binary'; readonly bytes: Uint8Array }
  | { readonly format: 'text';   readonly text: string };

/**
 * The level of access the authenticated user has on this specific file or
 * resource. Absent when the backend has no per-user ACL (Dropbox, WebDAV,
 * local). Present when the backend can report it (e.g. SharePoint via Graph).
 */
export type StorageAccess = 'read' | 'write' | 'owner';

/**
 * Key-value pairs collected from the session credential form, keyed by
 * {@link CredentialField.name}. A named, readonly alias for what is inherently
 * polymorphic form data at this port boundary.
 */
export type SessionCredentials = Readonly<Record<string, string>>;

/**
 * A per-session authentication input collected at connect time (e.g. a WebDAV
 * username/password). Distinct from {@link ConfigField}, which is one-time setup.
 */
export interface CredentialField {
  name: string;
  label: string;
  type?: 'text' | 'password';
  placeholder?: string;
}

/**
 * A one-time configuration input — typically an OAuth app key / client id that
 * identifies *which* third-party app this deployment uses. Configured once in
 * Settings and reused across sessions, as opposed to {@link CredentialField}.
 */
export interface ConfigField {
  name: string;
  label: string;
  type?: 'text' | 'password';
  placeholder?: string;
  /** Short hint shown under the input — e.g. where to obtain the value. */
  help?: string;
}

/**
 * The bytes-only storage port. Authentication, configuration, and credentials
 * live on {@link StorageAuth} (see `src/storage/auth.ts`). A non-null `Storage`
 * reference passed to the Editor already implies the user is authenticated —
 * `App.svelte` gates the prop to `null` until auth is established.
 */
export interface Storage {
  readonly id: string;
  readonly label: string;
  /** One-line description shown in Settings and as a pill tooltip. */
  readonly blurb?: string;
  /** Set when this backend cannot be used in the current browser environment. */
  readonly unavailableReason?: string;

  // ── Target file / format ───────────────────────────────────────────────────
  filename?(): string;
  setFilename?(name: string): void;

  readonly contentFormat: DocContent['format'];
  load(): Promise<DocContent | null>;
  save(content: DocContent): Promise<void>;

  /**
   * The authenticated user's access level on this specific file/resource.
   * Absent when the backend has no per-user ACL (Dropbox, WebDAV, local).
   * Present when the backend can report it (e.g. SharePoint via Graph API).
   */
  access?(): Promise<StorageAccess>;
}
