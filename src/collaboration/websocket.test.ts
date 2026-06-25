import { describe, it, expect, vi } from 'vitest';

// Replace the real y-websocket provider with a tiny event emitter we can drive.
vi.mock('y-websocket', () => {
  class Awareness {
    states = new Map<number, unknown>([[1, {}]]); // self is always present
    handlers: Record<string, (() => void)[]> = {};
    clientID = 1;
    on(ev: string, fn: () => void) {
      (this.handlers[ev] ||= []).push(fn);
    }
    off(ev: string, fn: () => void) {
      this.handlers[ev] = (this.handlers[ev] || []).filter((f) => f !== fn);
    }
    emit(ev: string) {
      (this.handlers[ev] || []).forEach((fn) => fn());
    }
    getStates() {
      return this.states;
    }
  }
  class WebsocketProvider {
    awareness = new Awareness();
    handlers: Record<string, ((...a: unknown[]) => void)[]> = {};
    wsconnected = false;
    url: string;
    room: string;
    constructor(url: string, room: string, _doc: unknown) {
      this.url = url;
      this.room = room;
      (globalThis as Record<string, unknown>).__wsp = this;
    }
    on(ev: string, fn: (...a: unknown[]) => void) {
      (this.handlers[ev] ||= []).push(fn);
    }
    emit(ev: string, arg?: unknown) {
      (this.handlers[ev] || []).forEach((fn) => fn(arg));
    }
    destroy() {}
  }
  return { WebsocketProvider };
});

import { websocketCollab } from './websocket.js';
import type { RoomId } from './types.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const provider = (): any => (globalThis as Record<string, unknown>).__wsp;

const ROOM = 'room' as RoomId;

describe('websocketCollab status mapping', () => {
  it('maps connecting → waiting → connected as the socket and peers change', () => {
    const collab = websocketCollab({ url: 'wss://x' })(ROOM);
    const seen: string[] = [];
    collab.onStatus((s) => seen.push(s));

    // Socket not open yet → 'connecting'.
    expect(seen[0]).toBe('connecting');

    // Socket attaches but we're alone in the room → 'waiting', not 'connected'.
    provider().wsconnected = true;
    provider().emit('status', { status: 'connected' });
    expect(seen.at(-1)).toBe('waiting');

    // Another peer's awareness appears → 'connected'.
    provider().awareness.states.set(2, {});
    provider().awareness.emit('change');
    expect(seen.at(-1)).toBe('connected');

    // Socket drops → back to 'connecting'.
    provider().wsconnected = false;
    provider().emit('status', { status: 'disconnected' });
    expect(seen.at(-1)).toBe('connecting');

    collab.destroy();
  });

  it('tracks the synced flag', () => {
    const collab = websocketCollab({ url: 'wss://x' })(ROOM);
    let synced = true;
    collab.onSynced((b) => (synced = b));
    expect(synced).toBe(false); // initial

    provider().emit('sync', true);
    expect(synced).toBe(true);

    collab.destroy();
  });

  it('connects to the configured server URL and room', () => {
    websocketCollab({ url: 'wss://hub.example' })('my-room' as RoomId);
    expect(provider().url).toBe('wss://hub.example');
    expect(provider().room).toBe('my-room');
  });

  it('reports the hub transport', () => {
    const collab = websocketCollab({ url: 'wss://x' })(ROOM);
    expect(collab.transport).toBe('hub');
    collab.destroy();
  });
});
