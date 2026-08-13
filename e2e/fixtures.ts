import { test as base, expect, type Page } from '@playwright/test';

export const test = base;

export { expect };

/** Types into the editor, taking the write gate's escape hatch if it closed mid-keystroke on a loaded runner. */
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
