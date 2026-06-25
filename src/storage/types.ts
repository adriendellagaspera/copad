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

export interface Storage {
  readonly id: string;
  readonly label: string;
  /** One-line description shown in Settings and as a pill tooltip. */
  readonly blurb?: string;
  /** Set when this backend cannot be used in the current browser environment. */
  readonly unavailableReason?: string;

  // ── One-time configuration (Settings) ──────────────────────────────────────
  // Backends that need no setup (Local, WebDAV) omit these entirely.
  /** Configurable app-level fields shown in the Settings panel. */
  readonly configFields?: ConfigField[];
  /** Effective value of a config field (env var or saved). */
  config?(name: string): string;
  /** Persist a config value. No-op when the field is locked by an env var. */
  setConfig?(name: string, value: string): void;
  /** True when the field is fixed by an env var (managed by the deployment). */
  configLocked?(name: string): boolean;
  /** True when all required configuration is present (ready to connect). */
  configured?(): boolean;

  // ── Target file / format ───────────────────────────────────────────────────
  // The filename's extension selects the codec (see src/format). Backends that
  // omit these default to `document.yjs` (the native Copad format).
  /** Effective target filename including extension, e.g. `notes.md`. */
  filename?(): string;
  /** Change the target filename. Absent where the name is fixed by the backend. */
  setFilename?(name: string): void;

  // ── Per-session authentication ─────────────────────────────────────────────
  isAuthenticated(): boolean;
  /** Session credentials collected on the connect form (e.g. WebDAV login). */
  readonly credentialFields?: CredentialField[];
  connect(creds?: SessionCredentials): Promise<void>;
  disconnect(): void;
  /** Whether this backend stores a Yjs binary snapshot or the file's raw text. */
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

/** Whether a backend has the one-time config it needs to attempt a connect. */
export function isConfigured(s: Storage): boolean {
  return s.configured ? s.configured() : true;
}
