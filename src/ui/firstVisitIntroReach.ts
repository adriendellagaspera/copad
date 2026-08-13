import { Transport } from '../collaboration/types.js';

/** Only the peer-to-peer arm may claim end-to-end encryption (docs/contract.md §2). */
export const IntroReach = {
  Encrypted: 'encrypted',
  Relayed: 'relayed',
} as const;
export type IntroReach = (typeof IntroReach)[keyof typeof IntroReach];

export function introReachFor(transport: Transport): IntroReach {
  return transport === Transport.P2P ? IntroReach.Encrypted : IntroReach.Relayed;
}
