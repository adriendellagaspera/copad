import type { WriteReceipt } from './writeOutcome.js';

export type StorageId = string & { readonly _brand: 'StorageId' };
export type StorageLabel = string & { readonly _brand: 'StorageLabel' };
export type Filename = string & { readonly _brand: 'Filename' };

export const DocFormat = { Binary: 'binary', Text: 'text' } as const;
export type DocFormat = (typeof DocFormat)[keyof typeof DocFormat];

// Binary backends (Dropbox, pCloud, WebDAV, local) use Yjs snapshots; text backends (GitHub, SharePoint…) use raw text.
export type DocContent =
  | { readonly format: typeof DocFormat.Binary; readonly bytes: Uint8Array }
  | { readonly format: typeof DocFormat.Text;   readonly text: string };

export function docContentBytes(content: DocContent): Uint8Array {
  return content.format === DocFormat.Binary
    ? content.bytes
    : new TextEncoder().encode(content.text);
}

export const StorageAccess = { Read: 'read', Write: 'write', Owner: 'owner' } as const;
export type StorageAccess = (typeof StorageAccess)[keyof typeof StorageAccess];

export type StorageAvailability =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

export type SessionCredentials = Readonly<Record<string, string>>;

export const OpenMode = { New: 'new' } as const;
export type OpenMode = (typeof OpenMode)[keyof typeof OpenMode];

export const LoginKind = { Credentials: 'credentials', Open: 'open' } as const;
export type LoginKind = (typeof LoginKind)[keyof typeof LoginKind];

export type LoginOptions =
  | { readonly kind: typeof LoginKind.Credentials; readonly credentials: SessionCredentials }
  | { readonly kind: typeof LoginKind.Open;        readonly mode: OpenMode };

export const InputType = { Text: 'text', Password: 'password' } as const;
export type InputType = (typeof InputType)[keyof typeof InputType];

export interface CredentialField {
  name: string;
  label: string;
  type?: InputType;
  placeholder?: string;
  help?: string;
}

export interface ConfigField {
  name: string;
  label: string;
  type?: InputType;
  placeholder?: string;
  help?: string;
}

// Auth/config/credentials live on StorageAuth (src/storage/auth.ts); a non-null Storage implies authenticated.
export interface Storage {
  readonly id: StorageId;
  readonly label: StorageLabel;
  readonly blurb?: string;
  readonly availability: StorageAvailability;

  filename?(): Filename;
  setFilename?(name: string): void;
  defaultFilename?(): Filename;

  readonly contentFormat: DocFormat;
  load(): Promise<DocContent | null>;
  // "Didn't throw" != "the bytes arrived" (docs/contract.md §3.2) — WriteReceipt says which.
  save(content: DocContent): Promise<WriteReceipt>;

  access?(): Promise<StorageAccess>;

  // Absent where listing can't honor the OAuth scope, e.g. Google Drive's drive.file only sees files Copad created.
  list?(): Promise<Filename[]>;

  // Distinct from load(): reads any file without changing the room's persisted target filename.
  loadFrom?(filename: Filename): Promise<DocContent | null>;
}
