import { test, expect } from '@playwright/test';

// The write gate: docs/contract.md §1–§4.

test('a solo peer-to-peer room gates writing after the settle window, then opens via the explicit escape hatch', async ({ page }) => {
  await page.goto('/?room=intro-solo');

  const banner = page.locator('.sync-banner');
  await expect(banner).toBeVisible({ timeout: 20_000 });
  await expect(banner).toContainText("You're the only one here");
  await expect(banner.getByRole('button', { name: 'Copy invite link', exact: true })).toBeVisible();
  await expect(page.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'false');

  // Only the explicit button lifts the gate — a click never silently does.
  await page.locator('.ProseMirror').click();
  await expect(page.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'false');

  await banner.getByRole('button', { name: 'Write alone anyway' }).click();
  await expect(page.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'true');

  await expect(banner).toBeVisible();
});

test('the explicit "Write alone anyway" click focuses the editor', async ({ page }) => {
  await page.goto('/?room=intro-solo-focus');
  const banner = page.locator('.sync-banner');
  await expect(banner).toBeVisible({ timeout: 20_000 });

  await banner.getByRole('button', { name: 'Write alone anyway' }).click();
  await expect(page.locator('.ProseMirror')).toBeFocused();
});

test('a peer joining opens the gate without stealing focus (contract §4.1)', async ({ page, context }) => {
  await page.goto('/?room=intro-peer-join');
  const banner = page.locator('.sync-banner');
  await expect(banner).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'false');

  const roomName = page.getByLabel('Room name');
  await roomName.click();
  await expect(roomName).toBeFocused();

  const page2 = await context.newPage();
  await page2.goto('/?room=intro-peer-join');
  await expect(page2.locator('.ProseMirror')).toBeVisible();

  await expect(page.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'true', { timeout: 20_000 });
  await expect(roomName).toBeFocused();
});

test('a read-only link never offers the write-alone escape hatch', async ({ page }) => {
  // Readers are never gated, so the escape-hatch button never renders. Storage-backed
  // "never gated" needs a backend this harness cannot wire — see writeGate.test.ts.
  await page.goto('/?room=intro-reader&role=reader');
  await expect(page.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'false');
  await expect(page.getByRole('button', { name: 'Write alone anyway' })).toHaveCount(0);
});

test.describe('on a narrow viewport', () => {
  test.use({ viewport: { width: 390, height: 664 }, isMobile: true, hasTouch: true });

  test('the gated banner wraps its actions instead of overflowing off-screen', async ({ page }) => {
    await page.goto('/?room=intro-solo-mobile');
    const banner = page.locator('.sync-banner');
    await expect(banner).toBeVisible({ timeout: 20_000 });
    const writeSolo = banner.getByRole('button', { name: 'Write alone anyway' });
    await expect(writeSolo).toBeVisible();

    const box = await writeSolo.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);

    await writeSolo.click();
    await expect(page.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'true');
  });
});
