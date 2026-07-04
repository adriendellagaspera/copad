import { test, expect } from './fixtures';

/** UI/UX regression tests for the redesigned chrome and editor features. */

test('theme toggle flips and persists across reload', async ({ page }) => {
  await page.goto('/');
  await page.locator('.ProseMirror').waitFor();

  const initial = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.locator('header button[aria-label*="theme"]').click();
  const toggled = await page.evaluate(() => document.documentElement.dataset.theme);
  expect(toggled).not.toBe(initial);

  await page.reload();
  await page.locator('.ProseMirror').waitFor();
  const persisted = await page.evaluate(() => document.documentElement.dataset.theme);
  expect(persisted).toBe(toggled);
});

test('share dialog copies the invite link', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/?room=pw-share');
  await page.locator('.ProseMirror').waitFor();

  await page.locator('.share-btn').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Copy link' }).click();

  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toContain('room=pw-share');
});

test('slash menu inserts a heading', async ({ page }) => {
  await page.goto('/?room=pw-slash');
  const ed = page.locator('.ProseMirror');
  await ed.waitFor();
  await ed.click();
  await page.keyboard.type('/head');
  await page.locator('.slash-menu').waitFor();
  await page.keyboard.press('Enter');
  await page.keyboard.type('My title');
  await expect(page.locator('.ProseMirror h1')).toContainText('My title');
});

test('word count reflects typed text', async ({ page }) => {
  await page.goto('/?room=pw-wc');
  const ed = page.locator('.ProseMirror');
  await ed.waitFor();
  await ed.click();
  await page.keyboard.type('one two three');
  await expect(page.locator('.wordcount')).toContainText('3 words');
});
