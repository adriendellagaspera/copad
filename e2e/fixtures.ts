import { test as base, expect, type Page } from '@playwright/test';

/**
 * Shared e2e fixtures.
 *
 * Editor flows here run solo (one page, no peers), so the P2P write gate is
 * eligible — presence holds `Alone` only for `GATE_SETTLE_P2P_MS` before it
 * closes (contract §3.4's deferred-locking half). Tests used to rely on typing
 * inside that grace window, which is a timing assumption a loaded runner
 * breaks: the gate closes mid-keystroke, nothing lands, and the failure
 * surfaces far from its cause. Use {@link typeIntoEditor}, which takes the
 * gate's own escape hatch when that happens. The gate's behaviour is covered
 * directly in `intro.test.ts`.
 */

export const test = base;

export { expect };

/** Type into the editor, taking the write gate's escape hatch if it closed
 *  mid-keystroke, and prove the text landed before the caller depends on it. */
export async function typeIntoEditor(page: Page, text: string): Promise<void> {
  const editor = page.locator('.ProseMirror');
  await editor.waitFor();
  await editor.click();
  await page.keyboard.type(text);
  if (!(await editor.innerText()).includes(text)) {
    const writeSolo = page.getByRole('button', { name: 'Write alone anyway' });
    if (await writeSolo.count()) {
      await writeSolo.click();
      await editor.click();
      await page.keyboard.type(text);
    }
  }
  await expect(editor).toContainText(text);
}
