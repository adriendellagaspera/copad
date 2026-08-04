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

test('export a copy (Settings) exports the document as markdown', async ({ page }) => {
  // Force the Blob/anchor fallback so this test observes a real Playwright
  // download event regardless of whether the browser also supports the File
  // System Access API's save picker.
  await page.addInitScript(() => { delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker; });
  await page.goto('/?room=pw-export');
  const ed = page.locator('.ProseMirror');
  await ed.waitFor();
  await ed.click();
  await page.keyboard.type('# Export me');

  await page.locator('.cap-btn[title="Settings"]').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Markdown/ }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('pw-export.md');
  const path = await download.path();
  expect(path && readFileSync(path, 'utf8')).toContain('# Export me');
});

test('export a copy is reachable from the read-only band while write-gated', async ({ page }) => {
  await page.addInitScript(() => { delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker; });
  // Pre-seed the one-time write-gate explainer as already seen — this test covers
  // the standing banner's Export action, not the first-encounter blocking dialog
  // (see intro.test.ts).
  await page.addInitScript(() => localStorage.setItem('copad:writeGateSeen', 'true'));
  await page.goto('/?room=pw-export-gated');
  await page.locator('.ProseMirror').waitFor();

  // Solo + P2P + live-only: the write-gate arms after its grace window (2s) —
  // wait it out without clicking into the editor, since any click/keystroke
  // there is itself the "yield to write" gesture that lifts the gate.
  const banner = page.locator('.sync-banner');
  await expect(banner).toBeVisible({ timeout: 5000 });
  await expect(banner).toContainText("You're the only one here");

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    (async () => {
      await banner.getByRole('button', { name: 'Export a copy' }).click();
      await expect(page.getByRole('dialog', { name: 'Export a copy' })).toBeVisible();
      await page.getByRole('button', { name: /Markdown/ }).click();
    })(),
  ]);
  expect(download.suggestedFilename()).toBe('pw-export-gated.md');
});
