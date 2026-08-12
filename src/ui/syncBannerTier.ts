/** No clocks and no DOM inside: time-dependent inputs arrive pre-computed, same split as `writeGate.ts`. */

import type { DisplayName } from '../collaboration/types.js';
import { ConnStatus, PresenceKind, Transport } from '../collaboration/types.js';
import type { EpochMs } from '../time.js';
import type { StorageLabel } from '../storage/types.js';

export type WaitingSinceLabel = string & { readonly _brand: 'WaitingSinceLabel' };
export type TierSignature = string & { readonly _brand: 'TierSignature' };

export type WriteGateHeld = boolean & { readonly _brand: 'WriteGateHeld' };
export type WriteGateArmable = boolean & { readonly _brand: 'WriteGateArmable' };
export type CollabUnavailable = boolean & { readonly _brand: 'CollabUnavailable' };
export type DepartureLingering = boolean & { readonly _brand: 'DepartureLingering' };

export const AloneVariant = {
  Relayed: 'relayed',
  Saved: 'saved',
  Void: 'void',
} as const;
export type AloneVariant = (typeof AloneVariant)[keyof typeof AloneVariant];

export const BannerTierKind = {
  Hidden: 'hidden',
  Gated: 'gated',
  Reaching: 'reaching',
  Departing: 'departing',
  Unreachable: 'unreachable',
  Offline: 'offline',
  Unavailable: 'unavailable',
  Alone: 'alone',
} as const;
export type BannerTierKind = (typeof BannerTierKind)[keyof typeof BannerTierKind];

export type BannerTier =
  | { readonly kind: typeof BannerTierKind.Hidden }
  | {
      readonly kind: typeof BannerTierKind.Gated;
      readonly transport: Transport;
      readonly waitingSince: WaitingSinceLabel | null;
    }
  | { readonly kind: typeof BannerTierKind.Reaching }
  | { readonly kind: typeof BannerTierKind.Departing; readonly who: DisplayName }
  | { readonly kind: typeof BannerTierKind.Unreachable }
  | { readonly kind: typeof BannerTierKind.Offline }
  | {
      readonly kind: typeof BannerTierKind.Unavailable;
      readonly storageLabel: StorageLabel | null;
    }
  | {
      readonly kind: typeof BannerTierKind.Alone;
      readonly variant: AloneVariant;
      readonly storageLabel: StorageLabel | null;
    };

export interface BannerInput {
  readonly conn: ConnStatus;
  readonly presenceKind: PresenceKind;
  readonly transport: Transport;
  readonly storageLabel: StorageLabel | null;
  readonly gated: WriteGateHeld;
  readonly gateEligible: WriteGateArmable;
  readonly collabUnavailable: CollabUnavailable;
  readonly waitingSince: WaitingSinceLabel | null;
  readonly departedPeerName: DisplayName | null;
  readonly withinDepartureLinger: DepartureLingering;
}

const HIDDEN: BannerTier = { kind: BannerTierKind.Hidden };
const REACHING: BannerTier = { kind: BannerTierKind.Reaching };
const UNREACHABLE: BannerTier = { kind: BannerTierKind.Unreachable };
const OFFLINE: BannerTier = { kind: BannerTierKind.Offline };

const ANONYMOUS_PEER = 'Someone' as DisplayName;
const PEER_NAME_MAX = 24;

export function waitingSinceLabel(at: EpochMs): WaitingSinceLabel {
  return new Date(at).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }) as WaitingSinceLabel;
}

/** Remote text clamped here, not in CSS, so a flex row cannot overflow at 390px. */
export function peerLabel(name: DisplayName | null): DisplayName {
  const trimmed = name?.trim() ?? '';
  if (trimmed === '') return ANONYMOUS_PEER;
  if (trimmed.length <= PEER_NAME_MAX) return trimmed as DisplayName;
  return `${trimmed.slice(0, PEER_NAME_MAX - 1)}…` as DisplayName;
}

function aloneVariant(input: BannerInput): AloneVariant {
  if (input.transport !== Transport.P2P) return AloneVariant.Relayed;
  if (input.storageLabel !== null) return AloneVariant.Saved;
  return AloneVariant.Void;
}

export function bannerTierFor(input: BannerInput): BannerTier {
  if (input.gated)
    return {
      kind: BannerTierKind.Gated,
      transport: input.transport,
      waitingSince: input.waitingSince,
    };
  if (input.presenceKind === PresenceKind.Reaching) return REACHING;
  if (input.withinDepartureLinger)
    return { kind: BannerTierKind.Departing, who: peerLabel(input.departedPeerName) };
  if (input.conn === ConnStatus.Unreachable) return UNREACHABLE;
  if (input.conn === ConnStatus.Offline) return OFFLINE;
  if (input.collabUnavailable)
    return { kind: BannerTierKind.Unavailable, storageLabel: input.storageLabel };
  if (input.conn === ConnStatus.Waiting && !input.gateEligible)
    return {
      kind: BannerTierKind.Alone,
      variant: aloneVariant(input),
      storageLabel: input.storageLabel,
    };
  return HIDDEN;
}

export const BannerTone = { Warn: 'warn', Neutral: 'neutral' } as const;
export type BannerTone = (typeof BannerTone)[keyof typeof BannerTone];

export function bannerToneFor(tier: BannerTier): BannerTone {
  if (tier.kind === BannerTierKind.Gated) return BannerTone.Warn;
  if (tier.kind === BannerTierKind.Alone && tier.variant === AloneVariant.Void)
    return BannerTone.Warn;
  return BannerTone.Neutral;
}

/** Excludes `waitingSince` and the storage label: either would resurrect a dismissed strip. */
export function tierSignature(tier: BannerTier): TierSignature {
  if (tier.kind === BannerTierKind.Gated) return `gated:${tier.transport}` as TierSignature;
  if (tier.kind === BannerTierKind.Alone) return `alone:${tier.variant}` as TierSignature;
  return tier.kind as TierSignature;
}
