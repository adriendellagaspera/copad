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

export type ConflictWarning = string & { readonly _brand: 'ConflictWarning' };
export type StorageAttached = boolean & { readonly _brand: 'StorageAttached' };
export type RoomEncrypted = boolean & { readonly _brand: 'RoomEncrypted' };
export type KeepSegmentLabels = boolean & { readonly _brand: 'KeepSegmentLabels' };
