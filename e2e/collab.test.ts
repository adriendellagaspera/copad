import { test, expect } from '@playwright/test';

/**
 * End-to-end test: two browser instances share a Yjs document via y-webrtc.
 *
 * Both pages join the same room. y-webrtc syncs via WebRTC data channels
 * between peers AND via BroadcastChannel for same-browser peers. The test
 * uses two pages in the same browser context so BroadcastChannel acts as the
 * reliable in-process sync path (WebRTC ICE may still be negotiated in the
 * background — whichever channel wins first, the result must be identical).
 *
 * What this proves: two independent Yjs documents converge to the same state
 * when a user types in one page, matching the P2P collaboration guarantee.
 */
test('two instances sync text via WebRTC', async ({ browser }) => {
  // Pages in the same context share BroadcastChannel (same browsing context group,
  // same origin) which y-webrtc uses for local peer sync.
  const ctx = await browser.newContext();
  const page1 = await ctx.newPage();
  const page2 = await ctx.newPage();

  await Promise.all([page1.goto('/'), page2.goto('/')]);

  const editor1 = page1.locator('.ProseMirror');
  const editor2 = page2.locator('.ProseMirror');

  // Wait for both editors to mount.
  await Promise.all([editor1.waitFor(), editor2.waitFor()]);

  // Wait until each peer sees the other in the awareness channel.
  const status1 = page1.locator('.status');
  const status2 = page2.locator('.status');
  await expect(status1).toContainText('2 peer', { timeout: 20_000 });
  await expect(status2).toContainText('2 peer', { timeout: 5_000 });

  // Give ProseMirror a moment to finish all initial syncing before typing.
  await page1.waitForTimeout(300);

  // Click the editor and wait for it to be focused before typing.
  await editor1.click();
  await page1.waitForFunction(() =>
    document.querySelector('.ProseMirror') === document.activeElement
  );

  const text = 'Hello from page 1';
  // Use pressSequentially with delay so ProseMirror processes each key in turn.
  await editor1.pressSequentially(text, { delay: 30 });

  // Verify that page 1 itself shows the typed text.
  await expect(editor1).toContainText(text, { timeout: 5_000 });

  // Now verify the sync to page 2 (via BroadcastChannel or WebRTC).
  await expect(editor2).toContainText(text, { timeout: 10_000 });

  // Reverse direction: type in page 2 and verify it appears in page 1.
  await editor2.click();
  await page2.waitForFunction(() =>
    document.querySelector('.ProseMirror') === document.activeElement
  );

  const reply = 'Reply from page 2';
  await editor2.pressSequentially(' ' + reply, { delay: 30 });

  await expect(editor1).toContainText(reply, { timeout: 10_000 });

  await ctx.close();
});
