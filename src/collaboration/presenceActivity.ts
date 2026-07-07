/**
 * Idle tracking for remote cursors. y-prosemirror's `yCursorPlugin` renders
 * every present peer at full strength forever — fine in a small room, noisy
 * once a peer parks their cursor and steps away (SOTA: Figma fades a cursor
 * after ~5 min idle). This module is the "since when has this peer been
 * still" half; `Editor.svelte` turns that into a fade tier for CSS.
 */

import type { Awareness } from 'y-protocols/awareness';

/** Idle-time thresholds (ms) — below FADE_START a peer renders at full
 *  strength; between FADE_START and FADE_DONE it fades; at/after FADE_DONE
 *  it's settled at its faintest (still present — only leaving removes it). */
export const FADE_START_MS = 20_000;
export const FADE_DONE_MS = 5 * 60_000;

export interface PresenceActivity {
  /** Milliseconds since this client's awareness state last changed (cursor
   *  moved, selection changed, …). A client never observed reports 0 — treat
   *  first sight as "active now" so a peer doesn't render pre-faded. */
  idleMs(clientId: number): number;
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
  const lastActive = new Map<number, number>();
  const lastCursor = new Map<number, string>();

  const cursorKey = (clientId: number): string | undefined => {
    const state = awareness.getStates().get(clientId) as { cursor?: unknown } | undefined;
    return state?.cursor == null ? undefined : JSON.stringify(state.cursor);
  };

  const touch = (clientId: number): void => {
    lastActive.set(clientId, Date.now());
    const key = cursorKey(clientId);
    if (key !== undefined) lastCursor.set(clientId, key);
  };

  awareness.getStates().forEach((_state, clientId) => touch(clientId));

  const onChange = ({ added, updated }: { added: number[]; updated: number[]; removed: number[] }): void => {
    added.forEach(touch);
    updated.forEach((clientId) => {
      const key = cursorKey(clientId);
      if (key !== lastCursor.get(clientId)) touch(clientId);
    });
  };
  awareness.on('change', onChange);

  return {
    idleMs(clientId) {
      const t = lastActive.get(clientId);
      return t == null ? 0 : Date.now() - t;
    },
    destroy() {
      awareness.off('change', onChange);
    },
  };
}

/** Idle → fade tier, `0` (fresh) to `1` (fully faded). Linear ramp between the
 *  two thresholds so CSS can interpolate opacity/size smoothly. */
export function fadeTier(idleMs: number): number {
  if (idleMs <= FADE_START_MS) return 0;
  if (idleMs >= FADE_DONE_MS) return 1;
  return (idleMs - FADE_START_MS) / (FADE_DONE_MS - FADE_START_MS);
}
