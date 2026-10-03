import { test, expect, type Locator, type Page } from '@playwright/test';

type ThemeName = 'light' | 'dark';
type ViewportWidth = 320 | 390;

const TOUCH_FLOOR = 44;
const ACTION_ROW = 52;
const PROSE_SIZE = '18px';
const COMPACT_UI_SIZE = '14px';
const ACTION_UI_SIZE = '16px';
const ICON_SIZE = 20;
const COMPACT_INLINE_PAD = 10;

async function setTheme(page: Page, theme: ThemeName): Promise<void> {
  await page.evaluate((nextTheme) => {
    document.documentElement.dataset.theme = nextTheme;
  }, theme);
}

async function dimensions(target: Locator): Promise<{ width: number; height: number }> {
  const box = await target.boundingBox();
  expect(box).not.toBeNull();
  return { width: box!.width, height: box!.height };
}

async function expectTouchTarget(target: Locator): Promise<void> {
  const box = await dimensions(target);
  expect(box.width).toBeGreaterThanOrEqual(TOUCH_FLOOR);
  expect(box.height).toBeGreaterThanOrEqual(TOUCH_FLOOR);
}

async function expectNoPageOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

async function openEditableRoom(page: Page, room: string): Promise<void> {
  await page.goto(`/?room=${room}`);
  await page.locator('.ProseMirror').waitFor({ timeout: 30_000 });
  const writeSolo = page.getByRole('button', { name: 'Write alone anyway' });
  if (await writeSolo.isVisible()) await writeSolo.click();
}

