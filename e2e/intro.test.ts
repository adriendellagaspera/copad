import { test, expect } from '@playwright/test';

/**
 * The write gate (`docs/contract.md` §1–§4). Copad's peer-to-peer, live-only
 * default is unusual — writing alone means nothing leaves this device until
 * someone joins. The gate holds the editor read-only while alone, past a settle
 * window, and the waiting state itself explains why — no separate onboarding
 * dialog (`WriteGateIntro`, deleted; contract §7 — "the waiting state teaches
 * the contract better than a modal shown once per browser"). The escape hatch
 * is an explicit, named "Write alone anyway" button (contract §4.4), not a
 * silent yield on the first click/keystroke.
 */

test('a solo peer-to-peer room gates writing after the settle window, then opens via the explicit escape hatch', async ({ page }) => {
  await page.goto('/?room=intro-solo');

  // Peer-to-peer, no peers, no backend → after the settle window the gate holds:
  // the editor goes read-only and the top strip explains why, with Invite /
  // Connect storage / Write alone anyway.
  const banner = page.locator('.sync-banner');
  await expect(banner).toBeVisible({ timeout: 20_000 });
  await expect(banner).toContainText("You're the only one here");
  await expect(banner.getByRole('button', { name: 'Invite' })).toBeVisible();
  await expect(page.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'false');

  // Clicking or typing in the body does NOT silently lift the gate anymore —
  // only the explicit button does.
  await page.locator('.ProseMirror').click();
  await expect(page.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'false');

  await banner.getByRole('button', { name: 'Write alone anyway' }).click();
  await expect(page.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'true');

  // Opting in for this room doesn't re-show the gate for the rest of the session.
  await expect(banner).toBeVisible();
});

test('a read-only link never offers the write-alone escape hatch', async ({ page }) => {
  // Storage-backed "never gated" is covered by unit tests (`writeGate.test.ts`,
  // the `savedHere` branch) — no backend is easy to wire in this harness. This
  // exercises the reader carve-out: `writeGateFor()` opens for readers
  // unconditionally, so the escape-hatch button (only rendered while gated)
  // never appears — a read-only visitor was never a candidate to write at all.
  await page.goto('/?room=intro-reader&role=reader');
  await expect(page.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'false');
  await expect(page.getByRole('button', { name: 'Write alone anyway' })).toHaveCount(0);
});
