import { test, expect } from '@playwright/test';

/**
 * Regression test for the encrypted-room privacy hole: removing a room's key and
 * reloading must NOT still show the (cached) content. Instead the room is gated,
 * and the local cache is encrypted at rest so it can't be read back without the key.
 */

const ROOM = 'enc-lock';
const SECRET = 'top-secret-passage';
const PASSWORD = 'hunter2';

const removeKey = (room: string) =>
  `(() => localStorage.removeItem('collab.room-password.${room}'))()`;

test('an encrypted room without its key is gated and its cache is unreadable', async ({ page }) => {
  await page.goto(`/?room=${ROOM}`);
  const ed = page.locator('.ProseMirror');
  await ed.waitFor();
  await ed.click();
  await page.keyboard.type(SECRET);
  await expect(ed).toContainText(SECRET);
  // Let the local cache flush the content to IndexedDB before we encrypt.
  await page.waitForTimeout(1200);

  // Encrypt the room with a password via the Share dialog.
  await page.locator('.share-btn').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('input[aria-label="Room password"]').fill(PASSWORD);
  await dialog.getByRole('button', { name: 'Set', exact: true }).click();
  await page.keyboard.press('Escape');

  // The editor remounts under the new key; content survives the cache migration.
  await expect(page.locator('.ProseMirror')).toContainText(SECRET, { timeout: 15_000 });
  await page.waitForTimeout(1200); // let the encrypted cache settle

  // The cache is encrypted at rest: the plaintext DB is gone, the encrypted one
  // exists, and the secret text is not recoverable from its raw bytes.
  const atRest = await page.evaluate(async (room) => {
    const names = (await indexedDB.databases()).map((d) => d.name);
    const encName = `copad:enc:${room}`;
    const db: IDBDatabase = await new Promise((res, rej) => {
      const q = indexedDB.open(encName);
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });
    const recs: Array<{ ct: ArrayBuffer }> = await new Promise((res, rej) => {
      const q = db.transaction('updates', 'readonly').objectStore('updates').getAll();
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });
    db.close();
    const bytes = recs.map((r) => new TextDecoder().decode(new Uint8Array(r.ct))).join('');
    return {
      hasPlaintextDb: names.includes(`copad:${room}`),
      hasEncryptedDb: names.includes(encName),
      recordCount: recs.length,
      leaks: bytes.includes('top-secret'),
    };
  }, ROOM);
  expect(atRest.hasEncryptedDb).toBe(true);
  expect(atRest.hasPlaintextDb).toBe(false);
  expect(atRest.recordCount).toBeGreaterThan(0);
  expect(atRest.leaks).toBe(false);

  // Remove the key (as the user did) and reload — the room must now be gated.
  await page.evaluate(removeKey(ROOM));
  await page.reload();

  await expect(page.getByRole('heading', { name: /encrypted/i })).toBeVisible();
  await expect(page.locator('.ProseMirror')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(SECRET);

  // A wrong key is rejected and keeps the room locked.
  await page.locator('input[aria-label="Room key or password"]').fill('not-the-password');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByText(/doesn't match/i)).toBeVisible();
  await expect(page.locator('.ProseMirror')).toHaveCount(0);

  // The correct key unlocks the room and decrypts the cached content.
  const keyInput = page.locator('input[aria-label="Room key or password"]');
  await keyInput.fill('');
  await keyInput.fill(PASSWORD);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.locator('.ProseMirror')).toContainText(SECRET, { timeout: 15_000 });
});
