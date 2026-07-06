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

test('a solo peer-to-peer room gates writing until you invite someone or opt out', async ({ page }) => {
  await page.goto('/?room=intro-solo');

  // Dismiss the intro so it doesn't cover the gate.
  await page.getByRole('button', { name: 'Got it' }).click();

  // Attached to signaling but with no peers, peer-to-peer and no backend → the
  // write-gate holds the editor read-only: writing solo would go into the void.
  const gate = page.locator('.gate');
  await expect(gate).toBeVisible({ timeout: 20_000 });
  await expect(gate).toContainText('Copad is for writing together');
  await expect(gate.getByRole('button', { name: 'Invite someone' })).toBeVisible();
  await expect(page.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'false');

  // The gate is not a wall — opting to write solo lifts it, makes the editor
  // editable again, and leaves a standing banner that you're writing into the void.
  await gate.getByRole('button', { name: 'Write on your own' }).click();
  await expect(gate).toBeHidden();
  await expect(page.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'true');

  const banner = page.locator('.sync-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("You're writing to an empty room");
  await expect(banner.getByRole('button', { name: 'Invite' })).toBeVisible();
});
