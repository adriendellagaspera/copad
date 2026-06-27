import type { DisplayName, CursorColor } from '../collaboration/types.js';

/** A peer present in the room (derived from y-protocols awareness state). */
export interface PeerUser {
  id: number;
  name: DisplayName;
  color: CursorColor;
  self?: boolean;
}

/** Storage save lifecycle, surfaced by the StatusPill. */
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';
