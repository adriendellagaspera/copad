import { describe, it, expect } from 'vitest';
import { ConnStatus, PresenceKind, Transport, type DisplayName } from '../collaboration/types.js';
import {
  AloneVariant,
  BannerTierKind,
  BannerTone,
  bannerTierFor,
  bannerToneFor,
  peerLabel,
  tierSignature,
  type BannerInput,
  type CollabUnavailable,
  type DepartureLingering,
  type WaitingSinceLabel,
  type WriteGateArmable,
  type WriteGateHeld,
} from './syncBannerTier.js';
import type { StorageLabel } from '../storage/types.js';

const GATE_HELD = true as WriteGateHeld;
const GATE_OPEN = false as WriteGateHeld;
const GATE_ARMABLE = true as WriteGateArmable;
const GATE_UNARMABLE = false as WriteGateArmable;
const NO_COLLAB = true as CollabUnavailable;
const COLLAB = false as CollabUnavailable;
const LINGERING = true as DepartureLingering;
const SETTLED = false as DepartureLingering;

const base: BannerInput = {
  conn: ConnStatus.Connected,
  presenceKind: PresenceKind.Accompanied,
  transport: Transport.P2P,
  storageLabel: null,
  gated: GATE_OPEN,
  gateEligible: GATE_UNARMABLE,
  collabUnavailable: COLLAB,
  waitingSince: null,
  departedPeerName: null,
  withinDepartureLinger: SETTLED,
};

const input = (over: Partial<BannerInput>): BannerInput => ({ ...base, ...over });
const label = (s: string): StorageLabel => s as StorageLabel;
const peer = (s: string): DisplayName => s as DisplayName;

describe('bannerTierFor', () => {
  it('says nothing while accompanied and connected', () => {
    expect(bannerTierFor(base).kind).toBe(BannerTierKind.Hidden);
  });

  it('says nothing during the pre-arm grace window', () => {
    const tier = bannerTierFor(
      input({ conn: ConnStatus.Waiting, presenceKind: PresenceKind.Alone, gateEligible: GATE_ARMABLE }),
    );
    expect(tier.kind).toBe(BannerTierKind.Hidden);
  });

  it('leads with the gate whenever it holds, whatever else is true', () => {
    const tier = bannerTierFor(
      input({
        gated: GATE_HELD,
        conn: ConnStatus.Offline,
        collabUnavailable: NO_COLLAB,
        withinDepartureLinger: LINGERING,
        presenceKind: PresenceKind.Reaching,
        waitingSince: '14:02' as WaitingSinceLabel,
      }),
    );
    expect(tier).toEqual({
      kind: BannerTierKind.Gated,
      transport: Transport.P2P,
      waitingSince: '14:02',
    });
  });

  it('carries the transport into the gated tier so the hub can state its own contract', () => {
    const tier = bannerTierFor(input({ gated: GATE_HELD, transport: Transport.Hub }));
    expect(tier).toMatchObject({ kind: BannerTierKind.Gated, transport: Transport.Hub });
  });

  it('puts "someone is here, unreachable" above a departure and above the network', () => {
    const tier = bannerTierFor(
      input({
        presenceKind: PresenceKind.Reaching,
        withinDepartureLinger: LINGERING,
        conn: ConnStatus.Unreachable,
      }),
    );
    expect(tier.kind).toBe(BannerTierKind.Reaching);
  });

  it('names the departed peer, and falls back when unknown', () => {
    expect(
      bannerTierFor(input({ withinDepartureLinger: LINGERING, departedPeerName: peer('Ada') })),
    ).toEqual({ kind: BannerTierKind.Departing, who: 'Ada' });
    expect(bannerTierFor(input({ withinDepartureLinger: LINGERING }))).toEqual({
      kind: BannerTierKind.Departing,
      who: 'Someone',
    });
  });

  it('prefers Offline over the permanent one, but the permanent one over Unreachable', () => {
    expect(bannerTierFor(input({ conn: ConnStatus.Offline, collabUnavailable: NO_COLLAB })).kind).toBe(
      BannerTierKind.Offline,
    );
    expect(
      bannerTierFor(input({ conn: ConnStatus.Unreachable, collabUnavailable: NO_COLLAB })).kind,
    ).toBe(BannerTierKind.Unavailable);
  });

  it('still reports a real Unreachable when collab is otherwise available', () => {
    expect(
      bannerTierFor(input({ conn: ConnStatus.Unreachable, collabUnavailable: COLLAB })).kind,
    ).toBe(BannerTierKind.Unreachable);
  });

  it('surfaces the collab-unavailable tier with the storage it still has', () => {
    expect(bannerTierFor(input({ collabUnavailable: NO_COLLAB, storageLabel: label('Drive') }))).toEqual(
      { kind: BannerTierKind.Unavailable, storageLabel: 'Drive' },
    );
  });

  it('picks the standing solo variant from transport and durability', () => {
    const alone = (over: Partial<BannerInput>) =>
      bannerTierFor(input({ conn: ConnStatus.Waiting, presenceKind: PresenceKind.Alone, ...over }));
    expect(alone({ transport: Transport.Hub })).toMatchObject({
      kind: BannerTierKind.Alone,
      variant: AloneVariant.Relayed,
    });
    expect(alone({ storageLabel: label('Drive') })).toMatchObject({
      kind: BannerTierKind.Alone,
      variant: AloneVariant.Saved,
      storageLabel: 'Drive',
    });
    expect(alone({})).toMatchObject({ kind: BannerTierKind.Alone, variant: AloneVariant.Void });
  });

  it('keeps the standing reminder out of the way once a peer is present', () => {
    expect(
      bannerTierFor(input({ conn: ConnStatus.Waiting, presenceKind: PresenceKind.Reaching })).kind,
    ).toBe(BannerTierKind.Reaching);
    expect(bannerTierFor(input({ conn: ConnStatus.Connected })).kind).toBe(BannerTierKind.Hidden);
  });
});