for (const width of [320, 390] as const satisfies readonly ViewportWidth[]) {
  test.describe(`mobile visual scale at ${width}px`, () => {
    test.use({ viewport: { width, height: 664 }, isMobile: true, hasTouch: true });

    for (const theme of ['light', 'dark'] as const satisfies readonly ThemeName[]) {
      test(`document surfaces stay generous and contained in ${theme} mode`, async ({ page }) => {
        await openEditableRoom(page, `scale-${width}-${theme}`);
        await setTheme(page, theme);

        const capsule = page.locator('.mobile-capsule');
        await expect(capsule).toBeVisible();
        expect((await dimensions(capsule)).height).toBe(52);
        for (const control of await capsule.locator('.cap-mark, .identity-btn, .chip, .cap-btn, .cap-share').all()) {
          await expectTouchTarget(control);
        }
        const glyph = capsule.locator('.mobile-action-palette .mobile-cap-glyph');
        expect((await dimensions(glyph)).height).toBe(40);
        const moreIcon = glyph.locator('svg');
        expect((await dimensions(moreIcon)).width).toBe(ICON_SIZE);
        expect((await dimensions(moreIcon)).height).toBe(ICON_SIZE);

        const prose = page.locator('.ProseMirror');
        await expect(prose).toHaveCSS('font-size', PROSE_SIZE);
        await expect(page.locator('.doc-title .title-input')).toHaveCSS('font-size', '28px');

        await prose.click();
        const toolbar = page.locator('.fixed-toolbar.editing .toolbar');
        await expect(toolbar).toBeVisible();
        expect((await dimensions(toolbar)).height).toBe(52);
        for (const control of await toolbar.locator('button').all()) await expectTouchTarget(control);
        const toolbarIcon = toolbar.locator('button svg').first();
        expect((await dimensions(toolbarIcon)).width).toBe(ICON_SIZE);
        expect((await dimensions(toolbarIcon)).height).toBe(ICON_SIZE);
        await expect(toolbar.locator('button').first()).toHaveCSS('font-size', COMPACT_UI_SIZE);
        const shareVisual = capsule.locator('.mobile-action-share .mobile-cap-glyph');
        await expect(shareVisual).toHaveCSS('font-size', COMPACT_UI_SIZE);
        await expect(shareVisual).toHaveCSS('padding-left', `${COMPACT_INLINE_PAD}px`);
        await expect(shareVisual).toHaveCSS('padding-right', `${COMPACT_INLINE_PAD}px`);
        const shareContentWidth = await shareVisual.evaluate((el) => {
          const icon = el.querySelector('svg')?.getBoundingClientRect().width ?? 0;
          const label = el.querySelector('.cap-share-label')?.getBoundingClientRect().width ?? 0;
          const gap = Number.parseFloat(getComputedStyle(el).columnGap || getComputedStyle(el).gap);
          return icon + label + gap;
        });
        expect((await dimensions(shareVisual)).width - shareContentWidth).toBeGreaterThanOrEqual(
          COMPACT_INLINE_PAD * 2,
        );

        await page.getByRole('button', { name: 'More actions', exact: true }).click();
        const actions = page.getByRole('dialog', { name: 'Document actions' });
        await expect(actions).toBeVisible();
        const actionRow = actions.locator('.mobile-actions-row').first();
        expect((await dimensions(actionRow)).height).toBeGreaterThanOrEqual(ACTION_ROW);
        await expect(actionRow).toHaveCSS('font-size', ACTION_UI_SIZE);
        const actionIcon = actionRow.locator('svg');
        expect((await dimensions(actionIcon)).width).toBe(ICON_SIZE);

        await actions.getByRole('button', { name: 'Search document & commands', exact: true }).click();
        const palette = page.getByRole('dialog', { name: 'Search and commands' });
        await expect(palette).toBeVisible();
        const paletteInput = palette.locator('.palette-input');
        expect((await dimensions(paletteInput)).height).toBeGreaterThanOrEqual(ACTION_ROW);
        await paletteInput.fill('>Export');
        const paletteRow = palette.locator('.palette-row').first();
        await expect(paletteRow).toBeVisible();
        expect((await dimensions(paletteRow)).height).toBeGreaterThanOrEqual(ACTION_ROW);
        await expect(paletteRow.locator('.palette-label')).toHaveCSS('font-size', ACTION_UI_SIZE);

        await expectNoPageOverflow(page);
      });

      test(`About uses the same mobile scale in ${theme} mode`, async ({ page }) => {
        await page.goto('/?about');
        await setTheme(page, theme);

        const capsule = page.locator('.about-capsule');
        await expect(capsule).toBeVisible();
        expect((await dimensions(capsule)).height).toBe(52);
        await expectTouchTarget(capsule.locator('.cap-mark'));
        await expectTouchTarget(capsule.locator('.cap-share'));
        await expectTouchTarget(capsule.locator('.cap-theme button'));
        await expect(capsule.locator('.cap-share')).toHaveCSS('font-size', COMPACT_UI_SIZE);
        await expect(capsule.locator('.cap-share')).toHaveCSS(
          'padding-left',
          `${COMPACT_INLINE_PAD}px`,
        );
        await expect(capsule.locator('.cap-share')).toHaveCSS(
          'padding-right',
          `${COMPACT_INLINE_PAD}px`,
        );

        const prose = page.locator('.about-doc .ProseMirror');
        await expect(prose).toHaveCSS('font-size', PROSE_SIZE);
        await expect(page.locator('.about-doc .doc-title h1')).toHaveCSS('font-size', '28px');

        const search = page.locator('.about-doc .palette-trigger');
        expect((await dimensions(search)).height).toBeGreaterThanOrEqual(ACTION_ROW);
        await expect(search).toHaveCSS('font-size', COMPACT_UI_SIZE);
        const searchIcon = search.locator('svg');
        expect((await dimensions(searchIcon)).width).toBe(ICON_SIZE);
        expect((await dimensions(searchIcon)).height).toBe(ICON_SIZE);

        await expectNoPageOverflow(page);
      });
    }
  });
}


test.describe('mobile formatting marks', () => {
  test.use({ viewport: { width: 390, height: 664 }, isMobile: true, hasTouch: true });

  test('armed marks persist, compose, and can be removed independently', async ({ page }) => {
    await openEditableRoom(page, 'formatting-marks');

    const prose = page.locator('.ProseMirror');
    await prose.click();

    const toolbar = page.locator('.fixed-toolbar.editing .toolbar');
    const italic = toolbar.getByRole('button', { name: 'Italic' });
    const bold = toolbar.getByRole('button', { name: 'Bold' });

    await italic.click();
    await expect(italic).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.type('ab');
    expect((await prose.locator('em').allTextContents()).join('')).toBe('ab');

    await bold.click();
    await expect(italic).toHaveAttribute('aria-pressed', 'true');
    await expect(bold).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.type('cd');

    await italic.click();
    await expect(italic).toHaveAttribute('aria-pressed', 'false');
    await expect(bold).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.type('ef');

    expect(await prose.textContent()).toBe('abcdef');
    expect((await prose.locator('em').allTextContents()).join('')).toBe('abcd');
    expect((await prose.locator('strong').allTextContents()).join('')).toBe('cdef');
  });
});
