import { readFileSync } from 'node:fs';
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

test('download menu (header capsule) exports the document as markdown', async ({ page }) => {
  // Force the Blob/anchor fallback so this test observes a real Playwright
  // download event regardless of whether the browser also supports the File
  // System Access API's save picker (Chromium does; Firefox/Safari don't).
  await page.addInitScript(() => { delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker; });
  await page.goto('/?room=pw-download');
  const ed = page.locator('.ProseMirror');
  await ed.waitFor();
  await ed.click();
  await page.keyboard.type('# Export me');

  // Scoped to the header capsule instance — the mobile dock mounts a second,
  // CSS-hidden copy of the same component (see IdentityMenu/Share for the
  // same dual-mount pattern), so an unscoped title/role lookup would be
  // ambiguous even though only one is ever visible at a time.
  await page.locator('header.capsule .download-btn').click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: /Markdown/ }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('pw-download.md');
  const path = await download.path();
  expect(path && readFileSync(path, 'utf8')).toContain('# Export me');
});
