// Properties of geom/parametric.js.
//
// polar and the catalogue curves are EXACT: the homotopy port must land on the
// shipped explorer's bits, so they are compared with Object.is against the
// shipped expressions, restated literally below, over seeded sweeps. The seam
// API is checked on the example it exists for: circle_unwrap, u ↦ polar((1−t)u)
// on the circle, which jumps across u = 0 ~ 1 for every 0 < t < 1 and not at t = 0.

import { suite, assert } from '../harness.mjs';
import * as P from '../../engine/geom/parametric.js';
import { TOL } from '../../engine/geom/tolerance.js';

const rng = seed => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// The shipped explorer, verbatim (homotopy-explorer.html line 82 and 132).
const SHIPPED_TAU = 2 * Math.PI;
const shippedPolar = (u, r = 1) => [r * Math.cos(SHIPPED_TAU * u), r * Math.sin(SHIPPED_TAU * u)];

const same = (got, want, msg) => {
  assert.equal(got.length, want.length, `${msg}: length`);
  for (let i = 0; i < want.length; i++)
    assert.ok(Object.is(got[i], want[i]), `${msg}[${i}]: ${got[i]} is not bit-identical to ${want[i]}`);
};

suite('geom/parametric', ({ test }) => {

  test('the exported surface is exactly what the brief names', () => {
    assert.equal(Object.keys(P).sort(), ['LAYER', 'TAU', 'circle', 'defineCurve', 'polar', 'segment']);
    assert.equal(P.LAYER, 2);
    assert.ok(Object.is(P.TAU, SHIPPED_TAU));
  });

  test('polar is the shipped expression, bit for bit, in turns', () => {
    const r = rng(1);
    for (let k = 0; k < 500; k++) {
      const u = r() * 5 - 2, rad = r() * 2;
      same(P.polar(u, rad), shippedPolar(u, rad), `polar(${u}, ${rad})`);
      same(P.polar(u), shippedPolar(u), `polar(${u})`);
    }
    for (const u of [0, 0.25, 0.5, 1, -0, 1e-17, 0.015, 0.985]) same(P.polar(u), shippedPolar(u), `polar(${u})`);
    // The seam is real at the level of bits: u + 1 names the same point only up to float error.
    assert.ok(!Object.is(P.polar(1)[1], 0), 'polar(1) is exactly (1, 0) — the seam would be invisible');
    assert.close(P.polar(1)[1], 0, 1e-15);
  });

  test('defineCurve validates what it is given and freezes what it returns', () => {
    const c = P.defineCurve({ id: 'c', at: u => [u, 0] });
    assert.ok(Object.isFrozen(c) && Object.isFrozen(c.domain) && Object.isFrozen(c.seams));
    assert.equal([c.id, c.label, c.closed, c.seams], ['c', 'c', false, []]);
    assert.equal(Object.keys(c).sort(), ['arcLength', 'at', 'closed', 'domain', 'id', 'identify', 'jumpAcross',
      'label', 'polyline', 'seamProbes', 'seams', 'tangent']);
    for (const bad of [{}, { id: 'x' }, { id: '', at: u => [u] }, { id: 'x', at: u => [u], domain: [1, 0] },
      { id: 'x', at: u => [u], domain: [0, NaN] }, { id: 'x', at: u => [u], closed: 1 },
      { id: 'x', at: u => [u], tangent: 3 }])
      assert.throws(() => P.defineCurve(bad), `accepted ${JSON.stringify(bad)}`);
  });

  test('polyline has res + 1 points at params d0 + (d1 − d0)·i/res, both ends even when closed', () => {
    const calls = [];
    const c = P.defineCurve({ id: 'c', domain: [0.25, 2], closed: true, at: u => { calls.push(u); return [u, u * u]; } });
    const pl = c.polyline({ res: 7 });
    assert.equal(pl.points.length, 8);
    assert.equal(pl.closed, true);
    for (let i = 0; i <= 7; i++) {
      assert.ok(Object.is(pl.params[i], 0.25 + (2 - 0.25) * i / 7), `params[${i}]`);
      same(pl.points[i], [pl.params[i], pl.params[i] ** 2], `points[${i}]`);
    }
    assert.ok(pl.params[0] === 0.25 && pl.params[7] === 2, 'both ends are included');
    assert.ok(Object.isFrozen(pl) && Object.isFrozen(pl.points) && Object.isFrozen(pl.params));
    // On [0, 1] the parameter is exactly i/res — the shipped curve loop's i/N.
    const u = P.circle().polyline().params;
    assert.equal(u.length, 145, 'default res is 144');
    assert.all(u, (v, i) => Object.is(v, i / 144), 'params are not i/144');
    assert.throws(() => c.polyline({ res: 0 }));
    assert.throws(() => c.polyline({ res: 2.5 }));
  });

  test('tangent: the analytic one when given, else a difference that stays in the domain', () => {
    let analytic = 0;
    const withT = P.defineCurve({ id: 'a', at: u => [u, u * u], tangent: u => { analytic++; return [1, 2 * u]; } });
    assert.equal(withT.tangent(0.3), [1, 0.6]);
    assert.equal(analytic, 1, 'the analytic tangent was not used');
    const seen = [];
    const open = P.defineCurve({ id: 'o', domain: [0, 1], at: u => { seen.push(u); return [u, u * u * u]; } });
    for (const u of [0, 0.2, 0.5, 1]) {
      const t = open.tangent(u);
      assert.close(t[0], 1, 1e-9, `d/du u at ${u}`);
      assert.close(t[1], 3 * u * u, 1e-4, `d/du u³ at ${u}`);
    }
    assert.all(seen, u => u >= 0 && u <= 1, 'an open curve was evaluated outside its domain');
    const closed = P.defineCurve({ id: 'k', closed: true, at: u => P.polar(u) });
    const t0 = closed.tangent(0);
    assert.close(t0[0], 0, 1e-8); assert.close(t0[1], P.TAU, 1e-6, 'central difference across a periodic end');
    assert.throws(() => open.tangent(0.5, { h: 0 }));
  });

  test('arcLength converges on 2πr and a segment is exact', () => {
    assert.close(P.circle(2).arcLength(), 4 * Math.PI, 1e-4);
    assert.close(P.circle(2).arcLength({ res: 4096 }), 4 * Math.PI, 2e-6);
    assert.close(P.segment([0, 0], [3, 4]).arcLength(), 5, 1e-12);
  });

  test('a closed curve has one periodic seam; an open one has none', () => {
    assert.equal(P.circle().seams, [{ id: 'wrap', axis: 'u', at: [0, 1], identification: 'periodic' }]);
    const c = P.defineCurve({ id: 'c', domain: [2, 5], closed: true, at: u => [u] });
    assert.equal(c.seams[0].at, [2, 5]);
    assert.ok(Object.isFrozen(c.seams[0]) && Object.isFrozen(c.seams[0].at));
    assert.equal(P.segment([0, 0], [1, 0]).seams, []);
  });

  test('seamProbes lands on the shipped a/b markers, .015 and .985, bit for bit', () => {
    const c = P.circle();
    const ab = c.seamProbes();
    assert.equal(ab.length, 2);
    assert.ok(Object.is(ab[0], 0.015) && Object.is(ab[1], 0.985), `got [${ab}]`);
    assert.equal(c.seamProbes(c.seams[0], { inset: 0.1 }), [0.1, 0.9]);
    assert.ok(Object.isFrozen(ab));
  });

  test('seamProbes with more probes: count/2 at each end, ascending, mirrored', () => {
    const c = P.defineCurve({ id: 'c', domain: [2, 5], closed: true, at: u => [u] });
    const p = c.seamProbes(c.seams[0], { count: 6, inset: 0.1 });
    assert.equal(p.length, 6);
    for (let i = 1; i < p.length; i++) assert.ok(p[i] > p[i - 1], 'not ascending');
    [2.1, 2.2, 2.3, 4.7, 4.8, 4.9].forEach((v, i) => assert.close(p[i], v, 1e-12, `probe ${i}`));
    for (let k = 0; k < 3; k++) assert.close(p[k] - 2, 5 - p[5 - k], 1e-12, 'probes are not mirrored');
    assert.throws(() => c.seamProbes(c.seams[0], { count: 3 }), 'an odd count');
    assert.throws(() => c.seamProbes(c.seams[0], { count: 0 }), 'a zero count');
    assert.throws(() => c.seamProbes(c.seams[0], { count: 40, inset: 0.1 }), 'probes that cross the middle');
    assert.throws(() => c.seamProbes(c.seams[0], { inset: 0 }), 'no inset');
    assert.throws(() => P.segment([0, 0], [1, 1]).seamProbes(), 'an open curve has no default seam');
    assert.throws(() => c.seamProbes({ at: [0, 1] }), 'not a seam');
  });

  test('identify is a canonical representative in [d0, d1), and idempotent to the bit', () => {
    const c = P.circle();
    const r = rng(2);
    const us = [0, -0, 1, 2, -1, 1 - 1e-17, -1e-17, 1e-17, 0.999999999999, -3.25, 7.5, 0.3, 1e6 + 0.25];
    for (let k = 0; k < 400; k++) us.push((r() - 0.5) * 20, r(), -r() * 1e-15);
    for (const u of us) {
      const v = c.identify(u);
      assert.ok(v >= 0 && v < 1, `identify(${u}) = ${v} is outside [0, 1)`);
      assert.ok(Object.is(c.identify(v), v), `identify(identify(${u})) moved`);
      assert.ok(!Object.is(v, -0), `identify(${u}) is −0`);
      assert.close(Math.cos(P.TAU * v), Math.cos(P.TAU * u), 1e-6, `identify(${u}) is not the same point`);
    }
    assert.ok(Object.is(c.identify(0.3), 0.3), 'a canonical value was moved');
    assert.equal(c.identify(1), 0);
    const k = P.defineCurve({ id: 'k', domain: [2, 5], closed: true, at: u => [u] });
    for (const u of [2, 5, 1.5, 11.75, -4]) {
      const v = k.identify(u);
      assert.ok(v >= 2 && v < 5 && Object.is(k.identify(v), v), `identify on [2, 5) at ${u}`);
    }
    assert.ok(Object.is(P.segment([0], [1]).identify(1.7), 1.7), 'an open curve identifies nothing');
    assert.throws(() => c.identify(NaN));
  });

  test('jumpAcross finds circle_unwrap for every 0 < t < 1, and nothing at t = 0', () => {
    const C = P.circle();
    const unwrap = t => u => P.polar((1 - t) * u);
    assert.equal(C.jumpAcross(C.seams[0], unwrap(0)), null, 't = 0 is the identity, which descends');
    for (const t of [0.05, 0.25, 0.5, 0.75, 0.95]) {
      const j = C.jumpAcross(C.seams[0], unwrap(t));
      assert.ok(j !== null, `no witness at t = ${t}`);
      const w = j.witness;
      assert.equal([w.left, w.right], [0, 1]);
      same(w.leftImage, P.polar(0), 'leftImage');
      same(w.rightImage, P.polar(1 - t), 'rightImage');
      assert.close(w.distance, 2 * Math.abs(Math.sin(Math.PI * (1 - t))), 1e-12, `jump size at t = ${t}`);
      assert.ok(w.distance > TOL.geometry);
      assert.ok(Object.isFrozen(j) && Object.isFrozen(w));
    }
    const r = rng(3);
    for (let k = 0; k < 50; k++) {
      const t = 0.01 + r() * 0.98;
      assert.ok(C.jumpAcross(C.seams[0], unwrap(t)) !== null, `missed the jump at t = ${t}`);
    }
  });

  test('jumpAcross finds nothing for maps that descend, and says nothing it cannot', () => {
    const C = P.circle();
    assert.equal(C.jumpAcross(C.seams[0], u => P.polar(u + 0.3)), null, 'a rotation descends');
    assert.equal(C.jumpAcross(C.seams[0], u => P.polar(3 * u)), null, 'degree 3 descends');
    assert.ok(C.jumpAcross(C.seams[0], u => P.polar(2.5 * u)) !== null, 'a half-integer degree does not');
    // A looser tolerance can hide a small jump; it cannot invent one.
    const tiny = u => [u * 1e-9, 0];
    assert.ok(C.jumpAcross(C.seams[0], tiny) === null, 'a 1e-9 jump is under tol.geometry');
    assert.ok(C.jumpAcross(C.seams[0], tiny, { tol: { ...TOL, geometry: 1e-12 } }) !== null);
    const none = { id: 'x', axis: 'u', at: [0, 1], identification: 'none' };
    assert.throws(() => C.jumpAcross(none, u => [u]), 'a none seam identifies nothing to jump across');
    assert.throws(() => C.jumpAcross(C.seams[0], u => [NaN, 0]), 'a non-finite image');
    assert.throws(() => C.jumpAcross(C.seams[0], 'f'));
  });

  test('circle(r, {center}) is [c0 + p[0], c1 + p[1]] with p = polar(u, r), bit for bit', () => {
    const r = rng(4);
    for (let k = 0; k < 50; k++) {
      const rad = r() * 2, c = [r() * 4 - 2, r() * 4 - 2], C = P.circle(rad, { center: c });
      for (let j = 0; j < 10; j++) {
        const u = r() * 3 - 1, p = shippedPolar(u, rad);
        same(C.at(u), [c[0] + p[0], c[1] + p[1]], `circle(${rad}).at(${u})`);
      }
      const u = r(), h = 1e-6, a = C.at(u - h), b = C.at(u + h), t = C.tangent(u);
      assert.close(t[0], (b[0] - a[0]) / (2 * h), 1e-4 * (1 + rad), 'analytic tangent x');
      assert.close(t[1], (b[1] - a[1]) / (2 * h), 1e-4 * (1 + rad), 'analytic tangent y');
    }
    assert.ok(P.circle().closed && P.circle().id === 'circle');
    assert.throws(() => P.circle(-1));
    assert.throws(() => P.circle(1, { center: [0] }));
  });

  test('segment(a, b) is (1 − u)·a + u·b componentwise, bit for bit, and hits its ends', () => {
    const r = rng(5);
    for (let k = 0; k < 100; k++) {
      const a = [r() * 4 - 2, r() * 4 - 2, r()], b = [r() * 4 - 2, r() * 4 - 2, r()], S = P.segment(a, b), u = r();
      same(S.at(u), a.map((v, i) => (1 - u) * v + u * b[i]), 'segment.at');
      same(S.at(0), a, 'segment.at(0) is not a');
      same(S.at(1), b, 'segment.at(1) is not b');
      same(S.tangent(u), b.map((v, i) => v - a[i]), 'segment tangent');
    }
    const src = [1, 2], S = P.segment(src, [3, 4]);
    src[0] = 99;
    assert.equal(S.at(0), [1, 2], 'the segment kept a reference to its caller\'s array');
    assert.ok(!S.closed);
    assert.throws(() => P.segment([0, 0], [1]));
  });
});
