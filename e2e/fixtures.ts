import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';

/**
 * Shared e2e fixtures.
 *
 * The first-run intro popup is a full-screen modal that overlays the app on a
 * fresh browser (empty localStorage). It's real first-run UX, but the editor
 * flows exercised here are *returning-user* behaviour — so seed the "seen" flag
 * to skip it. First-run onboarding has its own coverage in `intro.test.ts`.
 */

/** The localStorage key the app writes once the intro has been dismissed. */
const SEEN_INTRO_KEY = 'copad:seenIntro';

/** Seed a context so the first-run intro popup doesn't overlay the app. */
export async function skipIntro(context: BrowserContext): Promise<void> {
  await context.addInitScript((key) => {
    try {
      window.localStorage.setItem(key, '1');
    } catch {
      /* private mode / unavailable — the popup just shows, harmless here */
    }
  }, SEEN_INTRO_KEY);
}

/**
 * Auto-dismiss the P2P write-gate whenever it appears. Editor flows here run solo
 * (one page, no peers), which is exactly when the gate holds the editor read-only;
 * these tests exercise editor mechanics, not the gate, so click its "write on your
 * own" escape as soon as it overlays the editor. The escape is session-scoped
 * (in-memory), so this is the honest equivalent of a user opting to write solo —
 * no persisted flag. The gate itself is covered in `intro.test.ts` (raw context,
 * no fixtures), which drives and asserts it directly.
 */
export async function autoDismissWriteGate(page: Page): Promise<void> {
  await page.addLocatorHandler(page.locator('.gate'), async () => {
    await page.getByRole('button', { name: 'Write on your own' }).click();
  });
}

/** `test` with the intro popup pre-dismissed and the solo write-gate auto-cleared. */
export const test = base.extend({
  context: async ({ context }, use) => {
    await skipIntro(context);
    await use(context);
  },
  page: async ({ page }, use) => {
    await autoDismissWriteGate(page);
    await use(page);
  },
});

export { expect };
