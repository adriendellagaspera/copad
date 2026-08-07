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
  await page.goto('/?room=pw-export-gated');
  await page.locator('.ProseMirror').waitFor();

  // Solo + P2P + live-only: the gate holds once presence has settled Alone
  // (GATE_SETTLE_P2P_MS) — wait it out without clicking into the editor, since a
  // click no longer silently opts into writing solo (contract §4.4's explicit
  // escape hatch replaced that).
  const banner = page.locator('.sync-banner');
  await expect(banner).toBeVisible({ timeout: 10_000 });
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

test('PDF (print) export opens the browser print flow', async ({ page }) => {
  await page.goto('/?room=pw-print');
  const ed = page.locator('.ProseMirror');
  await ed.waitFor();
  await ed.click();
  await page.keyboard.type('# Print me');

  const printCalled = page.evaluate(
    () => new Promise<void>((resolve) => { window.print = () => resolve(); }),
  );
  await page.locator('.cap-btn[title="Settings"]').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'PDF (print)' }).click();
  await printCalled;
});

test('print output hides the room-name field and the caret block-context hint', async ({ page }) => {
  // Regression: DocTitle's `<input>` and the line-hint decoration both live
  // inside `.content`/`.ProseMirror`, so the app-chrome exclusion rule
  // (`.editor > :not(.content)`) can't reach them — they'd otherwise bleed
  // into the printed output as garbled/overlapping text on top of the real
  // heading.
  await page.goto('/?room=pw-print-clean');
  const ed = page.locator('.ProseMirror');
  await ed.waitFor();
  await ed.click();
  await page.keyboard.type('# Bonjour');
  await page.waitForTimeout(100); // let the focused-caret line-hint decoration mount

  await page.emulateMedia({ media: 'print' });
  const docTitle = page.locator('.doc-title');
  const lineHint = page.locator('.line-hint-inline');
  await expect(docTitle).toHaveCSS('display', 'none');
  await expect(lineHint).toHaveCSS('display', 'none');
  // display:none elements still carry text in the DOM (textContent doesn't
  // reflect paint), so the real proof is zero rendered client rects.
  expect(await docTitle.evaluate((el) => el.getClientRects().length)).toBe(0);
  expect(await lineHint.evaluate((el) => el.getClientRects().length)).toBe(0);
});
