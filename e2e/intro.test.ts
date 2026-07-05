import { test, expect } from '@playwright/test';

/**
 * First-run onboarding: the intro popup explaining Copad's peer-to-peer model,
 * and the persistent "you're alone → not syncing" banner. These deliberately
 * use a fresh context (no `skipIntro`) so the first-run UX actually shows.
 */

test('first visit shows the intro popup, then remembers it was dismissed', async ({ page }) => {
  await page.goto('/?room=intro-first');

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('How Copad sharing works');

  await page.getByRole('button', { name: 'Got it' }).click();
  await expect(dialog).toBeHidden();

  // Dismissal is persisted — a reload in the same browser doesn't bring it back.
  await page.reload();
  await page.locator('.ProseMirror').waitFor();
  await expect(page.getByRole('dialog')).toBeHidden();
});

test('a solo room shows the presence-first banner with an Invite CTA', async ({ page }) => {
  await page.goto('/?room=intro-solo');

  // Dismiss the intro so it doesn't cover the banner.
  await page.getByRole('button', { name: 'Got it' }).click();

  // Attached to signaling but with no peers → the banner makes solitude explicit.
  // With no backend connected the room is live-only, so the copy is honest that
  // the notes stay on this device only, and offers Invite as the primary action.
  const banner = page.locator('.sync-banner');
  await expect(banner).toBeVisible({ timeout: 20_000 });
  await expect(banner).toContainText("You're the only one here");
  await expect(banner.getByRole('button', { name: 'Invite' })).toBeVisible();
});
