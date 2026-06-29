/** Opaque identifier for a storage backend instance (e.g. `'dropbox'`, `'local'`). */
export type StorageId = string & { readonly _brand: 'StorageId' };

/**
 * A target filename including its extension (e.g. `'notes.md'`, `'document.yjs'`).
 * The extension drives which codec is used to read/write the document.
 */
export type Filename = string & { readonly _brand: 'Filename' };

/**
 * The document content exchanged between the Editor and a Storage backend.
 * Binary backends (Dropbox, pCloud, WebDAV, local) use the Yjs state snapshot.
 * Text backends (GitHub, SharePoint…) use the file's raw text so the stored
 * file remains human-readable and committable.
 */
/**
 * Document content formats. The const object holds the wire values; the type is
 * the union of its members, so internal code matches against `DocFormat.Binary`
 * rather than a bare `'binary'` literal — no primitives at the domain boundary.
 */
export const DocFormat = { Binary: 'binary', Text: 'text' } as const;
export type DocFormat = (typeof DocFormat)[keyof typeof DocFormat];

export type DocContent =
  | { readonly format: typeof DocFormat.Binary; readonly bytes: Uint8Array }
  | { readonly format: typeof DocFormat.Text;   readonly text: string };

/**
 * The level of access the authenticated user has on this specific file or
 * resource. Absent when the backend has no per-user ACL (Dropbox, WebDAV,
 * local). Present when the backend can report it (e.g. SharePoint via Graph).
 */
export const StorageAccess = { Read: 'read', Write: 'write', Owner: 'owner' } as const;
export type StorageAccess = (typeof StorageAccess)[keyof typeof StorageAccess];

/**
 * Whether this backend can be used in the current environment.
 * Absent from the check only when the browser/API makes it impossible.
 */
export type StorageAvailability =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

/**
 * Key-value pairs collected from the session credential form, keyed by
 * {@link CredentialField.name}. A named, readonly alias for what is inherently
 * polymorphic form data at this port boundary.
 */
export type SessionCredentials = Readonly<Record<string, string>>;

/**
 * The "open mode" chosen on the connect form. `New` starts a fresh, empty
 * document; its absence means open/import an existing file. Read by the local
 * backend (cloud backends ignore it). Named so call sites match `OpenMode.New`
 * rather than a bare `'new'` literal.
 */
export const OpenMode = { New: 'new' } as const;
export type OpenMode = (typeof OpenMode)[keyof typeof OpenMode];

/**
 * Which kind of input a {@link StorageAuth.login} call carries — a closed set we
 * own, matched as `LoginKind.Credentials` over a bare `'credentials'` literal.
 */
export const LoginKind = { Credentials: 'credentials', Open: 'open' } as const;
export type LoginKind = (typeof LoginKind)[keyof typeof LoginKind];

/**
 * Structured input to {@link StorageAuth.login}, modelled as a discriminated
 * union so the two intents can never co-occur or be half-specified:
 * - `Credentials` — a per-session credentialed login (WebDAV), carrying the
 *   form values; the credential bag is *not* a control channel.
 * - `Open` — how the local picker opens its file ({@link OpenMode}).
 *
 * Backends needing neither (OAuth: Dropbox/pCloud/GitHub) and the local
 * open/import-existing path are called with no argument. Each arm requires its
 * payload, so a credentials login always carries credentials and an open always
 * carries a mode — illegal states are unrepresentable.
 */
export type LoginOptions =
  | { readonly kind: typeof LoginKind.Credentials; readonly credentials: SessionCredentials }
  | { readonly kind: typeof LoginKind.Open;        readonly mode: OpenMode };

/**
 * How a {@link CredentialField} / {@link ConfigField} input renders — a closed
 * set we own (it happens to map onto the HTML `<input type>` attribute). Named
 * so field definitions and defaults use `InputType.Password` over a bare literal.
 */
export const InputType = { Text: 'text', Password: 'password' } as const;
export type InputType = (typeof InputType)[keyof typeof InputType];

/**
 * A per-session authentication input collected at connect time (e.g. a WebDAV
 * username/password). Distinct from {@link ConfigField}, which is one-time setup.
 */
export interface CredentialField {
  name: string;
  label: string;
  type?: InputType;
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
  type?: InputType;
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
  readonly id: StorageId;
  readonly label: string;
  /** One-line description shown in Settings and as a pill tooltip. */
  readonly blurb?: string;
  readonly availability: StorageAvailability;

  // ── Target file / format ───────────────────────────────────────────────────
  // The filename's extension selects the codec (see src/format). Backends that
  // omit these default to `document.yjs` (the native Copad format).
  /** Effective target filename including extension, e.g. `notes.md`. */
  filename?(): Filename;
  /** Change the target filename. Absent where the name is fixed by the backend. */
  setFilename?(name: string): void;

  readonly contentFormat: DocFormat;
  load(): Promise<DocContent | null>;
  save(content: DocContent): Promise<void>;

  /**
   * The authenticated user's access level on this specific file/resource.
   * Absent when the backend has no per-user ACL (Dropbox, WebDAV, local).
   * Present when the backend can report it (e.g. SharePoint via Graph API).
   */
  access?(): Promise<StorageAccess>;
}
