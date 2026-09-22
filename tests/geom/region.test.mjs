// Properties of geom/region.js.
//
// The invariants are checked over every region type with seeded points, and
// against oracles written here independently of the module: a strict-inside
// predicate per type for the SIGN of distance (I3), and a dense boundary
// sampler per type for its SIZE. The hand-computed values pin the formulas a
// sign slip or a transposed term would break; the spec's own usage block is
// run as written.

import { suite, assert } from '../harness.mjs';
import * as RG from '../../engine/geom/region.js';
import { TOL, tolerance } from '../../engine/geom/tolerance.js';
import * as M from '../../engine/geom/map.js';
import { polar } from '../../engine/geom/parametric.js';

const { Region: R } = RG;

const rng = seed => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// ---- independent geometry ----------------------------------------------------
const hyp = (p, c) => Math.hypot(p[0] - c[0], p[1] - c[1]);
function segGap(p, a, b) {
  const vx = b[0] - a[0], vy = b[1] - a[1], L = vx * vx + vy * vy;
  const s = L === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L));
  return Math.hypot(p[0] - a[0] - s * vx, p[1] - a[1] - s * vy);
}
function evenOdd(P, p) {
  let c = false;
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < a[0] + (p[1] - a[1]) * (b[0] - a[0]) / (b[1] - a[1])) c = !c;
  }
  return c;
}
const angleIn = (p, c, [a0, a1]) => {
  let d = Math.atan2(p[1] - c[1], p[0] - c[0]) - a0;
  while (d < 0) d += 2 * Math.PI;
  while (d >= 2 * Math.PI) d -= 2 * Math.PI;
  return d < a1 - a0;
};
const arcPts = (c, r, a, b, n) => Array.from({ length: n + 1 }, (_, i) => {
  const t = a + (b - a) * i / n;
  return [c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)];
});
const segPts = (a, b, n) => Array.from({ length: n + 1 }, (_, i) =>
  [a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]);
const edgesOf = (P, closed = true) => P.flatMap((a, i) => (i < P.length - 1 || closed) && P.length > 1
  ? [segPts(a, P[(i + 1) % P.length], 2000)] : []).flat();

/**
 * Every type, with an independent strict-inside oracle (each part thickened by
 * its slack, as the module documents) and, for primitives, a dense boundary.
 */
