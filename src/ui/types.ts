import type { DisplayName, CursorColor, ClientId } from '../collaboration/types.js';

export interface PeerUser {
  id: ClientId;
  name: DisplayName;
  color: CursorColor;
  self?: boolean;
}

export const SaveStatus = { Idle: 'idle', Saving: 'saving', Saved: 'saved', Error: 'error' } as const;
export type SaveStatus = (typeof SaveStatus)[keyof typeof SaveStatus];

export type ConflictWarning = string & { readonly _brand: 'ConflictWarning' };
export type StorageAttached = boolean & { readonly _brand: 'StorageAttached' };
export type RoomEncrypted = boolean & { readonly _brand: 'RoomEncrypted' };
export type KeepSegmentLabels = boolean & { readonly _brand: 'KeepSegmentLabels' };

export type DialogOpen = boolean & { readonly _brand: 'DialogOpen' };
export type DialogTitle = string & { readonly _brand: 'DialogTitle' };
export type DialogFlush = boolean & { readonly _brand: 'DialogFlush' };
export type SpellcheckEnabled = boolean & { readonly _brand: 'SpellcheckEnabled' };
export type ResolvedLanguage = string & { readonly _brand: 'ResolvedLanguage' };
export type FocusAdvanced = boolean & { readonly _brand: 'FocusAdvanced' };
