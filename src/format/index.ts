import { yjsCodec } from './yjs.js';
import { textCodec } from './text.js';
import { markdownCodec } from './markdown.js';
import { htmlCodec } from './html.js';
import { jsonCodec } from './json.js';
import { docxCodec } from './docx.js';
import { extensionOf, type Codec, type ExportCodec, type FileExtension } from './types.js';

export type { Codec, ExportCodec, FileExtension };
export { extensionOf };

/** Every codec Copad can read/write. The first one (`.yjs`) is the native default. */
export const codecs: Codec[] = [yjsCodec, textCodec, markdownCodec, htmlCodec, jsonCodec];

/**
 * Formats offered by the "Export a copy" action — every bidirectional codec
 * but the native `.yjs` snapshot (that's a backend save target, not a
 * portable file to hand someone outside Copad), plus one-way export-only
 * formats like `docxCodec`. `docxCodec` is deliberately absent from `codecs`/
 * `knownExtensions()` — there's nothing to decode if a user picks a `.docx`
 * in the Local import flow.
 */
export const exportCodecs: ExportCodec[] = [textCodec, markdownCodec, htmlCodec, jsonCodec, docxCodec];

/** Native format used whenever a filename has no recognised content extension. */
export const DEFAULT_CODEC = yjsCodec;

/** Every extension any codec handles, e.g. `['.yjs', '.txt', '.md', …]`. */
export function knownExtensions(): FileExtension[] {
  return codecs.flatMap(c => c.extensions);
}

/** Pick the codec for a filename by extension; falls back to the native `.yjs` codec. */
export function codecForFilename(filename: string): Codec {
  const ext = extensionOf(filename);
  return codecs.find(c => c.extensions.includes(ext)) ?? DEFAULT_CODEC;
}
