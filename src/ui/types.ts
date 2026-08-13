import type { DisplayName, CursorColor, ClientId } from '../collaboration/types.js';

/** A peer present in the room (derived from y-protocols awareness state). */
export interface PeerUser {
  id: ClientId;
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

export type DialogOpen = boolean & { readonly _brand: 'DialogOpen' };
export type DialogTitle = string & { readonly _brand: 'DialogTitle' };
/** A dialog body that supplies its own padding, so the shell adds none. */
export type DialogFlush = boolean & { readonly _brand: 'DialogFlush' };
export type SpellcheckEnabled = boolean & { readonly _brand: 'SpellcheckEnabled' };
/** A resolved BCP-47 language tag — `LanguageChoice` (`language.svelte.ts`)
 *  after its `'auto'` sentinel has been settled against `navigator.language`. */
export type ResolvedLanguage = string & { readonly _brand: 'ResolvedLanguage' };
/** Open Settings with the Advanced section expanded and focused. */
export type FocusAdvanced = boolean & { readonly _brand: 'FocusAdvanced' };
