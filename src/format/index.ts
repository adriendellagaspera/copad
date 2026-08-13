import { yjsCodec } from './yjs.js';
import { textCodec } from './text.js';
import { markdownCodec } from './markdown.js';
import { htmlCodec } from './html.js';
import { jsonCodec } from './json.js';
import { docxCodec } from './docx.js';
import { extensionOf, type Codec, type ExportCodec, type FileExtension } from './types.js';

export type { Codec, ExportCodec, FileExtension };
export { extensionOf };

export const codecs: Codec[] = [yjsCodec, textCodec, markdownCodec, htmlCodec, jsonCodec];

// `docxCodec` is export-only: it belongs here but never in `codecs`, which must stay decodable.
export const exportCodecs: ExportCodec[] = [textCodec, markdownCodec, htmlCodec, jsonCodec, docxCodec];

export const DEFAULT_CODEC = yjsCodec;

export function knownExtensions(): FileExtension[] {
  return codecs.flatMap(c => c.extensions);
}

export function codecForFilename(filename: string): Codec {
  const ext = extensionOf(filename);
  return codecs.find(c => c.extensions.includes(ext)) ?? DEFAULT_CODEC;
}
