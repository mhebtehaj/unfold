// Parametric curves, with the parameter left in view. The 2-D subset: curves
// and their seams. Surfaces arrive in Phase 5.
//
// The design constraint comes from the homotopy explorer (homotopy.md §14
// item 1): "the engine must expose the raw parameter, and the page must be
// allowed to annotate it — do not hide u." circle_unwrap, annulus_paths and
// map_classes are entirely about u = 0 and u = 1 naming the same point of X
// while a formula treats them differently. So the seam is a first-class,
// addressable object here, not an implementation detail of sampling, and the
// page's a/b markers at u = .015 and .985 are one call (seamProbes).
//
// `polar` takes TURNS, not radians, because every shipped formula does:
// polar(u) walks the circle once as u goes 0 → 1. Region angles (region.js)
// are radians; the two conventions meet only where a caller converts.
//
// Sampling is deterministic and never adaptive. A mesh that changes as a
// parameter changes shimmers under animation and makes screenshots
// irreproducible, and for a teaching tool reproducible output is a
// correctness property, not a preference.

import { TOL } from './tolerance.js';

export const LAYER = 2;

/** One full turn in radians. */
export const TAU = 2 * Math.PI;

/**
 * The point at `u` turns and radius `r`: [r·cos 2πu, r·sin 2πu].
 *
 * EXACT: this is the shipped explorer's `polar`, expression for expression, so
 * a port lands on the same bits. `polar(u + 1, r)` equals `polar(u, r)` only up
 * to float error — `polar(1)` is [1, −2.45e−16], not [1, 0] — which is exactly
 * the seam this module makes addressable rather than hides.
 *
 * @param {number} u  turns
 * @param {number} [r=1]
 * @returns {[number, number]}
 */
export function polar(u, r = 1) {
  return [r * Math.cos(TAU * u), r * Math.sin(TAU * u)];
}

// ---- helpers -------------------------------------------------------------

const IDENTIFICATIONS = ['periodic', 'flip', 'collapse', 'none'];
const finite = x => typeof x === 'number' && Number.isFinite(x);

function checkRes(res, where) {
  if (!Number.isInteger(res) || res < 1)
    throw new RangeError(`${where}: res must be a positive integer, got ${String(res)}`);
}

function checkSeam(s, where) {
  if (!s || typeof s !== 'object' || !Array.isArray(s.at) || s.at.length !== 2 ||
      !finite(s.at[0]) || !finite(s.at[1]) || !IDENTIFICATIONS.includes(s.identification))
    throw new TypeError(`${where}: expected a Seam { id, axis, at: [a, b], identification } — ` +
                        `take one from curve.seams`);
}

function distance(p, q, where) {
  if (!Array.isArray(p) || !Array.isArray(q) || p.length !== q.length)
    throw new TypeError(`${where}: images must be points of one dimension`);
  let s = 0;
  for (let i = 0; i < p.length; i++) { const d = p[i] - q[i]; s += d * d; }
  return Math.sqrt(s);
}

// ---- curves --------------------------------------------------------------

/**
 * @typedef {Readonly<{id:string, axis:string, at:readonly [number, number],
 *           identification:'periodic'|'flip'|'collapse'|'none'}>} Seam
 *
 * `at` names the two parameter values the identification relates. For a
 * periodic seam they are the same point of the quotient: at[0] ~ at[1].
 */

