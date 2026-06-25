/** A peer present in the room (derived from y-protocols awareness state). */
export interface PeerUser {
  id: number;
  name: string;
  color: string;
  self?: boolean;
}

/** Storage save lifecycle, surfaced by the StatusPill. */
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';
