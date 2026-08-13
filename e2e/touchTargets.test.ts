import { test, expect, type Locator, type Page } from '@playwright/test';

/*
 * Measured, not derived. Issues #101/#291/#292/#293 all carry figures computed from CSS by
 * hand; this spec observes boundingBox() instead and prints what it saw. The 44px floor is
 * asserted in the fixme'd describe at the bottom — today's UI violates it (#287).
 */

type ElementName = string & { readonly _brand: 'ElementName' };
type ViewportLabel = string & { readonly _brand: 'ViewportLabel' };
type Px = number & { readonly _brand: 'Px' };
type Overflows = boolean & { readonly _brand: 'Overflows' };

const TOUCH_FLOOR = 44 as Px;

interface Measurement {
  readonly element: ElementName;
  readonly viewport: ViewportLabel;
  readonly width: Px;
  readonly height: Px;
  readonly right: Px;
}

interface DockRow {
  readonly row: ElementName;
  readonly viewport: ViewportLabel;
  readonly scrollWidth: Px;
  readonly clientWidth: Px;
  readonly controlsWidth: Px;
  readonly overflows: Overflows;
}

const measurements: Measurement[] = [];
const dockRows: DockRow[] = [];

function px(n: number): Px {
  return (Math.round(n * 100) / 100) as Px;
}

async function measure(name: ElementName, viewport: ViewportLabel, target: Locator): Promise<Measurement> {
  await expect(target, `${name} must be visible to be measured`).toBeVisible();
  const box = await target.boundingBox();
  expect(box, `${name} has no bounding box at ${viewport}`).not.toBeNull();
  const m: Measurement = {
    element: name,
    viewport,
    width: px(box!.width),
    height: px(box!.height),
    right: px(box!.x + box!.width),
  };
  measurements.push(m);
  return m;
}

async function nameOf(target: Locator, fallback: ElementName): Promise<ElementName> {
  const label = await target.getAttribute('aria-label');
  if (label) return label as ElementName;
  const title = await target.getAttribute('title');
  if (title) return title.split(' (')[0] as ElementName;
  const text = (await target.innerText()).trim();
  return (text || fallback) as ElementName;
}

async function measureEach(
  group: Locator,
  viewport: ViewportLabel,
  prefix: ElementName,
): Promise<void> {
  const count = await group.count();
  for (let i = 0; i < count; i += 1) {
    const item = group.nth(i);
    const name = await nameOf(item, `${prefix} #${i}` as ElementName);
    await measure(`${prefix}: ${name}` as ElementName, viewport, item);
  }
}

/** Waits for the app shell; the dock only renders once the editor mounted. */
async function openRoom(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.locator('.ProseMirror').waitFor({ timeout: 30_000 });
}

/** `overflow-x: auto` hides a row that does not fit; scrollWidth vs clientWidth is the only tell. */
async function measureRow(row: Locator, name: ElementName, viewport: ViewportLabel): Promise<DockRow> {
  const raw = await row.evaluate((el) => {
    const style = getComputedStyle(el);
    const gap = parseFloat(style.columnGap === 'normal' ? '0' : style.columnGap);
    const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    const kids = Array.from(el.children) as HTMLElement[];
    const controls = kids
      .filter((k) => !k.classList.contains('dock-fill'))
      .reduce((sum, k) => sum + k.getBoundingClientRect().width, 0);
    return {
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      controlsWidth: controls + gap * Math.max(kids.length - 1, 0) + padding,
    };
  });
  const measured: DockRow = {
    row: name,
    viewport,
    scrollWidth: px(raw.scrollWidth),
    clientWidth: px(raw.clientWidth),
    controlsWidth: px(raw.controlsWidth),
    // 1px slack: sub-pixel layout rounds scrollWidth up on a row that in fact fits.
    overflows: (raw.scrollWidth > raw.clientWidth + 1) as Overflows,
  };
  dockRows.push(measured);
  return measured;
}

function dockRow(page: Page, viewport: ViewportLabel): Promise<DockRow> {
  return measureRow(page.locator('.mobile-dock'), '.mobile-dock' as ElementName, viewport);
}

async function measureDock(page: Page, viewport: ViewportLabel): Promise<void> {
  const dock = page.locator('.mobile-dock');
  await expect(dock).toBeVisible();

  await measure('dock: identity avatar' as ElementName, viewport, dock.locator('.identity-btn'));
  await measure('dock: status pill (plain)' as ElementName, viewport, dock.locator('.chip'));
  await measureEach(dock.locator('.dock-btn'), viewport, 'dock' as ElementName);
  await measure('dock: Share chip' as ElementName, viewport, dock.locator('.dock-share'));

  await dockRow(page, viewport);
}

function report(): void {
  if (measurements.length === 0 && dockRows.length === 0) return;
  const lines = [
    '',
    '=== MEASURED (Playwright boundingBox) ===',
    'element | viewport | width x height | >=44px?',
  ];
  for (const m of measurements) {
    const pass = m.width >= TOUCH_FLOOR && m.height >= TOUCH_FLOOR ? 'yes' : 'NO';
    lines.push(`${m.element} | ${m.viewport} | ${m.width} x ${m.height} | ${pass} (right edge ${m.right})`);
  }
  lines.push('--- scrolling rows ---');
  lines.push('row | viewport | controls width | scrollWidth | clientWidth | overflows?');
  for (const d of dockRows) {
    lines.push(
      `${d.row} | ${d.viewport} | ${d.controlsWidth} | ${d.scrollWidth} | ${d.clientWidth} | ${d.overflows ? 'YES' : 'no'}`,
    );
  }
  lines.push('=== END MEASURED ===', '');
  console.log(lines.join('\n'));
}