function fixtures() {
  const Q = [0, Math.PI / 2], W = [-2, 2.5], PIE = [Math.PI / 4, Math.PI];
  const L = [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]], T = [[-1, -0.8], [1, -0.8], [0, 1]];
  const sectorB = (c, i, o, a) => [...arcPts(c, o, a[0], a[1], 2000), ...(i > 0 ? arcPts(c, i, a[0], a[1], 2000) : []),
    ...a.flatMap(t => segPts([c[0] + i * Math.cos(t), c[1] + i * Math.sin(t)], [c[0] + o * Math.cos(t), c[1] + o * Math.sin(t)], 1000))];
  const capB = (a, b, r) => {
    const phi = Math.atan2(b[1] - a[1], b[0] - a[0]), n = [-Math.sin(phi) * r, Math.cos(phi) * r];
    return [...arcPts(b, r, phi - Math.PI / 2, phi + Math.PI / 2, 2000), ...arcPts(a, r, phi + Math.PI / 2, phi + 1.5 * Math.PI, 2000),
            ...segPts([a[0] + n[0], a[1] + n[1]], [b[0] + n[0], b[1] + n[1]], 2000),
            ...segPts([a[0] - n[0], a[1] - n[1]], [b[0] - n[0], b[1] - n[1]], 2000)];
  };
  const inDisk = (c, r) => p => hyp(p, c) < r;
  return [
    { name: 'point', r: R.point([0.3, -0.2]), inside: () => false, boundary: [[0.3, -0.2]] },
    { name: 'point with slack', r: R.point([0.3, -0.2], { slack: 0.05 }), inside: () => false, boundary: [[0.3, -0.2]], thick: inDisk([0.3, -0.2], 0.05) },
    { name: 'disk', r: R.disk([0.1, 0.2], 0.7), inside: inDisk([0.1, 0.2], 0.7), boundary: arcPts([0.1, 0.2], 0.7, 0, 2 * Math.PI, 4000) },
    { name: 'annulus', r: R.annulus([0, 0], 0.45, 1), inside: p => hyp(p, [0, 0]) > 0.45 && hyp(p, [0, 0]) < 1,
      boundary: [...arcPts([0, 0], 1, 0, 2 * Math.PI, 4000), ...arcPts([0, 0], 0.45, 0, 2 * Math.PI, 4000)] },
    { name: 'annulus, inner 0', r: R.annulus([0.2, 0], 0, 0.8), inside: inDisk([0.2, 0], 0.8), boundary: arcPts([0.2, 0], 0.8, 0, 2 * Math.PI, 4000) },
    { name: 'sector', r: R.sector([0, 0], 0.6, 0.9, Q),
      inside: p => angleIn(p, [0, 0], Q) && hyp(p, [0, 0]) > 0.6 && hyp(p, [0, 0]) < 0.9, boundary: sectorB([0, 0], 0.6, 0.9, Q) },
    { name: 'sector wider than π', r: R.sector([0.1, -0.1], 0.3, 1.2, W),
      inside: p => angleIn(p, [0.1, -0.1], W) && hyp(p, [0.1, -0.1]) > 0.3 && hyp(p, [0.1, -0.1]) < 1.2, boundary: sectorB([0.1, -0.1], 0.3, 1.2, W) },
    { name: 'pie slice', r: R.sector([0, 0], 0, 1, PIE), inside: p => angleIn(p, [0, 0], PIE) && hyp(p, [0, 0]) < 1, boundary: sectorB([0, 0], 0, 1, PIE) },
    { name: 'rect', r: R.rect({ x0: -1, x1: 1, y0: -0.42, y1: 0.42 }), inside: p => Math.abs(p[0]) < 1 && Math.abs(p[1]) < 0.42,
      boundary: edgesOf([[-1, -0.42], [1, -0.42], [1, 0.42], [-1, 0.42]]) },
    { name: 'circle', r: R.circle([0, 0], 1), inside: () => false, boundary: arcPts([0, 0], 1, 0, 2 * Math.PI, 4000) },
    { name: 'circle with slack', r: R.circle([0, 0], 1, { slack: 0.01 }), inside: () => false,
      boundary: arcPts([0, 0], 1, 0, 2 * Math.PI, 4000), thick: p => Math.abs(hyp(p, [0, 0]) - 1) < 0.01 },
    { name: 'capsule', r: R.capsule([-0.8, 0.45], [0, -0.3], 0.2), inside: p => segGap(p, [-0.8, 0.45], [0, -0.3]) < 0.2,
      boundary: capB([-0.8, 0.45], [0, -0.3], 0.2) },
    { name: 'capsule, a = b', r: R.capsule([0.5, 0.5], [0.5, 0.5], 0.3), inside: inDisk([0.5, 0.5], 0.3),
      boundary: arcPts([0.5, 0.5], 0.3, 0, 2 * Math.PI, 4000) },
    { name: 'triangle', r: R.polygon(T), inside: p => evenOdd(T, p), boundary: edgesOf(T) },
    { name: 'clockwise triangle', r: R.polygon([...T].reverse()), inside: p => evenOdd(T, p), boundary: edgesOf(T) },
    { name: 'L shape', r: R.polygon(L), inside: p => evenOdd(L, p), boundary: edgesOf(L) },
    { name: 'segment polygon', r: R.polygon([[-0.5, 0.2], [0.7, -0.4]]), inside: () => false, boundary: segPts([-0.5, 0.2], [0.7, -0.4], 2000) },
    { name: 'vertex polygon', r: R.polygon([[0.4, 0.4]]), inside: () => false, boundary: [[0.4, 0.4]] },
    { name: 'halfplane', r: R.halfplane([1, 2], 0.5), inside: p => p[0] + 2 * p[1] < 0.5,
      boundary: segPts([0.5 - 2 * 6, 6], [0.5 + 2 * 6, -6], 20000) },
    { name: 'intersection', r: R.intersection([R.disk([0, 0], 1), R.halfplane([0, 1], 0.2)]),
      inside: p => hyp(p, [0, 0]) < 1 && p[1] < 0.2 },
    { name: 'union', r: R.union([R.disk([-0.6, 0], 0.5), R.point([1, 1], { slack: 0.1 }), R.rect({ x0: 0.2, x1: 0.9, y0: -0.3, y1: 0.3 })]),
      inside: p => hyp(p, [-0.6, 0]) < 0.5 || hyp(p, [1, 1]) < 0.1 || (p[0] > 0.2 && p[0] < 0.9 && Math.abs(p[1]) < 0.3) },
    { name: 'difference', r: R.difference(R.disk([0, 0], 1), R.disk([0, 0], 0.45)),
      inside: p => hyp(p, [0, 0]) < 1 && hyp(p, [0, 0]) > 0.45 },
  ];
}

