import { test, expect } from './fixtures';

test('a first visit leads with unsaved state and next actions, not a model explainer', async ({ page }) => {
  await page.goto('/');
  await page.locator('.ProseMirror').waitFor();

  const intro = page.locator('.first-visit');
  await expect(intro).toBeVisible();
  await expect(intro).toContainText('Nothing here is saved yet.');
  await expect(intro.getByRole('button', { name: 'Invite someone' })).toBeVisible();
  await expect(intro.getByRole('button', { name: 'Connect storage' })).toBeVisible();
  await expect(intro.getByRole('button', { name: 'How Copad works' })).toBeVisible();
  await expect(intro).not.toContainText('Copad is a room');
});

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

test('a bare visit that is only read leaves nothing in the library', async ({ page }) => {
  await page.goto('/');
  await page.locator('.ProseMirror').waitFor();
  const minted = new URL(page.url()).searchParams.get('room');
  expect(minted).toBeTruthy();

  await page.goto('/?room=pw-litter-witness');
  await page.locator('.ProseMirror').waitFor();

  await page.getByRole('button', { name: 'Your documents' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(`a[href*="room=${minted}"]`)).toHaveCount(0);
  await expect(dialog.locator('a[href*="room=pw-litter-witness"]')).toHaveCount(1);
});

test('a view-only visit is remembered as view-only, never reopened as a writer', async ({ page }) => {
  await page.goto('/?room=pw-reader&role=reader');
  await page.locator('.ProseMirror').waitFor();

  await page.getByRole('button', { name: 'Your documents' }).first().click();
  const row = page.getByRole('dialog').locator('a[href*="room=pw-reader"]');
  await expect(row).toHaveAttribute('href', /role=reader/);
});
