import { describe, it, expect } from 'vitest';
import {
  writeGateFor,
  gateSettleMs,
  gateLingerMs,
  GATE_SETTLE_HUB_MS,
  GATE_SETTLE_P2P_MS,
  GATE_LINGER_HUB_MS,
  GATE_LINGER_P2P_MS,
  type WriteGateInput,
  type SoloOptIn,
} from './writeGate.js';
import { PresenceKind, SessionRole, Transport } from './types.js';
import type { RoomPresence } from './types.js';

const SOLO_ON = true as SoloOptIn;
const SOLO_OFF = false as SoloOptIn;

const presence = (kind: PresenceKind): RoomPresence => ({ kind });

const BASE: WriteGateInput = {
  role: SessionRole.Writer,
  presence: presence(PresenceKind.Alone),
  collabUnavailable: false,
  soloOptIn: SOLO_OFF,
  savedHere: false,
  aloneSettled: true,
  withinDepartureLinger: false,
};

describe('writeGateFor — full truth table', () => {
  it('opens for a reader, regardless of anything else', () => {
    expect(writeGateFor({ ...BASE, role: SessionRole.Reader }).status).toBe('open');
    expect(
      writeGateFor({ ...BASE, role: SessionRole.Reader, aloneSettled: true, savedHere: false }).status,
    ).toBe('open');
  });

  it('opens when collab is structurally unavailable', () => {
    expect(writeGateFor({ ...BASE, collabUnavailable: true }).status).toBe('open');
  });

  it('opens when the user explicitly opted to write solo', () => {
    expect(writeGateFor({ ...BASE, soloOptIn: SOLO_ON }).status).toBe('open');
  });

  it('opens when presence is Accompanied', () => {
    expect(writeGateFor({ ...BASE, presence: presence(PresenceKind.Accompanied) }).status).toBe('open');
  });

  it('opens when presence is Reaching — proven presence, our failure to connect', () => {
    expect(writeGateFor({ ...BASE, presence: presence(PresenceKind.Reaching) }).status).toBe('open');
  });

  it('opens when presence is Unknown — never lock on ignorance', () => {
    expect(writeGateFor({ ...BASE, presence: presence(PresenceKind.Unknown) }).status).toBe('open');
  });

  it('opens when a storage backend of the user\'s own durably saves the room', () => {
    expect(writeGateFor({ ...BASE, savedHere: true }).status).toBe('open');
  });

  it('opens during the settle grace window right after becoming Alone', () => {
    expect(
      writeGateFor({ ...BASE, presence: presence(PresenceKind.Alone), aloneSettled: false }).status,
    ).toBe('open');
  });

  it('opens within the departure linger window after a peer leaves', () => {
    expect(writeGateFor({ ...BASE, withinDepartureLinger: true }).status).toBe('open');
  });

  it('holds only once Alone, settled, out of linger, unsaved, not solo, collab available, writer', () => {
    expect(writeGateFor(BASE).status).toBe('held');
  });

  it('never locks on Connecting/Unreachable/Offline — all of those map to presence Unknown upstream', () => {
    // core.ts's computePresenceKind() maps every non-attached / offline ConnStatus
    // to PresenceKind.Unknown before it ever reaches this function; verifying the
    // Unknown branch (above) is what enforces the acceptance criterion here.
    expect(writeGateFor({ ...BASE, presence: presence(PresenceKind.Unknown) }).status).toBe('open');
  });
});

describe('writeGateFor — unlock is immediate, lock is deferred (the core asymmetry)', () => {
  it('unlocks the same call the instant presence flips to Accompanied — no settle needed', () => {
    // Start Held: alone, settled, nothing else protecting the writer.
    expect(writeGateFor(BASE).status).toBe('held');
    // A peer arrives — even with `aloneSettled` still (stale) true, the very next
    // call opens immediately. No fake-timer advance required: this is the point.
    const next: WriteGateInput = { ...BASE, presence: presence(PresenceKind.Accompanied) };
    expect(writeGateFor(next).status).toBe('open');
  });

  it('does not lock the instant presence flips to Alone — stays open until settled', () => {
    // Accompanied → open.
    const accompanied: WriteGateInput = { ...BASE, presence: presence(PresenceKind.Accompanied) };
    expect(writeGateFor(accompanied).status).toBe('open');
    // The peer leaves. Presence flips to Alone, but `aloneSettled` starts false
    // (the wiring layer hasn't run the grace timer yet) — still open.
    const justAlone: WriteGateInput = {
      ...BASE,
      presence: presence(PresenceKind.Alone),
      aloneSettled: false,
      withinDepartureLinger: true,
    };
    expect(writeGateFor(justAlone).status).toBe('open');
    // Only once both the settle *and* the linger windows have separately elapsed
    // (both flip to their "expired" value) does it hold.
    const settled: WriteGateInput = { ...justAlone, aloneSettled: true, withinDepartureLinger: false };
    expect(writeGateFor(settled).status).toBe('held');
  });

  it('re-arms from Held the moment any single open condition becomes true, symmetrically for every arm', () => {
    expect(writeGateFor(BASE).status).toBe('held');
    expect(writeGateFor({ ...BASE, role: SessionRole.Reader }).status).toBe('open');
    expect(writeGateFor({ ...BASE, collabUnavailable: true }).status).toBe('open');
    expect(writeGateFor({ ...BASE, soloOptIn: SOLO_ON }).status).toBe('open');
    expect(writeGateFor({ ...BASE, savedHere: true }).status).toBe('open');
  });
});

// docs/contract.md §2.1's inversion: the transport with the better detection
// (the hub) gets to trust it faster; P2P's structurally unbounded false
// negatives mean it must wait longer before concluding "alone".
describe('gateSettleMs / gateLingerMs — the hub’s stricter contract (docs/contract.md §8)', () => {
  it('settles faster on the hub than on P2P', () => {
    expect(gateSettleMs(Transport.Hub)).toBe(GATE_SETTLE_HUB_MS);
    expect(gateSettleMs(Transport.P2P)).toBe(GATE_SETTLE_P2P_MS);
    expect(GATE_SETTLE_HUB_MS).toBeLessThan(GATE_SETTLE_P2P_MS);
  });

  it('lingers longer on the hub than on P2P — it has to outlast the awareness sweep', () => {
    expect(gateLingerMs(Transport.Hub)).toBe(GATE_LINGER_HUB_MS);
    expect(gateLingerMs(Transport.P2P)).toBe(GATE_LINGER_P2P_MS);
    expect(GATE_LINGER_HUB_MS).toBeGreaterThan(GATE_LINGER_P2P_MS);
  });

  it('hub linger covers y-protocols\' 30s outdatedTimeout sweep, or the gate would lock on stale data', () => {
    const AWARENESS_OUTDATED_TIMEOUT_MS = 30_000;
    expect(GATE_LINGER_HUB_MS).toBeGreaterThanOrEqual(AWARENESS_OUTDATED_TIMEOUT_MS);
  });
});