describe('bannerToneFor', () => {
  it('spends amber on the gate and on writing into a live-only peer-to-peer room', () => {
    expect(bannerToneFor(bannerTierFor(input({ gated: GATE_HELD })))).toBe(BannerTone.Warn);
    expect(
      bannerToneFor(
        bannerTierFor(input({ conn: ConnStatus.Waiting, presenceKind: PresenceKind.Alone })),
      ),
    ).toBe(BannerTone.Warn);
  });

  it('stays neutral everywhere else', () => {
    const neutral = (over: Partial<BannerInput>) => bannerToneFor(bannerTierFor(input(over)));
    expect(neutral({ presenceKind: PresenceKind.Reaching })).toBe(BannerTone.Neutral);
    expect(neutral({ withinDepartureLinger: LINGERING })).toBe(BannerTone.Neutral);
    expect(neutral({ conn: ConnStatus.Offline })).toBe(BannerTone.Neutral);
    expect(neutral({ conn: ConnStatus.Unreachable })).toBe(BannerTone.Neutral);
    expect(neutral({ collabUnavailable: NO_COLLAB })).toBe(BannerTone.Neutral);
    expect(
      neutral({
        conn: ConnStatus.Waiting,
        presenceKind: PresenceKind.Alone,
        storageLabel: label('Drive'),
      }),
    ).toBe(BannerTone.Neutral);
  });
});

describe('tierSignature', () => {
  it('ignores the ticking clock, so a dismissal survives the same waiting stretch', () => {
    const a = bannerTierFor(input({ gated: GATE_HELD, waitingSince: '14:02' as WaitingSinceLabel }));
    const b = bannerTierFor(input({ gated: GATE_HELD, waitingSince: '14:09' as WaitingSinceLabel }));
    expect(tierSignature(a)).toBe(tierSignature(b));
  });

  it('changes when the tier changes, so nothing stale survives a transition', () => {
    const gated = bannerTierFor(input({ gated: GATE_HELD }));
    const accompanied = bannerTierFor(base);
    const departing = bannerTierFor(input({ withinDepartureLinger: LINGERING }));
    expect(new Set([gated, accompanied, departing].map(tierSignature)).size).toBe(3);
  });

  it('distinguishes the three standing solo variants from one another', () => {
    const alone = (over: Partial<BannerInput>) =>
      tierSignature(
        bannerTierFor(
          input({ conn: ConnStatus.Waiting, presenceKind: PresenceKind.Alone, ...over }),
        ),
      );
    expect(
      new Set([
        alone({ transport: Transport.Hub }),
        alone({ storageLabel: label('Drive') }),
        alone({}),
      ]).size,
    ).toBe(3);
  });

  it('separates a gated hub from a gated peer-to-peer room — different copy', () => {
    expect(tierSignature(bannerTierFor(input({ gated: GATE_HELD, transport: Transport.Hub })))).not.toBe(
      tierSignature(bannerTierFor(input({ gated: GATE_HELD, transport: Transport.P2P }))),
    );
  });
});

describe('peerLabel', () => {
  it('falls back to a neutral name for missing or blank names', () => {
    expect(peerLabel(null)).toBe('Someone');
    expect(peerLabel(peer('   '))).toBe('Someone');
  });

  it('clamps a very long display name so the row cannot overflow', () => {
    const long = peerLabel(peer('A'.repeat(200)));
    expect(long).toHaveLength(24);
    expect(long.endsWith('…')).toBe(true);
  });

  it('leaves an ordinary name untouched', () => {
    expect(peerLabel(peer('Ada Lovelace'))).toBe('Ada Lovelace');
  });
});
