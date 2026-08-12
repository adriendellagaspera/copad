// Hub only, and it sends nothing: `@y/websocket-server` pushes a room's
// awareness states to every new connection unprompted. See docs/contract.md §6.1.

import * as decoding from 'lib0/decoding';
import type { RoomId, WebsocketUrl } from './types.js';
import type { EpochMs, Milliseconds } from '../time.js';
import { now } from '../time.js';
import { PRESENCE_PROBE_SETTLE_MS } from './constants.js';
import type { SelfProbeMarker } from './selfProbeMarker.js';
import { parsePeerAwarenessState } from './parse.js';

const MESSAGE_AWARENESS = 1; // stock message type 0 is sync, never decoded here

export const HallPresenceKind = {
  Unknown: 'unknown',
  Empty: 'empty',
  Someone: 'someone',
} as const;
export type HallPresenceKind = (typeof HallPresenceKind)[keyof typeof HallPresenceKind];

/** A departure takes ~31s to register, so `lastSeen` is never "present now". */
export type HallPresence =
  | { readonly kind: 'unknown' }
  | { readonly kind: 'empty' }
  | { readonly kind: 'someone'; readonly lastSeen: EpochMs };

export interface PresenceProbe {
  onPresence(fn: (presence: HallPresence) => void): () => void;
  stop(): void;
}

export interface WebsocketPresenceProbeOptions {
  url: WebsocketUrl;
  settleMs?: Milliseconds;
  /** Discards the about-to-open tab's own self-join broadcast. */
  selfMarker?: SelfProbeMarker;
  webSocketImpl?: typeof WebSocket;
}

function hubProbeUrl(url: WebsocketUrl, room: RoomId): string {
  const trimmed = (url as string).replace(/\/+$/, '');
  return `${trimmed}/${room as string}`;
}

function isSelfJoinState(stateJson: string, selfMarker: SelfProbeMarker): boolean {
  try {
    const parsed: unknown = JSON.parse(stateJson);
    return parsePeerAwarenessState(parsed).selfProbeMarker === selfMarker;
  } catch {
    return false;
  }
}

function readAwarenessPeerCount(buf: Uint8Array, selfMarker: SelfProbeMarker | undefined): number {
  const decoder = decoding.createDecoder(buf);
  const len = decoding.readVarUint(decoder);
  let present = 0;
  for (let i = 0; i < len; i++) {
    decoding.readVarUint(decoder); // clientID
    decoding.readVarUint(decoder); // clock
    const stateJson = decoding.readVarString(decoder);
    if (stateJson === 'null') continue;
    if (selfMarker !== undefined && isSelfJoinState(stateJson, selfMarker)) continue;
    present += 1;
  }
  return present;
}

export function probeWebsocketPresence(
  room: RoomId,
  opts: WebsocketPresenceProbeOptions,
): PresenceProbe {
  const WS = opts.webSocketImpl ?? WebSocket;
  const settleMs = opts.settleMs ?? PRESENCE_PROBE_SETTLE_MS;
  const fns = new Set<(presence: HallPresence) => void>();
  let presence: HallPresence = { kind: HallPresenceKind.Unknown };
  let clientCount = 0;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;

  const emit = (next: HallPresence): void => {
    presence = next;
    fns.forEach((fn) => fn(presence));
  };

  const ws = new WS(hubProbeUrl(opts.url, room));
  ws.binaryType = 'arraybuffer';

  ws.onopen = () => {
    settleTimer = setTimeout(() => {
      if (clientCount === 0) emit({ kind: HallPresenceKind.Empty });
    }, settleMs);
  };

  ws.onmessage = (event: MessageEvent) => {
    const decoder = decoding.createDecoder(new Uint8Array(event.data as ArrayBuffer));
    const messageType = decoding.readVarUint(decoder);
    if (messageType !== MESSAGE_AWARENESS) return;
    clientCount = readAwarenessPeerCount(decoding.readVarUint8Array(decoder), opts.selfMarker);
    emit(
      clientCount > 0
        ? { kind: HallPresenceKind.Someone, lastSeen: now() }
        : { kind: HallPresenceKind.Empty },
    );
  };

  const stop = (): void => {
    if (settleTimer !== undefined) clearTimeout(settleTimer);
    ws.onopen = null;
    ws.onmessage = null;
    ws.onerror = null;
    ws.onclose = null;
    ws.close();
    fns.clear();
  };

  return {
    onPresence(fn) {
      fns.add(fn);
      fn(presence);
      return () => fns.delete(fn);
    },
    stop,
  };
}
