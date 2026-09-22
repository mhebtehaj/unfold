// Properties of geom/tolerance.js.
//
// The module exists to stop four epsilons drifting apart, so the tests pin
// the four values, the refusal of typo keys (a typo that is ignored leaves the
// default in force while the caller believes they loosened it), and the
// boundary behaviour — inclusive at the tolerance, never true for NaN.

import { suite, assert } from '../harness.mjs';
import * as T from '../../engine/geom/tolerance.js';

// mulberry32, seeded per test (see tests/vec.test.mjs).
const rng = seed => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

suite('geom/tolerance', ({ test }) => {

  test('the exported surface is exactly what the brief names', () => {
    assert.equal(Object.keys(T).sort(), ['LAYER', 'TOL', 'isZero', 'nearlyEqual', 'tolerance']);
    assert.equal(T.LAYER, 2);
  });

  test('TOL holds the four named values, and is frozen', () => {
    assert.equal({ ...T.TOL }, { support: 1e-9, geometry: 1e-8, degenerate: 1e-12, angle: 1e-9 });
    assert.ok(Object.isFrozen(T.TOL), 'TOL is not frozen');
    assert.throws(() => { T.TOL.geometry = 1; }, 'writing to TOL must throw in a module');
    assert.equal(T.TOL.geometry, 1e-8);
  });

  test('tolerance() merges, freezes, and leaves TOL alone', () => {
    const t = T.tolerance({ geometry: 1e-6 });
    assert.equal({ ...t }, { support: 1e-9, geometry: 1e-6, degenerate: 1e-12, angle: 1e-9 });
    assert.ok(Object.isFrozen(t), 'the merge is not frozen');
    assert.ok(t !== T.TOL, 'tolerance() must return a copy');
    assert.equal(T.TOL.geometry, 1e-8, 'TOL changed');
    assert.equal({ ...T.tolerance() }, { ...T.TOL }, 'no overrides is TOL');
    assert.equal(T.tolerance({ geometry: 0 }).geometry, 0, 'zero is a legal tolerance');
  });

  test('tolerance() refuses a typo key and every unusable value', () => {
    assert.throws(() => T.tolerance({ geometric: 1e-6 }), 'a typo key was accepted');
    for (const v of [-1e-9, NaN, Infinity, '1e-6', null])
      assert.throws(() => T.tolerance({ geometry: v }), `geometry: ${String(v)} was accepted`);
    for (const o of [null, 5, 'x', [1]]) assert.throws(() => T.tolerance(o), `overrides ${String(o)} accepted`);
  });

  test('isZero is |x| <= tol[key]: inclusive, symmetric, never true for NaN', () => {
    assert.ok(T.isZero(0) && T.isZero(-0));
    assert.ok(T.isZero(1e-9) && T.isZero(-1e-9), 'the support tolerance itself counts as zero');
    assert.ok(!T.isZero(1.0000001e-9), 'just over the support tolerance');
    assert.ok(T.isZero(1e-8, T.TOL, 'geometry') && !T.isZero(1.1e-8, T.TOL, 'geometry'));
    assert.ok(T.isZero(1e-12, T.TOL, 'degenerate') && !T.isZero(1e-11, T.TOL, 'degenerate'));
    assert.ok(!T.isZero(NaN), 'NaN is not zero');
    assert.ok(T.isZero(5e-7, T.tolerance({ support: 1e-6 })), 'an override is honoured');
    assert.throws(() => T.isZero(0, T.TOL, 'nope'), 'unknown key');
    assert.throws(() => T.isZero('0'), 'a string is not a number');
    assert.throws(() => T.isZero(0, { support: 'x' }), 'a malformed tolerance object');
    const r = rng(1);
    for (let k = 0; k < 300; k++) {
      const x = (r() - 0.5) * 4e-9;
      assert.equal(T.isZero(x), Math.abs(x) <= 1e-9, `isZero(${x})`);
    }
  });

  test('nearlyEqual compares numbers by difference and points by Euclidean distance', () => {
    assert.ok(T.nearlyEqual(1, 1 + 1e-8) && !T.nearlyEqual(1, 1 + 2e-8));
    assert.ok(T.nearlyEqual([0, 0], [6e-9, 8e-9]), 'distance exactly 1e-8');
    // Each axis is within 1e-8 but the distance is not: a per-axis test would say equal.
    assert.ok(!T.nearlyEqual([0, 0], [9e-9, 9e-9]), 'per-axis, not Euclidean');
    assert.ok(T.nearlyEqual([1, 2, 3, 4], [1, 2, 3, 4]), 'any dimension');
    assert.ok(!T.nearlyEqual([NaN], [NaN]) && !T.nearlyEqual(NaN, NaN), 'NaN never equals');
    assert.ok(T.nearlyEqual(1, 1.5, T.tolerance({ angle: 1 }), 'angle'), 'the key selects the tolerance');
    assert.ok(T.nearlyEqual(new Float64Array([1, 2]), [1, 2]), 'typed arrays are points');
    assert.throws(() => T.nearlyEqual(1, [1]), 'a number with a point');
    assert.throws(() => T.nearlyEqual([1, 2], [1, 2, 3]), 'different dimensions');
    const r = rng(2);
    for (let k = 0; k < 200; k++) {
      const a = [r() * 2 - 1, r() * 2 - 1], b = [a[0] + (r() - 0.5) * 3e-8, a[1] + (r() - 0.5) * 3e-8];
      const dx = a[0] - b[0], dy = a[1] - b[1];
      assert.equal(T.nearlyEqual(a, b), Math.sqrt(dx * dx + dy * dy) <= 1e-8, 'distance rule');
      assert.equal(T.nearlyEqual(a, b), T.nearlyEqual(b, a), 'not symmetric');
    }
  });
});
