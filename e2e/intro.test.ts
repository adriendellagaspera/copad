import { test, expect } from '@playwright/test';

/**
 * First-run onboarding. Copad's peer-to-peer, live-only default is unusual — writing
 * alone means nothing leaves this device until someone joins. The write-gate teaches
 * that just-in-time: it holds the editor read-only and, in the top banner, explains
 * why. It's the strongest tier of the one presence strip (no separate overlay, no
 * scrim over the text). It yields on the writing gesture — clicking or typing in the
 * body lifts it — so there's never a trip to a button. Fresh context (no fixtures)
 * so the gate actually arms.
 */

test('a solo peer-to-peer room gates writing, then yields on the writing gesture', async ({ page }) => {
  await page.goto('/?room=intro-solo');

  // Peer-to-peer, no peers, no backend → after a short grace window the gate arms:
  // the editor goes read-only and the top strip explains why, with Invite / Connect.
  const banner = page.locator('.sync-banner');
  await expect(banner).toBeVisible({ timeout: 20_000 });
  await expect(banner).toContainText('Start writing to write on your own');
  await expect(banner.getByRole('button', { name: 'Invite' })).toBeVisible();
  await expect(page.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'false');

  // Yield-on-write: clicking into the body IS opting to write solo — the gate lifts
  // under the cursor (no button trip), the editor becomes editable, and the strip
  // stays as a standing "empty room" reminder.
  await page.locator('.ProseMirror').click();
  await expect(page.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'true');
  await expect(banner).toContainText("You're writing to an empty room");
  await expect(banner.getByRole('button', { name: 'Invite' })).toBeVisible();
});
