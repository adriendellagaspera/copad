import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { test, expect, typeIntoEditor } from './fixtures';

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

test('the header Import button is disabled while write-gated', async ({ page }) => {
  await page.goto('/?room=pw-import-gated');
  await page.locator('.ProseMirror').waitFor();

  const banner = page.locator('.sync-banner');
  await expect(banner).toBeVisible({ timeout: 10_000 });
  await expect(banner).toContainText("You're the only one here");

  await expect(page.getByRole('button', { name: 'Import a file into this document' })).toBeDisabled();
});

test('export a copy is reachable from the header', async ({ page }) => {
  await page.addInitScript(() => { delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker; });
  await page.goto('/?room=pw-export-header');
  const ed = page.locator('.ProseMirror');
  await ed.waitFor();
  await ed.click();
  await page.keyboard.type('Export me');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    (async () => {
      await page.getByRole('button', { name: 'Export a copy of this document' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.getByRole('button', { name: /Markdown/ }).click();
    })(),
  ]);
  expect(download.suggestedFilename()).toBe('pw-export-header.md');
});

test('export a copy (Settings) exports the document as a Word (.docx) file', async ({ page }) => {
  await page.addInitScript(() => { delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker; });
  await page.goto('/?room=pw-docx');
  const ed = page.locator('.ProseMirror');
  await ed.waitFor();
  await ed.click();
  await page.keyboard.type('# Export me');

  await page.locator('.cap-btn[title="Settings"]').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Word \(\.docx\)/ }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('pw-docx.docx');
  const path = await download.path();
  const bytes = readFileSync(path!);
  const xml = await (await JSZip.loadAsync(bytes)).file('word/document.xml')?.async('string');
  expect(xml).toContain('Export me');
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

test('print output stays white-background even in dark theme', async ({ page }) => {
  await page.goto('/?room=pw-print-dark');
  const ed = page.locator('.ProseMirror');
  await ed.waitFor();

  const theme = await page.evaluate(() => document.documentElement.dataset.theme);
  if (theme !== 'dark') {
    await page.locator('header button[aria-label*="theme"]').click();
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe(
      'dark',
    );
  }

  await page.emulateMedia({ media: 'print' });
  // body's background-color transitions (base.css); let it settle before reading.
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
    .toBe('rgb(255, 255, 255)');
});

test.describe('the caret pill and the selection bubble stay distinct surfaces', () => {
  test('arming a mark over a bare caret shows the pill, never the format bubble', async ({ page }) => {
    await page.goto('/?room=pw-armed-caret');
    const ed = page.locator('.ProseMirror');
    await ed.waitFor();
    await ed.click();
    await page.keyboard.press('Control+b');

    await expect(page.locator('.caret-hint.visible')).toBeVisible();
    await expect(page.locator('.sel-toolbar.visible')).toHaveCount(0);
  });

  test('a real selection shows the bubble, never the caret pill', async ({ page }) => {
    await page.goto('/?room=pw-armed-selection');
    await typeIntoEditor(page, 'hello');
    await page.keyboard.down('Shift');
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowLeft');
    await page.keyboard.up('Shift');

    await expect(page.locator('.sel-toolbar.visible')).toBeVisible();
    await expect(page.locator('.caret-hint.visible')).toHaveCount(0);
  });
});

test.describe('the floating text/table panel split', () => {
  test('a bare caret in a table shows only the table-structure panel', async ({ page }) => {
    await page.goto('/?room=pw-table-panel-caret');
    const ed = page.locator('.ProseMirror');
    await ed.waitFor();
    await ed.click();
    await page.keyboard.type('/table');
    await page.getByRole('option', { name: /Table/ }).click();
    await page.locator('.ProseMirror td, .ProseMirror th').first().click();

    await expect(page.locator('.table-toolbar.visible')).toBeVisible();
    await expect(page.locator('.sel-toolbar.visible')).toHaveCount(0);
  });

  test('a real text selection inside a table cell shows only the text-format panel', async ({ page }) => {
    await page.goto('/?room=pw-table-panel-selection');
    const ed = page.locator('.ProseMirror');
    await ed.waitFor();
    await ed.click();
    await page.keyboard.type('/table');
    await page.getByRole('option', { name: /Table/ }).click();
    const cell = page.locator('.ProseMirror td, .ProseMirror th').first();
    await cell.click();
    await page.keyboard.type('hello');
    await page.keyboard.down('Shift');
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowLeft');
    await page.keyboard.up('Shift');

    await expect(page.locator('.sel-toolbar.visible')).toBeVisible();
    await expect(page.locator('.table-toolbar.visible')).toHaveCount(0);
  });
});
