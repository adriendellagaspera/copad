import type * as Y from 'yjs';

export type FileExtension = string & { readonly _brand: 'FileExtension' };

export interface Codec {
  readonly id: string;
  readonly label: string;
  readonly extensions: FileExtension[];
  decode(bytes: Uint8Array, doc: Y.Doc): void | Promise<void>;
  encode(doc: Y.Doc): Uint8Array | Promise<Uint8Array>;
}

export interface ExportCodec {
  readonly id: string;
  readonly label: string;
  readonly extensions: FileExtension[];
  encode(doc: Y.Doc): Uint8Array | Promise<Uint8Array>;
}

export function extensionOf(filename: string): FileExtension {
  const dot = filename.lastIndexOf('.');
  return (dot === -1 ? '' : filename.slice(dot).toLowerCase()) as FileExtension;
}
