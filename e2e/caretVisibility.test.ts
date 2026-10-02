import { expect, test, type Locator, type Page } from '@playwright/test';

type ViewportEvent = 'resize' | 'scroll';

interface SyntheticViewport {
  innerHeight: number;
  height: number;
  offsetTop: number;
}

interface SyntheticViewportState extends SyntheticViewport {
  set(next: SyntheticViewport, event: ViewportEvent): void;
  setAfterEvent(next: SyntheticViewport, event: ViewportEvent): void;
}

async function installViewportHarness(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const state: SyntheticViewportState = {
      innerHeight: window.innerHeight,
      height: viewport.height,
      offsetTop: viewport.offsetTop,
      set(next, event) {
        this.innerHeight = next.innerHeight;
        this.height = next.height;
        this.offsetTop = next.offsetTop;
        viewport.dispatchEvent(new Event(event));
      },
      setAfterEvent(next, event) {
        viewport.dispatchEvent(new Event(event));
        this.innerHeight = next.innerHeight;
        this.height = next.height;
        this.offsetTop = next.offsetTop;
      },
    };

    Object.defineProperty(window, '__copadCaretViewportTest', {
      configurable: true,
      value: state,
    });
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      get: () => state.innerHeight,
    });
    Object.defineProperty(viewport, 'height', {
      configurable: true,
      get: () => state.height,
    });
    Object.defineProperty(viewport, 'offsetTop', {
      configurable: true,
      get: () => state.offsetTop,
    });
  });
}

async function setViewport(
  page: Page,
  next: SyntheticViewport,
  event: ViewportEvent,
): Promise<void> {
  await page.evaluate(
    ({ next, event }) => {
      const state = (
        window as typeof window & { __copadCaretViewportTest?: SyntheticViewportState }
      ).__copadCaretViewportTest;
      if (!state) throw new Error('visualViewport test harness was not installed');
      state.set(next, event);
    },
    { next, event },
  );
}

async function setViewportAfterEvent(
  page: Page,
  next: SyntheticViewport,
  event: ViewportEvent,
): Promise<void> {
  await page.evaluate(
    ({ next, event }) => {
      const state = (
        window as typeof window & { __copadCaretViewportTest?: SyntheticViewportState }
      ).__copadCaretViewportTest;
      if (!state) throw new Error('visualViewport test harness was not installed');
      state.setAfterEvent(next, event);
    },
    { next, event },
  );
}

async function enterSoloEditing(page: Page): Promise<Locator> {
  const editor = page.locator('.ProseMirror');
  await editor.waitFor({ timeout: 30_000 });
  const writeSolo = page.getByRole('button', { name: 'Write alone anyway' });
  await expect(writeSolo).toBeVisible({ timeout: 30_000 });
  await writeSolo.evaluate((element) => (element as HTMLButtonElement).click());
  await editor.evaluate((element) => (element as HTMLElement).focus());
  await expect(editor).toBeFocused();
  return editor;
}

async function caretToolbarGap(page: Page): Promise<number> {
  const line = await page.locator('.ProseMirror > p:last-child').boundingBox();
  const toolbar = await page.locator('.fixed-toolbar.editing .toolbar').boundingBox();
  if (!line || !toolbar) throw new Error('caret line or toolbar is not measurable');
  return toolbar.y - (line.y + line.height);
}

async function caretDiagnostics(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const content = document.querySelector<HTMLElement>('.content');
    const toolbar = document.querySelector<HTMLElement>('.fixed-toolbar.editing .toolbar');
    const line = document.querySelector<HTMLElement>('.ProseMirror > p:last-child');
    const selection = window.getSelection();
    const range =
      selection && selection.rangeCount > 0 ? selection.getRangeAt(selection.rangeCount - 1) : null;
    const rect = (element: HTMLElement | null) => {
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, height: box.height };
    };
    const rangeBox = range?.getBoundingClientRect();
    return {
      content: content
        ? {
            top: content.getBoundingClientRect().top,
            bottom: content.getBoundingClientRect().bottom,
            clientHeight: content.clientHeight,
            scrollHeight: content.scrollHeight,
            scrollTop: content.scrollTop,
            maxScroll: content.scrollHeight - content.clientHeight,
          }
        : null,
      toolbar: rect(toolbar),
      line: rect(line),
      range: rangeBox
        ? { top: rangeBox.top, bottom: rangeBox.bottom, height: rangeBox.height }
        : null,
      activeElement: document.activeElement?.className ?? document.activeElement?.nodeName ?? null,
    };
  });
}

