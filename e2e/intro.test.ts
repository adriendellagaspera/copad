import { test, expect } from '@playwright/test';

/**
 * First-run onboarding. Copad's peer-to-peer, live-only default is unusual — writing
 * alone means nothing leaves this device until someone joins. The write-gate teaches
 * that just-in-time: it holds the editor read-only and, in the top banner, explains
 * why. It yields on the writing gesture — clicking or typing in the body lifts it —
 * so there's never a trip to a button. Fresh context (no fixtures) so the gate
 * actually arms.
 *
 * The very first time a browser ever arms the gate, a blocking dialog (WriteGateIntro)
 * escalates on top of the still-visible editor before the ambient banner's
 * yield-on-write behavior applies — that first encounter is covered separately below.
 */

test('first-ever gate arm shows a blocking explainer, dismissible by writing solo', async ({ page }) => {
  await page.goto('/?room=intro-solo-first');

  const dialog = page.getByRole('dialog', { name: "You're the only one here" });
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'false');

  await dialog.getByRole('button', { name: 'Write here anyway' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'true');

  const seen = await page.evaluate(() => localStorage.getItem('copad:writeGateSeen'));
  expect(seen).toBe('true');

  // Never reappears once seen — a fresh room in the same browser goes straight to
  // the ambient banner + yield-on-write behavior.
  await page.goto('/?room=intro-solo-second');
  await expect(page.locator('.sync-banner')).toBeVisible({ timeout: 20_000 });
  await expect(dialog).toBeHidden();
});

test('a solo peer-to-peer room gates writing, then yields on the writing gesture', async ({ page }) => {
  // Pre-seed the one-time explainer as already seen — this test is about the
  // standing banner + yield-on-write behavior that every arm after the first uses,
  // not the first-encounter dialog (covered above).
  await page.addInitScript(() => localStorage.setItem('copad:writeGateSeen', 'true'));
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
