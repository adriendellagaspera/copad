import { test as base, expect, type BrowserContext } from '@playwright/test';

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

/** `test` with the intro popup pre-dismissed on the default context. */
export const test = base.extend({
  context: async ({ context }, use) => {
    await skipIntro(context);
    await use(context);
  },
});

export { expect };
