#!/usr/bin/env node
// Control-surface reconnaissance.
//
//   node tools/probe.mjs                       every page
//   node tools/probe.mjs homotopy-explorer.html
//
// Dumps the live control surface of a page — including inside the sandboxed
// iframe, which the parent document cannot script. Used to author and maintain
// tools/states.mjs against ground truth rather than against grep.
//
// Several behaviours in these pages are only discoverable this way: #example is
// repopulated by #category, #map-variant is hidden for every carrier case but
// 'circle', #solid-base offers different options per #solid-scene, and the
// extension tab is a five-stage stepper whose slider is disabled at the ends.

import { chromium } from 'playwright';
import { serve, CHROMIUM } from './lib/serve.mjs';

const PAGES = ['index.html', 'homotopy-explorer.html',
               'realization-carrier-explorer.html', 'ambiguity-explorer.html'];

const DUMP = () => {
  const q = s => [...document.querySelectorAll(s)];
  const shown = el => {
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && el.getClientRects().length > 0;
  };
  const key = el => el.dataset.control || el.id || el.dataset.face ||
                    el.getAttribute('aria-label') || el.name || '?';
  return {
    selects: q('select').map(el => ({
      k: key(el), value: el.value, shown: shown(el), disabled: el.disabled,
      options: [...el.options].map(o => o.value),
    })),
    ranges: q('input[type=range]').map(el => ({
      k: key(el), min: el.min, max: el.max, step: el.step,
      value: el.value, shown: shown(el), disabled: el.disabled,
    })),
    checks: q('input[type=checkbox]').map(el => ({
      k: key(el), checked: el.checked, shown: shown(el), disabled: el.disabled,
    })),
    radios: q('input[type=radio]').map(el => ({
      k: key(el), value: el.value, checked: el.checked, shown: shown(el),
    })),
    buttons: q('button').map(el => ({
      k: key(el), pressed: el.getAttribute('aria-pressed'),
      role: el.getAttribute('role'), shown: shown(el), disabled: el.disabled,
      text: el.textContent.trim().slice(0, 28),
    })),
    tabs: q('[role=tab]').map(el => ({ k: key(el), selected: el.getAttribute('aria-selected') })),
    scenes: q('svg').filter(shown).map(svg => ({
      k: svg.id || svg.getAttribute('class'),
      viewBox: svg.getAttribute('viewBox'),
      marks: svg.querySelectorAll('circle,path,line,rect,text,polygon,polyline').length,
      probe: Object.fromEntries([...svg.attributes]
        .filter(a => a.name.startsWith('data-'))
        .map(a => [a.name, String(a.value).slice(0, 48)])),
    })),
    a11y: {
      live: q('[aria-live],[role=status]').length,
      tablists: q('[role=tablist]').length,
      headings: q('h1,h2,h3').map(h => h.tagName),
    },
  };
};

const line = (label, rows, fmt) => {
  if (!rows?.length) return;
  console.log(`  ${label}`);
  for (const r of rows) console.log(`    ${fmt(r)}`);
};

const want = process.argv.slice(2).filter(a => !a.startsWith('-'));
const pages = want.length ? want : PAGES;

const srv = await serve('.');
const browser = await chromium.launch({ executablePath: CHROMIUM });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e).split('\n')[0]));

for (const name of pages) {
  errors.length = 0;
  await page.goto(`${srv.url}/${name}`, { waitUntil: 'load' });
  await page.waitForTimeout(500);
  console.log(`\n${'='.repeat(66)}\n${name}\n${'='.repeat(66)}`);

  const targets = [['main', page.mainFrame()],
                   ...page.frames().filter(f => f !== page.mainFrame()).map(f => ['iframe', f])];
  for (const [where, frame] of targets) {
    const d = await frame.evaluate(DUMP).catch(e => ({ error: String(e).split('\n')[0] }));
    console.log(` [${where}]`);
    if (d.error) { console.log(`    unreachable: ${d.error}`); continue; }
    line('selects', d.selects, r =>
      `${r.k}${r.shown ? '' : ' (hidden)'}${r.disabled ? ' (disabled)' : ''} = ${r.value}  [${r.options.join(', ')}]`);
    line('ranges', d.ranges, r =>
      `${r.k}${r.shown ? '' : ' (hidden)'}${r.disabled ? ' (disabled)' : ''} = ${r.value}  (${r.min}..${r.max} step ${r.step})`);
    line('checks', d.checks, r => `${r.k}${r.shown ? '' : ' (hidden)'}${r.disabled ? ' (disabled)' : ''} = ${r.checked}`);
    line('buttons', d.buttons.filter(b => b.shown), r =>
      `${r.k}${r.disabled ? ' (disabled)' : ''}${r.pressed ? ` pressed=${r.pressed}` : ''}  "${r.text}"`);
    line('tabs', d.tabs, r => `${r.k} selected=${r.selected}`);
    line('scenes', d.scenes, r =>
      `${r.k} ${r.viewBox} ${r.marks} marks ${Object.keys(r.probe).length ? JSON.stringify(r.probe) : ''}`);
    console.log(`    a11y: ${d.a11y.live} live regions, ${d.a11y.tablists} tablists, headings ${d.a11y.headings.join('>') || 'none'}`);
  }
  if (errors.length) console.log(`  PAGE ERRORS: ${[...new Set(errors)].join(' | ')}`);
}

await browser.close();
await srv.close();
