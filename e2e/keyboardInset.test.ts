import { expect, test, type Page } from '@playwright/test';

type ViewportEvent = 'resize' | 'scroll';

interface SyntheticViewport {
  innerHeight: number;
  height: number;
  offsetTop: number;
}

interface SyntheticViewportState extends SyntheticViewport {
  set(next: SyntheticViewport, event: ViewportEvent): void;
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
    };

    Object.defineProperty(window, '__copadViewportTest', { configurable: true, value: state });
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
        window as typeof window & { __copadViewportTest?: SyntheticViewportState }
      ).__copadViewportTest;
      if (!state) throw new Error('visualViewport test harness was not installed');
      state.set(next, event);
    },
    { next, event },
  );
}

async function toolbarGapFromVisualBottom(page: Page, visualBottom: number): Promise<number> {
  return page.locator('.fixed-toolbar.editing').evaluate(
    (toolbar, bottom) => bottom - toolbar.getBoundingClientRect().bottom,
    visualBottom,
  );
}

test.describe('mobile formatting toolbar keyboard anchoring', () => {
  test.use({ viewport: { width: 390, height: 664 }, isMobile: true, hasTouch: true });

  test('follows a keyboard visual viewport after a long document was already scrolled', async ({
    page,
  }) => {
    await installViewportHarness(page);
    await page.goto('/?room=keyboard-inset-long-doc');

    const editor = page.locator('.ProseMirror');
    await editor.waitFor({ timeout: 30_000 });

    const writeSolo = page.getByRole('button', { name: 'Write alone anyway' });
    await expect(writeSolo).toBeVisible({ timeout: 30_000 });
    await writeSolo.click();
    await editor.click();
    await page.keyboard.insertText('long document content '.repeat(2_500));
    await editor.evaluate((element) => (element as HTMLElement).blur());

    const content = page.locator('.content');
    await content.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    const scrollTop = await content.evaluate((element) => element.scrollTop);
    expect(scrollTop).toBeGreaterThan(0);

    await editor.evaluate((element) => (element as HTMLElement).focus({ preventScroll: true }));
    const toolbar = page.locator('.fixed-toolbar.editing');
    await expect(toolbar).toBeVisible();

    const layoutHeight = await page.evaluate(() => document.documentElement.clientHeight);
    const spacing = await page.evaluate(() =>
      Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--sp-2'),
      ),
    );
    const keyboardHeight = 300;
    const visualHeight = layoutHeight - keyboardHeight;
    const firstOffsetTop = 96;
    const firstVisualBottom = firstOffsetTop + visualHeight;

    // WebKit can report innerHeight == visualViewport.height while the keyboard is open.
    await setViewport(
      page,
      { innerHeight: visualHeight, height: visualHeight, offsetTop: firstOffsetTop },
      'resize',
    );

    await expect
      .poll(() => toolbarGapFromVisualBottom(page, firstVisualBottom))
      .toBeCloseTo(spacing, 0);

    const secondOffsetTop = 124;
    const secondVisualBottom = secondOffsetTop + visualHeight;
    await setViewport(
      page,
      { innerHeight: visualHeight, height: visualHeight, offsetTop: secondOffsetTop },
      'scroll',
    );

    await expect
      .poll(() => toolbarGapFromVisualBottom(page, secondVisualBottom))
      .toBeCloseTo(spacing, 0);

    await setViewport(
      page,
      { innerHeight: layoutHeight, height: layoutHeight, offsetTop: 0 },
      'resize',
    );

    await expect
      .poll(() =>
        toolbar.evaluate(
          (element, height) => height - element.getBoundingClientRect().bottom,
          layoutHeight,
        ),
      )
      .toBeCloseTo(spacing, 0);
  });
});
