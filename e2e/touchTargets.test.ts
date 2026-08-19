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
/** #291's widest pill decision (a) can carry at 320px. */
const PILL_CEILING = 106.41 as Px;

type SegmentText = string & { readonly _brand: 'SegmentText' };
type StateLabels = string & { readonly _brand: 'StateLabels' };
type HowReached = string & { readonly _brand: 'HowReached' };
type Provenance = 'observed' | 'constructed';
type RoomFragment = string & { readonly _brand: 'RoomFragment' };
type VariantName = string & { readonly _brand: 'VariantName' };

interface PillState {
  readonly labels: StateLabels;
  readonly how: HowReached;
  readonly provenance: Provenance;
  readonly viewport: ViewportLabel;
  readonly width: Px;
  readonly labelBoxWidth: Px;
}

interface Variant {
  readonly name: VariantName;
  readonly fragment: RoomFragment;
  readonly tail: readonly SegmentText[];
}

const VARIANTS: readonly Variant[] = [
  { name: 'plain' as VariantName, fragment: '' as RoomFragment, tail: [] },
  // `#k=` is the room key a real "New document" link carries; it turns the "Encrypted" segment on.
  { name: 'encrypted' as VariantName, fragment: '#k=pill-state-key' as RoomFragment, tail: ['Encrypted' as SegmentText] },
];

const pillStates: PillState[] = [];

interface Measurement {
  readonly element: ElementName;
  readonly viewport: ViewportLabel;
  readonly width: Px;
  readonly height: Px;
  readonly right: Px;
}

interface CapsuleRow {
  readonly row: ElementName;
  readonly viewport: ViewportLabel;
  readonly scrollWidth: Px;
  readonly clientWidth: Px;
  readonly controlsWidth: Px;
  readonly overflows: Overflows;
}

const measurements: Measurement[] = [];
const capsuleRows: CapsuleRow[] = [];

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

/** Waits for the app shell; the mobile capsule only renders once the editor mounted. */
async function openRoom(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.locator('.ProseMirror').waitFor({ timeout: 30_000 });
}

/** `overflow-x: auto` hides a row that does not fit; scrollWidth vs clientWidth is the only tell. */
async function measureRow(row: Locator, name: ElementName, viewport: ViewportLabel): Promise<CapsuleRow> {
  const raw = await row.evaluate((el) => {
    const style = getComputedStyle(el);
    const gap = parseFloat(style.columnGap === 'normal' ? '0' : style.columnGap);
    const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    const kids = Array.from(el.children) as HTMLElement[];
    const controls = kids
      .filter((k) => !k.classList.contains('cap-fill'))
      .reduce((sum, k) => sum + k.getBoundingClientRect().width, 0);
    return {
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      controlsWidth: controls + gap * Math.max(kids.length - 1, 0) + padding,
    };
  });
  const measured: CapsuleRow = {
    row: name,
    viewport,
    scrollWidth: px(raw.scrollWidth),
    clientWidth: px(raw.clientWidth),
    controlsWidth: px(raw.controlsWidth),
    // 1px slack: sub-pixel layout rounds scrollWidth up on a row that in fact fits.
    overflows: (raw.scrollWidth > raw.clientWidth + 1) as Overflows,
  };
  capsuleRows.push(measured);
  return measured;
}

function capsuleRow(page: Page, viewport: ViewportLabel): Promise<CapsuleRow> {
  return measureRow(page.locator('.mobile-capsule'), '.mobile-capsule' as ElementName, viewport);
}

async function measureMobileCapsule(page: Page, viewport: ViewportLabel): Promise<void> {
  const capsule = page.locator('.mobile-capsule');
  await expect(capsule).toBeVisible();

  await measure('mobile capsule: identity avatar' as ElementName, viewport, capsule.locator('.identity-btn'));
  await measure('mobile capsule: status pill (plain)' as ElementName, viewport, capsule.locator('.chip'));
  await measureEach(capsule.locator('.cap-btn'), viewport, 'mobile capsule' as ElementName);
  await measure('mobile capsule: Share chip' as ElementName, viewport, capsule.locator('.cap-share'));

  await capsuleRow(page, viewport);
}

