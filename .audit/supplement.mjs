import { chromium } from 'playwright';
import fs from 'node:fs';

const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = 'http://localhost:4173/';
const OUT = '/tmp/claude-0/-home-user-copad/507fb634-b1a6-5326-ad13-2dcd60927e83/scratchpad/shots';

const DEVICES = {
  desktop: { viewport: { width: 1440, height: 900 }, hasTouch: false, isMobile: false, dpr: 1 },
  mobile: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, dpr: 3 },
};
const device = process.argv[2] || 'desktop';
const cfg = DEVICES[device];

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });

async function fresh() {
  const ctx = await browser.newContext({ viewport: cfg.viewport, hasTouch: cfg.hasTouch, isMobile: cfg.isMobile, deviceScaleFactor: cfg.dpr });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(900);
  // dismiss intro
  const got = page.locator('button:has-text("Got it")').first();
  if (await got.count()) await got.click().catch(() => {});
  await page.waitForTimeout(200);
  return { ctx, page };
}
async function writeSolo(page) {
  const b = page.locator('button:has-text("Write on your own")').first();
  if (await b.count()) await b.click().catch(() => {});
  await page.waitForTimeout(200);
  // dismiss info banner
  const d = page.locator('button[aria-label="Dismiss"]').first();
  if (await d.count()) await d.click().catch(() => {});
  await page.waitForTimeout(150);
}
async function typeSample(page) {
  const pm = page.locator('.ProseMirror');
  await pm.click({ force: true }).catch(() => {});
  await page.keyboard.type('# Meeting notes\n', { delay: 6 });
  await page.keyboard.type('Visit our site for details and more information about the plan.\n', { delay: 3 });
  await page.keyboard.type('## Section two\nSome text here.\n', { delay: 4 });
  await page.waitForTimeout(200);
}
async function cap(page, slug, full = false) {
  await page.screenshot({ path: `${OUT}/${device}-sup-${slug}.png`, fullPage: full }).catch((e) => console.log('shot fail', slug, String(e).slice(0, 80)));
  console.log('cap', device, slug);
}

// 1) Room switcher open (force click to bypass any hover-intent)
{
  const { ctx, page } = await fresh();
  await page.locator('button[title="Switch room"]').first().click({ force: true }).catch((e) => console.log('rs', String(e).slice(0, 80)));
  await page.waitForTimeout(400);
  await cap(page, 'room-switcher');
  await ctx.close();
}
// 2) Identity menu open
{
  const { ctx, page } = await fresh();
  await page.locator('button[aria-label="Your identity — click to edit"]').first().click({ force: true }).catch((e) => console.log('id', String(e).slice(0, 80)));
  await page.waitForTimeout(400);
  await cap(page, 'identity-menu');
  await ctx.close();
}
// 3) Link popover (Ctrl+K on a selected word)
{
  const { ctx, page } = await fresh();
  await writeSolo(page);
  await typeSample(page);
  const pm = page.locator('.ProseMirror');
  await pm.click({ force: true }).catch(() => {});
  // select the word "site" on line 2 via double-click is unreliable; select whole line 2
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('ArrowDown'); // into line 2
  await page.keyboard.press('Home');
  await page.keyboard.down('Shift');
  await page.keyboard.press('End');
  await page.keyboard.up('Shift');
  await page.waitForTimeout(150);
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(400);
  await cap(page, 'link-popover');
  // type a bad link to test validation
  await page.keyboard.type('notaurl', { delay: 20 });
  await page.waitForTimeout(200);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await cap(page, 'link-popover-badlink');
  await ctx.close();
}
// 4) Outline panel
{
  const { ctx, page } = await fresh();
  await writeSolo(page);
  await typeSample(page);
  const ob = page.locator('button[title="Document outline"]').first();
  if (await ob.count()) { await ob.click({ force: true }).catch(() => {}); await page.waitForTimeout(400); await cap(page, 'outline'); }
  else console.log('no outline button');
  await ctx.close();
}
// 5) Selection toolbar (desktop bubble) / mobile fixed toolbar with selection
{
  const { ctx, page } = await fresh();
  await writeSolo(page);
  await typeSample(page);
  const pm = page.locator('.ProseMirror');
  await pm.click({ force: true }).catch(() => {});
  await page.keyboard.press('Control+Home');
  await page.keyboard.down('Shift');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('End');
  await page.keyboard.up('Shift');
  await page.waitForTimeout(400);
  await cap(page, 'selection-toolbar');
  await ctx.close();
}
// 6) Share dialog: room-password mode + secure link mode
{
  const { ctx, page } = await fresh();
  await page.locator('button[title="Share / invite collaborators"]').first().click({ force: true }).catch(() => {});
  await page.waitForTimeout(500);
  await cap(page, 'share-default');
  // toggle a secure link if a control exists
  const enc = page.locator('button', { hasText: /secure link|encrypt|generate/i }).first();
  if (await enc.count()) { await enc.click({ force: true }).catch(() => {}); await page.waitForTimeout(400); await cap(page, 'share-encrypted'); }
  // type a room password
  const pw = page.locator('input[aria-label="Room password"]').first();
  if (await pw.count()) { await pw.click({ force: true }).catch(() => {}); await pw.fill('hunter2').catch(() => {}); await page.waitForTimeout(300); await cap(page, 'share-roompw'); }
  await ctx.close();
}
// 7) Connection dialog
{
  const { ctx, page } = await fresh();
  await page.locator('button[aria-label="Connection details"]').first().click({ force: true }).catch((e) => console.log('conn', String(e).slice(0, 80)));
  await page.waitForTimeout(500);
  await cap(page, 'connection');
  await ctx.close();
}
// 8) Settings: each backend expanded (full page)
{
  const { ctx, page } = await fresh();
  await page.locator('button[aria-label="Settings"]').first().click({ force: true }).catch(() => {});
  await page.waitForTimeout(500);
  await cap(page, 'settings', true);
  await ctx.close();
}
// 9) New room -> empty state (write gate again, no content)
{
  const { ctx, page } = await fresh();
  await page.locator('button[title="New document"]').first().click({ force: true }).catch(() => {});
  await page.waitForTimeout(600);
  await cap(page, 'new-room');
  await ctx.close();
}

await browser.close();
console.log('SUPPLEMENT DONE', device);
