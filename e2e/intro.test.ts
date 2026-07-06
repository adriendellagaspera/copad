import { test, expect } from '@playwright/test';

/**
 * First-run onboarding. Copad's peer-to-peer, live-only default is unusual — writing
 * alone means nothing leaves this device until someone joins. Rather than explain
 * that up front in a modal, the write-gate teaches it just-in-time: it holds the
 * editor read-only the moment writing-into-the-void becomes true, with the actions
 * that resolve it. These use a fresh context (no fixtures) so the gate actually shows.
 */

test('a solo peer-to-peer room gates writing until you invite someone or opt out', async ({ page }) => {
  await page.goto('/?room=intro-solo');

  // Peer-to-peer, no peers, no backend → the write-gate holds the editor read-only:
  // writing solo would go into the void. It arms after a short grace window (a peer
  // might have joined), and does not depend on having attached to signaling first.
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
