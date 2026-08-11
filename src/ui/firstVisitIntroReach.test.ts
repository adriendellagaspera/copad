import { describe, it, expect } from 'vitest';
import { Transport } from '../collaboration/types.js';
import { IntroReach, introReachFor } from './firstVisitIntroReach.js';

describe('introReachFor', () => {
  it('claims end-to-end encryption only peer to peer', () => {
    expect(introReachFor(Transport.P2P)).toBe(IntroReach.Encrypted);
  });

  it('never claims encryption on a hub deployment', () => {
    expect(introReachFor(Transport.Hub)).toBe(IntroReach.Relayed);
  });
});
