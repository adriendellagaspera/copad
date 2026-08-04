// Bridge letting UI outside the Editor subtree (the read-only band, Settings)
// reach the Editor-owned Y.Doc for the "Export a copy" action (#214), without
// Editor exposing its Y.Doc as a prop to App.svelte. Same shape as
// collaboration/roomName.svelte.ts: only one Editor is mounted at a time, so a
// single module-level holder is sufficient — Editor registers on mount and
// unregisters on teardown. Available whenever the Editor is mounted, including
// while the write-gate holds it read-only — export is a read, not a write.

import type { Codec } from '../format/types.js';

type EncodeFn = (codec: Codec) => Promise<Uint8Array>;

let encode = $state<EncodeFn | null>(null);

export const exportBridge = {
  /** Whether an Editor is currently mounted and ready to encode. */
  get available(): boolean {
    return encode !== null;
  },
  /** Encode the current document via `codec`. Rejects if no Editor is mounted. */
  request(codec: Codec): Promise<Uint8Array> {
    return encode ? encode(codec) : Promise.reject(new Error('No document to export yet'));
  },
};

/** Install the Y.Doc-backed encoder (Editor mount). */
export function bindExport(fn: EncodeFn): void {
  encode = fn;
}

/** Drop the encoder (Editor teardown / room change). */
export function unbindExport(): void {
  encode = null;
}
