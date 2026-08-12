import { test, expect } from './fixtures';

// Waiting room and unlock moment: docs/contract.md §4, §4.1, §4.2.

test('the waiting tier shows a calm dot, elapsed time, Waiting on the pill, and the tab title', async ({ page }) => {
  await page.goto('/?room=pw-waiting');
  const banner = page.locator('.sync-banner');
  await expect(banner).toBeVisible({ timeout: 20_000 });
  await expect(banner).toContainText("You're the only one here");
  await expect(banner).toContainText('Waiting since');

  await expect(banner.locator('.waiting-dot')).toBeVisible();
  await expect(banner.locator('.spinner')).toHaveCount(0);

  await expect(banner.getByRole('button', { name: 'Copy invite link', exact: true })).toBeVisible();

  await expect(page.locator('.session .chip .seg.conn .seg-label')).toHaveText('Waiting');
  await expect(page).toHaveTitle(/^Waiting…/);
});

test('Copy invite link in the waiting tier copies the room URL', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/?room=pw-waiting-copy');
  const banner = page.locator('.sync-banner');
  await expect(banner).toBeVisible({ timeout: 20_000 });

  await banner.getByRole('button', { name: 'Copy invite link', exact: true }).click();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toContain('room=pw-waiting-copy');
});

test('a peer leaving shows who left, then the room returns to waiting', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page1 = await ctx.newPage();
  const page2 = await ctx.newPage();

  await Promise.all([page1.goto('/?room=pw-departing'), page2.goto('/?room=pw-departing')]);
  await Promise.all([
    page1.locator('.ProseMirror').waitFor(),
    page2.locator('.ProseMirror').waitFor(),
  ]);
  await expect(page1.locator('.session .presence .avatar')).toHaveCount(1, { timeout: 20_000 });

  await expect(page1.locator('.sync-banner')).toHaveCount(0);

  // Navigate away first: a bare close() can skip unload, so the departure never broadcasts.
  await page2.goto('about:blank');
  await page2.close();

  const banner = page1.locator('.sync-banner');
  await expect(banner).toBeVisible({ timeout: 30_000 });
  await expect(banner).toContainText('left.');
  await expect(banner).toContainText('You can keep writing for a moment');
  await expect(page1.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'true');

  await expect(banner).toContainText("You're the only one here", { timeout: 20_000 });
  await expect(page1.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'false');

  await ctx.close();
});

test('a peer arriving plays the unlock moment: avatar enters, one self-dismissing line, no stolen focus', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page1 = await ctx.newPage();

  await page1.goto('/?room=pw-unlock');
  const banner = page1.locator('.sync-banner');
  await expect(banner).toBeVisible({ timeout: 20_000 });
  await expect(page1.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'false');

  const activeBefore = await page1.evaluate(() => document.activeElement?.tagName);

  const page2 = await ctx.newPage();
  await page2.goto('/?room=pw-unlock');
  await page2.locator('.ProseMirror').waitFor();

  await expect(page1.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'true', { timeout: 10_000 });
  await expect(banner).toHaveCount(0);
  await expect(page1.locator('.session .presence .avatar')).toHaveCount(1);
  const unlockLine = page1.locator('.unlock-line');
  await expect(unlockLine).toContainText('is here. The document is open.');
  await expect(unlockLine).toHaveCount(0, { timeout: 5_000 });

  const activeAfter = await page1.evaluate(() => document.activeElement?.tagName);
  expect(activeAfter).toBe(activeBefore);

  await ctx.close();
});