function mobileCapsulePill(page: Page): Locator {
  return page.locator('.mobile-capsule .chip');
}

/**
 * Below 720px `.seg-label` is clipped to 1px, so a state is identified by label text the
 * layout never pays for — hence `allTextContents()` rather than a visible-text assertion.
 */
async function measurePillState(
  page: Page,
  viewport: ViewportLabel,
  expected: readonly SegmentText[],
  how: HowReached,
  provenance: Provenance = 'observed',
): Promise<void> {
  const pill = mobileCapsulePill(page);
  const labels = expected.join(' + ') as StateLabels;
  await expect
    .poll(async () => (await pill.locator('.seg-label').allTextContents()).map((t) => t.trim()), {
      timeout: 30_000,
      message: `pill never reached ${labels}`,
    })
    .toEqual([...expected]);
  const m = await measure(`pill: ${labels}` as ElementName, viewport, pill);
  const labelBox = await pill.locator('.seg-label').first().boundingBox();
  pillStates.push({
    labels,
    how,
    provenance,
    viewport,
    width: m.width,
    labelBoxWidth: px(labelBox?.width ?? 0),
  });
}

/** No signaling socket ever opens: the pill sits on Connecting, then times out to Can't connect. */
async function blockSignaling(page: Page): Promise<void> {
  await page.routeWebSocket((url) => url.port === '4444', (ws) => ws.close());
}

const DAV_PATH = '/dav';

/**
 * A stand-in WebDAV server: the only storage backend whose login is a plain fetch, so the
 * durability segment's states are driven through the real Settings flow and a real save.
 */
async function mockWebdav(page: Page, putStatus: number, putDelayMs: number): Promise<void> {
  await page.route(
    (url) => url.pathname === DAV_PATH || url.pathname.startsWith(`${DAV_PATH}/`),
    async (route) => {
      if (route.request().method() !== 'PUT') return route.fulfill({ status: 404, body: '' });
      if (putDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, putDelayMs));
      return route.fulfill({ status: putStatus, body: '' });
    },
  );
}

async function openStorageSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Storage', exact: true }).click();
  const tile = page.getByRole('button', { name: 'WebDAV / Nextcloud' });
  await tile.click();
}

/** Field help text repeats other fields' names, so the label span is matched whole. */
function settingsField(page: Page, label: string): Locator {
  return page
    .locator('label.field')
    .filter({ has: page.locator('.field-label', { hasText: new RegExp(`^\\s*${label}\\s*$`) }) })
    .locator('input');
}

async function connectWebdav(page: Page): Promise<void> {
  await openStorageSettings(page);
  const field = (label: string): Locator => settingsField(page, label);
  await field('WebDAV folder URL').fill(new URL(DAV_PATH, page.url()).href);
  await field('Username').fill('measure');
  await field('App password').fill('measure');
  await page.getByRole('button', { name: 'Connect WebDAV / Nextcloud' }).click();
  await expect(page.getByRole('button', { name: 'Disconnect' })).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press('Escape');
  await expect(mobileCapsulePill(page)).toBeVisible();
}

/** Blurring after typing lets any pending save settle before the next pill read. */
async function typeThenLeaveEditor(page: Page): Promise<void> {
  // Attached storage satisfies the write gate on its own, so the escape hatch may not be there.
  const writeSolo = page.getByRole('button', { name: 'Write alone anyway' });
  if (await writeSolo.isVisible()) await writeSolo.click();
  const editor = page.locator('.ProseMirror[contenteditable="true"]');
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await editor.click();
  await page.keyboard.type('measuring the pill');
  await editor.evaluate((el) => (el as HTMLElement).blur());
}

