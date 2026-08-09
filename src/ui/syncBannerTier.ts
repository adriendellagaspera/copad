/** Which state the one top strip is in, as a pure decision function — the
 *  presentation half of `docs/contract.md` §4's state table. No DOM, no clocks:
 *  time-dependent inputs arrive pre-computed, same split as `writeGate.ts`. */

import type { DisplayName } from '../collaboration/types.js';
import { ConnStatus, PresenceKind, Transport } from '../collaboration/types.js';

/** Display label of the backend keeping this room for the local user. */
export type StorageLabel = string & { readonly _brand: 'StorageLabel' };

/** Wall-clock label of when this stretch of solitude began ("14:02", §4.2). */
export type WaitingSinceLabel = string & { readonly _brand: 'WaitingSinceLabel' };

/** Identity of a banner state. Equal signatures ⟺ the strip is still saying the
 *  same thing, so per-tier UI (dismissal, disclosure) may survive; a change
 *  retires both. */
export type TierSignature = string & { readonly _brand: 'TierSignature' };

/** Which flavour of standing solitude — three genuinely different durability
 *  stories, not one message with optional clauses. */
export const AloneVariant = {
  /** Hub transport: the relay catches later joiners up. */
  Relayed: 'relayed',
  /** P2P, but a backend of the user's own keeps this room. */
  Saved: 'saved',
  /** P2P and live-only: the bytes are on this device and nowhere else. */
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
  /** Non-null ⟺ a copy of *this room* lands in the user's own storage. */
  readonly storageLabel: StorageLabel | null;
  /** The write gate is holding the editor read-only (§4, row ③). */
  readonly gated: boolean;
  /** The gate could still arm — the pre-arm grace window, during which the strip
   *  says nothing rather than pre-announcing a lock that may never come. */
  readonly gateEligible: boolean;
  /** This deployment can never sync across devices — permanent, not transient. */
  readonly collabUnavailable: boolean;
  readonly waitingSince: WaitingSinceLabel | null;
  readonly departedPeerName: DisplayName | null;
  /** Still inside the departure-hysteresis window (§4, row ⑥). */
  readonly withinDepartureLinger: boolean;
}

const HIDDEN: BannerTier = { kind: BannerTierKind.Hidden };
const REACHING: BannerTier = { kind: BannerTierKind.Reaching };
const UNREACHABLE: BannerTier = { kind: BannerTierKind.Unreachable };
const OFFLINE: BannerTier = { kind: BannerTierKind.Offline };

const ANONYMOUS_PEER = 'Someone' as DisplayName;
const PEER_NAME_MAX = 24;

/** A departed peer's name is remote, user-chosen text landing in a flex row that
 *  must not overflow at 390px — clamp it here rather than trusting CSS alone. */
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

/**
 * One strip, an escalation ladder — first match wins.
 * ```
 * gated                       → the waiting room (blocks, transient)
 * presence Reaching           → someone's here, we can't reach them (never blocks)
 * within departure linger     → a peer just left (never blocks)
 * conn Unreachable / Offline  → we don't know / no network (never blocks)
 * collabUnavailable           → permanent environment fact (never blocks)
 * conn Waiting, gate can't arm→ the standing solo reminder (never blocks)
 * hidden                      → deliberate silence, grace window included
 * ```
 */
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

/** Amber is spent only where the bytes are genuinely going nowhere: the gate
 *  itself, and writing solo into a live-only peer-to-peer room. Everything else
 *  is a neutral heads-up. */
export function bannerToneFor(tier: BannerTier): BannerTone {
  if (tier.kind === BannerTierKind.Gated) return BannerTone.Warn;
  if (tier.kind === BannerTierKind.Alone && tier.variant === AloneVariant.Void)
    return BannerTone.Warn;
  return BannerTone.Neutral;
}

/** Deliberately excludes `waitingSince` and the storage label: the clock ticking
 *  on or a backend relabelling is not a new thing to say, and must not resurrect
 *  a dismissed strip or re-collapse an open disclosure. */
export function tierSignature(tier: BannerTier): TierSignature {
  if (tier.kind === BannerTierKind.Gated) return `gated:${tier.transport}` as TierSignature;
  if (tier.kind === BannerTierKind.Alone) return `alone:${tier.variant}` as TierSignature;
  return tier.kind as TierSignature;
}
