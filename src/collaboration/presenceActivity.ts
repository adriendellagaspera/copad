/**
 * Idle tracking for remote cursors. y-prosemirror's `yCursorPlugin` renders
 * every present peer at full strength forever — fine in a small room, noisy
 * once a peer parks their cursor and steps away (SOTA: Figma fades a cursor
 * after ~5 min idle). This module is the "since when has this peer been
 * still" half; `Editor.svelte` turns that into a fade tier for CSS.
 */

import type { Awareness } from 'y-protocols/awareness';
import { now, type Milliseconds, type EpochMs } from '../time.js';
import { parsePeerCursorValue, parseClientId } from './parse.js';
import type { ClientId } from './types.js';

/** Idle-time thresholds (ms) — below FADE_START a peer renders at full
 *  strength; between FADE_START and FADE_DONE it fades; at/after FADE_DONE
 *  it's settled at its faintest (still present — only leaving removes it). */
export const FADE_START_MS = 20_000 as Milliseconds;
export const FADE_DONE_MS = (5 * 60_000) as Milliseconds;

export interface PresenceActivity {
  /** Milliseconds since this client's awareness state last changed (cursor
   *  moved, selection changed, …). A client never observed reports 0 — treat
   *  first sight as "active now" so a peer doesn't render pre-faded. */
  idleMs(clientId: ClientId): Milliseconds;
  destroy(): void;
}

/** Tracks per-peer last-active timestamps from an `Awareness` instance,
 *  keyed off actual movement of the `cursor` field yCursorPlugin maintains
 *  (anchor/head relative positions) — NOT off every `change` event. Awareness
 *  itself re-broadcasts each peer's unchanged local state on a ~15s keep-alive
 *  (see y-protocols' `outdatedTimeout` heartbeat), which fires a `change` for
 *  that client even when nothing moved; treating that as activity would mean
 *  idle time never accumulates. So we compare the cursor value itself and
 *  only touch the timestamp when it actually differs from what we last saw. */
export function trackPresenceActivity(awareness: Awareness): PresenceActivity {
  const lastActive = new Map<ClientId, EpochMs>();
  const lastCursor = new Map<ClientId, string>();

  const cursorKey = (clientId: ClientId): string | undefined => {
    const cursor = parsePeerCursorValue(awareness.getStates().get(clientId));
    return cursor == null ? undefined : JSON.stringify(cursor);
  };

  const touch = (clientId: ClientId): void => {
    lastActive.set(clientId, now());
    const key = cursorKey(clientId);
    if (key !== undefined) lastCursor.set(clientId, key);
  };

  awareness.getStates().forEach((_state, clientId) => touch(parseClientId(clientId)));

  const onChange = ({ added, updated }: { added: number[]; updated: number[]; removed: number[] }): void => {
    added.map(parseClientId).forEach(touch);
    updated.map(parseClientId).forEach((clientId) => {
      const key = cursorKey(clientId);
      if (key !== lastCursor.get(clientId)) touch(clientId);
    });
  };
  awareness.on('change', onChange);

  return {
    idleMs(clientId) {
      const t = lastActive.get(clientId);
      return (t == null ? 0 : now() - t) as Milliseconds;
    },
    destroy() {
      awareness.off('change', onChange);
    },
  };
}

/** Idle → fade tier, `0` (fresh) to `1` (fully faded). Linear ramp between the
 *  two thresholds so CSS can interpolate opacity/size smoothly. */
export function fadeTier(idleMs: Milliseconds): number {
  if (idleMs <= FADE_START_MS) return 0;
  if (idleMs >= FADE_DONE_MS) return 1;
  return (idleMs - FADE_START_MS) / (FADE_DONE_MS - FADE_START_MS);
}