test.afterAll(() => {
  report();
});

for (const width of [320, 390] as const) {
  const viewport = `${width}px` as ViewportLabel;

  test.describe(`mobile dock at ${width}px`, () => {
    test.use({ viewport: { width, height: 664 }, isMobile: true, hasTouch: true });

    test('measures every dock control, plain status pill', async ({ page }) => {
      await openRoom(page, `/?room=measure-dock-plain-${width}`);
      await expect(page.locator('.mobile-dock .chip .seg.secure')).toHaveCount(0);
      await measureDock(page, viewport);
    });

    test('measures the status pill in its encrypted state', async ({ page }) => {
      // `#k=` is the room key a real "New document" link carries; it is what turns the
      // extra "Encrypted" segment on (App.svelte roomEncrypted -> StatusPill `encrypted`).
      await openRoom(page, `/?room=measure-dock-enc-${width}#k=measure-key-${width}`);
      const pill = page.locator('.mobile-dock .chip');
      await expect(pill.locator('.seg.secure')).toHaveCount(1);
      await measure('dock: status pill (encrypted)' as ElementName, viewport, pill);
      await dockRow(page, `${width}px encrypted` as ViewportLabel);
    });

    test('measures the formatting toolbar buttons', async ({ page }) => {
      await openRoom(page, `/?room=measure-toolbar-${width}`);
      // The toolbar replaces the dock only once the editor has focus, and the write gate
      // keeps a solo room non-editable until the escape hatch is taken.
      const writeSolo = page.getByRole('button', { name: 'Write alone anyway' });
      await expect(writeSolo).toBeVisible({ timeout: 30_000 });
      await writeSolo.click();
      await page.locator('.ProseMirror').click();

      const toolbar = page.locator('.fixed-toolbar.editing .toolbar');
      await expect(toolbar).toBeVisible();
      await measure('toolbar: row' as ElementName, viewport, toolbar);
      await measureEach(toolbar.locator('button'), viewport, 'toolbar' as ElementName);
      await measureRow(toolbar, '.fixed-toolbar .toolbar' as ElementName, viewport);
    });
  });
}

test.describe('header capsule on a fine-pointer viewport', () => {
  // The capsule is hidden under `pointer: coarse` or below 900px — both must be avoided.
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });

  test('measures the capsule and its controls', async ({ page }) => {
    const viewport = '1280px (desktop)' as ViewportLabel;
    await openRoom(page, '/?room=measure-capsule');
    const capsule = page.locator('header.capsule');
    await expect(capsule).toBeVisible();

    await measure('capsule: total' as ElementName, viewport, capsule);
    await measure('capsule: theme toggle (.cap-theme button)' as ElementName, viewport, capsule.locator('.cap-theme button'));
    await measure('capsule: identity avatar' as ElementName, viewport, capsule.locator('.identity-btn'));
    await measure('capsule: status pill' as ElementName, viewport, capsule.locator('.chip'));
    await measure('capsule: Share chip' as ElementName, viewport, capsule.locator('.cap-share'));
    await measureEach(capsule.locator('.cap-btn'), viewport, 'capsule' as ElementName);
  });
});

/*
 * The durable gate #291 asks for. Skipped, not deleted: the numbers above show today's UI
 * fails it, and #287 is the change that makes it pass. Drop `.fixme` when #287 lands.
 */
test.describe.fixme('touch-target floor of 44px (#291) — enable with #287', () => {
  for (const width of [320, 390] as const) {
    test.describe(`at ${width}px`, () => {
      test.use({ viewport: { width, height: 664 }, isMobile: true, hasTouch: true });

      test('every dock control clears 44x44 and the row does not overflow', async ({ page }) => {
        await openRoom(page, `/?room=gate-dock-${width}`);
        const dock = page.locator('.mobile-dock');
        const controls = dock.locator('.identity-btn, .chip, .dock-btn, .dock-share');
        const count = await controls.count();
        expect(count).toBeGreaterThan(0);
        for (let i = 0; i < count; i += 1) {
          const item = controls.nth(i);
          const name = await nameOf(item, `dock control #${i}` as ElementName);
          const box = await item.boundingBox();
          expect(box, `${name} has no bounding box`).not.toBeNull();
          expect(box!.width, `${name} width`).toBeGreaterThanOrEqual(TOUCH_FLOOR);
          expect(box!.height, `${name} height`).toBeGreaterThanOrEqual(TOUCH_FLOOR);
          expect(box!.x + box!.width, `${name} right edge`).toBeLessThanOrEqual(page.viewportSize()!.width);
        }

        const row = await dockRow(page, `${width}px gate` as ViewportLabel);
        expect(row.overflows, 'the dock row overflows its container').toBe(false);
      });
    });
  }
});
