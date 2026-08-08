/**
 * "Is anyone in this room?" without joining it — no `Y.Doc` attach, no content
 * sync, no room key. See docs/contract.md §6.1.
 *
 * The stock `@y/websocket-server` (`npm run collab`) pushes two messages to
 * every new connection before either side has sent a byte
 * (`setupWSConnection` in its `utils.js`): a sync-step-1 (a state *vector*,
 * not content) and, only if the room already has peers, their current
 * awareness states. This probe opens a raw `WebSocket` to read that second
 * message and nothing else — it never constructs a `Y.Doc`, never decodes the
 * sync frame, and never sends anything itself, so it never triggers the
 * server into replying with actual document content. Awareness state
 * (display name, colour, role) is not gated by the room's encryption key —
 * the live app already shows it unencrypted in `PresenceBar` — so this needs
 * no key either.
 *
 * Known cost, not fixed here (out of scope, see docs/contract.md §6.1): the
 * stock server only frees a room's `Y.Doc` on disconnect when persistence is
 * configured, and the bundled binary configures none. Every probed room —
 * even briefly — leaks one `Y.Doc` for the life of the server process.
 *
 * The WebRTC/P2P transport has no equivalent gap-free path: `y-webrtc`'s
 * signaling server is pure pub/sub with no roster (docs/contract.md §2), so
 * "is anyone here" can only be answered by actually joining the room's
 * `WebrtcProvider` and watching `room.webrtcConns`/`bcConns` the way
 * `webrtcCollab()` does — which pulls in the same peer-to-peer machinery
 * `webrtcCollab` already builds a full `Collab` around. Doing that safely
 * without a `Y.Doc` attach needs its own investigation; deferred here. This
 * module covers the hub transport only.
 */

import * as decoding from 'lib0/decoding';
import type { RoomId, WebsocketUrl } from './types.js';
import type { EpochMs, Milliseconds } from '../time.js';
import { now } from '../time.js';
import { PRESENCE_PROBE_SETTLE_MS } from './constants.js';

const MESSAGE_AWARENESS = 1; // the other stock message type, 0, is sync — never decoded here

export const HallPresenceKind = {
  Unknown: 'unknown',
  Empty: 'empty',
  Someone: 'someone',
} as const;
export type HallPresenceKind = (typeof HallPresenceKind)[keyof typeof HallPresenceKind];

/**
 * Result of a presence probe. `Unknown` while connecting or undetermined —
 * never collapsed into `Empty`, the same "don't lock on ignorance" rule as
 * `PresenceKind.Unknown` (docs/contract.md §2.2). `lastSeen` backs the
 * required "seen a minute ago" copy — frozen/backgrounded peers can take up
 * to ~89s (P2P) / ~31s (hub) to register as gone, so this must never read
 * as "present".
 */
export type HallPresence =
  | { readonly kind: 'unknown' }
  | { readonly kind: 'empty' }
  | { readonly kind: 'someone'; readonly lastSeen: EpochMs };

export interface PresenceProbe {
  /** Fires immediately with the current value, then on every change. */
  onPresence(fn: (presence: HallPresence) => void): () => void;
  /** Close the socket. Call when the caller no longer needs an answer. */
  stop(): void;
}

export interface WebsocketPresenceProbeOptions {
  /** Validated hub URL, same one `websocketCollab` connects to. */
  url: WebsocketUrl;
  /** Grace window after the socket opens before an empty room is reported.
   *  Defaults to `PRESENCE_PROBE_SETTLE_MS`. */
  settleMs?: Milliseconds;
  /** Inject a `WebSocket` constructor for tests; defaults to the global. */
  webSocketImpl?: typeof WebSocket;
}

function hubProbeUrl(url: WebsocketUrl, room: RoomId): string {
  const trimmed = (url as string).replace(/\/+$/, '');
  return `${trimmed}/${room as string}`;
}

function readAwarenessClientCount(buf: Uint8Array): number {
  const decoder = decoding.createDecoder(buf);
  const len = decoding.readVarUint(decoder);
  let present = 0;
  for (let i = 0; i < len; i++) {
    decoding.readVarUint(decoder); // clientID
    decoding.readVarUint(decoder); // clock
    const stateJson = decoding.readVarString(decoder);
    if (stateJson !== 'null') present += 1;
  }
  return present;
}

/**
 * Probe a room on the hub transport for presence, without attaching a
 * `Y.Doc` and without the room's encryption key.
 */
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
    clientCount = readAwarenessClientCount(decoding.readVarUint8Array(decoder));
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
