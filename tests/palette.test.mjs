// render/palette.js — token names, token references, and the static hues.
//
// Runs under node and in the browser: palette is in the DOM-free set. Whether
// these names and values agree with the stylesheet is a browser question, and
// lives in tests/unfold-css.test.mjs.

import { suite, assert } from './harness.mjs';
import { LAYER, TOKENS, HUES, token, isToken } from '../engine/render/palette.js';

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
});
