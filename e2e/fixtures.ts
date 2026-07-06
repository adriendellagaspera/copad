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

/**
 * Seed a context so the P2P write-gate doesn't hold the editor read-only. Editor
 * flows here run solo (one page, no peers), which is exactly when the gate fires;
 * these tests exercise editor mechanics, not the gate, so pre-authorise solo
 * writing for whichever room loads. The gate itself is covered in `intro.test.ts`
 * (raw context, no fixture). Uses the same per-room `collab.room-solo-ok.<room>`
 * flag the "Write on your own" escape sets.
 */
export async function skipWriteGate(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    try {
      const room = new URLSearchParams(window.location.search).get('room') || 'copad-demo';
      window.localStorage.setItem(`collab.room-solo-ok.${room}`, '1');
    } catch {
      /* private mode / unavailable — the gate just shows, tests would flag it */
    }
  });
}

/** `test` with the intro popup and the solo write-gate pre-cleared on the context. */
export const test = base.extend({
  context: async ({ context }, use) => {
    await skipIntro(context);
    await skipWriteGate(context);
    await use(context);
  },
});

export { expect };
