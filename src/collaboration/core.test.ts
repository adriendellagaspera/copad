// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Y from 'yjs';
import { createCollabCore } from './core.js';
import { CONNECT_TIMEOUT_MS } from './constants.js';
import { PresenceKind } from './types.js';
import type { RoomId } from './types.js';

const ROOM = 'room' as RoomId;

let attached: boolean;
let peers: number;
let reaching: number;
const makeCore = (doc = new Y.Doc()) =>
  createCollabCore({
    doc,
    room: ROOM,
    isAttached: () => attached,
    peerCount: () => peers,
    reachingCount: () => reaching,
  });

beforeEach(() => {
  attached = false;
  peers = 0;
  reaching = 0;
});

describe('createCollabCore status machine', () => {
  it('maps not-attached → connecting, attached+alone → waiting, peer → connected', () => {
    const core = makeCore();
    const seen: string[] = [];
    core.onStatus((s) => seen.push(s));
    expect(seen[0]).toBe('connecting');

    attached = true;
    core.emitStatus();
    expect(seen.at(-1)).toBe('waiting');

    peers = 1;
    core.emitStatus();
    expect(seen.at(-1)).toBe('connected');

    attached = false;
    core.emitStatus();
    expect(seen.at(-1)).toBe('connecting');
    core.destroy();
  });

  it('unsubscribing stops further status callbacks', () => {
    const core = makeCore();
    const seen: string[] = [];
    const off = core.onStatus((s) => seen.push(s));
    const n = seen.length;
    off();
    attached = true;
    core.emitStatus();
    expect(seen.length).toBe(n);
    core.destroy();
  });
});

describe('createCollabCore unreachable timeout', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('reports unreachable once the timeout elapses while never attached', () => {
    const core = makeCore();
    const seen: string[] = [];
    core.onStatus((s) => seen.push(s));
    expect(seen.at(-1)).toBe('connecting');

    vi.advanceTimersByTime(CONNECT_TIMEOUT_MS - 1);
    expect(seen.at(-1)).toBe('connecting');

    vi.advanceTimersByTime(1);
    expect(seen.at(-1)).toBe('unreachable');
    core.destroy();
  });

  it('clears unreachable and resets the window once attached', () => {
    const core = makeCore();
    const seen: string[] = [];
    core.onStatus((s) => seen.push(s));
    vi.advanceTimersByTime(CONNECT_TIMEOUT_MS);
    expect(seen.at(-1)).toBe('unreachable');

    attached = true;
    core.emitStatus();
    expect(seen.at(-1)).toBe('waiting');

    attached = false;
    core.emitStatus();
    expect(seen.at(-1)).toBe('connecting');
    vi.advanceTimersByTime(CONNECT_TIMEOUT_MS - 1);
    expect(seen.at(-1)).toBe('connecting');
    core.destroy();
  });

  it('resetConnectTimeout() rearms a fresh window on manual reconnect', () => {
    const core = makeCore();
    const seen: string[] = [];
    core.onStatus((s) => seen.push(s));
    vi.advanceTimersByTime(CONNECT_TIMEOUT_MS);
    expect(seen.at(-1)).toBe('unreachable');

    core.resetConnectTimeout();
    core.emitStatus();
    expect(seen.at(-1)).toBe('connecting');

    vi.advanceTimersByTime(CONNECT_TIMEOUT_MS - 1);
    expect(seen.at(-1)).toBe('connecting');
    vi.advanceTimersByTime(1);
    expect(seen.at(-1)).toBe('unreachable');
    core.destroy();
  });

  it('does not count time spent offline against the connect window', () => {
    const core = makeCore();
    const seen: string[] = [];
    core.onStatus((s) => seen.push(s));

    vi.advanceTimersByTime(CONNECT_TIMEOUT_MS - 1);
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    window.dispatchEvent(new Event('offline'));
    expect(seen.at(-1)).toBe('offline');

    vi.advanceTimersByTime(10 * CONNECT_TIMEOUT_MS); // well past the window, but offline the whole time
    expect(seen.at(-1)).toBe('offline');

    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    window.dispatchEvent(new Event('online'));
    expect(seen.at(-1)).toBe('connecting');
    core.destroy();
  });
});

