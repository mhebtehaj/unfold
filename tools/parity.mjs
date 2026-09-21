#!/usr/bin/env node
// Old renderer against new, pixel for pixel.
//
//   node tools/parity.mjs              every case, every width, both schemes
//   node tools/parity.mjs --only glued run the cases whose name contains "glued"
//   node tools/parity.mjs --blend css  draw the engine side through CSS color-mix()
//
// The baseline (tools/shots.mjs) compares a page against its own past. A port
// needs something else: the shipped renderer and the engine's drawing of the
// same state, side by side, now. This drives the shipped page into a state,
// measures the drawing's box, draws the same state in the engine fixture at
// the same box — same size, same sub-pixel offset, so antialiasing lines up —
// and compares the two crops. Any change in any channel of any pixel is a
// failure, and before it reports anything the comparator has to prove it can
// see the smallest such change there is.
//
// Today it holds tests/fixtures/realize.html to the realization explorer's
// "A drawing of |Δ|" panel: Phase 3's proof that the render layer reproduces a
// shipped drawing exactly.

import { chromium } from 'playwright';
import { serve, CHROMIUM } from './lib/serve.mjs';
import { comparePNG, DETERMINISTIC_ARGS } from './lib/imagediff.mjs';
import { CASES as ALL, stateOf } from '../tests/fixtures/realize-cases.mjs';

const argv = process.argv.slice(2);
const opt = f => { const i = argv.indexOf(f); return i < 0 ? null : argv[i + 1]; };
const ONLY = opt('--only');
const BLEND = opt('--blend') ?? 'numeric';
const PRECISION = opt('--precision') == null ? null : Number(opt('--precision'));

const WIDTHS = [{ name: 'desktop', width: 1280, height: 900 }, { name: 'tablet', width: 820, height: 1000 },
                { name: 'phone', width: 390, height: 844 }];
const SCHEMES = ['light', 'dark'];

const CASES = ALL.filter(c => !ONLY || c.name.includes(ONLY));

async function apply(page, [action, sel, value]) {
  if (action === 'click') await page.click(sel);
  else if (action === 'select') await page.selectOption(sel, value);
  else if (action === 'range') await page.locator(sel).evaluate((n, v) => {
    n.value = v; n.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
  else throw new Error(`unknown step ${action}`);
}

const srv = await serve('.');
const browser = await chromium.launch({ executablePath: CHROMIUM, args: DETERMINISTIC_ARGS });
const differ = await (await browser.newContext()).newPage();
let failures = 0, compared = 0;

// "Identical" means nothing unless the comparison can fail. Two 2x2 images one
// level apart in the blue channel must differ in all four pixels.
const [one, two] = (await differ.evaluate(() => [30, 31].map(blue => {
  const c = document.createElement('canvas');
  c.width = c.height = 2;
  const x = c.getContext('2d');
  const img = x.createImageData(2, 2);
  for (let i = 0; i < 16; i += 4) img.data.set([10, 20, blue, 255], i);
  x.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}))).map(u => Buffer.from(u.slice(u.indexOf(',') + 1), 'base64'));
const sanity = await comparePNG(differ, one, two, 0, { metric: 'max' });
if (sanity.changed !== 4) {
  console.error(`parity: the comparator saw ${sanity.changed} of 4 changed pixels; refusing to report`);
  process.exit(2);
}

for (const c of CASES) {
  const state = stateOf(c);
  for (const vp of WIDTHS) for (const scheme of SCHEMES) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, colorScheme: scheme, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.goto(`${srv.url}/realization-carrier-explorer.html`, { waitUntil: 'load' });
    for (const step of c.steps) await apply(page, step);
    const picture = page.locator('#real-picture');
    await picture.scrollIntoViewIfNeeded();
    await page.waitForTimeout(50);
    const box = await picture.evaluate(n => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
    const clip = { x: Math.ceil(box.x), y: Math.ceil(box.y), width: Math.floor(box.x + box.width) - Math.ceil(box.x),
                   height: Math.floor(box.y + box.height) - Math.ceil(box.y) };
    if (clip.width < 20 || clip.height < 20) {
      compared++; failures++;
      console.log(`FAIL ${c.name} @${vp.name} ${scheme}: the drawing measured ${clip.width}x${clip.height}`);
      await context.close();
      continue;
    }
    const before = await page.screenshot({ clip, animations: 'disabled' });

    const fixture = await context.newPage();
    await fixture.goto(`${srv.url}/tests/fixtures/realize.html`, { waitUntil: 'load' });
    await fixture.waitForFunction(() => document.documentElement.dataset.ready === 'true');
    const stats = await fixture.evaluate(([s, b, blend]) => window.__realize.draw(s, { box: b, blend: blend[0], precision: blend[1] }), [state, box, [BLEND, PRECISION]]);
    const after = await fixture.screenshot({ clip, animations: 'disabled' });
    await context.close();

    compared++;
    const d = before.equals(after) ? { changed: 0 } : await comparePNG(differ, before, after, 0, { metric: 'max' });
    const where = `${c.name} @${vp.name} ${scheme}`;
    if (stats.skipped) { failures++; console.log(`FAIL ${where}: the engine skipped the frame (${stats.skipped})`); continue; }
    if (stats.warnings?.length) { failures++; console.log(`FAIL ${where}: scene warnings ${stats.warnings.join('; ')}`); continue; }
    if (d.sizeMismatch) { failures++; console.log(`FAIL ${where}: size ${d.a} vs ${d.b}`); continue; }
    if (d.changed) {
      failures++;
      console.log(`FAIL ${where}: ${d.changed} px differ (${(d.ratio * 100).toFixed(3)}%), max delta ${d.maxDelta}, box ${d.box}`);
    } else {
      console.log(`  ok ${where}: ${clip.width}x${clip.height} identical, ${Object.values(stats.marks).reduce((a, b) => a + b, 0)} marks`);
    }
  }
}
await browser.close();
await srv.close();
console.log(`\n${compared - failures}/${compared} identical (${BLEND} blend)`);
process.exit(failures ? 1 : 0);
