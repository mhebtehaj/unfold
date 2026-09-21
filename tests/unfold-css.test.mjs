// engine/unfold.css, resolved live — the token-contrast gate.
//
// tokens.test.mjs reads what the pages resolved when the baseline was
// captured. This reads the stylesheet itself: it loads unfold.css alone in a
// fixture frame, resolves every token the engine names in both colour schemes
// and on both grounds, and measures. So it covers tokens no page uses yet, and
// a change to the stylesheet is caught here before any page is recaptured.
//
// Resolution goes through a real element, because a custom property reads back
// as its authored text ("light-dark(#a,#b)"), not as the colour in force. A
// sentinel colour one level up catches a token that fails to resolve: an
// invalid value makes `color` inherit, and the probe then reads the sentinel.
//
// Browser-only (tools/run-tests.mjs); under node it registers nothing.

import { suite, assert } from './harness.mjs';
import { contrast, over } from './tokens.test.mjs';
import { TOKENS, HUES } from '../engine/render/palette.js';

const DOM = typeof document !== 'undefined';

const SCHEMES = ['light', 'dark'];
const GROUNDS = ['work', 'paper'];
const SENTINEL = [1, 2, 3, 1];
const NAMES = Object.values(TOKENS);

const AA = 4.5, NON_TEXT = 3;

const parse = css => {
  const m = /^rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\s*\)$/.exec(css);
  return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : null;
};
const hexRGB = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)).concat(1);
const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => v === b[i]);

/** Contrast of `fg` composited over `bg`; `bg` is assumed opaque. */
const ratio = (fg, bg) => contrast(over(fg, bg), bg.slice(0, 3));

let DATA = null;

/** Load the fixture once and resolve everything the tests measure. */
function data() {
  DATA ??= new Promise((ok, fail) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.style.cssText = 'position:absolute;left:-10000px;top:0;width:800px;height:400px;border:0';
    frame.onerror = () => fail(new Error('tests/fixtures/tokens.html did not load'));
    frame.onload = () => {
      try { ok(measure(frame.contentDocument)); } catch (e) { fail(e); }
    };
    frame.src = 'fixtures/tokens.html';
    document.body.append(frame);
  });
  return DATA;
}

function measure(doc) {
  const view = doc.defaultView;
  const context = attrs => {
    const box = doc.createElement('div');
    for (const [k, v] of Object.entries(attrs)) if (v) box.setAttribute(k, v);
    box.style.colorScheme = attrs.scheme;
    const wrap = doc.createElement('div');
    wrap.style.color = `rgb(${SENTINEL.slice(0, 3).join(',')})`;
    const probe = doc.createElement('span');
    wrap.append(probe); box.append(wrap); doc.body.append(box);
    return { box, probe };
  };
  const read = (probe, name) => {
    probe.style.color = `var(${name})`;
    return parse(view.getComputedStyle(probe).color);
  };

  const tokens = {}, hues = {}, lineHeight = {};
  for (const ground of GROUNDS) for (const scheme of SCHEMES) {
    const { box, probe } = context({ 'data-ground': ground === 'paper' ? 'paper' : null, scheme });
    const set = tokens[`${ground}:${scheme}`] = {};
    for (const name of NAMES) set[name] = read(probe, name);
    lineHeight[ground] = view.getComputedStyle(box).lineHeight;
  }
  // The work ground's line height is the root's; a nested box without a ground
  // inherits it rather than recomputing it.
  lineHeight.work = view.getComputedStyle(doc.documentElement).lineHeight;
  for (const hue of Object.keys(HUES)) for (const scheme of SCHEMES) {
    const { probe } = context({ 'data-hue': hue, scheme });
    hues[`${hue}:${scheme}`] = read(probe, '--accent');
  }
  return { tokens, hues, lineHeight, frame: doc };
}

// Text pairs, [ink, surface]. Every place a token is set as text on a token.
const TEXT = [];
for (const ink of ['--fg', '--muted', '--accent', '--violet', '--teal', '--orange', '--good', '--bad'])
  for (const surface of ['--bg', '--surface']) TEXT.push([ink, surface]);
TEXT.push(['--fg', '--surface-soft'], ['--muted', '--surface-soft'],
          ['--fg', '--inert'], ['--muted', '--inert'],
          ['--accent', '--accent-soft'], ['--on-accent', '--accent']);

const ACCENTS = ['--violet', '--teal', '--orange', '--accent'];
const DATA_INKS = ['--data-1', '--data-2', '--data-3', '--data-4',
                   '--face-1', '--face-2', '--face-3', '--pink', '--good', '--bad'];

