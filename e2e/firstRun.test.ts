import { test, expect } from './fixtures';

/**
 * First run: a visitor with no link and a deployment with no `VITE_DEFAULT_ROOM`
 * gets a private room of their own (encrypted, contract §5) rather than landing
 * in a room shared with every other bare visitor. The room is then findable
 * again from the local library without having kept its URL.
 */

test('a bare visit mints a private encrypted room and stays in it across a reload', async ({ page }) => {
  await page.goto('/');
  await page.locator('.ProseMirror').waitFor();

  await expect(page).toHaveURL(/\?room=[^#]+#k=.+/);
  const minted = new URL(page.url()).searchParams.get('room');
  expect(minted).toBeTruthy();

  await page.reload();
  await page.locator('.ProseMirror').waitFor();
  expect(new URL(page.url()).searchParams.get('room')).toBe(minted);
});

test('the library lists a room this browser has opened', async ({ page }) => {
  await page.goto('/?room=pw-library');
  await page.locator('.ProseMirror').waitFor();

  await page.getByRole('button', { name: 'Your documents' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('a[href*="room=pw-library"]')).toHaveCount(1);
});

test('a view-only visit is remembered as view-only, never reopened as a writer', async ({ page }) => {
  await page.goto('/?room=pw-reader&role=reader');
  await page.locator('.ProseMirror').waitFor();

  await page.getByRole('button', { name: 'Your documents' }).first().click();
  const row = page.getByRole('dialog').locator('a[href*="room=pw-reader"]');
  await expect(row).toHaveAttribute('href', /role=reader/);
});
