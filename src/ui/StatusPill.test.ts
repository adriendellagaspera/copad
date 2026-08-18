import { describe, it, expect } from 'vitest';
import { render } from 'svelte/server';
import StatusPill from './StatusPill.svelte';
import { ConnStatus, Transport } from '../collaboration/types.js';
import { SaveStatus } from './types.js';
import type { StorageAttached } from './types.js';
import type { CollabUnavailable } from './syncBannerTier.js';

const UNSAVED = false as StorageAttached;
const SYNC_OK = false as CollabUnavailable;
const NO_SYNC = true as CollabUnavailable;

function html(collabUnavailable: CollabUnavailable): string {
  return render(StatusPill, {
    props: {
      conn: ConnStatus.Unreachable,
      saveStatus: SaveStatus.Idle,
      hasStorage: UNSAVED,
      transport: Transport.P2P,
      collabUnavailable,
    },
  }).body;
}

describe('StatusPill — Unreachable segment', () => {
  it('offers to retry when the deployment can otherwise sync', () => {
    const page = html(SYNC_OK);
    expect(page).toContain("The server didn't answer — click to retry");
    expect(page).toContain("Can't connect");
  });

  it('never says "retry" for a deployment with no signaling server to retry against', () => {
    const page = html(NO_SYNC);
    expect(page).not.toContain('retry');
    expect(page).toContain("This deployment doesn't support real-time sync");
    expect(page).toContain("Can't connect");
  });
});
