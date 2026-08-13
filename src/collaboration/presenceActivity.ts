import type { Awareness } from 'y-protocols/awareness';
import { now, type Milliseconds, type EpochMs } from '../time.js';
import { parsePeerCursorValue, parseClientId } from './parse.js';
import type { ClientId } from './types.js';

export const FADE_START_MS = 20_000 as Milliseconds;
export const FADE_DONE_MS = (5 * 60_000) as Milliseconds;

export interface PresenceActivity {
  /** An unobserved client reports 0, so first sight never renders pre-faded. */
  idleMs(clientId: ClientId): Milliseconds;
  destroy(): void;
}

/** Compares the cursor value rather than trusting `change`: y-protocols
 *  re-broadcasts unchanged state on a ~15s keep-alive, so idle time would
 *  never accumulate. */
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

export function fadeTier(idleMs: Milliseconds): number {
  if (idleMs <= FADE_START_MS) return 0;
  if (idleMs >= FADE_DONE_MS) return 1;
  return (idleMs - FADE_START_MS) / (FADE_DONE_MS - FADE_START_MS);
}