/**
 * A parametric curve u ↦ at(u) on `domain`, frozen.
 *
 *   id, label, domain, closed    as given (label defaults to id)
 *   at(u)                        the caller's function, unwrapped
 *   tangent(u, {h = 1e-5})       the analytic tangent if one was given, else a
 *                                central difference. On an open curve the
 *                                stencil is clipped to the domain (one-sided at
 *                                the ends) so it never evaluates outside it.
 *   polyline({res = 144})        { points, params, closed } with
 *                                params[i] = d0 + (d1 − d0)·i/res, i = 0 … res:
 *                                res + 1 points, BOTH ENDS INCLUDED EVEN WHEN
 *                                CLOSED. The duplicated endpoint is deliberate:
 *                                u = 1 is a different parameter from u = 0 even
 *                                where it is the same point, and a caller that
 *                                wants a loop drops the last point knowingly.
 *   arcLength({res = 512})       the length of that polyline
 *   seams                        closed → [{ id: 'wrap', axis: 'u', at: [d0, d1],
 *                                identification: 'periodic' }], else []
 *   seamProbes(seam, {count = 2, inset = 0.015})
 *                                parameters just either side of the seam, in
 *                                ascending order: count/2 at at[0] + k·inset and
 *                                count/2 at at[1] − k·inset, k = 1 … count/2.
 *                                count 2 gives [at[0] + inset, at[1] − inset] —
 *                                the shipped a/b markers, .015 and .985, bit for
 *                                bit. result[k] and result[count−1−k] mirror each
 *                                other across the seam.
 *   identify(u)                  closed: the representative of u in [d0, d1), and
 *                                identify(identify(u)) === identify(u) exactly.
 *                                Open: u itself — nothing is identified.
 *   jumpAcross(seam, f, {tol})   f maps a parameter to a point. Compares
 *                                f(at[0]) and f(at[1]) — one point of the
 *                                quotient — and returns a witness when they are
 *                                more than tol.geometry apart.
 *
 * jumpAcross is one-sided on purpose. A witness is a PROOF that f does not
 * descend to the quotient, i.e. is discontinuous there. `null` proves nothing:
 * it is not evidence of continuity, and nothing in the engine claims
 * continuity (spec §2.3, §6).
 *
 * @param {object} o
 * @param {string} o.id
 * @param {(u:number) => number[]} o.at
 * @param {[number, number]} [o.domain=[0, 1]]
 * @param {boolean} [o.closed=false]
 * @param {(u:number) => number[]} [o.tangent]
 * @param {string} [o.label]
 */
