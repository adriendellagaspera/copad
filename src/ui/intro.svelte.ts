/**
 * First-run intro flag — persisted, per-browser. Copad's peer-to-peer default
 * (no async sync unless a storage backend is shared) is unusual enough that new
 * users deserve a one-time heads-up. This store remembers whether they've seen
 * it, so the intro popup shows exactly once per browser.
 */

import { localStore } from '../persistence/local.js';
import { nsKey } from '../config.js';

// Absent key ⇒ not seen yet ⇒ default false. Stored as '1' once dismissed.
const introSeen = localStore<boolean>(
  nsKey('seenIntro'),
  (raw) => raw === '1',
  (seen) => (seen ? '1' : null),
);

/** Whether the first-run intro has already been dismissed on this browser. */
export function hasSeenIntro(): boolean {
  return introSeen.read();
}

/** Remember that the first-run intro has been dismissed. */
export function markIntroSeen(): void {
  introSeen.write(true);
}
