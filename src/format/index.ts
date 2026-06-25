import { yjsCodec } from './yjs.js';
import { textCodec } from './text.js';
import { markdownCodec } from './markdown.js';
import { htmlCodec } from './html.js';
import { jsonCodec } from './json.js';
import { extensionOf, type Codec } from './types.js';

export type { Codec };
export { extensionOf };

/** Every codec Copad can read/write. The first one (`.yjs`) is the native default. */
export const codecs: Codec[] = [yjsCodec, textCodec, markdownCodec, htmlCodec, jsonCodec];

/** Native format used whenever a filename has no recognised content extension. */
export const DEFAULT_CODEC = yjsCodec;

/** Every extension any codec handles, e.g. `['.yjs', '.txt', '.md', …]`. */
export function knownExtensions(): string[] {
  return codecs.flatMap(c => c.extensions);
}

/** Pick the codec for a filename by extension; falls back to the native `.yjs` codec. */
export function codecForFilename(filename: string): Codec {
  const ext = extensionOf(filename);
  return codecs.find(c => c.extensions.includes(ext)) ?? DEFAULT_CODEC;
}
