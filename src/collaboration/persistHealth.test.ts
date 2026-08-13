import { describe, it, expect } from 'vitest';
import {
  nextPersistHealth,
  nextRegime,
  durabilityHolds,
  PersistHealthKind,
  PersistRegime,
  UNPROVEN,
  WRITE_FAIL_STREAK,
  type PersistHealth,
} from './persistHealth.js';
import { WriteFailureKind, WriteSkip, landed, skipped } from '../storage/writeOutcome.js';
import type { EpochMs } from '../time.js';

// Any number stands in for a timestamp; cast once here rather than at every call site.
const at = (ms: number): EpochMs => ms as EpochMs;

const PROVEN: PersistHealth = { kind: PersistHealthKind.Proven, at: at(1) };
const FAILING = (streak: number): PersistHealth => ({ kind: PersistHealthKind.Failing, streak });
const BROKEN: PersistHealth = { kind: PersistHealthKind.Broken, since: at(1), cause: WriteFailureKind.Denied };

describe('nextPersistHealth', () => {
  it('a landed write proves health from any prior state', () => {
    for (const current of [UNPROVEN, PROVEN, FAILING(2), BROKEN]) {
      expect(nextPersistHealth(current, { ok: true, receipt: landed() }, at(2)).kind).toBe(
        PersistHealthKind.Proven,
      );
    }
  });

  it('a coalesced skip observes nothing — health is unchanged', () => {
    for (const current of [UNPROVEN, PROVEN, FAILING(2)]) {
      expect(nextPersistHealth(current, { ok: true, receipt: skipped(WriteSkip.Coalesced) }, at(2))).toBe(
        current,
      );
    }
  });

  it('a terminal failure kind locks Broken on the very first occurrence', () => {
    for (const kind of [WriteFailureKind.Denied, WriteFailureKind.Missing, WriteFailureKind.Rejected]) {
      const next = nextPersistHealth(UNPROVEN, { ok: false, kind }, at(5));
      expect(next).toEqual({ kind: PersistHealthKind.Broken, since: at(5), cause: kind });
    }
  });

  it('a non-terminal failure kind only escalates to Failing, streak 1', () => {
    for (const kind of [WriteFailureKind.Contended, WriteFailureKind.Transient, WriteFailureKind.Unknown]) {
      expect(nextPersistHealth(UNPROVEN, { ok: false, kind }, at(1))).toEqual({
        kind: PersistHealthKind.Failing,
        streak: 1,
      });
    }
  });

  it('a non-terminal streak accumulates and only breaks to Broken at the threshold', () => {
    let health: PersistHealth = UNPROVEN;
    for (let i = 1; i < WRITE_FAIL_STREAK; i++) {
      health = nextPersistHealth(health, { ok: false, kind: WriteFailureKind.Transient }, at(i));
      expect(health).toEqual({ kind: PersistHealthKind.Failing, streak: i });
    }
    health = nextPersistHealth(health, { ok: false, kind: WriteFailureKind.Transient }, at(99));
    expect(health).toEqual({ kind: PersistHealthKind.Broken, since: at(99), cause: WriteFailureKind.Transient });
  });

  it('a landed write resets a Failing streak back to Proven, not partial credit', () => {
    const failing = nextPersistHealth(UNPROVEN, { ok: false, kind: WriteFailureKind.Transient }, at(1));
    const next = nextPersistHealth(failing, { ok: true, receipt: landed() }, at(2));
    expect(next).toEqual({ kind: PersistHealthKind.Proven, at: at(2) });
  });
});

describe('nextRegime', () => {
  it('stays Cold on a selection-only transaction (no doc change)', () => {
    expect(nextRegime(PersistRegime.Cold, { docChanged: false, isChangeOrigin: false })).toBe(PersistRegime.Cold);
  });

  it('stays Cold on a remote sync transaction, even though the doc changed', () => {
    expect(nextRegime(PersistRegime.Cold, { docChanged: true, isChangeOrigin: true })).toBe(PersistRegime.Cold);
  });

  it('warms on this user\'s own doc-changing transaction', () => {
    expect(nextRegime(PersistRegime.Cold, { docChanged: true, isChangeOrigin: false })).toBe(PersistRegime.Warm);
  });

  it('Warm is absorbing for the rest of the session', () => {
    expect(nextRegime(PersistRegime.Warm, { docChanged: false, isChangeOrigin: false })).toBe(PersistRegime.Warm);
    expect(nextRegime(PersistRegime.Warm, { docChanged: true, isChangeOrigin: true })).toBe(PersistRegime.Warm);
  });
});

describe('durabilityHolds — false in exactly one case: Broken ∧ Cold', () => {
  const HEALTHS: PersistHealth[] = [UNPROVEN, PROVEN, FAILING(1), BROKEN];
  const REGIMES = [PersistRegime.Cold, PersistRegime.Warm];

  it('is always false when the room is not savedHere, regardless of health/regime', () => {
    for (const health of HEALTHS) {
      for (const regime of REGIMES) {
        expect(durabilityHolds(false, health, regime)).toBe(false);
      }
    }
  });

  it('holds for every health/regime combination except Broken ∧ Cold, once savedHere', () => {
    for (const health of HEALTHS) {
      for (const regime of REGIMES) {
        const expected = !(health.kind === PersistHealthKind.Broken && regime === PersistRegime.Cold);
        expect(durabilityHolds(true, health, regime)).toBe(expected);
      }
    }
  });

  it('Broken never locks while Warm — there is something to lose', () => {
    expect(durabilityHolds(true, BROKEN, PersistRegime.Warm)).toBe(true);
  });

  it('Broken locks while Cold — nothing to lose yet', () => {
    expect(durabilityHolds(true, BROKEN, PersistRegime.Cold)).toBe(false);
  });
});
