import { test, expect, typeIntoEditor } from './fixtures.js';

const palette = '[role="dialog"][aria-label="Search and commands"]';

test.describe('command palette', () => {
  test('opens on the header trigger and closes on Escape', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Search documents/ }).click();

    await expect(page.locator(palette)).toBeVisible();
    await expect(page.getByRole('combobox')).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(page.locator(palette)).toBeHidden();
  });

  test('opens on Mod+K even while the editor holds focus', async ({ page }) => {
    await page.goto('/');
    await page.locator('.ProseMirror').click();

    await page.keyboard.press('ControlOrMeta+k');

    await expect(page.locator(palette)).toBeVisible();
  });

  test('rests on something rather than opening blank', async ({ page }) => {
    await page.goto('/');
    await typeIntoEditor(page, 'Decisions');
    await page.locator('.ProseMirror').press('ControlOrMeta+Alt+1');

    await page.keyboard.press('ControlOrMeta+k');

    await expect(page.locator(`${palette} [role="option"]`).first()).toBeVisible();
  });

  test('jumps to a heading and hands focus back to the document', async ({ page }) => {
    await page.goto('/');
    await typeIntoEditor(page, 'Decisions');
    await page.locator('.ProseMirror').press('ControlOrMeta+Alt+1');

    await page.keyboard.press('ControlOrMeta+k');
    await page.getByRole('combobox').fill('#Decisions');
    await page.keyboard.press('Enter');

    await expect(page.locator(palette)).toBeHidden();
    await expect(page.locator('.ProseMirror')).toBeFocused();
  });

  test('says so plainly when nothing matches', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('ControlOrMeta+k');
    await page.getByRole('combobox').fill('zzzzzzzz');

    await expect(page.locator(`${palette} [role="option"]`)).toHaveCount(0);
    await expect(page.locator(palette)).toContainText('Nothing matches');
  });

  test('runs an action from its > prefix', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('ControlOrMeta+k');
    await page.getByRole('combobox').fill('>Export');
    await page.keyboard.press('Enter');

    await expect(page.locator(palette)).toBeHidden();
    await expect(page.getByRole('dialog').filter({ hasText: 'Export' })).toBeVisible();
  });

  test('leaves Mod+Shift+K to the link popover', async ({ page }) => {
    await page.goto('/');
    await typeIntoEditor(page, 'anchor');
    await page.locator('.ProseMirror').press('ControlOrMeta+a');
    await page.locator('.ProseMirror').press('ControlOrMeta+Shift+k');

    await expect(page.locator(palette)).toBeHidden();
    await expect(page.getByPlaceholder('Paste or type a link')).toBeVisible();
  });
});
