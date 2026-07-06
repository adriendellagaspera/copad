import { test as base, expect, type Page } from '@playwright/test';

/**
 * Shared e2e fixtures.
 *
 * Editor flows exercised here run solo (one page, no peers), which is exactly when
 * the P2P write-gate holds the editor read-only. These tests exercise editor
 * mechanics, not the gate, so we auto-clear the gate for them. The gate itself is
 * covered directly in `intro.test.ts` (raw `@playwright/test`, no fixtures).
 */

/**
 * Auto-dismiss the P2P write-gate whenever it appears. Clicks its "write on your
 * own" escape as soon as it overlays the editor. The escape is session-scoped
 * (in-memory), so this is the honest equivalent of a user opting to write solo —
 * no persisted flag.
 */
export async function autoDismissWriteGate(page: Page): Promise<void> {
  await page.addLocatorHandler(page.locator('.gate'), async () => {
    await page.getByRole('button', { name: 'Write on your own' }).click();
  });
}

/** `test` with the solo write-gate auto-cleared. */
export const test = base.extend({
  page: async ({ page }, use) => {
    await autoDismissWriteGate(page);
    await use(page);
  },
});

export { expect };
