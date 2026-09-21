// n-dimensional vectors and matrices, as plain arrays.
//
// Nothing here is dimension-typed, so one implementation serves 2-D layout,
// the 3-D scenes and the 4-D rotations. `Mat3`/`Mat4` classes would force a
// parallel copy per dimension, and the two hand-written Givens rotations in
// the old `projectFour` are just `rotation(4, i, j, θ)`.
//
// Every vector-returning function takes a trailing `out` and writes into it.
// These run per vertex per frame; allocating a fresh array each call is what
// turns a smooth orbit into a sawtooth of collections. Nothing here allocates
// when `out` is supplied.
//
// `out` may alias an input for the elementwise operations — `add(p, q, p)` is
// how this module spells `p += q`. Those write index i only after reading
// index i, so aliasing is safe by construction. The ones that read an index
// other than the one they write (`cross3`, `centroid`, `matApply`,
// `matTranspose`) stage their reads. `matMul` cannot do that cheaply, so it
// refuses the aliasing instead.

export const LAYER = 0;

/** @typedef {number[]|Float64Array} Vec */
/** @typedef {number[]|Float64Array} Mat  row-major, length n*n */

/** Shorter than this is not a direction. Sized for coordinates near unit scale. */
export const EPS = 1e-9;

// ---- construction ------------------------------------------------------

/**
 * A zero-filled Vec of length n, or `out` zeroed to that length.
 * The fill is not decoration: `new Array(n)` is holey, and a holey array
 * poisons every later read of it. A supplied `out` is also usually last
 * frame's vector, so it has to be cleared whatever its provenance.
 */
export function alloc(n, out = new Array(n)) {
  for (let i = 0; i < n; i++) out[i] = 0;
  return out;
}

export function clone(a, out = alloc(a.length)) {
  for (let i = 0; i < a.length; i++) out[i] = a[i];
  return out;
}

/** s·e_i. Clears the rest of `out` first — a reused basis buffer keeps its old axis otherwise. */
export function basis(n, i, s = 1, out = alloc(n)) {
  alloc(n, out);
  out[i] = s;
  return out;
}

export function fill(a, v = 0) {
  for (let i = 0; i < a.length; i++) a[i] = v;
  return a;
}

// ---- arithmetic (all take optional out; out may alias a or b) ----------

export function add(a, b, out = alloc(a.length)) {
  for (let i = 0; i < a.length; i++) out[i] = a[i] + b[i];
  return out;
}

export function sub(a, b, out = alloc(a.length)) {
  for (let i = 0; i < a.length; i++) out[i] = a[i] - b[i];
  return out;
}

export function neg(a, out = alloc(a.length)) {
  for (let i = 0; i < a.length; i++) out[i] = -a[i];
  return out;
}

export function scale(a, k, out = alloc(a.length)) {
  for (let i = 0; i < a.length; i++) out[i] = a[i] * k;
  return out;
}

/** a + k·b */
export function addScaled(a, b, k, out = alloc(a.length)) {
  for (let i = 0; i < a.length; i++) out[i] = a[i] + b[i] * k;
  return out;
}

/**
 * The (1−t)·a + t·b form, not a + (b−a)·t: only the first lands exactly on `b`
 * at t = 1, and an eased transition that stops a rounding error short of its
 * target leaves a shape permanently, visibly off its mark.
 */
export function lerp(a, b, t, out = alloc(a.length)) {
  const u = 1 - t;
  for (let i = 0; i < a.length; i++) out[i] = u * a[i] + t * b[i];
  return out;
}

export function hadamard(a, b, out = alloc(a.length)) {
  for (let i = 0; i < a.length; i++) out[i] = a[i] * b[i];
  return out;
}

// ---- reductions --------------------------------------------------------

export function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** Plain sqrt of the sum of squares, not `Math.hypot`: hypot's overflow guard costs
 *  roughly an order of magnitude and these coordinates never approach the range
 *  where it pays. Use `len2` and skip the sqrt wherever only an ordering matters. */
export function len(a) { return Math.sqrt(len2(a)); }

export function len2(a) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * a[i];
  return s;
}

export function dist(a, b) { return Math.sqrt(dist2(a, b)); }

export function dist2(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; }
  return s;
}

export function sum(a) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i];
  return s;
}

/**
 * → Vec, or null when len(a) < eps. Never returns NaN.
 *
 * The degenerate case is a real one — a zero-length edge, two coincident
 * vertices, a face normal of a collapsed triangle — and dividing by the length
 * anyway seeds NaN into a coordinate, which then propagates silently through
 * every downstream transform and finally lands in a path string as an invisible
 * mark. Returning null forces the caller to decide. `out` is left untouched on
 * that path, so a reused buffer keeps its last good value rather than gaining
 * a NaN the caller never asked about.
 */
export function normalize(a, out = alloc(a.length), eps = EPS) {
  const L = len(a);
  if (L < eps) return null;
  const k = 1 / L;
  for (let i = 0; i < a.length; i++) out[i] = a[i] * k;
  return out;
}

/** (a+b)/2 directly, rather than lerp(a,b,0.5): one rounding instead of three. */
export function midpoint(a, b, out = alloc(a.length)) {
  for (let i = 0; i < a.length; i++) out[i] = (a[i] + b[i]) * 0.5;
  return out;
}

