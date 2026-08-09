import { test, expect } from './fixtures';

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

  // Encrypt the room with a password via the Share dialog's security view.
  await page.locator('.share-btn').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Document security' }).click();
  await dialog.locator('input[aria-label="Document password"]').fill(PASSWORD);
  await dialog.getByRole('button', { name: 'Set', exact: true }).click();
  await page.keyboard.press('Escape');

  // The editor remounts under the new key; content survives the cache migration.
  await expect(page.locator('.ProseMirror')).toContainText(SECRET, { timeout: 15_000 });

  // Read the cache at rest: the plaintext DB should be gone, the encrypted one
  // populated, and the secret text unrecoverable from its raw bytes. PBKDF2 key
  // derivation + the migration's IndexedDB write can lag under load, so this polls
  // rather than assuming a fixed delay is enough (that flaked on slower CI
  // runners). Crucially, it only opens the encrypted DB with a bare
  // `indexedDB.open(name)` (no version) once `databases()` confirms it already
  // exists — opening it any earlier would race the app's own create-with-upgrade
  // call, and whichever open wins first locks in the schema, permanently
  // stranding the app without its object store if we won that race with an
  // upgrade-less open of our own.
  let atRest!: { hasPlaintextDb: boolean; hasEncryptedDb: boolean; recordCount: number; leaks: boolean };
  await expect
    .poll(
      async () => {
        atRest = await page.evaluate(async (room) => {
          const names = (await indexedDB.databases()).map((d) => d.name);
          const encName = `copad:enc:${room}`;
          if (!names.includes(encName)) {
            return { hasPlaintextDb: names.includes(`copad:${room}`), hasEncryptedDb: false, recordCount: 0, leaks: false };
          }
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
            hasEncryptedDb: true,
            recordCount: recs.length,
            leaks: bytes.includes('top-secret'),
          };
        }, ROOM);
        return atRest.hasEncryptedDb && !atRest.hasPlaintextDb && atRest.recordCount > 0;
      },
      { timeout: 15_000 },
    )
    .toBe(true);
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
  await page.locator('input[aria-label="Document key or password"]').fill('not-the-password');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByText(/doesn't match/i)).toBeVisible();
  await expect(page.locator('.ProseMirror')).toHaveCount(0);

  // The correct key unlocks the room and decrypts the cached content.
  const keyInput = page.locator('input[aria-label="Document key or password"]');
  await keyInput.fill('');
  await keyInput.fill(PASSWORD);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.locator('.ProseMirror')).toContainText(SECRET, { timeout: 15_000 });
});

test('text typed the instant an encrypted room opens is still cached', async ({ page }) => {
  // A URL `#k=` key encrypts the room (and its cache) from the first mount, giving
  // a brand-new encrypted cache. Typing immediately races that cache's async init;
  // the edits must still be captured (regression: a fresh cache dropped them).
  const room = 'enc-immediate';
  await page.goto(`/?room=${room}#k=instant-key-abc123`);
  const ed = page.locator('.ProseMirror');
  await ed.waitFor();
  await ed.click();
  await page.keyboard.type('typed the instant it opened'); // no wait — beat the cache init
  await page.waitForTimeout(1200);

  await page.reload(); // reload keeps the #k= key in the URL
  await expect(page.locator('.ProseMirror')).toContainText('typed the instant it opened', {
    timeout: 15_000,
  });
});
