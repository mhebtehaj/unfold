// Properties of core/vec.js.
//
// Almost every guarantee this module makes is about what it must NOT do:
// not allocate when handed an `out`, not corrupt when `out` aliases an input,
// not leave stale cells in a reused buffer, not return NaN from a degenerate
// normalize, not emit -0 from round. None of those show up in a worked example
// that happens to use fresh arrays and friendly numbers, so the tests are
// properties over a seeded generator. The seed is fixed, so a failure
// reproduces from the label alone.

import { suite, assert } from './harness.mjs';
import * as vec from '../engine/core/vec.js';

// mulberry32, seeded per test rather than per file: a suite added later must
// not be able to shift the inputs an existing property runs on.
const rng = seed => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// Components keep a magnitude in [0.25, 2] so `normalize` is always defined on
// a generated vector; the degenerate case is tested deliberately, not by luck.
const rv = (r, n) => Array.from({ length: n }, () => (0.25 + r() * 1.75) * (r() < 0.5 ? -1 : 1));
const rm = (r, n) => Array.from({ length: n * n }, () => r() * 4 - 2);

/** Elementwise closeness that names the index that drifted. */
const closeAll = (got, want, tol, msg) => {
  assert.equal(got.length, want.length, `${msg}: length`);
  for (let i = 0; i < got.length; i++) assert.close(got[i], want[i], tol, `${msg}[${i}]`);
};

// Every vector-returning operation, called uniformly as (a, b, out). The
// unary ones ignore b; cross3 only exists at n = 3.
const OPS = [
  { name: 'add',       run: (a, b, o) => vec.add(a, b, o) },
  { name: 'sub',       run: (a, b, o) => vec.sub(a, b, o) },
  { name: 'neg',       run: (a, b, o) => vec.neg(a, o) },
  { name: 'scale',     run: (a, b, o) => vec.scale(a, 2.5, o) },
  { name: 'addScaled', run: (a, b, o) => vec.addScaled(a, b, 0.7, o) },
  { name: 'lerp',      run: (a, b, o) => vec.lerp(a, b, 0.3, o) },
  { name: 'hadamard',  run: (a, b, o) => vec.hadamard(a, b, o) },
  { name: 'midpoint',  run: (a, b, o) => vec.midpoint(a, b, o) },
  { name: 'clone',     run: (a, b, o) => vec.clone(a, o) },
  { name: 'normalize', run: (a, b, o) => vec.normalize(a, o) },
  { name: 'cross3',    run: (a, b, o) => vec.cross3(a, b, o), dims: [3] },
];

const DIMS = [2, 3, 5];

