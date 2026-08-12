import type { RoomId } from '../collaboration/types.js';
import { Transport } from '../collaboration/types.js';
import type { RoomCredential } from '../collaboration/roomAccess.js';

export type AppUrl = string & { readonly _brand: 'AppUrl' };
export type ShareUrl = string & { readonly _brand: 'ShareUrl' };
export type ShareTitle = string & { readonly _brand: 'ShareTitle' };
export type ShareMessage = string & { readonly _brand: 'ShareMessage' };
export type ShareChannelUrl = string & { readonly _brand: 'ShareChannelUrl' };
export type InviteRoleLabel = string & { readonly _brand: 'InviteRoleLabel' };
export type RoomEncrypted = boolean & { readonly _brand: 'RoomEncrypted' };

/** `?role=reader` is removable by its recipient: cooperative, not access control (docs/contract.md §4). */
export const InviteRole = { Editor: 'editor', Reader: 'reader' } as const;
export type InviteRole = (typeof InviteRole)[keyof typeof InviteRole];

export const ShareView = { Invite: 'invite', Security: 'security' } as const;
export type ShareView = (typeof ShareView)[keyof typeof ShareView];

export interface InviteRoleChoice {
  readonly role: InviteRole;
  readonly label: InviteRoleLabel;
}

export const INVITE_ROLE_CHOICES: readonly InviteRoleChoice[] = [
  { role: InviteRole.Editor, label: 'Editing' as InviteRoleLabel },
  { role: InviteRole.Reader, label: 'View-only' as InviteRoleLabel },
];

export const CopyFeedback = { Idle: 'idle', Copied: 'copied', Manual: 'manual' } as const;
export type CopyFeedback = (typeof CopyFeedback)[keyof typeof CopyFeedback];

export const LinkExposure = { Unshared: 'unshared', Shared: 'shared', Stale: 'stale' } as const;
export type LinkExposure = (typeof LinkExposure)[keyof typeof LinkExposure];

export const RoomSecurityKind = {
  None: 'none',
  Relayed: 'relayed',
  SecretLink: 'secret-link',
  Password: 'password',
  Deployment: 'deployment',
} as const;
export type RoomSecurityKind = (typeof RoomSecurityKind)[keyof typeof RoomSecurityKind];

export type RoomSecurity =
  | { readonly kind: typeof RoomSecurityKind.None }
  | { readonly kind: typeof RoomSecurityKind.Relayed }
  | { readonly kind: typeof RoomSecurityKind.SecretLink; readonly key: RoomCredential }
  | { readonly kind: typeof RoomSecurityKind.Password; readonly password: RoomCredential }
  | { readonly kind: typeof RoomSecurityKind.Deployment; readonly password: RoomCredential };

export interface RoomSecuritySources {
  readonly transport: Transport;
  readonly linkKey: RoomCredential | null;
  readonly storedPassword: RoomCredential | null;
  readonly envPassword: RoomCredential | null;
}

/** Precedence must stay identical to `App.svelte`'s `roomCipher`. The hub arm
 *  comes first because no credential encrypts anything there: `websocket.ts`
 *  never reads the cipher, and passes no `cacheKey`, so wire and cache are both
 *  plaintext (docs/contract.md §2). */
export function roomSecurity(sources: RoomSecuritySources): RoomSecurity {
  if (sources.transport !== Transport.P2P) return { kind: RoomSecurityKind.Relayed };
  if (sources.linkKey) return { kind: RoomSecurityKind.SecretLink, key: sources.linkKey };
  if (sources.storedPassword)
    return { kind: RoomSecurityKind.Password, password: sources.storedPassword };
  if (sources.envPassword)
    return { kind: RoomSecurityKind.Deployment, password: sources.envPassword };
  return { kind: RoomSecurityKind.None };
}

export function isEncrypted(security: RoomSecurity): RoomEncrypted {
  return (security.kind === RoomSecurityKind.SecretLink ||
    security.kind === RoomSecurityKind.Password ||
    security.kind === RoomSecurityKind.Deployment) as RoomEncrypted;
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

export function linkExposureAfterChange(
  exposure: LinkExposure,
  before: ShareUrl,
  after: ShareUrl,
): LinkExposure {
  if (exposure === LinkExposure.Unshared || before === after) return exposure;
  return LinkExposure.Stale;
}

export const SHARE_TITLE = 'Join me on Copad' as ShareTitle;

export function shareMessage(url: ShareUrl): ShareMessage {
  return `${SHARE_TITLE}: ${url}` as ShareMessage;
}

export function whatsappShareUrl(message: ShareMessage): ShareChannelUrl {
  return `https://wa.me/?text=${encodeURIComponent(message)}` as ShareChannelUrl;
}

export function smsShareUrl(message: ShareMessage): ShareChannelUrl {
  return `sms:?body=${encodeURIComponent(message)}` as ShareChannelUrl;
}

export function emailShareUrl(message: ShareMessage): ShareChannelUrl {
  return `mailto:?subject=${encodeURIComponent(SHARE_TITLE)}&body=${encodeURIComponent(message)}` as ShareChannelUrl;
}
