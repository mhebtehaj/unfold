// Phase 3's proof, in the suite: the engine's redraw of the realization
// explorer's "A drawing of |Δ|" against the shipped drawing, element by element.
//
// tools/parity.mjs compares the two as pixels (every case, three widths, both
// schemes — it needs a real screenshot, so it lives in tools/). This runs in
// tests/run.html on every open: both pages load in frames of one size, every
// case drives the explorer's own controls and hands the fixture the same
// state, and every drawn element — circle, path, text, in document order — is
// compared: its geometry to 1e-6 px and its resolved paint exactly.
//
// Browser-only (tools/run-tests.mjs); under node it registers nothing.

import { suite, assert } from './harness.mjs';
import { CASES, stateOf } from './fixtures/realize-cases.mjs';

const DOM = typeof document !== 'undefined';
const WIDTH = 1280;

const PAINT = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin',
               'opacity', 'fill-opacity', 'font-size', 'font-weight', 'font-family', 'text-anchor', 'visibility'];
const GEOM = { circle: ['cx', 'cy', 'r'], path: ['d'], text: ['x', 'y'] };

function frame(src) {
  return new Promise((ok, fail) => {
    const f = document.createElement('iframe');
    f.setAttribute('aria-hidden', 'true');
    f.tabIndex = -1;
    f.style.cssText = `position:absolute;left:-10000px;top:0;width:${WIDTH}px;height:900px;border:0`;
    f.onload = () => ok(f);
    f.onerror = () => fail(new Error(`${src} did not load`));
    f.src = src;
    document.body.append(f);
  });
}

/** Every number in an attribute, so "M1.5,2L3,4" and "M1.500000,2L3,4" compare as equal. */
const numbers = s => (String(s ?? '').match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number);
const letters = s => String(s ?? '').replace(/[-\d.e,\s]+/gi, ' ').trim();

function drawn(svg) {
  const view = svg.ownerDocument.defaultView;
  return [...svg.querySelectorAll('circle,path,text')].map(n => {
    const tag = n.localName, cs = view.getComputedStyle(n);
    return {
      tag,
      geom: (GEOM[tag] ?? []).map(a => [a, numbers(n.getAttribute(a)), letters(n.getAttribute(a))]),
      paint: PAINT.map(p => `${p}: ${cs.getPropertyValue(p)}`),
      text: tag === 'text' ? n.textContent : null,
    };
  });
}

function compare(was, now, where) {
  const out = [];
  if (now.length !== was.length) return [`${where}: ${now.length} drawn elements, the explorer draws ${was.length}`];
  for (let i = 0; i < was.length && out.length < 8; i++) {
    const a = was[i], b = now[i], at = `${where} #${i} <${a.tag}>`;
    if (a.tag !== b.tag) { out.push(`${at}: engine drew <${b.tag}>`); continue; }
    if (a.text !== b.text) out.push(`${at}: text "${b.text}", explorer "${a.text}"`);
    a.geom.forEach(([attr, nums, shape], k) => {
      const [, nums2, shape2] = b.geom[k];
      if (shape !== shape2) out.push(`${at} ${attr} commands "${shape2}" vs "${shape}"`);
      else if (nums.length !== nums2.length || nums.some((v, j) => Math.abs(v - nums2[j]) > 1e-6))
        out.push(`${at} ${attr} differs beyond 1e-6 px`);
    });
    a.paint.forEach((p, k) => { if (p !== b.paint[k]) out.push(`${at} ${b.paint[k]}, explorer ${p}`); });
  }
  return out;
}

async function drive(win, [action, sel, value]) {
  const n = win.document.querySelector(sel);
  if (!n) throw new Error(`the explorer has no ${sel}`);
  if (action === 'click') n.click();
  else if (action === 'select') { n.value = value; n.dispatchEvent(new win.Event('change', { bubbles: true })); }
  else if (action === 'range') { n.value = value; n.dispatchEvent(new win.Event('input', { bubbles: true })); }
}

if (DOM) suite('realize — the engine redraws a shipped drawing exactly', ({ test }) => {
  test('every case: same elements, same order, same geometry, same resolved paint', async () => {
    const failures = [];
    for (const c of CASES) {
      const [shipped, engine] = await Promise.all([frame('../realization-carrier-explorer.html'), frame('fixtures/realize.html')]);
      try {
        for (const step of c.steps) await drive(shipped.contentWindow, step);
        const svg = shipped.contentDocument.getElementById('real-picture');
        const r = svg.getBoundingClientRect();
        engine.contentWindow.__realize.draw(stateOf(c), { box: { x: 0, y: 0, width: r.width, height: r.height } });
        failures.push(...compare(drawn(svg), drawn(engine.contentDocument.getElementById('picture')), c.name));
      } finally { shipped.remove(); engine.remove(); }
      if (failures.length >= 8) break;
    }
    assert.equal(failures, [], failures.join('\n        '));
  });

  test('the comparison is not vacuous: a changed weight is caught', async () => {
    const [shipped, engine] = await Promise.all([frame('../realization-carrier-explorer.html'), frame('fixtures/realize.html')]);
    try {
      const svg = shipped.contentDocument.getElementById('real-picture');
      const r = svg.getBoundingClientRect();
      engine.contentWindow.__realize.draw({ ...stateOf(CASES[0]), w: [0.21, 0.29, 0.5] },
        { box: { x: 0, y: 0, width: r.width, height: r.height } });
      const out = compare(drawn(svg), drawn(engine.contentDocument.getElementById('picture')), 'nudged');
      assert.ok(out.length > 0, 'moving x by 0.01 went unnoticed');
    } finally { shipped.remove(); engine.remove(); }
  });
});