/** Component-outer, point-inner: index i is read across every point before it is
 *  written, so `out` may be one of the points. */
export function centroid(points, out = alloc(points[0].length)) {
  const n = points[0].length, m = points.length, k = 1 / m;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let p = 0; p < m; p++) s += points[p][i];
    out[i] = s * k;
  }
  return out;
}

export function cross3(a, b, out = alloc(3)) {
  // All six reads first: `out` is allowed to be `a` or `b`.
  const a0 = a[0], a1 = a[1], a2 = a[2];
  const b0 = b[0], b1 = b[1], b2 = b[2];
  out[0] = a1 * b2 - a2 * b1;
  out[1] = a2 * b0 - a0 * b2;
  out[2] = a0 * b1 - a1 * b0;
  return out;
}

/** Negated comparison, so a NaN component reports unequal instead of equal. */
export function approxEqual(a, b, eps = EPS) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!(Math.abs(a[i] - b[i]) <= eps)) return false;
  return true;
}

// ---- scalars -----------------------------------------------------------

/** An inverted range (lo > hi) collapses to `hi`, because the upper bound is
 *  applied last. Deterministic and cheap; swapping the bounds instead would
 *  paper over the caller bug that produced the inversion. */
export function clamp(v, lo = 0, hi = 1) {
  return Math.min(Math.max(v, lo), hi);
}

/**
 * Round for output. The `=== 0` branch is the point of it: `Math.round(-0.4)`
 * is -0, and a "-0" in an emitted coordinate is a pointless diff against the
 * captured baseline every time a value crosses zero from the other side.
 */
export function round(v, digits = 3) {
  const p = 10 ** digits;
  const r = Math.round(v * p) / p;
  return r === 0 ? 0 : r;
}

export function deg(rad) { return rad * 180 / Math.PI; }
export function rad(deg) { return deg * Math.PI / 180; }

/** Unclamped on purpose: the spec's formula exactly. Callers hand it a
 *  normalised t, and anim.js re-exports this one so easings stay in one place. */
export function smoothstepScalar(t) { return t * t * (3 - 2 * t); }

// ---- matrices (row-major flat, dimension passed explicitly) ------------

export function matIdentity(n, out = alloc(n * n)) {
  alloc(n * n, out);
  for (let i = 0; i < n; i++) out[i * n + i] = 1;
  return out;
}

/** a·b. `out` must not alias a or b. */
export function matMul(a, b, n, out = alloc(n * n)) {
  // Every output cell sums a whole row of `a` against a column of `b`, so
  // writing one back over an operand poisons the cells still to be read — and
  // the result is a plausible-looking wrong matrix, not a crash. One reference
  // compare buys the whole class of bug.
  if (out === a || out === b) throw new Error('matMul: out must not alias a or b');
  for (let i = 0; i < n; i++) {
    const r = i * n;
    for (let j = 0; j < n; j++) {
      let s = 0;
      for (let k = 0; k < n; k++) s += a[r + k] * b[k * n + j];
      out[r + j] = s;
    }
  }
  return out;
}

// Staging row for the in-place case below. Grown once by assignment and then
// reused; matApply calls nothing, so there is no re-entrancy to worry about.
const ROW = [];

/** m·v */
export function matApply(m, n, v, out = alloc(n)) {
  // `matApply(M, n, p, p)` is the natural way to spell "transform this point
  // where it lies", and the straightforward loop would read v[k] after having
  // overwritten it. Stage through ROW rather than forbidding the call or
  // allocating per call; the reference compare costs nothing otherwise.
  const dst = out === v ? ROW : out;
  for (let i = 0; i < n; i++) {
    const r = i * n;
    let s = 0;
    for (let k = 0; k < n; k++) s += m[r + k] * v[k];
    dst[i] = s;
  }
  if (dst !== out) for (let i = 0; i < n; i++) out[i] = dst[i];
  return out;
}

export function matTranspose(m, n, out = alloc(n * n)) {
  // In place, swap each off-diagonal pair once; the general loop would read
  // cells it had already written back.
  if (out === m) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = i * n + j, b = j * n + i;
        const t = m[a]; m[a] = m[b]; m[b] = t;
      }
    }
    return out;
  }
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) out[j * n + i] = m[i * n + j];
  }
  return out;
}

/**
 * Givens rotation in the (i,j) coordinate plane.
 *   v_i' = c·v_i − s·v_j      v_j' = s·v_i + c·v_j
 * This single primitive generates every rotation the engine needs:
 *   R_x(φ) = rotation(3, 1, 2, φ)      R_y(ψ) = rotation(3, 2, 0, ψ)
 *   R_z(θ) = rotation(3, 0, 1, θ)      R_14   = rotation(4, 0, 3, θ)
 *   R_24   = rotation(4, 1, 3, θ)      …and any (plane, angle) in any dimension.
 */
export function rotation(n, i, j, theta, out = matIdentity(n)) {
  // A rotation differs from the identity in exactly four cells, so a supplied
  // `out` has to be reset: reusing last frame's matrix and touching only those
  // four leaves the previous angle's off-plane terms in place.
  matIdentity(n, out);
  const c = Math.cos(theta), s = Math.sin(theta);
  out[i * n + i] = c;  out[i * n + j] = -s;
  out[j * n + i] = s;  out[j * n + j] = c;
  return out;
}
