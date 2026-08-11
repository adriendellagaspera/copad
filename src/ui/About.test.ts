import { describe, it, expect } from 'vitest';
import { render } from 'svelte/server';
import About from './About.svelte';
import { Transport } from '../collaboration/types.js';
import type { PagePath } from '../collaboration/roomHistory.js';
import { CONTRACT_URL, PRIVACY_URL } from './aboutCopy.js';

const PAGE = '/' as PagePath;

function html(transport: Transport, page: PagePath = PAGE): string {
  return render(About, { props: { onNewDocument: () => {}, transport, page } }).body;
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe('About', () => {
  it('mounts the real StatusPill, Avatar and SyncBanner rather than pictures of them', () => {
    const page = html(Transport.P2P);
    expect(occurrences(page, 'class="avatar')).toBe(3);
    expect(occurrences(page, 'keep-labels')).toBe(3);
    expect(page).toContain('sync-banner');
    expect(page).toContain("You're the only one here.");
  });

  it('holds the room specimen — its address and its live state — beside the hero', () => {
    expect(html(Transport.P2P)).toMatch(
      /class="hero-exhibit[^"]*"[\s\S]*?url-id[\s\S]*?keep-labels/,
    );
  });

  it('shows the write gate with its peer-to-peer escape hatch, and its cost', () => {
    const page = html(Transport.P2P);
    expect(page).toContain('Write alone anyway');
    expect(page).toContain('Nothing you write leaves this device until someone joins.');
  });

  it('never offers the escape hatch on a hub deployment', () => {
    const page = html(Transport.Hub);
    expect(page).toContain('sync-banner');
    expect(page).not.toContain('Write alone anyway');
  });

  it('claims encryption only on the peer-to-peer transport', () => {
    expect(html(Transport.P2P)).toContain('Encrypted');
  });

  it('makes no encryption claim on a hub deployment', () => {
    const page = html(Transport.Hub);
    expect(page).not.toMatch(/encrypt/i);
    expect(page).not.toContain('url-key');
  });

  it('leaves the mounted specimens non-interactive', () => {
    expect(html(Transport.P2P)).toMatch(/class="demo demo-banner[^"]*"[^>]*inert/);
  });

  it('owns a scroll container of its own, since the body cannot scroll', () => {
    expect(html(Transport.P2P)).toMatch(/class="about\b/);
  });

  it('links the contract as its privacy document', () => {
    const page = html(Transport.P2P);
    expect(page).toContain(`href="${CONTRACT_URL}"`);
    expect(page).toContain(`href="${PRIVACY_URL}"`);
  });

  it('derives its in-app link and its example URL from the page path it was given', () => {
    const page = html(Transport.P2P, '/pad/' as PagePath);
    expect(page).toContain('href="/pad/"');
    expect(page).toContain('/pad/?room=');
  });
});

describe('the room analogy', () => {
  // A room has no owner (docs/contract.md §1), so the page must not narrate one
  // side inviting another: an owner/guest split is the single easiest way for
  // this copy to drift back into promising standing access to a document.
  const OWNERSHIP_WORDS = ['guest', 'owner', 'invitee', 'the host'];

  for (const transport of [Transport.P2P, Transport.Hub]) {
    it(`frames nobody as owner or guest on the ${transport} transport`, () => {
      const page = html(transport).toLowerCase();
      for (const word of OWNERSHIP_WORDS) expect(page).not.toContain(word);
    });
  }

  it('says the room keeps nothing and that separated copies reconcile', () => {
    const page = html(Transport.P2P);
    expect(page).toContain('Nobody owns the room');
    expect(page).toContain('the room remembers nothing');
    expect(page).toContain('no copy is the real one');
    expect(page).toContain('reconcile');
  });
});
