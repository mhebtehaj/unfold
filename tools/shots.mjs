#!/usr/bin/env node
// Golden baseline harness.
//
//   node tools/shots.mjs --update        capture and overwrite the baseline
//   node tools/shots.mjs                 capture and compare against it
//   node tools/shots.mjs --only <prefix> restrict to matching state ids
//   node tools/shots.mjs --no-png        semantic capture only (fast)
//
// Semantic goldens are captured once per state in the light theme; geometry
// does not depend on theme, and resolved paint is covered by the token audit
// plus the PNG pass. PNGs are captured for 'full' states in both themes.

import { chromium } from 'playwright';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { serve, CHROMIUM } from './lib/serve.mjs';
import { CAPTURE, TOKENS } from './lib/capture.mjs';
import { comparePNG, isNoise, DETERMINISTIC_ARGS } from './lib/imagediff.mjs';
import { locate } from './lib/port-map.mjs';
import { STATES, WIDTHS, THEMES, RESPONSIVE } from './states.mjs';

const argv = process.argv.slice(2);
const flag = f => argv.includes(f);
const opt = f => { const i = argv.indexOf(f); return i < 0 ? null : argv[i + 1]; };

const UPDATE = flag('--update');
const NO_PNG = flag('--no-png');
const TOKENS_ONLY = flag('--tokens-only');
const ONLY = opt('--only');
const OUT = 'baseline';
const DESKTOP = WIDTHS[0];

const states = ONLY ? STATES.filter(s => s.id.startsWith(ONLY)) : STATES;
if (!states.length) { console.error(`no states match ${ONLY}`); process.exit(1); }

const srv = await serve('.');
const browser = await chromium.launch({ executablePath: CHROMIUM, args: DETERMINISTIC_ARGS });
// A scratch page used only to decode and diff PNGs.
const differ = await (await browser.newContext()).newPage();

const pageErrors = [];
const results = { captured: 0, changed: [], added: [], errors: [], noise: 0, diffs: [] };

/**
 * Apply one step, in the main document or the sandboxed iframe. A selector
 * that matches nothing on the page (the engine port of the homotopy explorer,
 * whose ids are generated) resolves through tools/lib/port-map.mjs — and only
 * then — so the same state list drives the frozen original and the port.
 */