suite('core/vec', ({ test }) => {

  test('the exported surface is exactly what the spec names', () => {
    // Layers 1-4 are being written against this list concurrently, so an extra
    // export is not a convenience — it is how the API quietly forks.
    const want = [
      'EPS', 'LAYER',
      'alloc', 'clone', 'basis', 'fill',
      'add', 'sub', 'neg', 'scale', 'addScaled', 'lerp', 'hadamard',
      'dot', 'len', 'len2', 'dist', 'dist2', 'sum', 'normalize', 'midpoint',
      'centroid', 'cross3', 'approxEqual',
      'clamp', 'round', 'deg', 'rad', 'smoothstepScalar',
      'matIdentity', 'matMul', 'matApply', 'matTranspose', 'rotation',
    ].sort();
    assert.equal(Object.keys(vec).sort(), want);
    assert.equal(vec.LAYER, 0);
    assert.equal(vec.EPS, 1e-9);
  });

  // ---- allocation ------------------------------------------------------

  test('alloc zero-fills rather than leaving holes', () => {
    // JSON renders a hole as null, so this also fails if `new Array(n)` is
    // handed back untouched — which would be a slow-path read everywhere.
    assert.equal(vec.alloc(3), [0, 0, 0]);
    assert.equal(vec.alloc(0), []);
  });

  test('construction clears a reused out', () => {
    const dirty = () => [9, 9, 9, 9];
    assert.equal(vec.alloc(4, dirty()), [0, 0, 0, 0]);
    assert.equal(vec.basis(4, 2, 3, dirty()), [0, 0, 3, 0], 'basis kept the old axis');
    assert.equal(vec.clone([1, 2, 3, 4], dirty()), [1, 2, 3, 4]);
    assert.equal(vec.fill(dirty(), -1), [-1, -1, -1, -1]);
    assert.equal(vec.fill(dirty()), [0, 0, 0, 0], 'fill defaults to zero');
    assert.equal(vec.basis(3, 0), [1, 0, 0]);
    assert.equal(vec.basis(3, 1, -2), [0, -2, 0]);
  });

  test('an op given an out returns that exact object', () => {
    // The whole point of the out parameter: identity, not equality. A function
    // that quietly allocates and copies passes every value test and still
    // costs a collection per vertex per frame.
    const r = rng(1);
    for (const { name, run, dims = DIMS } of OPS) {
      for (const n of dims) {
        const o = vec.alloc(n);
        assert.ok(run(rv(r, n), rv(r, n), o) === o, `${name} at n=${n} allocated`);
      }
    }
    const o3 = vec.alloc(3);
    assert.ok(vec.alloc(3, o3) === o3, 'alloc');
    assert.ok(vec.basis(3, 1, 1, o3) === o3, 'basis');
    assert.ok(vec.fill(o3, 2) === o3, 'fill');
    assert.ok(vec.centroid([[1, 2, 3], [4, 5, 6]], o3) === o3, 'centroid');
  });

  test('out may alias either input, for every elementwise op', () => {
    // `add(p, q, p)` is how this module spells `p += q`. The aliased call has
    // to agree with the unaliased one exactly, not approximately: the
    // arithmetic is identical, only the write target differs.
    const r = rng(2);
    for (const { name, run, dims = DIMS } of OPS) {
      for (const n of dims) {
        const a = rv(r, n), b = rv(r, n);
        const want = [...run(a.slice(), b.slice(), vec.alloc(n))];

        const ai = a.slice(), bi = b.slice();
        const gotA = run(ai, bi, ai);
        assert.ok(gotA === ai, `${name}(a,b,a) at n=${n} did not write into a`);
        assert.equal([...gotA], want, `${name}(a,b,a) at n=${n}`);
        assert.equal([...bi], [...b], `${name}(a,b,a) at n=${n} scribbled on b`);

        const aj = a.slice(), bj = b.slice();
        const gotB = run(aj, bj, bj);
        assert.ok(gotB === bj, `${name}(a,b,b) at n=${n} did not write into b`);
        assert.equal([...gotB], want, `${name}(a,b,b) at n=${n}`);
        assert.equal([...aj], [...a], `${name}(a,b,b) at n=${n} scribbled on a`);
      }
    }
  });

  // ---- arithmetic ------------------------------------------------------

  test('the arithmetic ops are what they claim', () => {
    const r = rng(3);
    for (let k = 0; k < 100; k++) {
      const n = 2 + (k % 4);
      const a = rv(r, n), b = rv(r, n), t = r();
      closeAll(vec.sub(a, b), vec.add(a, vec.neg(b)), 1e-15, 'a-b != a+(-b)');
      closeAll(vec.addScaled(a, b, t), vec.add(a, vec.scale(b, t)), 1e-15, 'addScaled');
      closeAll(vec.midpoint(a, b), vec.scale(vec.add(a, b), 0.5), 0, 'midpoint');
      closeAll(vec.neg(vec.neg(a)), a, 0, 'double negation');
      closeAll(vec.hadamard(a, b), vec.hadamard(b, a), 0, 'hadamard is not commutative');
    }
  });

  test('lerp lands exactly on its endpoints', () => {
    // a + (b-a)*t drifts off b at t = 1 by a rounding, and an eased transition
    // that stops a rounding short leaves a shape permanently, visibly off its
    // mark. These four pairs are ones where the naive form actually misses —
    // most pairs happen not to, which is why this is pinned rather than random.
    const a = [0.1, 0.2, 0.7, 0.1], b = [-0.3, -0.1, 0.1, 1e-8];
    assert.all(a, (x, i) => x + (b[i] - x) !== b[i],
      'the counterexample no longer distinguishes the two forms');
    assert.equal([...vec.lerp(a, b, 1)], [...b], 'lerp(a,b,1) != b');
    assert.equal([...vec.lerp(a, b, 0)], [...a], 'lerp(a,b,0) != a');

    const r = rng(4);
    for (let k = 0; k < 100; k++) {
      const n = 2 + (k % 4);
      const p = rv(r, n), q = rv(r, n);
      assert.equal([...vec.lerp(p, q, 0)], [...p], 'lerp(a,b,0) != a');
      assert.equal([...vec.lerp(p, q, 1)], [...q], 'lerp(a,b,1) != b');
      closeAll(vec.lerp(p, q, 0.5), vec.midpoint(p, q), 1e-15, 'lerp at 0.5');
      // Monotone between the endpoints, per component.
      const lo = vec.lerp(p, q, 0.3), hi = vec.lerp(p, q, 0.7);
      assert.all(lo, (x, i) => (q[i] >= p[i]) === (hi[i] >= x), 'lerp is not monotone');
    }
  });

  // ---- reductions ------------------------------------------------------

  test('the reductions agree with each other', () => {
    const r = rng(5);
    for (let k = 0; k < 100; k++) {
      const n = 2 + (k % 4);
      const a = rv(r, n), b = rv(r, n);
      assert.close(vec.len2(a), vec.dot(a, a), 1e-12, 'len2 != dot(a,a)');
      assert.close(vec.len(a), Math.sqrt(vec.len2(a)), 0, 'len != sqrt(len2)');
      assert.close(vec.dist2(a, b), vec.len2(vec.sub(a, b)), 1e-12, 'dist2 != |a-b|^2');
      assert.close(vec.dist(a, b), vec.dist(b, a), 0, 'dist is not symmetric');
      assert.close(vec.dist(a, a), 0, 0, 'dist to self is not zero');
      assert.close(vec.sum(a), vec.dot(a, a.map(() => 1)), 1e-12, 'sum != dot with ones');
      assert.close(vec.dot(a, b), vec.dot(b, a), 0, 'dot is not symmetric');
    }
  });

  test('normalize returns null on a degenerate vector, never NaN', () => {
    // A zero-length edge, two coincident vertices, the normal of a collapsed
    // triangle: dividing by the length anyway seeds a NaN that propagates
    // silently through every transform and lands as an invisible mark.
    assert.equal(vec.normalize([0, 0, 0]), null);
    assert.equal(vec.normalize([0, 0]), null);
    assert.equal(vec.normalize([-0, 0, -0]), null);
    assert.equal(vec.normalize([1e-12, -1e-12, 0]), null, 'shorter than EPS');

    // A caller that ignores the null and reads the buffer anyway should find
    // its last good value, not a fresh NaN it never asked for.
    const o = [7, 8, 9];
    assert.equal(vec.normalize([0, 0, 0], o), null);
    assert.equal(o, [7, 8, 9], 'out was written on the degenerate path');

    // The threshold is the argument, not a constant baked into the branch.
    const tiny = vec.normalize([3e-12, 4e-12, 0], vec.alloc(3), 1e-15);
    assert.ok(tiny !== null, 'a smaller eps must admit a shorter vector');
    closeAll(tiny, [0.6, 0.8, 0], 1e-12, 'tiny normalize');
  });

  test('normalize yields unit length and fixes an already-unit vector', () => {
    const r = rng(6);
    for (let k = 0; k < 200; k++) {
      const n = 2 + (k % 4);
      const a = rv(r, n);
      const u = vec.normalize(a);
      assert.ok(u !== null, 'generated vectors are never degenerate');
      assert.close(vec.len(u), 1, 1e-12, 'normalize is not unit');
      closeAll(vec.normalize(u), u, 1e-15, 'normalize is not idempotent');
      // Same direction, not the opposite one.
      assert.close(vec.dot(u, a), vec.len(a), 1e-12, 'normalize flipped the direction');
    }
  });

  test('centroid of a single point is that point, exactly', () => {
    const r = rng(7);
    for (const n of [1, 2, 3, 5]) {
      const p = rv(r, n);
      assert.equal(vec.centroid([p]), p, `n=${n}`);
    }
  });

  test('centroid of a regular simplex is equidistant from every vertex', () => {
    // The regular (n-1)-simplex spanned by s·e_0 … s·e_{n-1} has its barycentre
    // at (s/n, …, s/n), and symmetry makes every vertex distance identical.
    // An off-by-one in the divisor breaks the equidistance, not just the value.
    for (const n of [2, 3, 4, 5]) {
      const s = 1.7;
      const verts = Array.from({ length: n }, (_, i) => vec.basis(n, i, s));
      const c = vec.centroid(verts);
      closeAll(c, verts[0].map(() => s / n), 1e-15, `simplex barycentre at n=${n}`);
      const d0 = vec.dist(c, verts[0]);
      assert.all(verts, p => Math.abs(vec.dist(c, p) - d0) <= 1e-12,
        `n=${n}: a vertex is not equidistant from the centroid`);
    }
    // And a regular tetrahedron off the axes, so a version that only works on
    // basis vectors does not survive.
    const tet = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]];
    const c = vec.centroid(tet);
    closeAll(c, [0, 0, 0], 1e-15, 'tetrahedron barycentre');
    assert.all(tet, p => Math.abs(vec.dist(c, p) - Math.sqrt(3)) <= 1e-12,
      'tetrahedron vertex distance');
  });

  test('centroid is translation-equivariant and accepts one of its points as out', () => {
    const r = rng(8), n = 3;
    const pts = Array.from({ length: 5 }, () => rv(r, n));
    const t = rv(r, n);
    const c = vec.centroid(pts);
    closeAll(vec.centroid(pts.map(p => vec.add(p, t))), vec.add(c, t), 1e-14,
      'centroid is not translation-equivariant');
    // Index i is read across every point before it is written, so this is safe.
    const alias = pts.map(p => p.slice());
    const got = vec.centroid(alias, alias[2]);
    assert.ok(got === alias[2], 'centroid did not write into the out it was given');
    assert.equal([...got], [...c], 'centroid(pts, pts[2])');
  });

  test('cross3 is perpendicular, anticommutative and right-handed', () => {
    const e = i => vec.basis(3, i);
    assert.equal(vec.cross3(e(0), e(1)), [0, 0, 1], 'x cross y is z');
    assert.equal(vec.cross3(e(1), e(2)), [1, 0, 0], 'y cross z is x');
    assert.equal(vec.cross3(e(2), e(0)), [0, 1, 0], 'z cross x is y');
    const r = rng(9);
    for (let k = 0; k < 100; k++) {
      const a = rv(r, 3), b = rv(r, 3);
      const c = vec.cross3(a, b);
      assert.close(vec.dot(c, a), 0, 1e-14, 'cross is not perpendicular to a');
      assert.close(vec.dot(c, b), 0, 1e-14, 'cross is not perpendicular to b');
      closeAll(vec.cross3(b, a), vec.neg(c), 1e-15, 'cross is not anticommutative');
      // Lagrange: |a x b|^2 + (a.b)^2 = |a|^2|b|^2. Catches a transposed term
      // that happens to stay perpendicular.
      assert.close(vec.len2(c) + vec.dot(a, b) ** 2, vec.len2(a) * vec.len2(b), 1e-12,
        'Lagrange identity');
    }
  });

  test('approxEqual respects eps, length and NaN', () => {
    assert.ok(vec.approxEqual([1, 2, 3], [1, 2, 3]));
    assert.ok(vec.approxEqual([1, 2], [1 + 5e-10, 2 - 5e-10]), 'inside the default EPS');
    assert.ok(!vec.approxEqual([1, 2], [1 + 1e-6, 2]), 'outside the default EPS');
    assert.ok(vec.approxEqual([1, 2], [1 + 1e-6, 2], 1e-5), 'eps is honoured');
    assert.ok(!vec.approxEqual([1, 2], [1, 2, 3]), 'different lengths are not equal');
    assert.ok(!vec.approxEqual([NaN], [NaN]), 'NaN must never compare equal to itself');
    assert.ok(!vec.approxEqual([1], [NaN]));
    assert.ok(vec.approxEqual([0], [-0]), 'zero signs do not matter');
  });

  // ---- scalars ---------------------------------------------------------

  test('round never returns -0', () => {
    // A "-0" in an emitted coordinate is a diff against the captured baseline
    // every time a value crosses zero from the other side.
    for (const x of [-0, -1e-9, -0.0004, -0.0005, -1e-300, 0, 0.0004])
      for (const d of [0, 1, 3, 6])
        assert.ok(!Object.is(vec.round(x, d), -0), `round(${x}, ${d}) produced -0`);
    const r = rng(10);
    for (let k = 0; k < 500; k++) {
      // Magnitudes that land on or inside the rounding threshold, both signs.
      const x = (r() - 0.5) * 1e-3;
      assert.ok(!Object.is(vec.round(x, 3), -0), `round(${x}, 3) produced -0`);
      assert.ok(!Object.is(vec.round(x * 1e3, 0), -0), `round(${x * 1e3}, 0) produced -0`);
    }
  });

  test('round rounds to the digit count it is given', () => {
    assert.equal(vec.round(1.23456), 1.235, 'three digits by default');
    assert.equal(vec.round(1.23456, 0), 1);
    assert.equal(vec.round(1.23456, 1), 1.2);
    assert.equal(vec.round(-1.23456, 2), -1.23);
    assert.equal(vec.round(1234.5678, 3), 1234.568);
    assert.equal(vec.round(-2.5, 0), -2, 'ties go toward +inf, as Math.round does');
    const r = rng(11);
    for (let k = 0; k < 200; k++) {
      const x = (r() * 2000) - 1000, d = k % 5;
      assert.close(vec.round(x, d), x, 0.5 * 10 ** -d, `round(${x}, ${d}) moved too far`);
    }
  });

  test('clamp respects its bounds, and an inverted range collapses to hi', () => {
    const r = rng(12);
    for (let k = 0; k < 300; k++) {
      const lo = r() * 4 - 2, hi = lo + r() * 3, x = r() * 10 - 5;
      const c = vec.clamp(x, lo, hi);
      assert.ok(c >= lo && c <= hi, `clamp(${x}, ${lo}, ${hi}) = ${c} escaped its bounds`);
      if (x >= lo && x <= hi) assert.equal(c, x, 'an in-range value was altered');
    }
    assert.equal(vec.clamp(0.5), 0.5, 'the default range is 0..1');
    assert.equal(vec.clamp(-3), 0);
    assert.equal(vec.clamp(3), 1);
    // lo > hi: the upper bound is applied last, so every input collapses to hi.
    // Deterministic rather than silently swapped — swapping would hide the
    // caller bug that produced the inversion behind a plausible answer.
    assert.all([-5, 0, 0.5, 5], x => vec.clamp(x, 1, 0) === 0, 'inverted range');
  });

  test('deg and rad round-trip', () => {
    assert.close(vec.deg(Math.PI), 180, 1e-12);
    assert.close(vec.rad(180), Math.PI, 1e-15);
    assert.close(vec.deg(vec.rad(37.5)), 37.5, 1e-12);
    assert.close(vec.rad(vec.deg(1.234)), 1.234, 1e-15);
    assert.equal(vec.rad(0), 0);
    assert.equal(vec.deg(0), 0);
  });

  test('smoothstepScalar is the eased curve, not a ramp', () => {
    assert.equal(vec.smoothstepScalar(0), 0);
    assert.equal(vec.smoothstepScalar(1), 1);
    assert.equal(vec.smoothstepScalar(0.5), 0.5);
    // Hand-computed, because every structural property below (endpoints,
    // monotone, symmetric about 0.5) is also true of the identity — which is
    // exactly the "ease that turned out to be linear" bug.
    assert.equal(vec.smoothstepScalar(0.25), 0.15625);
    assert.equal(vec.smoothstepScalar(0.75), 0.84375);
    // Flat at both ends: the curve leaves and arrives with zero slope, so near
    // 0 it grows like t², an order of magnitude under the ramp.
    assert.ok(vec.smoothstepScalar(0.01) < 0.001, 'does not ease in');
    assert.ok(vec.smoothstepScalar(0.99) > 0.999, 'does not ease out');
    let prev = -Infinity;
    for (let k = 0; k <= 100; k++) {
      const t = k / 100, s = vec.smoothstepScalar(t);
      assert.ok(s >= prev, `not monotone at t=${t}`);
      prev = s;
      assert.close(s + vec.smoothstepScalar(1 - t), 1, 1e-15, `not symmetric at t=${t}`);
      if (t > 0 && t < 0.5) assert.ok(s < t, `not below the ramp at t=${t}`);
      if (t > 0.5 && t < 1) assert.ok(s > t, `not above the ramp at t=${t}`);
    }
  });
});

