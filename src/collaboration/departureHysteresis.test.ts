import { describe, it, expect } from 'vitest';
import { departureLingerDeadline, GATE_LINGER_CAP_MS } from './departureHysteresis.js';
import { GATE_LINGER_HUB_MS, GATE_LINGER_P2P_MS } from './writeGate.js';

describe('departureLingerDeadline', () => {
  it('falls back to the plain linger window when nothing was typed', () => {
    expect(departureLingerDeadline(1_000, null, GATE_LINGER_P2P_MS)).toBe(1_000 + GATE_LINGER_P2P_MS);
  });

  it('falls back to the plain linger window when the last edit predates the departure', () => {
    expect(departureLingerDeadline(1_000, 500, GATE_LINGER_P2P_MS)).toBe(1_000 + GATE_LINGER_P2P_MS);
  });

  it('extends from the last keystroke while typing continues after departure', () => {
    const departedAt = 1_000;
    const lastTypedAt = departedAt + 1_000;
    expect(departureLingerDeadline(departedAt, lastTypedAt, GATE_LINGER_P2P_MS)).toBe(
      lastTypedAt + GATE_LINGER_P2P_MS,
    );
  });

  it('never extends past the cap from the actual departure, however long typing continues', () => {
    const departedAt = 1_000;
    const lastTypedAt = departedAt + GATE_LINGER_CAP_MS + 5_000;
    expect(departureLingerDeadline(departedAt, lastTypedAt, GATE_LINGER_P2P_MS)).toBe(
      departedAt + GATE_LINGER_CAP_MS,
    );
  });

  it('the cap exceeds both transports\' base window, so a single extension is never clamped away', () => {
    expect(GATE_LINGER_CAP_MS).toBeGreaterThan(GATE_LINGER_P2P_MS);
    expect(GATE_LINGER_CAP_MS).toBeGreaterThan(GATE_LINGER_HUB_MS);
  });

  it('uses the hub\'s longer base window when passed explicitly', () => {
    expect(departureLingerDeadline(1_000, null, GATE_LINGER_HUB_MS)).toBe(1_000 + GATE_LINGER_HUB_MS);
  });
});
