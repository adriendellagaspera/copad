import { test, expect } from '@playwright/test';

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