export function defineCurve({ id, at, domain = [0, 1], closed = false, tangent, label } = {}) {
  if (typeof id !== 'string' || id === '') throw new TypeError('defineCurve: id must be a non-empty string');
  if (typeof at !== 'function') throw new TypeError(`defineCurve("${id}"): at must be a function u => point`);
  if (!Array.isArray(domain) || domain.length !== 2 || !finite(domain[0]) || !finite(domain[1]) ||
      !(domain[0] < domain[1]))
    throw new RangeError(`defineCurve("${id}"): domain must be [d0, d1] with d0 < d1, both finite`);
  if (typeof closed !== 'boolean') throw new TypeError(`defineCurve("${id}"): closed must be a boolean`);
  if (tangent !== undefined && typeof tangent !== 'function')
    throw new TypeError(`defineCurve("${id}"): tangent must be a function u => vector`);
  if (label !== undefined && typeof label !== 'string')
    throw new TypeError(`defineCurve("${id}"): label must be a string`);

  const d0 = domain[0], d1 = domain[1];
  const seams = Object.freeze(closed
    ? [Object.freeze({ id: 'wrap', axis: 'u', at: Object.freeze([d0, d1]), identification: 'periodic' })]
    : []);

  function polyline({ res = 144 } = {}) {
    checkRes(res, `curve "${id}".polyline`);
    const points = new Array(res + 1), params = new Array(res + 1);
    for (let i = 0; i <= res; i++) {
      const u = d0 + (d1 - d0) * i / res;
      params[i] = u;
      points[i] = at(u);
    }
    return Object.freeze({ points: Object.freeze(points), params: Object.freeze(params), closed });
  }

  return Object.freeze({
    id, label: label ?? id, domain: Object.freeze([d0, d1]), closed,

    at: u => at(u),

    tangent(u, { h = 1e-5 } = {}) {
      if (tangent) return tangent(u);
      if (!(h > 0) || !finite(h)) throw new RangeError(`curve "${id}".tangent: h must be a positive number`);
      let lo = u - h, hi = u + h;
      if (!closed) { if (lo < d0) lo = d0; if (hi > d1) hi = d1; }
      if (!(hi > lo))
        throw new RangeError(`curve "${id}".tangent: u = ${u} leaves no room for a difference in [${d0}, ${d1}]`);
      const a = at(lo), b = at(hi), w = hi - lo;
      return b.map((v, i) => (v - a[i]) / w);
    },

    polyline,

    arcLength({ res = 512 } = {}) {
      const { points } = polyline({ res });
      let s = 0;
      for (let i = 1; i < points.length; i++) s += distance(points[i - 1], points[i], `curve "${id}".arcLength`);
      return s;
    },

    seams,

    seamProbes(seam = seams[0], { count = 2, inset = 0.015 } = {}) {
      if (seam === undefined)
        throw new RangeError(`curve "${id}".seamProbes: an open curve has no seam — pass one explicitly`);
      checkSeam(seam, `curve "${id}".seamProbes`);
      if (!Number.isInteger(count) || count < 2 || count % 2 !== 0)
        throw new RangeError(`curve "${id}".seamProbes: count must be a positive even integer ` +
                             `(probes come in mirrored pairs), got ${String(count)}`);
      const [a, b] = seam.at, k = count / 2;
      if (!(inset > 0) || !(k * inset < (b - a) / 2))
        throw new RangeError(`curve "${id}".seamProbes: ${k} steps of inset ${inset} do not fit ` +
                             `inside half of [${a}, ${b}]`);
      const left = [], right = [];
      for (let j = 1; j <= k; j++) { left.push(a + j * inset); right.push(b - j * inset); }
      return Object.freeze([...left, ...right.reverse()]);
    },

    identify(u) {
      if (!finite(u)) throw new TypeError(`curve "${id}".identify: u must be a finite number, got ${String(u)}`);
      if (!closed) return u;
      if (u >= d0 && u < d1) return u + 0;          // + 0 turns −0 into 0
      const L = d1 - d0;
      let v = d0 + (((u - d0) % L) + L) % L;
      if (!(v >= d0 && v < d1)) v = d0;             // rounding landed on d1, which is d0
      return v + 0;
    },

    jumpAcross(seam, f, { tol = TOL } = {}) {
      checkSeam(seam, `curve "${id}".jumpAcross`);
      if (seam.identification !== 'periodic')
        throw new RangeError(`curve "${id}".jumpAcross: a curve's seam relates its ends periodically; ` +
                             `"${seam.identification}" identifications belong to surfaces (Phase 5)`);
      if (typeof f !== 'function') throw new TypeError(`curve "${id}".jumpAcross: f must be a function u => point`);
      const eps = tol?.geometry;
      if (!(eps >= 0)) throw new TypeError(`curve "${id}".jumpAcross: tol.geometry must be a number >= 0`);
      const left = seam.at[0], right = seam.at[1];
      const leftImage = f(left), rightImage = f(right);
      const d = distance(leftImage, rightImage, `curve "${id}".jumpAcross`);
      if (Number.isNaN(d)) throw new RangeError(`curve "${id}".jumpAcross: f returned a non-finite point`);
      if (!(d > eps)) return null;
      return Object.freeze({
        witness: Object.freeze({ left, right, leftImage, rightImage, distance: d }),
      });
    },
  });
}

// ---- catalogue -----------------------------------------------------------

/**
 * The circle of radius r about `center`, closed, with its periodic seam at u = 0 ~ 1.
 * EXACT: at(u) = [c0 + p[0], c1 + p[1]] with p = polar(u, r).
 */
export function circle(r = 1, { center = [0, 0] } = {}) {
  if (!finite(r) || r < 0) throw new RangeError(`circle: r must be a finite number >= 0, got ${String(r)}`);
  if (!Array.isArray(center) || center.length !== 2 || !finite(center[0]) || !finite(center[1]))
    throw new TypeError('circle: center must be a point [x, y]');
  const c0 = center[0], c1 = center[1];
  return defineCurve({
    id: 'circle', label: 'circle', closed: true,
    at: u => { const p = polar(u, r); return [c0 + p[0], c1 + p[1]]; },
    tangent: u => { const k = TAU * r; return [-k * Math.sin(TAU * u), k * Math.cos(TAU * u)]; },
  });
}

/** The segment from a to b, open. EXACT: at(u) = (1 − u)·a + u·b, componentwise. */
export function segment(a, b) {
  const ok = p => Array.isArray(p) && p.length > 0 && p.every(finite);
  if (!ok(a) || !ok(b) || a.length !== b.length)
    throw new TypeError('segment: a and b must be points of the same dimension');
  const A = [...a], B = [...b];
  return defineCurve({
    id: 'segment', label: 'segment',
    at: u => A.map((v, i) => (1 - u) * v + u * B[i]),
    tangent: () => B.map((v, i) => v - A[i]),
  });
}