if (DOM) suite('unfold.css', ({ test }) => {
  test('defines every token palette.js names, on both grounds, in both schemes', async () => {
    const { tokens } = await data();
    const bad = [];
    for (const [where, set] of Object.entries(tokens))
      for (const name of NAMES)
        if (!set[name] || same(set[name], SENTINEL)) bad.push(`${where} ${name}`);
    assert.equal(bad, [], `unresolved: ${bad.join(', ')}`);
  });

  test('every text pair meets WCAG AA (4.5:1) on both grounds, in both schemes', async () => {
    const { tokens } = await data();
    const fails = [];
    for (const [where, set] of Object.entries(tokens))
      for (const [ink, surface] of TEXT) {
        const r = ratio(set[ink], set[surface]);
        if (!(r >= AA)) fails.push(`${where} ${ink} on ${surface} = ${r.toFixed(2)}:1`);
      }
    assert.equal(fails, [], `${fails.length} pair(s) below AA:\n        ${fails.join('\n        ')}`);
  });

  test('--orange on the homepage tile clears AA (it was 4.17:1)', async () => {
    const { tokens } = await data();
    const set = tokens['paper:light'];
    for (const surface of ['--surface', '--bg']) {
      const r = ratio(set['--orange'], set[surface]);
      assert.ok(r >= AA, `--orange on ${surface} is ${r.toFixed(2)}:1`);
    }
  });

  test('the page hues are weight-matched: 4.9-5.2:1 on white, at least 7:1 in dark', async () => {
    const { tokens } = await data();
    const fails = [];
    const white = [255, 255, 255, 1];
    for (const name of ACCENTS) {
      const r = ratio(tokens['work:light'][name], white);
      if (r < 4.9 || r > 5.2) fails.push(`${name} light = ${r.toFixed(2)}:1 on white`);
      for (const ground of GROUNDS) for (const surface of ['--bg', '--surface']) {
        const set = tokens[`${ground}:dark`];
        const d = ratio(set[name], set[surface]);
        if (d < 7) fails.push(`${name} dark = ${d.toFixed(2)}:1 on ${ground} ${surface}`);
      }
    }
    assert.equal(fails, [], fails.join('; '));
  });

  test('data and state colours clear 3:1 against every ground (WCAG 1.4.11)', async () => {
    const { tokens } = await data();
    const fails = [];
    for (const [where, set] of Object.entries(tokens))
      for (const ink of DATA_INKS) for (const surface of ['--bg', '--surface']) {
        const r = ratio(set[ink], set[surface]);
        if (!(r >= NON_TEXT)) fails.push(`${where} ${ink} on ${surface} = ${r.toFixed(2)}:1`);
      }
    assert.equal(fails, [], fails.join('; '));
  });

  test('hairlines separate without drawing: 1.15-1.8:1 against their surfaces', async () => {
    const { tokens } = await data();
    const fails = [];
    for (const [where, set] of Object.entries(tokens))
      for (const surface of ['--bg', '--surface']) {
        const r = ratio(set['--line'], set[surface]);
        if (r < 1.15 || r > 1.8) fails.push(`${where} --line on ${surface} = ${r.toFixed(2)}:1`);
      }
    assert.equal(fails, [], fails.join('; '));
  });

  test('the paper ground swaps exactly the neutral set, and opens the line', async () => {
    const { tokens, lineHeight } = await data();
    for (const scheme of SCHEMES) {
      const work = tokens[`work:${scheme}`], paper = tokens[`paper:${scheme}`];
      const changed = NAMES.filter(n => !same(work[n], paper[n])).sort();
      assert.equal(changed, ['--bg', '--fg', '--line', '--muted'], `${scheme} scheme`);
    }
    assert.equal(lineHeight.work, '24px', 'work ground is 16px/1.5');
    assert.equal(lineHeight.paper, '24.8px', 'paper ground is 16px/1.55');
  });

  test('data-hue points --accent at the hue, in both schemes', async () => {
    const { tokens, hues } = await data();
    for (const hue of Object.keys(HUES)) for (const scheme of SCHEMES)
      assert.equal(hues[`${hue}:${scheme}`], tokens[`work:${scheme}`][`--${hue}`], `${hue} ${scheme}`);
  });

  test("palette.js HUES are exactly the stylesheet's hue tokens", async () => {
    const { tokens } = await data();
    for (const [hue, pair] of Object.entries(HUES)) for (const scheme of SCHEMES)
      assert.equal(hexRGB(pair[scheme]), tokens[`work:${scheme}`][`--${hue}`], `${hue} ${scheme}`);
  });

  test('every colour literal in the stylesheet belongs to a token palette.js names', async () => {
    const { frame } = await data();
    const declared = new Set();
    const walk = rules => {
      for (const r of rules) {
        if (r.style) for (const p of r.style) if (p.startsWith('--') && /light-dark\(|#/.test(r.style.getPropertyValue(p))) declared.add(p);
        if (r.cssRules) walk(r.cssRules);
      }
    };
    for (const sheet of frame.styleSheets) walk(sheet.cssRules);
    const unnamed = [...declared].filter(p => !NAMES.includes(p)).sort();
    assert.equal(unnamed, [], 'colour tokens the engine cannot name');
  });
});
