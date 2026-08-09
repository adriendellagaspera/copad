import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as encoding from 'lib0/encoding';
import { probeWebsocketPresence, HallPresenceKind } from './presenceProbe.js';
import { PRESENCE_PROBE_SETTLE_MS } from './constants.js';
import type { RoomId, WebsocketUrl } from './types.js';
import type { SelfProbeMarker } from './selfProbeMarker.js';

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  url: string;
  binaryType = '';
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: ArrayBuffer }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;
  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }
  close() {
    this.closed = true;
  }
  open() {
    this.onopen?.();
  }
  deliverAwareness(clientStates: Array<{ id: number; clock: number; state: unknown }>) {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    const payload = encoding.createEncoder();
    encoding.writeVarUint(payload, clientStates.length);
    for (const c of clientStates) {
      encoding.writeVarUint(payload, c.id);
      encoding.writeVarUint(payload, c.clock);
      encoding.writeVarString(payload, JSON.stringify(c.state));
    }
    encoding.writeVarUint8Array(encoder, encoding.toUint8Array(payload));
    this.onmessage?.({ data: encoding.toUint8Array(encoder).buffer as ArrayBuffer });
  }
  deliverSyncStep1() {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    encoding.writeVarUint8Array(encoder, new Uint8Array([1, 2, 3]));
    this.onmessage?.({ data: encoding.toUint8Array(encoder).buffer as ArrayBuffer });
  }
}

const ROOM = 'room' as RoomId;
const HUB = 'wss://hub.example' as WebsocketUrl;

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebSocket.instances = [];
});

afterEach(() => {
  vi.useRealTimers();
});

const latest = (): FakeWebSocket => FakeWebSocket.instances[FakeWebSocket.instances.length - 1];

describe('probeWebsocketPresence', () => {
  it('starts unknown', () => {
    const probe = probeWebsocketPresence(ROOM, {
      url: HUB,
      webSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    });
    const seen: string[] = [];
    probe.onPresence((p) => seen.push(p.kind));
    expect(seen).toEqual([HallPresenceKind.Unknown]);
    probe.stop();
  });

  it('connects to url/room, matching websocketCollab', () => {
    probeWebsocketPresence(ROOM, { url: HUB, webSocketImpl: FakeWebSocket as unknown as typeof WebSocket });
    expect(latest().url).toBe('wss://hub.example/room');
  });

  it('reports empty after the settle window with no awareness push', () => {
    const probe = probeWebsocketPresence(ROOM, {
      url: HUB,
      webSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    });
    const seen: string[] = [];
    probe.onPresence((p) => seen.push(p.kind));
    latest().open();
    expect(seen.at(-1)).toBe(HallPresenceKind.Unknown);

    vi.advanceTimersByTime(PRESENCE_PROBE_SETTLE_MS);
    expect(seen.at(-1)).toBe(HallPresenceKind.Empty);
    probe.stop();
  });

  it('reports someone when the server pushes non-null awareness states', () => {
    const probe = probeWebsocketPresence(ROOM, {
      url: HUB,
      webSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    });
    const seen: string[] = [];
    probe.onPresence((p) => seen.push(p.kind));
    latest().open();
    latest().deliverAwareness([{ id: 7, clock: 1, state: { user: 'ada' } }]);

    expect(seen.at(-1)).toBe(HallPresenceKind.Someone);
    probe.stop();
  });

  it('a departure (null state) reported after presence flips back to empty', () => {
    const probe = probeWebsocketPresence(ROOM, {
      url: HUB,
      webSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    });
    const seen: string[] = [];
    probe.onPresence((p) => seen.push(p.kind));
    latest().open();
    latest().deliverAwareness([{ id: 7, clock: 1, state: { user: 'ada' } }]);
    latest().deliverAwareness([{ id: 7, clock: 2, state: null }]);

    expect(seen.at(-1)).toBe(HallPresenceKind.Empty);
    probe.stop();
  });

  it('never decodes a sync message into presence', () => {
    const probe = probeWebsocketPresence(ROOM, {
      url: HUB,
      webSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    });
    const seen: string[] = [];
    probe.onPresence((p) => seen.push(p.kind));
    latest().open();
    latest().deliverSyncStep1();

    expect(seen).toEqual([HallPresenceKind.Unknown]);
    probe.stop();
  });

  it('excludes an awareness entry carrying its own selfMarker, reporting empty', () => {
    const selfMarker = 'nonce-1' as SelfProbeMarker;
    const probe = probeWebsocketPresence(ROOM, {
      url: HUB,
      selfMarker,
      webSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    });
    const seen: string[] = [];
    probe.onPresence((p) => seen.push(p.kind));
    latest().open();
    latest().deliverAwareness([
      { id: 7, clock: 1, state: { user: { name: 'me', color: '#111111' }, selfProbeMarker: selfMarker } },
    ]);

    expect(seen.at(-1)).toBe(HallPresenceKind.Empty);
    probe.stop();
  });

  it('still reports someone for a real peer alongside its own excluded self-join', () => {
    const selfMarker = 'nonce-2' as SelfProbeMarker;
    const probe = probeWebsocketPresence(ROOM, {
      url: HUB,
      selfMarker,
      webSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    });
    const seen: string[] = [];
    probe.onPresence((p) => seen.push(p.kind));
    latest().open();
    latest().deliverAwareness([
      { id: 7, clock: 1, state: { user: { name: 'me', color: '#111111' }, selfProbeMarker: selfMarker } },
      { id: 8, clock: 1, state: { user: { name: 'stranger', color: '#222222' } } },
    ]);

    expect(seen.at(-1)).toBe(HallPresenceKind.Someone);
    probe.stop();
  });

  it('does not exclude a peer carrying a different selfProbeMarker', () => {
    const selfMarker = 'nonce-3' as SelfProbeMarker;
    const probe = probeWebsocketPresence(ROOM, {
      url: HUB,
      selfMarker,
      webSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    });
    const seen: string[] = [];
    probe.onPresence((p) => seen.push(p.kind));
    latest().open();
    latest().deliverAwareness([
      {
        id: 9,
        clock: 1,
        state: { user: { name: 'other-joiner', color: '#333333' }, selfProbeMarker: 'nonce-other' },
      },
    ]);

    expect(seen.at(-1)).toBe(HallPresenceKind.Someone);
    probe.stop();
  });

  it('reports someone from a real peer when no selfMarker was given at all', () => {
    const probe = probeWebsocketPresence(ROOM, {
      url: HUB,
      webSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    });
    const seen: string[] = [];
    probe.onPresence((p) => seen.push(p.kind));
    latest().open();
    latest().deliverAwareness([
      { id: 7, clock: 1, state: { user: { name: 'stranger', color: '#111111' } } },
    ]);

    expect(seen.at(-1)).toBe(HallPresenceKind.Someone);
    probe.stop();
  });

  it('stop() closes the socket and unsubscribes listeners', () => {
    const probe = probeWebsocketPresence(ROOM, {
      url: HUB,
      webSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    });
    latest().open();
    probe.stop();
    expect(latest().closed).toBe(true);

    const seen: string[] = [];
    probe.onPresence((p) => seen.push(p.kind));
    latest().deliverAwareness([{ id: 1, clock: 1, state: {} }]);
    expect(seen).toEqual([HallPresenceKind.Unknown]);
  });
});
