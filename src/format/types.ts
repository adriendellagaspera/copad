import type * as Y from 'yjs';

/** A lower-cased file extension including its leading dot (e.g. `'.md'`, `'.yjs'`). */
export type FileExtension = string & { readonly _brand: 'FileExtension' };

/**
 * A file-format codec — the bridge between the bytes a {@link Storage} backend
 * moves and the shared {@link Y.Doc} the editor binds to.
 *
 * The `.yjs` codec is special: it round-trips the full CRDT state (history +
 * content), which is what makes collaboration and conflict-free merge work.
 * Every other codec carries only the *visible content*: it parses the file into
 * a ProseMirror document and reconciles it into the shared doc (and back).
 *
 * Codecs operate on the {@link Y.Doc} so they stay completely backend-agnostic —
 * the same codec applies whether the bytes came from Dropbox, WebDAV or a local
 * file. The backend just reports its filename; the extension picks the codec.
 */
export interface Codec {
  readonly id: string;
  readonly label: string;
  /** Lower-cased extensions (with leading dot) this codec handles, e.g. `['.md']`. */
  readonly extensions: FileExtension[];
  /** Parse file bytes into the shared doc (replacing its current content). */
  decode(bytes: Uint8Array, doc: Y.Doc): void | Promise<void>;
  /** Serialise the shared doc's current content into file bytes. */
  encode(doc: Y.Doc): Uint8Array | Promise<Uint8Array>;
}

/** The extension of a filename, lower-cased and including the dot (e.g. `.md`). */
export function extensionOf(filename: string): FileExtension {
  const dot = filename.lastIndexOf('.');
  return (dot === -1 ? '' : filename.slice(dot).toLowerCase()) as FileExtension;
}
