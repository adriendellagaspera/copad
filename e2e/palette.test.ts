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

  test.describe('mobile capsule', () => {
    test.use({ viewport: { width: 320, height: 664 }, isMobile: true, hasTouch: true });

    test('keeps moved document actions reachable through the palette', async ({ page }) => {
      await page.goto('/');
      const openPalette = async (): Promise<void> => {
        await page.getByRole('button', { name: 'Search and commands', exact: true }).click();
      };

      await openPalette();
      await page.getByRole('combobox').fill('>Your documents');
      await page.keyboard.press('Enter');
      await expect(page.getByRole('dialog', { name: 'Your documents' })).toBeVisible();
      await page.keyboard.press('Escape');

      await openPalette();
      await page.getByRole('combobox').fill('>Join a meeting link');
      await page.keyboard.press('Enter');
      await expect(page.getByRole('dialog', { name: 'Join a meeting' })).toBeVisible();
      await page.keyboard.press('Escape');

      await openPalette();
      await page.getByRole('combobox').fill('>Export a copy');
      await page.keyboard.press('Enter');
      await expect(page.getByRole('dialog', { name: 'Export a copy' })).toBeVisible();
      await page.keyboard.press('Escape');

      const popupPromise = page.waitForEvent('popup');
      await openPalette();
      await page.getByRole('combobox').fill('>New document');
      await page.keyboard.press('Enter');
      const popup = await popupPromise;
      await expect(popup.locator('.ProseMirror')).toBeVisible({ timeout: 30_000 });
      await popup.close();
    });

    test('keeps Import reachable when the write gate allows it', async ({ page }) => {
      await page.addInitScript(() => {
        Object.defineProperty(window, 'showOpenFilePicker', {
          configurable: true,
          value: async () => {
            sessionStorage.setItem('copad-test-file-picker-opened', 'yes');
            throw new DOMException('Cancelled by test', 'AbortError');
          },
        });
      });
      await page.goto('/');
      const writeSolo = page.getByRole('button', { name: 'Write alone anyway' });
      await expect(writeSolo).toBeVisible({ timeout: 30_000 });
      await writeSolo.click();

      await page.getByRole('button', { name: 'Search and commands', exact: true }).click();
      await page.getByRole('combobox').fill('>Import a file');
      await page.keyboard.press('Enter');

      await expect.poll(() =>
        page.evaluate(() => sessionStorage.getItem('copad-test-file-picker-opened')),
      ).toBe('yes');
    });
  });

});
