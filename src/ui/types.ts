import type { DisplayName, CursorColor } from '../collaboration/types.js';

/** A peer present in the room (derived from y-protocols awareness state). */
export interface PeerUser {
  id: number;
  name: DisplayName;
  color: CursorColor;
  self?: boolean;
}

/** Storage save lifecycle, surfaced by the StatusPill. */
export const SaveStatus = { Idle: 'idle', Saving: 'saving', Saved: 'saved', Error: 'error' } as const;
export type SaveStatus = (typeof SaveStatus)[keyof typeof SaveStatus];
