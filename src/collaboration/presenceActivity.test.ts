import { describe, it, expect, vi, afterEach } from 'vitest';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { trackPresenceActivity, fadeTier, FADE_START_MS, FADE_DONE_MS } from './presenceActivity.js';
import type { Milliseconds } from '../time.js';

function newAwareness(): Awareness {
  return new Awareness(new Y.Doc());
}

const ms = (n: number): Milliseconds => n as Milliseconds;

describe('trackPresenceActivity', () => {
  afterEach(() => vi.useRealTimers());

  it('reports 0 idle for a client just observed', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const awareness = newAwareness();
    awareness.setLocalState({ hello: 'world' });
    const activity = trackPresenceActivity(awareness);
    expect(activity.idleMs(awareness.clientID)).toBe(0);
    activity.destroy();
  });

  it('reports 0 for a client seen before tracking started', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const awareness = newAwareness();
    awareness.setLocalState({ hello: 'world' });
    // Simulate this peer having been present for a while already.
    const activity = trackPresenceActivity(awareness);
    expect(activity.idleMs(awareness.clientID)).toBe(0);
    activity.destroy();
  });

  it('accumulates idle time until the next state change', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const awareness = newAwareness();
    awareness.setLocalState({ cursor: 1 });
    const activity = trackPresenceActivity(awareness);

    vi.setSystemTime(10_000);
    expect(activity.idleMs(awareness.clientID)).toBe(10_000);

    awareness.setLocalState({ cursor: 2 });
    expect(activity.idleMs(awareness.clientID)).toBe(0);

    activity.destroy();
  });

  it('stops updating after destroy', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const awareness = newAwareness();
    awareness.setLocalState({ cursor: 1 });
    const activity = trackPresenceActivity(awareness);
    activity.destroy();

    vi.setSystemTime(5_000);
    awareness.setLocalState({ cursor: 2 });
    // No longer tracked, but idleMs still reflects the last-known touch (0 at t=0 -> now 5000).
    expect(activity.idleMs(awareness.clientID)).toBe(5_000);
  });

  it('reports 0 for an unknown client id', () => {
    const awareness = newAwareness();
    const activity = trackPresenceActivity(awareness);
    expect(activity.idleMs(999999)).toBe(0);
    activity.destroy();
  });
});

describe('fadeTier', () => {
  it('is 0 before the fade starts', () => {
    expect(fadeTier(ms(0))).toBe(0);
    expect(fadeTier(FADE_START_MS)).toBe(0);
  });

  it('is 1 once fully idle', () => {
    expect(fadeTier(FADE_DONE_MS)).toBe(1);
    expect(fadeTier(ms(FADE_DONE_MS + 1_000_000))).toBe(1);
  });

  it('ramps linearly between the thresholds', () => {
    const mid = ms(FADE_START_MS + (FADE_DONE_MS - FADE_START_MS) / 2);
    expect(fadeTier(mid)).toBeCloseTo(0.5);
  });
});
