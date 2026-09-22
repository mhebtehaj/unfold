// Tolerances, named once.
//
// The explorers this engine replaces test the same kind of question with four
// different epsilons — 0, 1e-10, 1e-9 and 1e-8, plus a 1e-6 inline — so "is
// this point in the region" and "is this weight positive" drift independently
// and a change to one formula silently flips a verdict elsewhere (realization.md
// §16.6, §16.20). This module is the fix: four named tolerances, one frozen
// object, and every Layer 2 function takes `{ tol = TOL }` rather than a bare
// epsilon argument. No other Layer 2 module may spell a literal tolerance.
//
// Four values, not one, because they answer different questions with
// different right answers:
//
//   support     1e-9   is a barycentric weight positive; is a coordinate
//                      nonzero. Must clear the round-off of a solve (~1e-16 ×
//                      cond) and stay far below any meaningful weight.
//   geometry    1e-8   are two points equal; is a point in a region. A
//                      distance, in math units, for scenes of extent ≈ 1.
//   degenerate  1e-12  is a determinant or denominator effectively zero; the
//                      guard in front of a division.
//   angle       1e-9   radians; seam and turning-number tests.

export const LAYER = 2;

/** The engine's tolerances. Frozen: a caller who wants others asks `tolerance()` for a copy. */
export const TOL = Object.freeze({ support: 1e-9, geometry: 1e-8, degenerate: 1e-12, angle: 1e-9 });

const KEYS = Object.keys(TOL);

/** Throws unless `tol[key]` is a usable tolerance, and returns it. */
function valueOf(tol, key, where) {
  if (!KEYS.includes(key))
    throw new RangeError(`${where}: unknown tolerance key "${key}" — use one of ${KEYS.join(', ')}`);
  const v = tol?.[key];
  if (typeof v !== 'number' || !(v >= 0) || v === Infinity)
    throw new TypeError(`${where}: tol.${key} must be a finite number >= 0, got ${String(v)} ` +
                        '— pass TOL or a tolerance() result');
  return v;
}

/**
 * TOL with some values replaced, frozen.
 *
 * An unknown key throws rather than being carried along: `{ geometric: 1e-6 }`
 * is a typo, and a typo that is silently ignored leaves the default in force
 * while the caller believes they loosened it.
 *
 * @param {Partial<typeof TOL>} [overrides]
 * @returns {Readonly<typeof TOL>}
 */
export function tolerance(overrides = {}) {
  if (overrides === null || typeof overrides !== 'object' || Array.isArray(overrides))
    throw new TypeError('tolerance: overrides must be an object such as { geometry: 1e-6 }');
  const out = { ...TOL };
  for (const [key, v] of Object.entries(overrides)) {
    if (!KEYS.includes(key))
      throw new RangeError(`tolerance: unknown key "${key}" — the keys are ${KEYS.join(', ')}`);
    out[key] = v;
    valueOf(out, key, 'tolerance');
  }
  return Object.freeze(out);
}

/**
 * |x| <= tol[key]. Inclusive, so a value exactly at the tolerance counts as zero.
 * NaN is never zero: the comparison is written so it fails rather than passes.
 *
 * @param {number} x
 * @param {Readonly<typeof TOL>} [tol=TOL]
 * @param {'support'|'geometry'|'degenerate'|'angle'} [key='support']
 */
export function isZero(x, tol = TOL, key = 'support') {
  const eps = valueOf(tol, key, 'isZero');
  if (typeof x !== 'number') throw new TypeError(`isZero: expected a number, got ${typeof x}`);
  return Math.abs(x) <= eps;
}

/**
 * Two numbers within tol[key] of each other, or two points (any dimension)
 * whose Euclidean distance is within tol[key] — a distance, not a per-axis
 * test, so the answer does not depend on how the axes happen to be rotated.
 *
 * Mixing a number with a point, or points of different dimensions, throws:
 * that is a caller bug, and answering `false` would hide it behind a
 * plausible verdict. NaN anywhere compares unequal.
 *
 * @param {number|number[]} a
 * @param {number|number[]} b
 * @param {Readonly<typeof TOL>} [tol=TOL]
 * @param {'support'|'geometry'|'degenerate'|'angle'} [key='geometry']
 */
export function nearlyEqual(a, b, tol = TOL, key = 'geometry') {
  const eps = valueOf(tol, key, 'nearlyEqual');
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= eps;
  const pa = Array.isArray(a) || ArrayBuffer.isView(a), pb = Array.isArray(b) || ArrayBuffer.isView(b);
  if (!pa || !pb)
    throw new TypeError('nearlyEqual: compare two numbers or two points, not a number with a point');
  if (a.length !== b.length)
    throw new RangeError(`nearlyEqual: points of different dimensions (${a.length} and ${b.length})`);
  let s = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; }
  return Math.sqrt(s) <= eps;
}
