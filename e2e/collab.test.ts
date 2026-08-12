import { test, expect } from './fixtures';

test('two instances sync text via WebRTC', async ({ browser }) => {
  // Same context: y-webrtc syncs local peers over BroadcastChannel, the reliable path here.
  const ctx = await browser.newContext();
  const page1 = await ctx.newPage();
  const page2 = await ctx.newPage();
  // Without a shared room, two bare visits mint two private rooms and never meet.
  await Promise.all([page1.goto('/?room=pw-sync'), page2.goto('/?room=pw-sync')]);

  const editor1 = page1.locator('.ProseMirror');
  const editor2 = page2.locator('.ProseMirror');

  await Promise.all([editor1.waitFor(), editor2.waitFor()]);

  // Each page shows exactly one *other* avatar; self lives in the identity menu.
  const others1 = page1.locator('.session .presence .avatar');
  const others2 = page2.locator('.session .presence .avatar');
  await expect(others1).toHaveCount(1, { timeout: 20_000 });
  await expect(others2).toHaveCount(1, { timeout: 5_000 });

  // Let initial sync settle before typing.
  await page1.waitForTimeout(300);

  await editor1.click();
  await page1.waitForFunction(() =>
    document.querySelector('.ProseMirror') === document.activeElement
  );

  const text = 'Hello from page 1';
  // Per-key delay so ProseMirror processes each keystroke in turn.
  await editor1.pressSequentially(text, { delay: 30 });

  await expect(editor1).toContainText(text, { timeout: 5_000 });

  await expect(editor2).toContainText(text, { timeout: 10_000 });

  await editor2.click();
  await page2.waitForFunction(() =>
    document.querySelector('.ProseMirror') === document.activeElement
  );

  const reply = 'Reply from page 2';
  await editor2.pressSequentially(' ' + reply, { delay: 30 });

  await expect(editor1).toContainText(reply, { timeout: 10_000 });

  await ctx.close();
});