// Planes worth covering: the three named 3-D axes, both 4-D planes the
// projector uses, a 4-D plane that touches neither w nor a named axis, and a
// 5-D one to prove nothing is dimension-typed.
const PLANES = [
  [2, 0, 1], [3, 0, 1], [3, 1, 2], [3, 2, 0],
  [4, 0, 3], [4, 1, 3], [4, 0, 2], [5, 1, 4],
];
const ANGLES = [0, 0.1, Math.PI / 6, Math.PI / 2, 2.4, Math.PI, -1.3, 7.5];

suite('core/vec/matrices', ({ test }) => {

  test('matIdentity is the multiplicative identity', () => {
    const r = rng(20);
    for (const n of [1, 2, 3, 4, 5]) {
      const I = vec.matIdentity(n), A = rm(r, n);
      closeAll(vec.matMul(A, I, n), A, 0, `A.I at n=${n}`);
      closeAll(vec.matMul(I, A, n), A, 0, `I.A at n=${n}`);
      const v = rv(r, n);
      closeAll(vec.matApply(I, n, v), v, 0, `I.v at n=${n}`);
    }
  });

  test('matrix ops write into the out they are given', () => {
    const r = rng(21), n = 4;
    const om = vec.alloc(n * n), ov = vec.alloc(n);
    assert.ok(vec.matIdentity(n, om) === om, 'matIdentity');
    assert.ok(vec.matMul(rm(r, n), rm(r, n), n, om) === om, 'matMul');
    assert.ok(vec.matTranspose(rm(r, n), n, om) === om, 'matTranspose');
    assert.ok(vec.matApply(rm(r, n), n, rv(r, n), ov) === ov, 'matApply');
    assert.ok(vec.rotation(n, 0, 3, 0.4, om) === om, 'rotation');
  });

  test('matMul refuses an out that aliases an operand', () => {
    // Every output cell sums a row of a against a column of b, so writing one
    // back over an operand poisons cells still to be read — and the result is a
    // plausible-looking wrong matrix, not a crash.
    const A = vec.rotation(3, 0, 1, 0.5), B = vec.rotation(3, 1, 2, 0.5);
    assert.throws(() => vec.matMul(A, B, 3, A), 'out === a must throw');
    assert.throws(() => vec.matMul(A, B, 3, B), 'out === b must throw');
    assert.ok(vec.matMul(A, B, 3, vec.alloc(9)).length === 9, 'the legitimate call still works');
  });

  test('matMul is associative', () => {
    const r = rng(22);
    for (const n of [2, 3, 4]) {
      for (let k = 0; k < 20; k++) {
        const A = rm(r, n), B = rm(r, n), C = rm(r, n);
        closeAll(vec.matMul(vec.matMul(A, B, n), C, n),
                 vec.matMul(A, vec.matMul(B, C, n), n), 1e-10,
                 `(AB)C != A(BC) at n=${n}`);
      }
    }
  });

  test('matApply factors through matMul', () => {
    // The one property the camera depends on: composing the rotations once per
    // frame and applying the product must equal applying them in turn.
    const r = rng(23);
    for (const n of [2, 3, 4, 5]) {
      for (let k = 0; k < 20; k++) {
        const A = rm(r, n), B = rm(r, n), x = rv(r, n);
        closeAll(vec.matApply(vec.matMul(A, B, n), n, x),
                 vec.matApply(A, n, vec.matApply(B, n, x)), 1e-10,
                 `(A.B).x != A.(B.x) at n=${n}`);
      }
    }
  });

  test('matApply accepts its own input as out', () => {
    const r = rng(24);
    for (const n of [2, 3, 4, 5]) {
      const A = rm(r, n), x = rv(r, n);
      const want = [...vec.matApply(A, n, x)];
      const p = x.slice();
      assert.ok(vec.matApply(A, n, p, p) === p, 'must return the out it was given');
      assert.equal([...p], want, `in-place transform at n=${n}`);
      assert.equal([...x], [...x], 'sanity');
    }
  });

  test('matTranspose is an involution and reverses a product', () => {
    const r = rng(25);
    for (const n of [2, 3, 4]) {
      const A = rm(r, n), B = rm(r, n);
      closeAll(vec.matTranspose(vec.matTranspose(A, n), n), A, 0, `TT != id at n=${n}`);
      closeAll(vec.matTranspose(vec.matMul(A, B, n), n),
               vec.matMul(vec.matTranspose(B, n), vec.matTranspose(A, n), n), 1e-12,
               `(AB)^T != B^T A^T at n=${n}`);
      // In place, which takes the pair-swap branch rather than the general one.
      const inPlace = A.slice();
      assert.ok(vec.matTranspose(inPlace, n, inPlace) === inPlace, 'must return its out');
      closeAll(inPlace, vec.matTranspose(A, n), 0, `in-place transpose at n=${n}`);
    }
  });

  // ---- rotations -------------------------------------------------------

  test('rotation is orthogonal in every plane and dimension', () => {
    for (const [n, i, j] of PLANES) {
      for (const t of ANGLES) {
        const R = vec.rotation(n, i, j, t);
        closeAll(vec.matMul(vec.matTranspose(R, n), R, n), vec.matIdentity(n), 1e-14,
          `R^T.R != I for (${n},${i},${j},${t})`);
      }
    }
  });

  test('rotation(3,1,2,phi) is R_x on the basis vectors', () => {
    // R_x = [[1,0,0],[0,c,-s],[0,s,c]], so the images of the basis vectors are
    // its columns. A flipped sign here is the "the solid spins the wrong way"
    // bug, and it survives every orthogonality check there is.
    for (const phi of [0.37, -1.1, Math.PI / 3]) {
      const c = Math.cos(phi), s = Math.sin(phi);
      const R = vec.rotation(3, 1, 2, phi);
      closeAll(vec.matApply(R, 3, vec.basis(3, 0)), [1, 0, 0], 1e-15, 'R_x fixes x');
      closeAll(vec.matApply(R, 3, vec.basis(3, 1)), [0, c, s], 1e-15, 'R_x on y');
      closeAll(vec.matApply(R, 3, vec.basis(3, 2)), [0, -s, c], 1e-15, 'R_x on z');
    }
  });

  test('rotation reproduces R_x, R_y and R_z at the plane indices the spec names', () => {
    for (const t of [0.42, -2.2]) {
      const c = Math.cos(t), s = Math.sin(t);
      closeAll(vec.rotation(3, 1, 2, t), [1, 0, 0, 0, c, -s, 0, s, c], 1e-15,
        'R_x != rotation(3,1,2)');
      closeAll(vec.rotation(3, 2, 0, t), [c, 0, s, 0, 1, 0, -s, 0, c], 1e-15,
        'R_y != rotation(3,2,0)');
      closeAll(vec.rotation(3, 0, 1, t), [c, -s, 0, s, c, 0, 0, 0, 1], 1e-15,
        'R_z != rotation(3,0,1)');
    }
  });

  test('rotation by theta then -theta is the identity', () => {
    for (const [n, i, j] of PLANES) {
      for (const t of ANGLES) {
        closeAll(vec.matMul(vec.rotation(n, i, j, t), vec.rotation(n, i, j, -t), n),
                 vec.matIdentity(n), 1e-14, `R(t).R(-t) at (${n},${i},${j},${t})`);
      }
    }
  });

  test('rotations in one plane add their angles', () => {
    for (const [n, i, j] of PLANES) {
      const a = 0.41, b = -1.27;
      closeAll(vec.matMul(vec.rotation(n, i, j, a), vec.rotation(n, i, j, b), n),
               vec.rotation(n, i, j, a + b), 1e-14,
               `R(a)R(b) != R(a+b) at (${n},${i},${j})`);
    }
  });

  test('rotation preserves length and leaves coordinates outside its plane alone', () => {
    const r = rng(26);
    for (const [n, i, j] of PLANES) {
      for (let k = 0; k < 10; k++) {
        const x = rv(r, n);
        const y = vec.matApply(vec.rotation(n, i, j, 1.13), n, x);
        assert.close(vec.len(y), vec.len(x), 1e-14, `length changed at (${n},${i},${j})`);
        for (let d = 0; d < n; d++) {
          if (d !== i && d !== j)
            assert.close(y[d], x[d], 0, `coordinate ${d} moved at (${n},${i},${j})`);
        }
      }
    }
  });

  test('rotation into a reused out is the same matrix as into a fresh one', () => {
    // A Givens rotation differs from the identity in exactly four cells. Handing
    // it last frame's matrix and writing only those four leaves the previous
    // angle's off-plane terms in place, which reads as a drifting camera.
    const n = 4;
    const o = vec.rotation(n, 0, 1, 1.9);
    const again = vec.rotation(n, 2, 3, -0.6, o);
    assert.ok(again === o, 'must return the out it was given');
    closeAll(again, vec.rotation(n, 2, 3, -0.6), 0, 'stale cells survived');
    // matIdentity carries the same reset obligation.
    const dirty = vec.rotation(3, 0, 1, 0.9);
    closeAll(vec.matIdentity(3, dirty), vec.matIdentity(3), 0, 'matIdentity left stale cells');
  });

  test('the spec worked example composes without allocating', () => {
    // §2.1, verbatim: pitch outer, yaw inner, applied into a preallocated out.
    const Rx = vec.rotation(3, 1, 2, 0.43);
    const Ry = vec.rotation(3, 2, 0, 0.72);
    const M = vec.matMul(Rx, Ry, 3);
    const out = vec.alloc(3);
    assert.ok(vec.matApply(M, 3, [1, 0, 0], out) === out);
    closeAll(out, vec.matApply(Rx, 3, vec.matApply(Ry, 3, [1, 0, 0])), 1e-15,
      'pitch-outer composition');
    assert.close(vec.len(out), 1, 1e-15, 'a rotation is not a scaling');
  });
});
