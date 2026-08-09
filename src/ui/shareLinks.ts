import type { RoomId } from '../collaboration/types.js';
import type { RoomCredential } from '../collaboration/roomAccess.js';

/** `${location.origin}${location.pathname}` — the app's own address, without
 *  query or fragment. Cast once, where `location` is read. */
export type AppUrl = string & { readonly _brand: 'AppUrl' };

/** A complete invite link: app address + room + optional role + optional key. */
export type ShareUrl = string & { readonly _brand: 'ShareUrl' };

/** What an invite link opens as. `Reader` is cooperative signalling, not access
 *  control: `?role=reader` is removable by its recipient (docs/contract.md §4). */
export const InviteRole = { Editor: 'editor', Reader: 'reader' } as const;
export type InviteRole = (typeof InviteRole)[keyof typeof InviteRole];

/** The two things the Share dialog shows, one at a time. */
export const ShareView = { Invite: 'invite', Security: 'security' } as const;
export type ShareView = (typeof ShareView)[keyof typeof ShareView];

export const RoomSecurityKind = {
  None: 'none',
  SecretLink: 'secret-link',
  Password: 'password',
  Deployment: 'deployment',
} as const;
export type RoomSecurityKind = (typeof RoomSecurityKind)[keyof typeof RoomSecurityKind];

export type RoomSecurity =
  | { readonly kind: typeof RoomSecurityKind.None }
  | { readonly kind: typeof RoomSecurityKind.SecretLink; readonly key: RoomCredential }
  | { readonly kind: typeof RoomSecurityKind.Password; readonly password: RoomCredential }
  | { readonly kind: typeof RoomSecurityKind.Deployment; readonly password: RoomCredential };

export interface RoomSecuritySources {
  readonly linkKey: RoomCredential | null;
  readonly storedPassword: RoomCredential | null;
  readonly envPassword: RoomCredential | null;
}

/** Mirrors App.svelte's effective cipher precedence: `#k=` → per-room password
 *  → deployment-wide env password. */
export function roomSecurity(sources: RoomSecuritySources): RoomSecurity {
  if (sources.linkKey) return { kind: RoomSecurityKind.SecretLink, key: sources.linkKey };
  if (sources.storedPassword)
    return { kind: RoomSecurityKind.Password, password: sources.storedPassword };
  if (sources.envPassword)
    return { kind: RoomSecurityKind.Deployment, password: sources.envPassword };
  return { kind: RoomSecurityKind.None };
}

export function isEncrypted(security: RoomSecurity): boolean {
  return security.kind !== RoomSecurityKind.None;
}

export function shareUrl(
  app: AppUrl,
  room: RoomId,
  role: InviteRole,
  linkKey: RoomCredential | null,
): ShareUrl {
  const role_ = role === InviteRole.Reader ? '&role=reader' : '';
  // #k= last: the key belongs in the fragment, which is never sent to a server.
  const key = linkKey ? `#k=${encodeURIComponent(linkKey)}` : '';
  return `${app}?room=${encodeURIComponent(room)}${role_}${key}` as ShareUrl;
}
