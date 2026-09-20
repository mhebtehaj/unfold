// Contrast of every text-on-surface token pair, in both colour schemes.
//
// Reads the resolved token values captured by tools/shots.mjs. Custom
// properties cannot be read back resolved — getPropertyValue('--x') returns the
// literal string "light-dark(#a,#b)" — so the capture step assigns each token
// to a real element, reads the computed colour, and paints it into a 1x1 canvas
// to get sRGB bytes (Chromium reports a color-mix() result in oklab). That is
// why this test consumes the baseline rather than the stylesheet.

import { suite, assert } from './harness.mjs';

const PAGES = ['index.html', 'homotopy-explorer.html',
               'realization-carrier-explorer.html', 'ambiguity-explorer.html'];

/** WCAG 2.1 relative luminance, sRGB in 0..255. */
function luminance([r, g, b]) {
  const f = v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Composite a possibly-translucent token over its surface before measuring. */
export function over(fg, bg) {
  const a = fg[3] ?? 1;
  return a >= 1 ? fg.slice(0, 3)
    : [0, 1, 2].map(i => Math.round(fg[i] * a + bg[i] * (1 - a)));
}

const AA = 4.5;        // normal text
const AA_LARGE = 3.0;  // large text, and non-text marks that carry meaning

// Which tokens carry TEXT, and on which surface. The author pages and the
// generated widget use different vocabularies for the same ideas, and three
// names mean the opposite thing across that seam — see the tracked issue below.
// Listing them per context is what keeps this test honest until the engine
// unifies them.
const TEXT_PAIRS = {
  main: [
    ['--fg', '--bg'], ['--muted', '--bg'], ['--fg', '--card'], ['--muted', '--card'],
    ['--violet', '--bg'], ['--teal', '--bg'], ['--orange', '--bg'],
    ['--good', '--bg'], ['--bad', '--bg'], ['--warning', '--bg'],
  ],
  frame: [
    ['--foreground', '--background'],
    ['--muted-foreground', '--background'],
  ],
};

let CACHE = null;
async function tokens() {
  if (CACHE) return CACHE;
  const base = (typeof window !== 'undefined' ? '../' : './') + 'baseline/tokens/';
  CACHE = {};
  for (const page of PAGES) for (const scheme of ['light', 'dark']) {
    try {
      const res = await fetch(`${base}${page}.${scheme}.json`);
      if (!res.ok) continue;
      const data = await res.json();
      for (const [where, block] of Object.entries(data)) {
        if (block?.tokens) CACHE[`${page}:${where}:${scheme}`] = block.tokens;
      }
    } catch { /* covered by the baseline-exists test */ }
  }
  return CACHE;
}

const rgbOf = (set, name) => set?.[name]?.srgb ?? null;

suite('tokens/contrast', ({ test, known }) => {
  test('baseline tokens exist', async () => {
    const t = await tokens();
    assert.ok(Object.keys(t).length >= 8,
      'run `node tools/shots.mjs --update --tokens-only` first');
  });

  test('every colour token resolves to sRGB', async () => {
    const t = await tokens();
    const bad = [];
    for (const [key, set] of Object.entries(t)) {
      for (const [name, v] of Object.entries(set)) {
        if (v.resolved === null) continue;      // not a colour; fine
        if (!Array.isArray(v.srgb)) bad.push(`${key} ${name} = ${v.resolved}`);
      }
    }
    assert.equal(bad, [], `unresolvable: ${bad.join(', ')}`);
  });

  test('contrast() reproduces known WCAG values', () => {
    assert.close(contrast([0, 0, 0], [255, 255, 255]), 21, 1e-9, 'black on white');
    assert.close(contrast([255, 255, 255], [255, 255, 255]), 1, 1e-9, 'white on white');
    // Measured against the real page background #faf9f6, not against white.
    assert.close(contrast([180, 105, 66], [250, 249, 246]), 3.96, 0.01, '--orange light');
    assert.close(contrast([163, 92, 55], [250, 249, 246]), 4.81, 0.01, 'proposed --orange');
  });

  test('over() composites alpha onto the surface', () => {
    assert.equal(over([0, 0, 0, 1], [255, 255, 255]), [0, 0, 0]);
    assert.equal(over([0, 0, 0, 0.5], [255, 255, 255]), [128, 128, 128]);
    assert.equal(over([255, 255, 255, 0], [10, 20, 30]), [10, 20, 30]);
  });

  // ---------------------------------------------------------------- debts --
  // Declared, not ignored. These fail today; each is a line item the engine
  // work is committed to fixing. If one starts passing, the run fails and the
  // marker must be removed.

  known('--orange on --bg meets AA in light mode',
        'Measured 3.96:1 on the real #faf9f6 background (the 4.17:1 figure in the ' +
        'inventory was computed against pure white). It is the homepage "Explore ↗" ' +
        'colour. Proposed #a35c37 = 4.81:1, which also matches the perceived weight ' +
        'of --violet (4.90) and --teal (4.82) so no page shouts.',
        async () => {
    const t = await tokens();
    const set = t['index.html:main:light'];
    assert.ok(set, 'index light tokens missing');
    const fg = rgbOf(set, '--orange'), bg = rgbOf(set, '--bg');
    assert.ok(fg && bg, 'tokens missing');
    const ratio = contrast(over(fg, bg), bg);
    assert.ok(ratio >= AA, `--orange on --bg is ${ratio.toFixed(2)}:1, want >= ${AA}`);
  });

  known('token vocabularies agree across the author/widget seam',
        'Three names mean the opposite thing either side of the iframe: --muted is ' +
        'secondary TEXT in the author pages but a 10%-alpha SURFACE tint in the ' +
        'widget; --card is an opaque raised surface vs a 5% tint; --accent is a ' +
        'foreground blue vs an accent background. Unifying the token set is Phase 2.',
        async () => {
    const t = await tokens();
    const main = t['index.html:main:light'];
    const frame = t['ambiguity-explorer.html:frame:light'];
    assert.ok(main && frame, 'token sets missing');
    for (const name of ['--muted', '--card', '--accent']) {
      const a = rgbOf(main, name), b = rgbOf(frame, name);
      if (!a || !b) continue;
      const opaqueA = (a[3] ?? 1) >= 1, opaqueB = (b[3] ?? 1) >= 1;
      assert.equal(opaqueA, opaqueB,
        `${name} is ${opaqueA ? 'opaque' : 'translucent'} in the author pages but ` +
        `${opaqueB ? 'opaque' : 'translucent'} in the widget`);
    }
  });

  known('--muted-foreground meets AA in the widget',
        'Measured 3.24:1 in light mode — secondary prose inside the ambiguity ' +
        'widget is below the 4.5:1 AA threshold. Not in the original accessibility ' +
        'audit, which measured the author pages\' --muted (4.87:1) and did not reach ' +
        'the generated widget\'s own muted token. Fixed when the token sets unify.',
        async () => {
    const t = await tokens();
    const set = t['ambiguity-explorer.html:frame:light'];
    assert.ok(set, 'widget tokens missing');
    const fg = rgbOf(set, '--muted-foreground'), bg = rgbOf(set, '--background');
    assert.ok(fg && bg, 'tokens missing');
    const ratio = contrast(over(fg, bg), bg);
    assert.ok(ratio >= AA, `--muted-foreground is ${ratio.toFixed(2)}:1, want >= ${AA}`);
  });

  known('every rendered context defines a foreground and a background',
        'The ambiguity wrapper page has no token layer at all: its only content is ' +
        'the back-link nav, which hardcodes its three colours inline — the same ' +
        'three-times-duplicated block found in the other two explorers. Every real ' +
        'token lives inside the iframe. De-iframing in Phase 5 removes the split.',
        async () => {
    const t = await tokens();
    for (const [key, set] of Object.entries(t)) {
      const fg = rgbOf(set, '--fg') ?? rgbOf(set, '--foreground');
      const bg = rgbOf(set, '--bg') ?? rgbOf(set, '--background');
      assert.ok(fg, `${key} has no foreground token`);
      assert.ok(bg, `${key} has no background token`);
    }
  });

  // ------------------------------------------------------------- the gate --
  test('all other text tokens meet AA in both schemes', async () => {
    const t = await tokens();
    const OWNED = new Set(['--orange', '--muted-foreground']);   // tracked above
    const failures = [];
    for (const [key, set] of Object.entries(t)) {
      const [, where] = key.split(':');
      const surface = where === 'frame' ? '--background' : '--bg';
      for (const [fgName, bgName] of TEXT_PAIRS[where] ?? []) {
        if (OWNED.has(fgName)) continue;
        const fg = rgbOf(set, fgName), bg = rgbOf(set, bgName) ?? rgbOf(set, surface);
        if (!fg || !bg) continue;
        const ratio = contrast(over(fg, bg), bg);
        if (ratio < AA) failures.push(`${key} ${fgName} on ${bgName} = ${ratio.toFixed(2)}:1`);
      }
    }
    assert.equal(failures, [], `${failures.length} pair(s) below AA:\n        ` +
      failures.join('\n        '));
  });

  test('accent tokens clear the 3:1 non-text threshold', async () => {
    const t = await tokens();
    const failures = [];
    for (const [key, set] of Object.entries(t)) {
      if (!key.includes(':main:')) continue;
      const bg = rgbOf(set, '--bg');
      if (!bg) continue;
      for (const name of ['--violet', '--teal', '--orange', '--accent']) {
        const fg = rgbOf(set, name);
        if (!fg) continue;
        const ratio = contrast(over(fg, bg), bg);
        if (ratio < AA_LARGE) failures.push(`${key} ${name} = ${ratio.toFixed(2)}:1`);
      }
    }
    assert.equal(failures, [], failures.join('; '));
  });

  test('borders are visible against their surface', async () => {
    const t = await tokens();
    const failures = [];
    for (const [key, set] of Object.entries(t)) {
      const bg = rgbOf(set, '--bg') ?? rgbOf(set, '--background');
      if (!bg) continue;
      for (const name of ['--line', '--border']) {
        const fg = rgbOf(set, name);
        if (!fg) continue;
        const ratio = contrast(over(fg, bg), bg);
        if (ratio < 1.15) failures.push(`${key} ${name} is invisible (${ratio.toFixed(2)}:1)`);
      }
    }
    assert.equal(failures, [], failures.join('; '));
  });

});
