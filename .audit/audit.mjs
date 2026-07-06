import { chromium } from 'playwright';
import fs from 'node:fs';

// ── Config ───────────────────────────────────────────────────────────────────
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = 'http://localhost:4173/';
const OUT = '/tmp/claude-0/-home-user-copad/507fb634-b1a6-5326-ad13-2dcd60927e83/scratchpad/shots';
fs.mkdirSync(OUT, { recursive: true });

const DEVICES = {
  desktop: { viewport: { width: 1440, height: 900 }, hasTouch: false, isMobile: false, dpr: 1 },
  laptop: { viewport: { width: 1280, height: 800 }, hasTouch: false, isMobile: false, dpr: 1 },
  mobile: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, dpr: 3 },
  smallmobile: { viewport: { width: 360, height: 640 }, hasTouch: true, isMobile: true, dpr: 2 },
  tablet: { viewport: { width: 768, height: 1024 }, hasTouch: true, isMobile: true, dpr: 2 },
};

const device = process.argv[2] || 'desktop';
const cfg = DEVICES[device];
if (!cfg) { console.error('unknown device', device); process.exit(1); }

const manifest = { device, viewport: cfg.viewport, steps: [], consoleErrors: [], diagnostics: {} };
let shotN = 0;

// ── Helpers ──────────────────────────────────────────────────────────────────
const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({
  viewport: cfg.viewport,
  hasTouch: cfg.hasTouch,
  isMobile: cfg.isMobile,
  deviceScaleFactor: cfg.dpr,
});
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') manifest.consoleErrors.push(m.text()); });
page.on('pageerror', (e) => manifest.consoleErrors.push('PAGEERROR: ' + e.message));

async function shot(slug, opts = {}) {
  shotN += 1;
  const name = `${device}-${String(shotN).padStart(2, '0')}-${slug}.png`;
  try {
    await page.screenshot({ path: `${OUT}/${name}`, fullPage: !!opts.full });
    manifest.steps.push({ n: shotN, slug, file: name, ok: true, note: opts.note || '' });
  } catch (e) {
    manifest.steps.push({ n: shotN, slug, ok: false, err: String(e).slice(0, 200) });
  }
  return name;
}
async function step(slug, fn, opts = {}) {
  try {
    await fn();
    await page.waitForTimeout(opts.wait ?? 350);
    await shot(slug, opts);
  } catch (e) {
    manifest.steps.push({ n: ++shotN, slug, ok: false, err: String(e).slice(0, 300) });
  }
}
const click = async (sel, o) => page.click(sel, { timeout: 3000, ...o });
const exists = async (sel) => (await page.locator(sel).count()) > 0;

// ── Programmatic diagnostics (touch targets, overflow, a11y) ─────────────────
async function runDiagnostics(label) {
  const d = await page.evaluate(() => {
    const vw = window.innerWidth, vh = window.innerHeight;
    const scroller = document.scrollingElement || document.documentElement;
    const horizOverflow = scroller.scrollWidth - vw;
    // interactive elements
    const sel = 'button, a, input, select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])';
    const els = [...document.querySelectorAll(sel)];
    const small = [], noLabel = [], offscreen = [];
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue; // hidden
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      const label = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
      const tag = el.tagName.toLowerCase();
      const cls = (el.getAttribute('class') || '').slice(0, 40);
      if ((r.width < 44 || r.height < 44)) small.push({ tag, cls, label, w: Math.round(r.width), h: Math.round(r.height) });
      const hasName = !!(el.getAttribute('aria-label') || el.getAttribute('title') || (el.textContent || '').trim() || el.getAttribute('placeholder'));
      const isInput = tag === 'input' || tag === 'textarea' || tag === 'select';
      if (!hasName && !isInput) noLabel.push({ tag, cls });
      if (r.right > vw + 2 || r.left < -2) offscreen.push({ tag, cls, label, left: Math.round(r.left), right: Math.round(r.right) });
    }
    // inputs missing accessible name
    const inputsNoName = [...document.querySelectorAll('input, textarea, select')].filter((el) => {
      if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') return false;
      const id = el.id;
      const hasLabelFor = id && document.querySelector(`label[for="${id}"]`);
      return !(el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title') || el.getAttribute('placeholder') || hasLabelFor);
    }).map((el) => ({ tag: el.tagName.toLowerCase(), type: el.type, cls: (el.getAttribute('class') || '').slice(0, 30) }));
    // heading order
    const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) => h.tagName + ':' + (h.textContent || '').trim().slice(0, 30));
    return { vw, vh, horizOverflow, smallCount: small.length, small: small.slice(0, 40), noLabel, offscreen, inputsNoName, headings };
  });
  manifest.diagnostics[label] = d;
  return d;
}

// ── Flow ─────────────────────────────────────────────────────────────────────
await page.goto(BASE, { waitUntil: 'networkidle' }).catch(() => {});
await page.waitForTimeout(1200);

// 01 — first load (intro dialog over write-gate + info banner)
await shot('first-load-intro');
await runDiagnostics('first-load');

// dismiss intro ("Got it")
await step('after-intro-dismiss', async () => {
  if (await exists('button:has-text("Got it")')) await click('button:has-text("Got it")');
}, { wait: 500 });

// 02 — write-gate visible (region "Waiting for someone to join")
await shot('write-gate');
await runDiagnostics('write-gate');

// dismiss info banner if present
await step('after-banner-dismiss', async () => {
  const b = page.locator('button[aria-label="Dismiss"]').first();
  if (await b.count()) await b.click({ timeout: 2000 }).catch(() => {});
});

