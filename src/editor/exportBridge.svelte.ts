import type { Codec } from '../format/types.js';

type EncodeFn = (codec: Codec) => Promise<Uint8Array>;

let encode = $state<EncodeFn | null>(null);

export const exportBridge = {
  get available(): boolean {
    return encode !== null;
  },
  request(codec: Codec): Promise<Uint8Array> {
    return encode ? encode(codec) : Promise.reject(new Error('No document to export yet'));
  },
};

export function bindExport(fn: EncodeFn): void {
  encode = fn;
}

export function unbindExport(): void {
  encode = null;
}
