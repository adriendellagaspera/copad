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
  type StorageLabel,
  type WaitingSinceLabel,
} from './syncBannerTier.js';

const base: BannerInput = {
  conn: ConnStatus.Connected,
  presenceKind: PresenceKind.Accompanied,
  transport: Transport.P2P,
  storageLabel: null,
  gated: false,
  gateEligible: false,
  collabUnavailable: false,
  waitingSince: null,
  departedPeerName: null,
  withinDepartureLinger: false,
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
      input({ conn: ConnStatus.Waiting, presenceKind: PresenceKind.Alone, gateEligible: true }),
    );
    expect(tier.kind).toBe(BannerTierKind.Hidden);
  });

  it('leads with the gate whenever it holds, whatever else is true', () => {
    const tier = bannerTierFor(
      input({
        gated: true,
        conn: ConnStatus.Offline,
        collabUnavailable: true,
        withinDepartureLinger: true,
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
    const tier = bannerTierFor(input({ gated: true, transport: Transport.Hub }));
    expect(tier).toMatchObject({ kind: BannerTierKind.Gated, transport: Transport.Hub });
  });

  it('puts "someone is here, unreachable" above a departure and above the network', () => {
    const tier = bannerTierFor(
      input({
        presenceKind: PresenceKind.Reaching,
        withinDepartureLinger: true,
        conn: ConnStatus.Unreachable,
      }),
    );
    expect(tier.kind).toBe(BannerTierKind.Reaching);
  });

  it('names the departed peer, and falls back when unknown', () => {
    expect(
      bannerTierFor(input({ withinDepartureLinger: true, departedPeerName: peer('Ada') })),
    ).toEqual({ kind: BannerTierKind.Departing, who: 'Ada' });
    expect(bannerTierFor(input({ withinDepartureLinger: true }))).toEqual({
      kind: BannerTierKind.Departing,
      who: 'Someone',
    });
  });

  it('prefers the network tiers over the permanent one', () => {
    expect(
      bannerTierFor(input({ conn: ConnStatus.Unreachable, collabUnavailable: true })).kind,
    ).toBe(BannerTierKind.Unreachable);
    expect(bannerTierFor(input({ conn: ConnStatus.Offline, collabUnavailable: true })).kind).toBe(
      BannerTierKind.Offline,
    );
  });

  it('surfaces the collab-unavailable tier with the storage it still has', () => {
    expect(bannerTierFor(input({ collabUnavailable: true, storageLabel: label('Drive') }))).toEqual(
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
    expect(bannerToneFor(bannerTierFor(input({ gated: true })))).toBe(BannerTone.Warn);
    expect(
      bannerToneFor(
        bannerTierFor(input({ conn: ConnStatus.Waiting, presenceKind: PresenceKind.Alone })),
      ),
    ).toBe(BannerTone.Warn);
  });

  it('stays neutral everywhere else', () => {
    const neutral = (over: Partial<BannerInput>) => bannerToneFor(bannerTierFor(input(over)));
    expect(neutral({ presenceKind: PresenceKind.Reaching })).toBe(BannerTone.Neutral);
    expect(neutral({ withinDepartureLinger: true })).toBe(BannerTone.Neutral);
    expect(neutral({ conn: ConnStatus.Offline })).toBe(BannerTone.Neutral);
    expect(neutral({ conn: ConnStatus.Unreachable })).toBe(BannerTone.Neutral);
    expect(neutral({ collabUnavailable: true })).toBe(BannerTone.Neutral);
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
    const a = bannerTierFor(input({ gated: true, waitingSince: '14:02' as WaitingSinceLabel }));
    const b = bannerTierFor(input({ gated: true, waitingSince: '14:09' as WaitingSinceLabel }));
    expect(tierSignature(a)).toBe(tierSignature(b));
  });

  it('changes when the tier changes, so nothing stale survives a transition', () => {
    const gated = bannerTierFor(input({ gated: true }));
    const accompanied = bannerTierFor(base);
    const departing = bannerTierFor(input({ withinDepartureLinger: true }));
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
    expect(tierSignature(bannerTierFor(input({ gated: true, transport: Transport.Hub })))).not.toBe(
      tierSignature(bannerTierFor(input({ gated: true, transport: Transport.P2P }))),
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
