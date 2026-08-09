/**
 * "Is anyone in this room?" without joining it — no `Y.Doc` attach, no content
 * sync, no room key. See docs/contract.md §6.1.
 *
 * Works because the stock `@y/websocket-server` pushes a room's current
 * awareness states to every new connection unprompted (`setupWSConnection` in
 * its `utils.js`), before this probe sends a byte. Reading that message never
 * requires decoding the sync frame or the room key, since awareness state is
 * unencrypted (`PresenceBar` already shows it that way).
 *
 * Known cost, out of scope (see §6.1): the stock server only frees a room's
 * `Y.Doc` on disconnect when persistence is configured — the bundled binary
 * configures none, so every probed room leaks one `Y.Doc` for the server's
 * lifetime.
 *
 * WebRTC/P2P has no equivalent probe (see §6.1 for the full analysis).
 * Signaling messages are AES-encrypted whenever the room has a key
 * (`publishSignalingMessage` in `y-webrtc.js`), so a keyless prober is
 * silently dropped by real peers — this probe's core property cannot hold
 * there. Provoking a reply without a key would also mean publishing a forged
 * `announce`, making a real peer spin up a genuine `RTCPeerConnection`
 * visible in its own UI as a phantom "Reaching" connection — a side effect on
 * the probed peer's device this module's design forbids.
 */

import * as decoding from 'lib0/decoding';
import type { RoomId, WebsocketUrl } from './types.js';
import type { EpochMs, Milliseconds } from '../time.js';
import { now } from '../time.js';
import { PRESENCE_PROBE_SETTLE_MS } from './constants.js';
import type { SelfProbeMarker } from './selfProbeMarker.js';
import { parsePeerAwarenessState } from './parse.js';

const MESSAGE_AWARENESS = 1; // stock message type 0 is sync — never decoded here

export const HallPresenceKind = {
  Unknown: 'unknown',
  Empty: 'empty',
  Someone: 'someone',
} as const;
export type HallPresenceKind = (typeof HallPresenceKind)[keyof typeof HallPresenceKind];

/**
 * `unknown` never collapses into `empty` (docs/contract.md §2.2) — connecting
 * or undetermined stays `unknown`. Peers can take ~89s (P2P) / ~31s (hub) to
 * register as gone, so `lastSeen` must not be read as still-present sooner.
 */
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
  /** Recognizes and discards this probe's own about-to-open tab's self-join
   *  awareness broadcast. Omit when no matching join is in flight. */
  selfMarker?: SelfProbeMarker;
  /** Inject a `WebSocket` constructor for tests; defaults to the global. */
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
    if (messageType !== MESSAGE_AWARENESS) return; // never decode MESSAGE_SYNC — no doc content read
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