async function placeCaretLineSafely(page: Page): Promise<void> {
  const content = page.locator('.content');
  const gap = await caretToolbarGap(page);
  await content.evaluate((element, delta) => {
    element.scrollTop += delta;
  }, 32 - gap);
  await expect.poll(() => caretToolbarGap(page)).toBeGreaterThanOrEqual(31);
}

for (const width of [320, 390] as const) {
  test.describe(`mobile caret visibility at ${width}px`, () => {
    test.use({ viewport: { width, height: 664 }, isMobile: true, hasTouch: true });



    test('keeps a still-short document clear while the keyboard is already open', async ({
      page,
    }) => {
      await installViewportHarness(page);
      await page.goto(`/?room=caret-visibility-short-${width}`);
      const editor = await enterSoloEditing(page);

      const layoutHeight = await page.evaluate(() => document.documentElement.clientHeight);
      const keyboardHeight = 300;
      const visualHeight = layoutHeight - keyboardHeight;
      const offsetTop = 96;
      // WebKit can emit resize before visualViewport.height/offsetTop expose their new values.
      await setViewportAfterEvent(
        page,
        { innerHeight: visualHeight, height: visualHeight, offsetTop },
        'resize',
      );

      const toolbar = page.locator('.fixed-toolbar.editing .toolbar');
      const visualBottom = offsetTop + visualHeight;
      await expect
        .poll(async () => {
          const box = await toolbar.boundingBox();
          return box ? visualBottom - (box.y + box.height) : Number.NaN;
        })
        .toBeCloseTo(8, 0);

      const content = page.locator('.content');
      for (let line = 1; line <= 24; line += 1) {
        await page.keyboard.press('Enter');
        if (test.info().project.name === 'webkit-caret-mobile') {
          console.log(`caret-debug short ${width}px line ${line}`, await caretDiagnostics(page));
        }
        await expect
          .poll(() => caretToolbarGap(page), { message: `line ${line} should clear the toolbar` })
          .toBeGreaterThanOrEqual(6);
      }

      await expect(editor).toBeFocused();
    });

    test('keeps new and wrapped lines clear of the formatting toolbar', async ({ page }) => {
      await installViewportHarness(page);
      await page.goto(`/?room=caret-visibility-${width}`);
      const editor = await enterSoloEditing(page);

      await page.keyboard.insertText('long document content '.repeat(2_500));
      await page.keyboard.press('Enter');

      const content = page.locator('.content');
      await content.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await placeCaretLineSafely(page);

      const safeScrollTop = await content.evaluate((element) => element.scrollTop);
      await page.keyboard.type('safe');
      const safeScrollDrift = Math.abs(
        (await content.evaluate((element) => element.scrollTop)) - safeScrollTop,
      );
      expect(safeScrollDrift).toBeLessThanOrEqual(2);

      for (let i = 0; i < 8; i += 1) await page.keyboard.press('Enter');
      if (test.info().project.name === 'webkit-caret-mobile') {
        console.log(`caret-debug long ${width}px`, await caretDiagnostics(page));
      }
      await expect.poll(() => caretToolbarGap(page)).toBeGreaterThanOrEqual(6);

      const layoutHeight = await page.evaluate(() => document.documentElement.clientHeight);
      const keyboardHeight = 300;
      const visualHeight = layoutHeight - keyboardHeight;
      const offsetTop = 96;
      await setViewport(
        page,
        { innerHeight: visualHeight, height: visualHeight, offsetTop },
        'resize',
      );

      const toolbar = page.locator('.fixed-toolbar.editing .toolbar');
      const visualBottom = offsetTop + visualHeight;
      await expect
        .poll(async () => {
          const box = await toolbar.boundingBox();
          return box ? visualBottom - (box.y + box.height) : Number.NaN;
        })
        .toBeCloseTo(8, 0);

      await page.keyboard.type(' wrapped line'.repeat(30));
      await expect.poll(() => caretToolbarGap(page)).toBeGreaterThanOrEqual(6);

      for (let i = 0; i < 4; i += 1) await page.keyboard.press('Enter');
      await expect.poll(() => caretToolbarGap(page)).toBeGreaterThanOrEqual(6);

      await expect(editor).toBeFocused();
    });
  });
}