function report(): void {
  if (measurements.length === 0 && capsuleRows.length === 0) return;
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
  for (const d of capsuleRows) {
    lines.push(
      `${d.row} | ${d.viewport} | ${d.controlsWidth} | ${d.scrollWidth} | ${d.clientWidth} | ${d.overflows ? 'YES' : 'no'}`,
    );
  }
  lines.push('--- status pill states (#292) vs the 106.41px ceiling (#291) ---');
  lines.push('state | reached | provenance | viewport | width | label box | <= 106.41?');
  for (const s of pillStates) {
    lines.push(
      `${s.labels} | ${s.how} | ${s.provenance} | ${s.viewport} | ${s.width} | ${s.labelBoxWidth} | ${s.width <= PILL_CEILING ? 'yes' : 'NO'}`,
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

  test.describe(`mobile capsule at ${width}px`, () => {
    test.use({ viewport: { width, height: 664 }, isMobile: true, hasTouch: true });

    test('measures every mobile capsule control, plain status pill', async ({ page }) => {
      await openRoom(page, `/?room=measure-capsule-plain-${width}`);
      await expect(page.locator('.mobile-capsule .chip .seg.secure')).toHaveCount(0);
      await measureMobileCapsule(page, viewport);
    });

    test('measures the status pill in its encrypted state', async ({ page }) => {
      // `#k=` is the room key a real "New document" link carries; it is what turns the
      // extra "Encrypted" segment on (App.svelte roomEncrypted -> StatusPill `encrypted`).
      await openRoom(page, `/?room=measure-capsule-enc-${width}#k=measure-key-${width}`);
      const pill = page.locator('.mobile-capsule .chip');
      await expect(pill.locator('.seg.secure')).toHaveCount(1);
      await measure('mobile capsule: status pill (encrypted)' as ElementName, viewport, pill);
      await capsuleRow(page, `${width}px encrypted` as ViewportLabel);
    });

    for (const v of VARIANTS) {
      const room = (name: string): string => `/?room=${name}-${v.name}-${width}${v.fragment}`;
      const state = (...segs: readonly SegmentText[]): readonly SegmentText[] => [...segs, ...v.tail];

      test(`measures the pill while the signaling server never answers (${v.name})`, async ({ page }) => {
        await blockSignaling(page);
        await openRoom(page, room('pill-unreachable'));
        await measurePillState(
          page,
          viewport,
          state('Connecting…' as SegmentText, 'Not saved' as SegmentText),
          'signaling socket closed on open' as HowReached,
        );
        await measurePillState(
          page,
          viewport,
          state("Can't connect" as SegmentText, 'Not saved' as SegmentText),
          'same, past CONNECT_TIMEOUT_MS' as HowReached,
        );
      });

      test(`measures the pill with the network down (${v.name})`, async ({ page, context }) => {
        await openRoom(page, room('pill-offline'));
        await context.setOffline(true);
        await measurePillState(
          page,
          viewport,
          state('Offline' as SegmentText, 'Not saved' as SegmentText),
          'context.setOffline(true)' as HowReached,
        );
      });

      // A second tab of the same browser is a real peer: y-webrtc counts its BroadcastChannel
      // connection, so this needs no WebRTC media path to reach Connected.
      test(`measures the pill with a peer in the room (${v.name})`, async ({ page, context }) => {
        const url = room('pill-connected');
        await openRoom(page, url);
        const peer = await context.newPage();
        try {
          await openRoom(peer, url);
          await measurePillState(
            page,
            viewport,
            state('Direct' as SegmentText, 'Not saved' as SegmentText),
            'a second tab joined the room' as HowReached,
          );
        } finally {
          await peer.close();
        }
      });
    }

    // The app's service worker serves fetches outside `page.route`'s reach, so the WebDAV
    // stand-in only answers with it blocked.
    test.describe('with a stand-in WebDAV server', () => {
      test.use({ serviceWorkers: 'block' });

      for (const v of VARIANTS) {
        const room = (name: string): string => `/?room=${name}-${v.name}-${width}${v.fragment}`;
        const state = (...segs: readonly SegmentText[]): readonly SegmentText[] => [...segs, ...v.tail];

        test(`measures the pill while a save is in flight and lands (${v.name})`, async ({ page }) => {
          await mockWebdav(page, 201, 2_500);
          await openRoom(page, room('pill-saving'));
          await connectWebdav(page);
          await measurePillState(
            page,
            viewport,
            state('Waiting' as SegmentText, 'Saved' as SegmentText),
            'WebDAV connected in Settings, nothing written yet' as HowReached,
          );
          await typeThenLeaveEditor(page);
          await measurePillState(
            page,
            viewport,
            state('Waiting' as SegmentText, 'Saving…' as SegmentText),
            'edit with the mock WebDAV PUT held 2.5s' as HowReached,
          );
          await measurePillState(
            page,
            viewport,
            state('Waiting' as SegmentText, 'Saved' as SegmentText),
            'the same PUT answering 201' as HowReached,
          );
        });

        test(`measures the pill after a failed save (${v.name})`, async ({ page }) => {
          await mockWebdav(page, 500, 0);
          await openRoom(page, room('pill-save-failed'));
          await connectWebdav(page);
          await typeThenLeaveEditor(page);
          await measurePillState(
            page,
            viewport,
            state('Waiting' as SegmentText, 'Save failed' as SegmentText),
            'edit with the mock WebDAV PUT answering 500' as HowReached,
          );
        });

        test(`measures the pill with two rooms saving to one file (${v.name})`, async ({ page }) => {
          await mockWebdav(page, 201, 0);
          const first = `pill-conflict-a-${v.name}-${width}`;
          await openRoom(page, `/?room=${first}${v.fragment}`);
          await connectWebdav(page);

          await openRoom(page, room('pill-conflict-b'));
          // Reconnecting is what adds a second room to the saved set; the file name then collides.
          await openStorageSettings(page);
          await page.getByRole('button', { name: 'Disconnect' }).click();
          await page.keyboard.press('Escape');
          await connectWebdav(page);
          await openStorageSettings(page);
          await settingsField(page, 'File name \\(this room\\)').fill(`${first}.yjs`);
          await page.keyboard.press('Escape');

          await measurePillState(
            page,
            viewport,
            state('Waiting' as SegmentText, 'Conflict' as SegmentText),
            'a second saved room renamed onto the first room\'s file' as HowReached,
          );
        });
      }
    });

    test('measures the formatting toolbar buttons', async ({ page }) => {
      await openRoom(page, `/?room=measure-toolbar-${width}`);
      // The toolbar only appears once the editor has focus, and the write gate
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
    // The room now mounts a hidden .mobile-capsule sibling at every viewport (App.svelte) —
    // :visible picks out whichever of the two the current breakpoint actually shows.
    const capsule = page.locator('header.capsule:visible');
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

      test('every mobile capsule control clears 44x44 and the row does not overflow', async ({ page }) => {
        await openRoom(page, `/?room=gate-capsule-${width}`);
        const capsule = page.locator('.mobile-capsule');
        const controls = capsule.locator('.identity-btn, .chip, .cap-btn, .cap-share');
        const count = await controls.count();
        expect(count).toBeGreaterThan(0);
        for (let i = 0; i < count; i += 1) {
          const item = controls.nth(i);
          const name = await nameOf(item, `capsule control #${i}` as ElementName);
          const box = await item.boundingBox();
          expect(box, `${name} has no bounding box`).not.toBeNull();
          expect(box!.width, `${name} width`).toBeGreaterThanOrEqual(TOUCH_FLOOR);
          expect(box!.height, `${name} height`).toBeGreaterThanOrEqual(TOUCH_FLOOR);
          expect(box!.x + box!.width, `${name} right edge`).toBeLessThanOrEqual(page.viewportSize()!.width);
        }

        const row = await capsuleRow(page, `${width}px gate` as ViewportLabel);
        expect(row.overflows, 'the mobile capsule row overflows its container').toBe(false);
      });
    });
  }
});