async function applyStep(ctx, [action, sel, value]) {
  const el = action === 'wait' ? null : (await locate(ctx, sel)).locator;
  switch (action) {
    case 'select': await el.selectOption(String(value)); break;
    case 'range':
      // Range inputs are driven by 'input' events, not by typing.
      await el.evaluate((node, v) => {
        node.value = v;
        node.dispatchEvent(new Event('input', { bubbles: true }));
        node.dispatchEvent(new Event('change', { bubbles: true }));
      }, String(value));
      break;
    case 'check':
      await el.evaluate((node, v) => {
        if (node.checked !== v) {
          node.checked = v;
          node.dispatchEvent(new Event('change', { bubbles: true }));
          node.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }, Boolean(value));
      break;
    case 'click': await el.click({ timeout: 4000 }); break;
    case 'wait': await ctx.waitForTimeout(Number(value)); break;
    default: throw new Error(`unknown step ${action}`);
  }
}

/** Wait until the drawn geometry stops changing (camera eases, rAF loops). */
async function settle(ctx, tries = 24, gap = 70) {
  let prev = null;
  for (let i = 0; i < tries; i++) {
    const now = await ctx.evaluate(() => {
      let s = '';
      for (const svg of document.querySelectorAll('svg')) {
        s += svg.getAttribute('viewBox') ?? '';
        for (const a of svg.attributes) if (a.name.startsWith('data-')) s += a.value;
        s += svg.querySelectorAll('circle,path,line,rect,text,polygon,polyline').length;
        const f = svg.querySelector('path,circle,line');
        if (f) s += (f.getAttribute('d') ?? f.getAttribute('cx') ?? f.getAttribute('x1') ?? '');
      }
      return s;
    }).catch(() => null);
    if (now !== null && now === prev) return true;
    prev = now;
    await ctx.waitForTimeout(gap);
  }
  return false;
}

const ctxFor = (page, state) => {
  if (state.frame !== 'iframe') return page;
  const f = page.frames().find(fr => fr !== page.mainFrame());
  if (!f) throw new Error('iframe not found');
  return f;
};

/**
 * Text goldens compare exactly. PNGs compare by pixels with a tolerance,
 * because headless rasterisation of SVG antialiasing is not byte-stable: with
 * the DOM in an identical state, successive screenshots alternate between two
 * encodings differing by a few subpixel values. A byte gate reports that as a
 * regression, every run, until nobody reads it.
 */
async function writeIfChanged(path, body, binary = false) {
  await mkdir(dirname(path), { recursive: true });
  const exists = existsSync(path);

  if (!exists) {
    results.added.push(path);
    await writeFile(path, body);
    return;
  }

  const old = await readFile(path);
  let same;
  if (!binary) {
    same = old.toString() === body;
  } else if (old.equals(body)) {
    same = true;
  } else {
    const diff = await comparePNG(differ, old, body, 0).catch(() => null);
    if (!diff) same = false;
    else if (isNoise(diff)) { same = true; results.noise++; }
    else {
      same = false;
      results.diffs.push({ path, diff });
      if (diff.image) {
        const png = Buffer.from(diff.image.split(',')[1], 'base64');
        const at = join(OUT, 'diff', relative(join(OUT, 'png'), path));
        await mkdir(dirname(at), { recursive: true });
        await writeFile(at, png);
      }
    }
  }

  if (!same) results.changed.push(path);
  if (UPDATE && !same) await writeFile(path, body);
}

// ---------------------------------------------------------------- run -------
const byPage = new Map();
for (const s of states) {
  if (!byPage.has(s.page)) byPage.set(s.page, []);
  byPage.get(s.page).push(s);
}

const t0 = Date.now();
for (const [pageName, group] of byPage) {
  for (const theme of THEMES) {
    // Semantic capture happens in light only; dark contributes PNGs and tokens.
    const need = TOKENS_ONLY ? [] : (theme === 'light' ? group
      : (NO_PNG ? [] : group.filter(s => s.tier === 'full')));
    if (!need.length && !TOKENS_ONLY) continue;

    const context = await browser.newContext({
      viewport: { width: DESKTOP.width, height: DESKTOP.height },
      colorScheme: theme,
      deviceScaleFactor: 1,
      reducedMotion: 'no-preference',
    });
    const page = await context.newPage();
    page.on('pageerror', e => pageErrors.push(`${pageName}: ${e}`));

    for (const state of need) {
      try {
        await page.goto(`${srv.url}/${pageName}`, { waitUntil: 'load' });
        await page.waitForTimeout(150);
        const ctx = ctxFor(page, state);
        for (const step of state.steps) await applyStep(ctx, step);
        await settle(ctx);

        if (theme === 'light') {
          const data = await ctx.evaluate(CAPTURE, { dp: 2 });
          await writeIfChanged(join(OUT, 'semantic', `${state.id}.json`),
            JSON.stringify(data, null, 1));
          results.captured++;
        }
        if (state.tier === 'full' && !NO_PNG) {
          const png = await page.screenshot({ fullPage: true, animations: 'disabled' });
          await writeIfChanged(join(OUT, 'png', theme, `${state.id}.png`), png, true);
        }
      } catch (e) {
        results.errors.push(`${state.id} [${theme}]: ${String(e).split('\n')[0]}`);
      }
    }

    // Token audit: one per page per theme.
    try {
      await page.goto(`${srv.url}/${pageName}`, { waitUntil: 'load' });
      await page.waitForTimeout(150);
      const main = await page.evaluate(TOKENS);
      let frame = null;
      const f = page.frames().find(fr => fr !== page.mainFrame());
      if (f) frame = await f.evaluate(TOKENS).catch(() => null);
      await writeIfChanged(join(OUT, 'tokens', `${pageName}.${theme}.json`),
        JSON.stringify({ main, frame }, null, 1));
    } catch (e) { results.errors.push(`tokens ${pageName} ${theme}: ${e}`); }

    await context.close();
  }
  process.stdout.write(`  ${pageName}: ${group.length} states\n`);
}

// ------------------------------------------------- responsive PNG sweep -----
if (!NO_PNG && !TOKENS_ONLY) {
  const resp = states.filter(s => RESPONSIVE.includes(s.id));
  for (const state of resp) for (const theme of THEMES) for (const w of WIDTHS.slice(1)) {
    const context = await browser.newContext({
      viewport: { width: w.width, height: w.height },
      colorScheme: theme, deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    try {
      await page.goto(`${srv.url}/${state.page}`, { waitUntil: 'load' });
      await page.waitForTimeout(150);
      const ctx = ctxFor(page, state);
      for (const step of state.steps) await applyStep(ctx, step);
      await settle(ctx);
      const png = await page.screenshot({ fullPage: true, animations: 'disabled' });
      await writeIfChanged(join(OUT, 'png', theme, `${state.id}@${w.name}.png`), png, true);
    } catch (e) {
      results.errors.push(`${state.id} @${w.name} ${theme}: ${String(e).split('\n')[0]}`);
    }
    await context.close();
  }
  if (resp.length) process.stdout.write(`  responsive: ${resp.length} states x 2 widths x 2 themes\n`);
}

await browser.close();
await srv.close();

// ---------------------------------------------------------------- report ----
const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`\n${UPDATE ? 'updated' : 'checked'} ${results.captured} semantic states in ${secs}s`);
if (results.added.length) console.log(`  new:     ${results.added.length}`);
if (results.noise) console.log(`  ${results.noise} screenshot(s) differed only as rasteriser noise (ignored)`);
if (results.changed.length) {
  console.log(`  CHANGED: ${results.changed.length}`);
  const byPath = new Map(results.diffs.map(d => [d.path, d.diff]));
  for (const p of results.changed.slice(0, 40)) {
    const d = byPath.get(p);
    if (!d) { console.log(`    ${p}`); continue; }
    if (d.sizeMismatch) { console.log(`    ${p}  size ${d.a} -> ${d.b}`); continue; }
    console.log(`    ${p}  ${(d.ratio * 100).toFixed(3)}% of pixels, max delta ${d.maxDelta}` +
                (d.box ? `, region ${d.box.join(',')}` : ''));
  }
  if (results.changed.length > 40) console.log(`    ...and ${results.changed.length - 40} more`);
  if (results.diffs.length) console.log(`  diff images written to ${join(OUT, 'diff')}/`);
}
if (pageErrors.length) {
  const uniq = [...new Set(pageErrors)];
  console.log(`  page errors: ${uniq.length}`);
  for (const e of uniq.slice(0, 10)) console.log(`    ${e}`);
}
if (results.errors.length) {
  console.log(`  HARNESS ERRORS: ${results.errors.length}`);
  for (const e of results.errors.slice(0, 20)) console.log(`    ${e}`);
}
const bad = results.changed.length || results.errors.length;
process.exit(!UPDATE && bad ? 1 : 0);