describe('createCollabCore synced flag', () => {
  it('fires immediately with false, then on each setSynced', () => {
    const core = makeCore();
    const seen: boolean[] = [];
    core.onSynced((b) => seen.push(b));
    expect(seen).toEqual([false]);

    core.setSynced(true);
    expect(seen.at(-1)).toBe(true);
    core.destroy();
  });
});

describe('createCollabCore teardown', () => {
  it('destroy() drops subscribers so later emits are no-ops', () => {
    const core = makeCore();
    let calls = 0;
    core.onStatus(() => (calls += 1));
    const after = calls;
    core.destroy();
    attached = true;
    core.emitStatus();
    expect(calls).toBe(after);
  });
});

describe('createCollabCore presence (RoomPresence, beside ConnStatus)', () => {
  it('maps offline/not-attached → Unknown, attached+alone → Alone, reaching → Reaching, peer → Accompanied', () => {
    const core = makeCore();
    const seen: PresenceKind[] = [];
    core.onPresence((p) => seen.push(p.kind));
    expect(seen[0]).toBe(PresenceKind.Unknown);

    attached = true;
    core.emitStatus();
    expect(seen.at(-1)).toBe(PresenceKind.Alone);

    reaching = 1;
    core.emitStatus();
    expect(seen.at(-1)).toBe(PresenceKind.Reaching);

    peers = 1;
    core.emitStatus();
    expect(seen.at(-1)).toBe(PresenceKind.Accompanied);

    peers = 0;
    reaching = 0;
    attached = false;
    core.emitStatus();
    expect(seen.at(-1)).toBe(PresenceKind.Unknown);
    core.destroy();
  });

  it('never reports Reaching when no reachingCount hook is supplied (hub transport shape)', () => {
    const core = createCollabCore({
      doc: new Y.Doc(),
      room: ROOM,
      isAttached: () => attached,
      peerCount: () => peers,
    });
    const seen: PresenceKind[] = [];
    core.onPresence((p) => seen.push(p.kind));
    attached = true;
    core.emitStatus();
    expect(seen.at(-1)).toBe(PresenceKind.Alone); // never Reaching — no hook to report it
    core.destroy();
  });

  it('reports Unknown while offline even if otherwise attached with peers (never confirms solitude OR company from stale reads)', () => {
    const core = makeCore();
    const seen: PresenceKind[] = [];
    core.onPresence((p) => seen.push(p.kind));
    attached = true;
    peers = 1;
    core.emitStatus();
    expect(seen.at(-1)).toBe(PresenceKind.Accompanied);

    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    window.dispatchEvent(new Event('offline'));
    expect(seen.at(-1)).toBe(PresenceKind.Unknown);

    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    window.dispatchEvent(new Event('online'));
    core.destroy();
  });

  it('is memoised: repeated emitStatus() calls with an unchanged kind notify once and reuse the same object identity', () => {
    const core = makeCore();
    const seen: unknown[] = [];
    core.onPresence((p) => seen.push(p));
    attached = true;
    core.emitStatus();
    const afterFirst = seen.length;
    const firstObject = seen.at(-1);

    core.emitStatus();
    core.emitStatus();
    core.emitStatus();
    expect(seen.length).toBe(afterFirst);
    expect(seen.at(-1)).toBe(firstObject);

    peers = 1;
    core.emitStatus();
    expect(seen.length).toBe(afterFirst + 1);
    expect(seen.at(-1)).not.toBe(firstObject);
    core.destroy();
  });

  it('a late subscriber gets the current, already-memoised object immediately', () => {
    const core = makeCore();
    attached = true;
    peers = 1;
    core.emitStatus();
    let got: unknown;
    core.onPresence((p) => (got = p));
    expect((got as { kind: PresenceKind }).kind).toBe(PresenceKind.Accompanied);
    core.destroy();
  });

  it('unsubscribing stops further presence callbacks', () => {
    const core = makeCore();
    const seen: PresenceKind[] = [];
    const off = core.onPresence((p) => seen.push(p.kind));
    const n = seen.length;
    off();
    attached = true;
    core.emitStatus();
    expect(seen.length).toBe(n);
    core.destroy();
  });
});
