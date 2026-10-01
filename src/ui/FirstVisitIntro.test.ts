import { describe, it, expect } from 'vitest';
import { render } from 'svelte/server';
import FirstVisitIntro from './FirstVisitIntro.svelte';

function html(): string {
  return render(FirstVisitIntro, {
    props: {
      onShare: () => {},
      onConnectStorage: () => {},
      onAbout: () => {},
    },
  }).body;
}

describe('FirstVisitIntro', () => {
  it('shows current durability and next actions without explaining the room model', () => {
    const page = html();

    expect(page).not.toContain('<p');
    expect(page).toContain('Nothing here is saved yet.');
    expect(page).toContain('Invite someone');
    expect(page).toContain('Connect storage');
    expect(page).toContain('How Copad works');
    expect(page).not.toContain('Copad is a room');
    expect(page).not.toMatch(/end-to-end|sync server|read-only/i);
  });
});