// write solo → editor editable
await step('after-write-solo', async () => {
  if (await exists('button:has-text("Write on your own")')) {
    await click('button:has-text("Write on your own")');
  }
}, { wait: 500 });

// type a heading + content
await step('typed-content', async () => {
  const pm = page.locator('.ProseMirror');
  await pm.click({ timeout: 3000 });
  await page.keyboard.type('# Roadmap Q3\n', { delay: 8 });
  await page.keyboard.type('This is the shared meeting note. ', { delay: 4 });
  await page.keyboard.type('We are testing **bold**, and lists.\n', { delay: 4 });
  await page.keyboard.type('## Priorities\n', { delay: 8 });
  await page.keyboard.type('- First item\n', { delay: 6 });
  await page.keyboard.type('Second item\n', { delay: 6 });
  await page.keyboard.type('Third item that is quite a lot longer to test how wrapping behaves in a list item on this viewport width\n', { delay: 2 });
}, { wait: 500 });

// select some text (triggers selection toolbar on desktop)
await step('text-selected', async () => {
  const pm = page.locator('.ProseMirror');
  await pm.click({ timeout: 3000 });
  // select the first heading line
  await page.keyboard.press('Control+Home');
  await page.keyboard.down('Shift');
  await page.keyboard.press('End');
  await page.keyboard.up('Shift');
}, { wait: 500 });

// slash menu
await step('slash-menu', async () => {
  const pm = page.locator('.ProseMirror');
  await pm.click({ timeout: 3000 });
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/', { delay: 20 });
}, { wait: 500 });
// close slash menu
await page.keyboard.press('Escape').catch(() => {});

// outline (needs headings) — toolbar/outline button
await step('outline-open', async () => {
  if (await exists('button[title="Document outline"]')) {
    await click('button[title="Document outline"]');
  }
}, { wait: 400 });
await page.keyboard.press('Escape').catch(() => {});

// link popover via Ctrl+K on a selection
await step('link-popover', async () => {
  const pm = page.locator('.ProseMirror');
  await pm.click({ timeout: 3000 });
  await page.keyboard.press('Control+Home');
  await page.keyboard.down('Shift');
  await page.keyboard.press('End');
  await page.keyboard.up('Shift');
  await page.keyboard.press('Control+k');
}, { wait: 400 });
await page.keyboard.press('Escape').catch(() => {});

// room switcher dropdown
await step('room-switcher-open', async () => {
  if (await exists('button[title="Switch room"]')) await click('button[title="Switch room"]');
}, { wait: 400 });
await page.keyboard.press('Escape').catch(() => {});

// identity menu
await step('identity-menu', async () => {
  if (await exists('button[aria-label="Your identity — click to edit"]')) {
    await click('button[aria-label="Your identity — click to edit"]');
  }
}, { wait: 400 });
await runDiagnostics('identity-open');
await page.keyboard.press('Escape').catch(() => {});
await page.mouse.click(5, 400).catch(() => {});

// share dialog
await step('share-dialog', async () => {
  if (await exists('button[title="Share / invite collaborators"]')) {
    await click('button[title="Share / invite collaborators"]');
  }
}, { wait: 500 });
await runDiagnostics('share-open');
// share: generate secure link
await step('share-secure-link', async () => {
  const b = page.locator('button', { hasText: /secure link|secret link|Generate|Encrypt/i }).first();
  if (await b.count()) await b.click({ timeout: 2000 }).catch(() => {});
}, { wait: 400 });
// close share
await page.keyboard.press('Escape').catch(() => {});
await page.mouse.click(5, 400).catch(() => {});

// connection details dialog
await step('connection-dialog', async () => {
  if (await exists('button[aria-label="Connection details"]')) {
    await click('button[aria-label="Connection details"]');
  }
}, { wait: 500 });
await runDiagnostics('connection-open');
await page.keyboard.press('Escape').catch(() => {});
await page.mouse.click(5, 400).catch(() => {});

// settings drawer
await step('settings-open', async () => {
  if (await exists('button[aria-label="Settings"]')) await click('button[aria-label="Settings"]');
}, { wait: 500 });
await runDiagnostics('settings-open');
await shot('settings-full', { full: true });
// scroll settings to backends
await step('settings-scrolled', async () => {
  await page.evaluate(() => {
    const el = document.querySelector('.settings');
    if (el) el.scrollTop = el.scrollHeight;
  });
}, { wait: 300 });
await page.keyboard.press('Escape').catch(() => {});
await page.mouse.click(5, 400).catch(() => {});

// dark theme
await step('dark-theme', async () => {
  const b = page.locator('button[aria-label="Switch to dark theme"]').first();
  if (await b.count()) await b.click({ timeout: 2000 });
}, { wait: 500 });
await shot('dark-theme-full', { full: true });

// back to light
await step('light-theme', async () => {
  const b = page.locator('button[aria-label="Switch to light theme"]').first();
  if (await b.count()) await b.click({ timeout: 2000 });
}, { wait: 300 });

// full-page editor with content
await shot('editor-full', { full: true });
await runDiagnostics('editor-with-content');

// write manifest
fs.writeFileSync(`${OUT}/../diag-${device}.json`, JSON.stringify(manifest, null, 2));
console.log(`DONE ${device}: ${shotN} shots, ${manifest.consoleErrors.length} console errors`);
console.log('overflow(first-load):', manifest.diagnostics['first-load']?.horizOverflow);
console.log('small targets(first-load):', manifest.diagnostics['first-load']?.smallCount);
await browser.close();
