import type { Page } from '@playwright/test';
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

    const openMenu = async (page: Page): Promise<void> => {
      await page.getByRole('button', { name: 'More actions', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Document actions' })).toBeVisible();
    };

    test('keeps moved document actions directly reachable through More', async ({ page }) => {
      await page.goto('/');

      await openMenu(page);
      await page.getByRole('button', { name: 'Your documents', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Your documents' })).toBeVisible();
      await page.keyboard.press('Escape');

      await openMenu(page);
      await page.getByRole('button', { name: 'Join a meeting link', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Join a meeting' })).toBeVisible();
      await page.keyboard.press('Escape');

      await openMenu(page);
      await page.getByRole('button', { name: 'Export a copy', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Export a copy' })).toBeVisible();
      await page.keyboard.press('Escape');

      const popupPromise = page.waitForEvent('popup');
      await openMenu(page);
      await page.getByRole('button', { name: 'New document', exact: true }).click();
      const popup = await popupPromise;
      await expect(popup.locator('.ProseMirror')).toBeVisible({ timeout: 30_000 });
      await popup.close();
    });

    test('opens the searchable command palette explicitly from More', async ({ page }) => {
      await page.goto('/');
      await openMenu(page);
      await page.getByRole('button', { name: 'Search document & commands', exact: true }).click();

      await expect(page.locator(palette)).toBeVisible();
      await expect(page.getByRole('combobox')).toBeFocused();
    });

    test('keeps Settings and appearance preferences in More', async ({ page }) => {
      await page.goto('/');

      await openMenu(page);
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Storage', exact: true })).toBeVisible();
      await page.keyboard.press('Escape');

      const before = await page.evaluate(() => document.documentElement.dataset.theme);
      await openMenu(page);
      await page
        .getByRole('button', { name: before === 'dark' ? 'Light appearance' : 'Dark appearance', exact: true })
        .click();
      await expect
        .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
        .toBe(before === 'dark' ? 'light' : 'dark');
    });

    test('keeps Import directly reachable when the write gate allows it', async ({ page }) => {
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

      await openMenu(page);
      await page.getByRole('button', { name: 'Import a file', exact: true }).click();

      await expect.poll(() =>
        page.evaluate(() => sessionStorage.getItem('copad-test-file-picker-opened')),
      ).toBe('yes');
    });
  });

});
