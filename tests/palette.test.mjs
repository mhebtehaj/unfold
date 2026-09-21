// render/palette.js — token names, token references, and the static hues.
//
// Runs under node and in the browser: palette is in the DOM-free set. Whether
// these names and values agree with the stylesheet is a browser question, and
// lives in tests/unfold-css.test.mjs.

import { suite, assert } from './harness.mjs';
import { LAYER, TOKENS, HUES, token, isToken, paint, mix, alpha, blend, blendNumeric, DATA } from '../engine/render/palette.js';

suite('palette', ({ test }) => {
  test('declares its layer', () => assert.equal(LAYER, 1));

  test('TOKENS is frozen and every value is a custom property name', () => {
    assert.ok(Object.isFrozen(TOKENS), 'TOKENS is mutable');
    assert.all(Object.values(TOKENS), v => /^--[a-z][a-z0-9-]*$/.test(v), 'token name');
    const values = Object.values(TOKENS);
    assert.equal(new Set(values).size, values.length, 'two engine names share one token');
  });

  test('token() turns every accepted form into a CSS value', () => {
    assert.equal(token('accent'), 'var(--accent)');
    assert.equal(token('surfaceSoft'), 'var(--surface-soft)');
    assert.equal(token('--accent'), 'var(--accent)');
    assert.equal(token(' --page-local '), 'var(--page-local)', 'a page may name its own token');
    assert.equal(token('var(--muted)'), 'var(--muted)');
    const mix = 'color-mix(in oklab, var(--accent) 22%, transparent)';
    assert.equal(token(mix), mix);
  });

  test('token() refuses an unknown bare name instead of drawing black', () => {
    assert.throws(() => token('acent'), 'a typo must throw');
    assert.throws(() => token('#7360b5'), 'a literal is not a token');
    assert.throws(() => token(42), 'a number is not a token');
  });

  test('isToken() knows the engine set in all three spellings', () => {
    assert.ok(isToken('violet') && isToken('--violet') && isToken('var(--violet)'));
    assert.ok(!isToken('--page-local'), 'page-local names are allowed by token(), not engine tokens');
    assert.ok(!isToken('purple') && !isToken(null) && !isToken('var(--nope)'));
  });

  test('HUES are frozen light/dark pairs of six-digit hex, one per page hue', () => {
    assert.ok(Object.isFrozen(HUES), 'HUES is mutable');
    assert.equal(Object.keys(HUES), ['violet', 'teal', 'orange']);
    for (const [name, pair] of Object.entries(HUES)) {
      assert.ok(Object.isFrozen(pair), `${name} is mutable`);
      assert.equal(Object.keys(pair), ['light', 'dark'], name);
      assert.all(Object.values(pair), v => /^#[0-9a-f]{6}$/.test(v), `${name} value`);
      assert.ok(isToken(name), `${name} is a page hue but not a token`);
    }
  });

  // -------------------------------------------------------------- paint --

  test('paint() passes palette output and keywords through, names tokens, refuses literals', () => {
    assert.equal(paint('accent'), 'var(--accent)');
    assert.equal(paint('--bg'), 'var(--bg)');
    for (const v of ['var(--x)', 'color-mix(in srgb, var(--a) 50%, var(--b))', 'rgb(1 2 3)',
                     'light-dark(rgb(1 2 3), rgb(4 5 6))', 'none', 'transparent', 'currentColor'])
      assert.equal(paint(v), v, v);
    assert.equal(paint(null), null);
    assert.equal(paint(undefined), null);
    assert.throws(() => paint('#fff'), 'a hex literal is not a token');
    assert.throws(() => paint('red'), 'nor is a named colour');
    assert.throws(() => paint(3), 'nor a number');
  });

  test('paint() looks inside palette functions: a literal wearing one is still a literal', () => {
    for (const v of ['color-mix(in srgb, red 50%, blue)', 'var(--x, #f00)', 'light-dark(#fff, #000)',
                     'rgb(255, 0, 0)', 'rgb(var(--r) 0 0)', 'hsl(0 50% 50%)', 'oklch(0.5 0.1 20)',
                     'color-mix(in srgb, var(--a) 50%)', 'color-mix(in srgb, var(--a) var(--b), var(--c))',
                     'light-dark(var(--a))', 'var(--a) var(--b)', 'var(--a))'])
      assert.throws(() => paint(v), v);
    assert.throws(() => token('var(--x, red)'), 'token() checks the same way');
    // Nesting and hue methods that the engine's own functions can produce pass.
    for (const v of ['color-mix(in oklch longer hue, var(--a), 30% var(--b))',
                     'color-mix(in srgb, color-mix(in oklab, var(--a) 20%, var(--b)) 50%, transparent)',
                     'rgb(175.5 119 99 / 50%)'])
      assert.equal(paint(v), v, v);
  });

  test('mix() and blend() refuse a colour space color-mix() does not have', () => {
    assert.throws(() => mix('fg', 'bg', 0.5, 'rgb'));
    assert.throws(() => mix('fg', 'bg', 0.5, 'srgb longer hue'), 'a hue method needs a polar space');
    assert.throws(() => blend([1, 1], DATA, { space: 'rgb' }));
    assert.equal(mix('fg', 'bg', 0.5, 'oklch shorter hue'), 'color-mix(in oklch shorter hue, var(--fg) 50%, var(--bg))');
  });

  // ------------------------------------------------------ derived colours --

  test('mix() and alpha() are color-mix() over tokens', () => {
    assert.equal(mix('accent', 'bg', 0.25), 'color-mix(in oklab, var(--accent) 75%, var(--bg))');
    assert.equal(mix('fg', 'muted', 1, 'srgb'), 'color-mix(in srgb, var(--fg) 0%, var(--muted))');
    assert.equal(alpha('fg', 0.4), 'color-mix(in srgb, var(--fg) 40%, transparent)');
    assert.throws(() => mix('fg', 'bg', 1.5));
    assert.throws(() => alpha('fg', -0.1));
  });

  // -------------------------------------------------------------- blend --

  test('a pure vertex blends to exactly its token', () => {
    assert.equal(blend([1, 0, 0]), 'var(--data-1)');
    assert.equal(blend([0, 0, 0, 5]), 'var(--data-4)', 'normalised first');
    assert.equal(blend([0, 1], ['teal', 'violet']), 'var(--violet)');
  });

  test('blend() folds from the tail, so the percentages are the convex combination', () => {
    // w = [.2, .3, .5]: the tail is c3; c2 = mix(c2 .3/.8, c3); c1 = mix(c1 .2/1, c2).
    assert.equal(blend([0.2, 0.3, 0.5], DATA, { space: 'srgb' }),
      'color-mix(in srgb, var(--data-1) 20%, color-mix(in srgb, var(--data-2) 37.5%, var(--data-3)))');
    assert.equal(blend([1, 1]), 'color-mix(in oklab, var(--data-1) 50%, var(--data-2))', 'oklab by default');
  });

  test('blend() drops shares at or below eps and renormalises the rest', () => {
    assert.equal(blend([0.5, 0.5, 0.00001]), blend([0.5, 0.5]));
    assert.equal(blend([1, 1e-5], DATA, { eps: 1e-6 }).startsWith('color-mix('), true, 'kept when above eps');
  });

  test('blend() refuses weights it cannot mean', () => {
    assert.throws(() => blend([]), 'no weights');
    assert.throws(() => blend([0, 0]), 'zero sum');
    assert.throws(() => blend([1, -0.1]), 'negative');
    assert.throws(() => blend([1, NaN]), 'NaN');
    assert.throws(() => blend([0.5, 0.5], ['teal']), 'a weight with no colour');
    assert.throws(() => blend(Array(7).fill(1), Array(7).fill('teal')), 'beyond maxTerms');
    assert.throws(() => blend([1, 1], ['#fff', 'teal']), 'a literal colour');
  });

  // --------------------------------------------------------- blendNumeric --

  const PALETTE = [[58, 112, 225], [230, 107, 67], [52, 171, 130], [158, 95, 214]];
  /** The realization explorer's color(w), verbatim. */
  const shipped = w => `rgb(${w.reduce((p, v, i) => p.map((x, j) => x + v * PALETTE[i][j]), [0, 0, 0]).map(Math.round).join(' ')})`;

  test("blendNumeric() is the explorer's own arithmetic, ties included", () => {
    // Two cells of the explorer's 18-step grid whose colour is an exact .5 tie
    // in one channel. The weights are computed exactly as the explorer computes
    // a cell's centroid, so the float sum lands just under the tie (119.4999…,
    // 117.4999…) and rounds down. CSS colour mixing would round the true tie up;
    // blendNumeric reproduces the explorer instead.
    const at = (i, j) => [i / 18, j / 18, 1 - (i + j) / 18];
    const cell = ws => ws[0].map((_, j) => (ws[0][j] + ws[1][j] + ws[2][j]) / 3);
    const tieA = cell([at(2, 12), at(3, 12), at(2, 13)]);
    const tieB = cell([at(4, 11), at(4, 12), at(3, 12)]);
    assert.equal(blendNumeric(tieA, PALETTE), shipped(tieA));
    assert.equal(blendNumeric(tieA, PALETTE), 'rgb(175 119 99)');
    assert.equal(blendNumeric(tieB, PALETTE), shipped(tieB));
    assert.equal(blendNumeric(tieB, PALETTE), 'rgb(169 117 109)');
    for (const w of [[0.2, 0.3, 0.5], [1 / 3, 1 / 3, 1 / 3], [0, 0, 1], [0.5, 0.5], [0.1, 0.2, 0.3, 0.4]])
      assert.equal(blendNumeric(w, PALETTE), shipped(w), JSON.stringify(w));
  });

  test('blendNumeric() normalises only weights that do not already sum to 1', () => {
    assert.equal(blendNumeric([2, 2], PALETTE), blendNumeric([0.5, 0.5], PALETTE));
    assert.equal(blendNumeric([1, 0, 0], PALETTE), 'rgb(58 112 225)');
  });

  test('blendNumeric() pairs a light and a dark blend when given both', () => {
    const dark = PALETTE.map(c => c.map(v => 255 - v));
    assert.equal(blendNumeric([1, 0], { light: PALETTE, dark }),
      'light-dark(rgb(58 112 225), rgb(197 143 30))');
  });

  test('blendNumeric() refuses what blend() refuses', () => {
    assert.throws(() => blendNumeric([1, -1], PALETTE));
    assert.throws(() => blendNumeric([0, 0], PALETTE));
    assert.throws(() => blendNumeric([0.5, 0.5], [[1, 2, 3]]));
  });
});
