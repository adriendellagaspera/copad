import { describe, it, expect, vi } from 'vitest';

// Replace the real y-webrtc provider with a tiny event emitter we can drive.
vi.mock('y-webrtc', () => {
  class WebrtcProvider {
    awareness = { on() {}, getStates: () => new Map(), clientID: 1 };
    handlers: Record<string, ((...a: unknown[]) => void)[]> = {};
    connected = true;
    synced = false;
    constructor() {
      (globalThis as Record<string, unknown>).__wp = this;
    }
    on(ev: string, fn: (...a: unknown[]) => void) {
      (this.handlers[ev] ||= []).push(fn);
    }
    emit(ev: string, arg?: unknown) {
      (this.handlers[ev] || []).forEach((fn) => fn(arg));
    }
    destroy() {}
  }
  return { WebrtcProvider };
});

import { webrtcCollab } from './webrtc.js';
import type { RoomId } from './types.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const provider = (): any => (globalThis as Record<string, unknown>).__wp;

const ROOM = 'room' as RoomId;

describe('webrtcCollab status mapping', () => {
  it('emits the current status immediately and on change', () => {
    const collab = webrtcCollab({ signaling: ['ws://x'] })(ROOM);
    const seen: string[] = [];
    collab.onStatus((s) => seen.push(s));

    // connected getter is true initially → 'connected'
    expect(seen[0]).toBe('connected');

    // provider reports it stopped looking for peers → 'connecting'
    provider().connected = false;
    provider().emit('status', { connected: false });
    expect(seen.at(-1)).toBe('connecting');

    collab.destroy();
  });

  it('tracks the synced flag', () => {
    const collab = webrtcCollab({ signaling: ['ws://x'] })(ROOM);
    let synced = true;
    collab.onSynced((b) => (synced = b));
    expect(synced).toBe(false); // initial

    provider().emit('synced', { synced: true });
    expect(synced).toBe(true);

    collab.destroy();
  });
});
