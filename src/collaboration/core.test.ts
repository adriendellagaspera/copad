// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { createCollabCore } from './core.js';
import type { RoomId } from './types.js';

const ROOM = 'room' as RoomId;

// Mutable transport state the fake hooks read, so a test can drive transitions.
let attached: boolean;
let peers: number;
const makeCore = (doc = new Y.Doc()) =>
  createCollabCore({
    doc,
    room: ROOM,
    isAttached: () => attached,
    peerCount: () => peers,
  });

beforeEach(() => {
  attached = false;
  peers = 0;
});

describe('createCollabCore status machine', () => {
  it('maps not-attached → connecting, attached+alone → waiting, peer → connected', () => {
    const core = makeCore();
    const seen: string[] = [];
    core.onStatus((s) => seen.push(s));
    expect(seen[0]).toBe('connecting'); // fires immediately with the current value

    attached = true;
    core.emitStatus();
    expect(seen.at(-1)).toBe('waiting'); // attached but no peers

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