/** Seeded points over [−2.2, 2.2]², plus points just either side of the boundary. */
function points(seed, f, n = 160) {
  const r = rng(seed), out = [];
  for (let k = 0; k < n; k++) out.push([r() * 4.4 - 2.2, r() * 4.4 - 2.2]);
  for (const b of (f.boundary ?? []).filter((_, i) => i % 97 === 0))
    for (const e of [0, 1e-9, -1e-9, 2e-8, -2e-8, 1e-3, -1e-3]) out.push([b[0] + e, b[1] - e / 2]);
  return out;
}

suite('geom/region', ({ test }) => {

  test('the exported surface is exactly what the brief names', () => {
    assert.equal(Object.keys(RG).sort(), ['LAYER', 'Region']);
    assert.equal(RG.LAYER, 2);
    assert.equal(Object.keys(R).sort(), [
      'annulus', 'area', 'bounds', 'capsule', 'circle', 'contains', 'difference', 'disk', 'distance', 'halfplane',
      'intersection', 'isEmpty', 'nearest', 'outline', 'point', 'polygon', 'rect', 'sample', 'sector', 'union',
    ]);
    assert.ok(Object.isFrozen(R));
  });

  test('every region is a frozen tagged record exposing its defining data', () => {
    const keys = r => Object.keys(r).sort().join(' ');
    assert.equal(keys(R.point([1, 2])), 'center contains slack type');
    assert.equal(keys(R.disk([0, 0], 1)), 'center contains r slack type');
    assert.equal(keys(R.annulus([0, 0], 0.45, 1)), 'center contains inner outer slack type', 'no angles on a ring');
    assert.equal(keys(R.sector([0, 0], 0.6, 0.9, [0, 1])), 'angles center contains inner outer slack type');
    assert.equal(keys(R.rect({ x0: 0, x1: 1, y0: 0, y1: 1 })), 'contains slack type x0 x1 y0 y1');
    assert.equal(keys(R.circle([0, 0], 1)), 'center contains r slack type');
    assert.equal(keys(R.capsule([0, 0], [1, 0], 0.2)), 'a b contains r slack type');
    assert.equal(keys(R.polygon([[0, 0], [1, 0], [0, 1]])), 'contains convex points slack type');
    assert.equal(keys(R.halfplane([0, 1], 0)), 'contains normal offset slack type');
    assert.equal(keys(R.union([R.disk([0, 0], 1)])), 'contains regions slack type');
    assert.equal(keys(R.difference(R.disk([0, 0], 1), R.disk([0, 0], 0.5))), 'a b contains slack type');
    const s = R.sector([1, 2], 0.6, 0.9, [0, Math.PI / 2]);
    assert.equal([s.type, s.center, s.inner, s.outer, s.angles, s.slack], ['annulus', [1, 2], 0.6, 0.9, [0, Math.PI / 2], 0],
      'a sector is an annulus with angles');
    assert.equal([R.circle([0, 0], 2, { slack: 0.01 }).slack, R.point([0, 0], { slack: 0.1 }).slack], [0.01, 0.1]);
    for (const { name, r } of fixtures()) {
      assert.ok(Object.isFrozen(r), `${name} is not frozen`);
      for (const k of ['center', 'points', 'normal', 'angles', 'regions', 'a', 'b'])
        if (r[k] && typeof r[k] === 'object') assert.ok(Object.isFrozen(r[k]), `${name}.${k} is not frozen`);
    }
    const src = [0.5, 0.5], d = R.disk(src, 1);
    src[0] = 9;
    assert.equal(d.center, [0.5, 0.5], 'a region kept a reference to its caller\'s array');
  });

  test('I1: contains ⟺ distance <= slack + tol.geometry, for every type, and the bound method agrees', () => {
    const loose = tolerance({ geometry: 1e-3 });
    fixtures().forEach(({ name, r }, i) => {
      for (const p of points(100 + i, fixtures()[i])) {
        const d = R.distance(r, p);
        assert.equal(R.contains(r, p), d <= r.slack + TOL.geometry, `${name} at ${p}`);
        assert.equal(R.contains(r, p, { tol: loose }), d <= r.slack + 1e-3, `${name} at ${p}, loose`);
        assert.equal(r.contains(p), R.contains(r, p), `${name}: the bound contains disagrees`);
        assert.equal(r.contains(p, { tol: loose }), R.contains(r, p, { tol: loose }), `${name}: bound contains, loose`);
      }
    });
  });

  test('I3: distance is negative exactly inside, zero on the boundary, positive outside — for every type', () => {
    fixtures().forEach((f, i) => {
      const oracle = f.thick ?? f.inside;
      for (const p of points(200 + i, f)) {
        const d = R.distance(f.r, p) - (f.thick ? f.r.slack : 0);
        if (Math.abs(d) <= 1e-9) continue;                     // on the boundary, the sign is not the point
        assert.equal(d < 0, oracle(p), `${f.name}: distance ${d} at ${p} has the wrong sign`);
      }
      for (const b of f.boundary ?? [])
        assert.ok(Math.abs(R.distance(f.r, b)) <= 1e-12, `${f.name}: boundary point ${b} has distance ${R.distance(f.r, b)}`);
    });
    for (const name of ['point', 'circle', 'segment polygon', 'vertex polygon']) {
      const f = fixtures().find(x => x.name === name);
      assert.all(points(300, f), p => R.distance(f.r, p) >= 0, `${name} has no inside, so no negative distance`);
    }
  });

  test('distance is exact for every primitive: its size is the gap to a dense independent boundary', () => {
    fixtures().forEach((f, i) => {
      if (!f.boundary || f.boundary.length < 2 || f.name === 'halfplane') return;
      const r = rng(400 + i);
      for (let k = 0; k < 60; k++) {
        const p = [r() * 4.4 - 2.2, r() * 4.4 - 2.2];
        let best = Infinity;
        for (const b of f.boundary) best = Math.min(best, hyp(p, b));
        assert.close(Math.abs(R.distance(f.r, p)), best, 2e-3, `${f.name} at ${p}`);
      }
    });
  });

  test('I2: nearest(r, p) === p when contains(r, p); otherwise the closest point of the region, which it contains', () => {
    fixtures().forEach((f, i) => {
      const { name, r } = f;
      const pool = r.type === 'halfplane' ? null : [...R.sample(r, { res: 48 }), ...R.sample(r, { res: 400, mode: 'boundary' })];
      for (const p of points(500 + i, f, 60)) {
        if (R.contains(r, p)) { assert.ok(R.nearest(r, p) === p, `${name}: nearest moved a contained point`); continue; }
        if (r.type === 'intersection' || r.type === 'difference') {
          assert.throws(() => R.nearest(r, p), `${name}: no exact projection, so it must refuse`);
          continue;
        }
        const q = R.nearest(r, p);
        assert.ok(Object.isFrozen(q) && q !== p);
        assert.ok(R.contains(r, q), `${name}: nearest(${p}) = ${q} is not in the region`);
        assert.close(hyp(p, q), R.distance(r, p) - r.slack, 1e-9, `${name}: |p − nearest| is not the distance`);
        if (pool) assert.ok(pool.every(s => hyp(p, s) >= hyp(p, q) - 1e-9), `${name}: a sampled point is nearer than nearest(${p})`);
      }
    });
  });

  test('distance at hand-computed points', () => {
    const d = (r, p) => R.distance(r, p);
    const box = R.rect({ x0: -1, x1: 1, y0: -1, y1: 1 });
    assert.close(d(box, [2, 2]), Math.SQRT2, 1e-15, 'rect corner');
    assert.close(d(box, [0, 0]), -1, 1e-15);
    assert.close(d(box, [0.5, 0.9]), -0.1, 1e-15);
    assert.close(d(R.disk([0, 0], 1), [3, 4]), 4, 1e-15);
    const A = R.annulus([0, 0], 0.45, 1);
    assert.equal([d(A, [0, 0]), d(A, [2, 0])], [0.45, 1]);
    assert.close(d(A, [0.7, 0]), -0.25, 1e-15, 'inside the ring');
    const S = R.sector([0, 0], 0.6, 0.9, [0, Math.PI / 2]);
    assert.close(d(S, [0.75 * Math.SQRT1_2, 0.75 * Math.SQRT1_2]), -0.15, 1e-12, 'mid-sector');
    assert.close(d(S, [1.2, 0.1]), Math.hypot(1.2, 0.1) - 0.9, 1e-12, 'beyond the outer arc');
    assert.close(d(S, [0.7, -0.2]), 0.2, 1e-12, 'below the first edge');
    assert.close(d(S, [-0.5, -0.5]), Math.hypot(1.1, 0.5), 1e-12, 'behind the apex: the nearest edge end');
    assert.close(d(S, [0.1, 0.1]), 0.6 - Math.hypot(0.1, 0.1), 1e-12, 'inside the hole, within the span');
    const cap = R.capsule([0, 0], [2, 0], 0.5);
    assert.equal([d(cap, [1, 2]), d(cap, [3, 0]), d(cap, [1, 0])], [1.5, 0.5, -0.5]);
    const Lp = R.polygon([[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]]);
    assert.equal([Lp.convex, d(Lp, [1.5, 1.5]), d(Lp, [0.5, 0.5]), d(Lp, [0.5, 1.5])], [false, 0.5, -0.5, -0.5], 'the L and its notch');
    assert.equal([d(R.halfplane([3, 4], 5), [0, 0]), d(R.halfplane([3, 4], 5), [3, 4])], [-1, 4], 'a non-unit normal');
    assert.equal([d(R.circle([0, 0], 1), [0, 0]), d(R.circle([0, 0], 1), [2, 0]), d(R.circle([0, 0], 1), [1, 0])], [1, 1, 0]);
    assert.close(d(R.polygon([[0, 0], [2, 0]]), [1, 1]), 1, 1e-15, 'a segment');
    assert.close(d(R.polygon([[1, 1]]), [4, 5]), 5, 1e-15, 'a vertex');
  });

  test('the slack fix: exactness is authored, not a floating-point accident', () => {
    // realization.md §16.8: a mapped vertex lands on its point region by a 4.59e-17 residual.
    const vertex = R.point([0, 1]);
    assert.ok(R.contains(vertex, [4.59e-17, 1]), 'a round-off residual is inside tol.geometry');
    assert.ok(!R.contains(vertex, [1e-7, 1]), 'slack 0 keeps the old exact semantics beyond tol.geometry');
    const authored = R.point([0, 1], { slack: 0.01 });
    assert.ok(R.contains(authored, [0.005, 1]) && !R.contains(authored, [0.02, 1]), 'slack is a radius');
    const ring = R.circle([0, 0], 1, { slack: 0.01 });
    assert.ok(R.contains(ring, [0.995, 0]) && !R.contains(ring, [0.98, 0]) && !R.contains(ring, [0, 0]), 'a ring half-thickness');
  });

  test('the specification\'s usage block runs as written', () => {
    const strip = R.rect({ x0: -1, x1: 1, y0: -0.42, y1: 0.42 });
    const vertex = R.disk([-0.8, 0], 0.16);
    const shared = R.capsule([-0.8, 0.45], [0, -0.3], 0.2);
    const ring = R.circle([0, 0], 1, { slack: 0.01 });
    const quarter = R.sector([0, 0], 0.6, 0.9, [0, Math.PI / 2]);
    assert.equal(R.contains(strip, [0, 0.9]), false);
    assert.close(R.distance(strip, [0, 0.9]), 0.48, 1e-15);
    const o = R.outline(quarter, { res: 51 });
    assert.equal([o.rings.length, o.rings[0].length, o.exact], [1, 102, true]);
    assert.ok(R.contains(vertex, [-0.8, 0.1]) && R.contains(shared, [-0.4, 0.075]) && R.contains(ring, [0, 1.005]));
  });

  test('bounds: the box around each type, slack included; unbounded sides are infinite', () => {
    const b = r => { const x = R.bounds(r); return [x.x0, x.x1, x.y0, x.y1]; };
    assert.equal(b(R.point([1, 2], { slack: 0.5 })), [0.5, 1.5, 1.5, 2.5]);
    assert.equal(b(R.disk([1, 2], 1)), [0, 2, 1, 3]);
    assert.equal(b(R.circle([0, 0], 1, { slack: 0.25 })), [-1.25, 1.25, -1.25, 1.25]);
    assert.equal(b(R.capsule([0, 0], [2, 1], 0.5)), [-0.5, 2.5, -0.5, 1.5]);
    assert.equal(b(R.polygon([[0, 0], [2, 0], [1, 3]])), [0, 2, 0, 3]);
    const q = b(R.sector([0, 0], 0.6, 0.9, [0, Math.PI / 2]));
    [0, 0.9, 0, 0.9].forEach((v, i) => assert.close(q[i], v, 1e-15, `quarter bound ${i}`));
    const w = b(R.sector([0, 0], 0.5, 1, [Math.PI / 4, (5 * Math.PI) / 4]));
    [-1, Math.SQRT1_2, -Math.SQRT1_2, 1].forEach((v, i) => assert.close(w[i], v, 1e-12, `half-disk bound ${i}`));
    assert.equal(b(R.halfplane([0, 2], 1)).map(String), ['-Infinity', 'Infinity', '-Infinity', '0.5'], 'JSON would print ±Infinity as null');
    assert.equal(b(R.halfplane([-1, 0], 1)).map(String), ['-1', 'Infinity', '-Infinity', 'Infinity']);
    assert.equal(b(R.halfplane([1, 1], 1)).map(String), ['-Infinity', 'Infinity', '-Infinity', 'Infinity']);
    assert.equal(b(R.intersection([R.disk([0, 0], 1), R.halfplane([0, 1], 0.2)])), [-1, 1, -1, 0.2]);
    const apart = R.bounds(R.intersection([R.disk([0, 0], 1), R.disk([5, 0], 1)]));
    assert.ok(apart.x0 > apart.x1, 'disjoint parts give an inverted box');
    assert.equal(b(R.union([R.disk([0, 0], 1), R.disk([5, 0], 1)])), [-1, 6, -1, 1]);
    assert.ok(Object.isFrozen(R.bounds(R.disk([0, 0], 1))));
  });

  test('outline: closed rings of boundary points, the counts documented, no markup', () => {
    const o = (r, res) => R.outline(r, res === undefined ? undefined : { res });
    const disk = o(R.disk([0, 0], 1));
    assert.equal([disk.rings.length, disk.rings[0].length, disk.exact], [1, 51, true], 'res 51 by default');
    assert.equal(disk.rings[0][0], [1, 0], 'starts at +x');
    const shoe = P => P.reduce((s, a, i) => s + a[0] * P[(i + 1) % P.length][1] - P[(i + 1) % P.length][0] * a[1], 0);
    const ann = o(R.annulus([0, 0], 0.45, 1), 40);
    assert.equal(ann.rings.map(r => r.length), [40, 40]);
    assert.ok(shoe(ann.rings[0]) > 0 && shoe(ann.rings[1]) < 0, 'the inner ring is reversed, so either fill rule shows the hole');
    assert.equal(o(R.sector([0, 0], 0, 1, [0, 1]), 10).rings[0].length, 11, 'a pie slice: the arc and its apex');
    assert.equal(o(R.capsule([0, 0], [1, 0], 0.2), 10).rings[0].length, 20);
    assert.equal(o(R.capsule([0, 0], [0, 0], 0.2), 10).rings[0].length, 10, 'a degenerate capsule is a circle');
    assert.equal(o(R.rect({ x0: 0, x1: 2, y0: 0, y1: 1 })).rings, [[[0, 0], [2, 0], [2, 1], [0, 1]]]);
    assert.equal(o(R.polygon([[0, 0], [1, 0], [0, 1]])).rings, [[[0, 0], [1, 0], [0, 1]]]);
    assert.equal(o(R.point([3, 4])).rings, [[[3, 4]]]);
    for (const f of fixtures()) {
      if (f.r.type === 'halfplane') { assert.throws(() => R.outline(f.r), 'a halfplane has no finite outline'); continue; }
      const out = R.outline(f.r, { res: 64 });
      assert.ok(Object.isFrozen(out) && Object.isFrozen(out.rings) && out.rings.every(Object.isFrozen), `${f.name} outline frozen`);
      assert.all(out.rings.flat(), p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite), `${f.name}: polylines of points`);
      if (out.exact) assert.all(out.rings.flat(), p => Math.abs(R.distance(f.r, p)) <= 1e-12, `${f.name}: an outline point off the boundary`);
      assert.equal(out.exact, !['intersection', 'union', 'difference'].includes(f.r.type), `${f.name}: exact`);
    }
    assert.equal(o(R.intersection([R.disk([0, 0], 1), R.halfplane([0, 1], 0)]), 12).rings.length, 1, 'the halfplane part is left out');
    assert.throws(() => R.outline(R.disk([0, 0], 1), { res: 2 }));
  });

  test('sample: contained, deterministic points; a region with no inside samples itself', () => {
    for (const f of fixtures()) {
      if (f.r.type === 'halfplane') { assert.throws(() => R.sample(f.r), 'unbounded'); continue; }
      const s = R.sample(f.r, { res: 20 });
      assert.ok(s.length > 0, `${f.name}: no interior samples`);
      assert.all(s, p => R.contains(f.r, p), `${f.name}: a sample outside the region`);
      assert.equal(JSON.stringify(R.sample(f.r, { res: 20 })), JSON.stringify(s), `${f.name}: not deterministic`);
      assert.ok(Object.isFrozen(s));
    }
    assert.equal(R.sample(R.point([1, 2])), [[1, 2]]);
    assert.equal(R.sample(R.polygon([[0, 0], [1, 0]]), { res: 4 }).length, 5, 'res + 1 along a segment');
    assert.equal(R.sample(R.circle([0, 0], 1), { res: 12 }).length, 12);
    const grid = R.sample(R.rect({ x0: 0, x1: 1, y0: 0, y1: 1 }), { res: 2 });
    assert.equal(grid, [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]], 'cell centres, rows of increasing y');
    assert.equal(R.sample(R.disk([0, 0], 1), { res: 8, mode: 'boundary' }).length, 8);
    assert.throws(() => R.sample(R.disk([0, 0], 1), { mode: 'volume' }));
  });

  test('area: exact where it can be, null where it cannot', () => {
    assert.close(R.area(R.disk([0, 0], 2)), 4 * Math.PI, 1e-14);
    assert.close(R.area(R.annulus([0, 0], 0.45, 1)), Math.PI * (1 - 0.45 * 0.45), 1e-14);
    assert.close(R.area(R.sector([0, 0], 0.6, 0.9, [0, Math.PI / 2])), (Math.PI / 4) * (0.81 - 0.36), 1e-14);
    assert.close(R.area(R.rect({ x0: -1, x1: 1, y0: -0.42, y1: 0.42 })), 1.68, 1e-14);
    assert.close(R.area(R.capsule([0, 0], [2, 0], 0.5)), Math.PI * 0.25 + 2, 1e-14);
    assert.close(R.area(R.polygon([[-1, -0.8], [1, -0.8], [0, 1]])), 1.8, 1e-14);
    assert.equal(R.area(R.polygon([[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]])), 3, 'the L');
    const star = R.polygon([[0, 1], [0.588, -0.809], [-0.951, 0.309], [0.951, 0.309], [-0.588, -0.809]]);
    assert.equal([star.convex, R.area(star)], [false, null], 'a self-intersecting polygon has no shoelace area');
    assert.equal([R.area(R.point([0, 0], { slack: 1 })), R.area(R.circle([0, 0], 1)), R.area(R.polygon([[0, 0], [1, 1]]))], [0, 0, 0]);
    assert.equal([R.area(R.halfplane([0, 1], 0)), R.area(R.union([R.disk([0, 0], 1)]))], [null, null]);
    // A Monte Carlo cross-check on the two formulas with the most terms.
    const r = rng(600);
    for (const reg of [R.capsule([-0.8, 0.45], [0, -0.3], 0.2), R.sector([0.1, -0.1], 0.3, 1.2, [-2, 2.5])]) {
      const bx = R.bounds(reg), n = 40000;
      let hit = 0;
      for (let k = 0; k < n; k++) if (R.contains(reg, [bx.x0 + r() * (bx.x1 - bx.x0), bx.y0 + r() * (bx.y1 - bx.y0)])) hit++;
      assert.close(R.area(reg), hit / n * (bx.x1 - bx.x0) * (bx.y1 - bx.y0), 0.02 * R.area(reg) + 1e-3, `${reg.type} Monte Carlo`);
    }
  });

  test('isEmpty decides what it can and refuses to guess the rest', () => {
    for (const f of fixtures()) if (!['intersection', 'difference'].includes(f.r.type)) assert.equal(R.isEmpty(f.r), false, f.name);
    assert.equal(R.isEmpty(R.intersection([R.disk([0, 0], 1), R.disk([3, 0], 1)])), true, 'disjoint boxes');
    assert.equal(R.isEmpty(R.intersection([R.disk([0, 0], 1), R.disk([1.5, 0], 1)])), false, 'a witness in the lens');
    assert.equal(R.isEmpty(R.difference(R.disk([0, 0], 1), R.disk([0, 0], 0.45))), false);
    assert.throws(() => R.isEmpty(R.intersection([R.circle([0, 0], 1), R.circle([1, 0], 1)])),
      'two circles meet in two points no sample lands on: undecidable here, so it must throw');
    assert.throws(() => R.isEmpty(R.difference(R.disk([0, 0], 0.5), R.disk([0, 0], 1))),
      'an empty difference cannot be proven by sampling, so it must throw');
  });

  test('polygons: convexity is decided once, and a false claim of convexity is refused', () => {
    assert.equal(R.polygon([[0, 0], [1, 0], [1, 1], [0, 1]]).convex, true);
    assert.equal(R.polygon([[0, 0], [0, 1], [1, 1], [1, 0]]).convex, true, 'clockwise');
    assert.equal(R.polygon([[0, 0], [1, 0], [1, 0], [2, 0], [2, 1], [0, 1]]).convex, true, 'a repeated and a straight vertex');
    assert.equal(R.polygon([[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]]).convex, false);
    assert.throws(() => R.polygon([[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]], { convex: true }), 'the L is not convex');
    const declared = R.polygon([[0, 0], [1, 0], [1, 1], [0, 1]], { convex: false });
    assert.equal([declared.convex, R.distance(declared, [0.5, 0.5])], [false, -0.5], 'convex: false still answers correctly');
    assert.equal(R.polygon([[0, 0], [1, 1], [2, 2]]).convex, false, 'no area, no inside');
  });

  test('constructors and operations refuse malformed input by name', () => {
    for (const [fn, why] of [
      [() => R.point([0]), 'a 1-D point'], [() => R.point([0, 0], { slack: -1 }), 'negative slack'],
      [() => R.disk([0, 0], -1), 'negative radius'], [() => R.disk([0, NaN], 1), 'NaN centre'],
      [() => R.annulus([0, 0], 1, 0.5), 'inner > outer'], [() => R.annulus([0, 0], 0.5, 0.5), 'inner = outer'],
      [() => R.sector([0, 0], 0.5, 1, [0, 7]), 'a span of 7 radians — turns, probably'],
      [() => R.sector([0, 0], 0.5, 1, [1, 0]), 'a reversed span'],
      [() => R.rect({ x0: 1, x1: 0, y0: 0, y1: 1 }), 'x0 > x1'], [() => R.rect({ x0: 0, x1: 1 }), 'missing y'],
      [() => R.capsule([0, 0], [1], 0.2), 'a bad endpoint'], [() => R.polygon([]), 'no points'],
      [() => R.polygon([[0, 0]], { convex: 'yes' }), 'a bad convex flag'], [() => R.halfplane([0, 0], 1), 'a zero normal'],
      [() => R.intersection([]), 'no parts'], [() => R.union([{ type: 'disk' }]), 'a forged part'],
      [() => R.difference(R.disk([0, 0], 1), null), 'no b'],
      [() => R.contains({ type: 'disk', center: [0, 0], r: 1, slack: 0 }, [0, 0]), 'a forged region'],
      [() => R.distance(R.disk([0, 0], 1), [0]), 'a 1-D query point'],
      [() => R.contains(R.disk([0, 0], 1), [0, 0], { tol: { geometry: 'x' } }), 'a malformed tolerance'],
    ]) assert.throws(fn, why);
  });

  test('regions work duck-typed where Layer 2 takes a contains(): map.escapes, and difference against the annulus', () => {
    const H = M.defineFamily({ id: 'annulus_straight', at: ({ u, r }, t) => { const z = polar(u, r); return [(1 - t) * z[0] + t * 0.75, (1 - t) * z[1]]; } });
    const Y = R.annulus([0, 0], 0.45, 1);
    assert.equal(M.escapes(H, M.Annulus(), Y, { t: 0.5 }).value, true, 'the straight line enters the hole');
    assert.equal(M.escapes(H, M.Annulus(), Y, { t: 0 }).value, false, 'at t = 0 it is the inclusion');
    assert.equal(M.escapes(M.radialInterp({ to: 0.45 }), M.Annulus(), Y, { t: 0.6 }).value, false, 'the retraction stays');
    const hole = R.difference(R.disk([0, 0], 1), R.disk([0, 0], 0.45));
    const r = rng(700);
    for (let k = 0; k < 500; k++) {
      const p = [r() * 2.4 - 1.2, r() * 2.4 - 1.2], d = Math.hypot(...p);
      if (Math.abs(d - 1) < 1e-6 || Math.abs(d - 0.45) < 1e-6) continue;
      assert.equal(R.contains(hole, p), R.contains(Y, p), `difference and annulus disagree at ${p}`);
    }
  });
});
