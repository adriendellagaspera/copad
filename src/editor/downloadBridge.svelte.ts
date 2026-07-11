// Bridge letting the header-level Download control (src/ui/DownloadMenu.svelte)
// reach the Editor-owned Y.Doc for the one-off "Download as…" export (#86,
// #181), without Editor exposing its Y.Doc as a prop to App.svelte. Same
// shape as collaboration/roomName.svelte.ts: only one Editor is mounted at a
// time, so a single module-level holder is sufficient — Editor registers on
// mount and unregisters on teardown.

import type { Codec } from '../format/types.js';

type EncodeFn = (codec: Codec) => Promise<Uint8Array>;

let encode = $state<EncodeFn | null>(null);

export const downloadBridge = {
  /** Whether an Editor is currently mounted and ready to encode. */
  get available(): boolean {
    return encode !== null;
  },
  /** Encode the current document via `codec`. Rejects if no Editor is mounted. */
  request(codec: Codec): Promise<Uint8Array> {
    return encode ? encode(codec) : Promise.reject(new Error('No document to download yet'));
  },
};

/** Install the Y.Doc-backed encoder (Editor mount). */
export function bindDownload(fn: EncodeFn): void {
  encode = fn;
}

/** Drop the encoder (Editor teardown / room change). */
export function unbindDownload(): void {
  encode = null;
}
