import { test, expect } from './fixtures';

const ROOM = 'enc-lock';
const SECRET = 'top-secret-passage';
const KEY = 'top-secret-key-please-keep';

test('an encrypted room without its key is gated and its cache is unreadable', async ({ page }) => {
  // Every room is encrypted from creation (docs/contract.md §5), as a real "New document" link would be.
  await page.goto(`/?room=${ROOM}#k=${KEY}`);
  const ed = page.locator('.ProseMirror');
  await ed.waitFor();
  await ed.click();
  await page.keyboard.type(SECRET);
  await expect(ed).toContainText(SECRET);
  // Let the local cache flush the content to IndexedDB before we check it at rest.
  await page.waitForTimeout(1200);

  // Poll: PBKDF2 derivation and the migration write lag under CI load.
  // Only open the encrypted DB once `databases()` lists it — an earlier version-less open would
  // win the race against the app's create-with-upgrade and strand it without its object store.
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

  await page.goto(`/?room=${ROOM}`);

  await expect(page.getByRole('heading', { name: /encrypted/i })).toBeVisible();
  await expect(page.locator('.ProseMirror')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(SECRET);

  await page.locator('input[aria-label="Document key or password"]').fill('not-the-password');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByText(/doesn't match/i)).toBeVisible();
  await expect(page.locator('.ProseMirror')).toHaveCount(0);

  const keyInput = page.locator('input[aria-label="Document key or password"]');
  await keyInput.fill('');
  await keyInput.fill(KEY);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.locator('.ProseMirror')).toContainText(SECRET, { timeout: 15_000 });
});

test('text typed the instant an encrypted room opens is still cached', async ({ page }) => {
  // Typing immediately races a brand-new encrypted cache's async init; the edits must survive it.
  const room = 'enc-immediate';
  await page.goto(`/?room=${room}#k=instant-key-abc123`);
  const ed = page.locator('.ProseMirror');
  await ed.waitFor();
  await ed.click();
  await page.keyboard.type('typed the instant it opened');
  await page.waitForTimeout(1200);

  await page.reload();
  await expect(page.locator('.ProseMirror')).toContainText('typed the instant it opened', {
    timeout: 15_000,
  });
});
