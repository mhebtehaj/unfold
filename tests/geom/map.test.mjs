// Properties of geom/map.js.
//
// Four kinds of test. EXACTNESS PINS compare the embeddings, the inverses, the
// arrow-key steps and the families with the shipped explorer's own
// expressions — restated literally below — using Object.is over seeded sweeps
// that cross 0 and 1, because the port must land on the same bits. PICKER
// tests pin the order of operations the brief fixes (policy before any
// evaluation, first-minimum ties, a threshold that only applies to a press,
// the cache). PROPERTY tests check the spec's invariants. And the ESTIMATORS
// are checked on the shipped scenarios they replace.

import { suite, assert } from '../harness.mjs';
import * as M from '../../engine/geom/map.js';
import { polar, TAU } from '../../engine/geom/parametric.js';
import { Claim } from '../../engine/geom/claim.js';
import { TOL } from '../../engine/geom/tolerance.js';

const rng = seed => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// ---- the shipped explorer, verbatim (homotopy-explorer.html) ----------------
const S_TAU = 2 * Math.PI, INNER = 0.45, DEST = 0.75;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const sPolar = (u, r = 1) => [r * Math.cos(S_TAU * u), r * Math.sin(S_TAU * u)];
const shippedWrap = (u, delta) => (u + delta + 1) % 1;                  // keydown, line 419
const shippedInvertU = (x, y) => (Math.atan2(y, x) / S_TAU + 1) % 1;    // lines 385, 395
const shippedHomotopy = (p, q, t) => p.map((v, i) => (1 - t) * v + t * q[i]);   // eqHomotopy, line 451

const same = (got, want, msg) => {
  assert.equal(got.length, want.length, `${msg}: length`);
  for (let i = 0; i < want.length; i++)
    assert.ok(Object.is(got[i], want[i]), `${msg}[${i}]: ${got[i]} is not bit-identical to ${want[i]}`);
};

/** u values that cross 0 and 1 from both sides, plus a seeded sweep. */
function sweep(r, n = 300) {
  const out = [0, 1, 0.5, 0.005, 0.995, 0.99, 0.01, 1e-17, 1 - 1e-16, 0.35, 0.12, 0.015, 0.985];
  for (let k = 0; k < n; k++) out.push(r());
  return out;
}
const DELTAS = [0.01, -0.01, 0.5, -0.5, 0.999, -0.999, 1e-3, -1e-3];

suite('geom/map', ({ test }) => {

  test('the exported surface is exactly what the brief names', () => {
    assert.equal(Object.keys(M).sort(), [
      'Annulus', 'Circle', 'Disk', 'Interval', 'LAYER', 'PointDomain', 'Segment', 'Wedge',
      'compose', 'constantMap', 'createPicker', 'defineDomain', 'defineFamily', 'defineHomotopy', 'defineMap',
      'escapes', 'estimateImageRank', 'identity', 'isDegenerate', 'radialInterp', 'restrict', 'rotateBy',
      'scaleBy', 'straightLine', 'turningNumber',
    ].sort());
    assert.equal(M.LAYER, 2);
    assert.ok(M.defineHomotopy === M.defineFamily, 'defineHomotopy must be the SAME function object (spec Q2)');
  });

  // ---- domains -------------------------------------------------------------

  test('the built-in domains have the axes, dims and seams the brief names', () => {
    const ax = d => d.axes.map(a => [a.name, a.min, a.max, a.wrap]);
    assert.equal([M.Interval().dim, ax(M.Interval())], [1, [['u', 0, 1, false]]]);
    assert.equal(ax(M.Interval({ from: -2, to: 3 })), [['u', -2, 3, false]]);
    assert.equal(ax(M.Segment()), [['u', 0, 1, false]]);
    assert.equal(ax(M.Circle()), [['u', 0, 1, true]]);
    assert.equal([M.Disk().dim, ax(M.Disk({ r: 2 }))], [2, [['u', 0, 1, true], ['r', 0, 2, false]]]);
    assert.equal(ax(M.Annulus()), [['u', 0, 1, true], ['r', 0.45, 1, false]]);
    assert.equal([M.PointDomain().dim, M.PointDomain().axes], [0, []]);
    const wrap = { id: 'wrap', axis: 'u', at: [0, 1], identification: 'periodic' };
    assert.equal(M.Circle().seams, [wrap]);
    assert.equal(M.Disk().seams, [wrap, { id: 'center', axis: 'r', at: [0, 0], identification: 'collapse' }]);
    assert.equal(M.Annulus().seams, [wrap]);
    assert.equal([M.Interval().seams, M.Segment().seams, M.PointDomain().seams], [[], [], []]);
    for (const d of [M.Interval(), M.Segment(), M.Circle(), M.Disk(), M.Annulus(), M.PointDomain()]) {
      assert.ok(Object.isFrozen(d) && Object.isFrozen(d.axes) && Object.isFrozen(d.seams), `${d.id} is not frozen`);
      assert.all(d.axes, a => Object.isFrozen(a), `${d.id} axes`);
    }
    assert.ok(typeof M.Circle().invert === 'function' && M.Segment().invert === undefined, 'invert only where given');
    assert.equal(['disk', 'disk(r=2)', 'annulus', 'annulus(0.3,1)', 'interval', 'interval[-1,1]'],
      [M.Disk().id, M.Disk({ r: 2 }).id, M.Annulus().id, M.Annulus({ inner: 0.3 }).id,
       M.Interval().id, M.Interval({ from: -1 }).id], 'ids name their parameters');
    assert.throws(() => M.Disk({ r: 0 }));
    assert.throws(() => M.Annulus({ inner: 0 }), 'inner = 0 is a Disk');
    assert.throws(() => M.Annulus({ inner: 1, outer: 1 }));
    assert.throws(() => M.Interval({ from: 1, to: 1 }));
  });

  test('EXACT: the embeddings are the shipped expressions, bit for bit', () => {
    const r = rng(1);
    const I = M.Interval(), S = M.Segment(), C = M.Circle(), D = M.Disk(), A = M.Annulus();
    for (const u of sweep(r)) {
      const rad = r(), ra = INNER + (1 - INNER) * r();
      same(I.embed({ u }), [u], 'Interval');
      same(S.embed({ u, r: 1 }), [2 * u - 1, 0], 'Segment');                    // sourcePoint, 'interval'
      same(C.embed({ u, r: 1 }), sPolar(u, 1), 'Circle');                       // sourcePoint, 'circle'
      same(D.embed({ u, r: rad }), sPolar(u, rad), 'Disk');                     // sourcePoint, 'disk'
      same(A.embed({ u, r: ra }), sPolar(u, ra), 'Annulus');                    // sourcePoint, 'annulus'
    }
    same(M.PointDomain().embed({}), [0, 0], 'PointDomain');
  });

  test('EXACT: Circle.invert and Disk.invert are the shipped pick formulas, bit for bit', () => {
    const r = rng(2);
    const C = M.Circle(), D = M.Disk(), A = M.Annulus(), D2 = M.Disk({ r: 2 });
    const pts = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, -0], [-1, -0], [0, 0], [-0, -0], [1e-300, -1e-300], [3, 4]];
    for (let k = 0; k < 400; k++) pts.push([(r() - 0.5) * 3, (r() - 0.5) * 3]);
    for (const [x, y] of pts) {
      const u = shippedInvertU(x, y);
      const c = C.invert([x, y]);
      assert.equal(Object.keys(c), ['u'], 'Circle.invert returns { u }');
      assert.ok(Object.is(c.u, u), `Circle.invert(${x}, ${y}).u`);
      const d = D.invert([x, y]);                                     // selectNear, 'disk', line 395
      assert.equal(Object.keys(d), ['u', 'r']);
      assert.ok(Object.is(d.u, u) && Object.is(d.r, clamp(Math.hypot(x, y))), `Disk.invert(${x}, ${y})`);
      const a = A.invert([x, y]);                                     // selectNear, annulus source, line 385
      assert.ok(Object.is(a.u, u) && Object.is(a.r, clamp(Math.hypot(x, y), INNER, 1)), `Annulus.invert(${x}, ${y})`);
      assert.ok(Object.is(D2.invert([x, y]).r, Math.min(2, Math.max(0, Math.hypot(x, y)))), 'Disk({r: 2}).invert');
    }
  });

  test('EXACT: step on a wrap axis is (u + delta + 1) % 1, across 0 and 1, and keeps every field', () => {
    const r = rng(3);
    const C = M.Circle(), D = M.Disk(), A = M.Annulus();
    for (const u of sweep(r)) {
      for (const delta of [...DELTAS, (r() - 0.5) * 1.99]) {
        const input = { u, r: 1, branch: 'loop', note: 'kept' };
        const out = C.step(input, 'u', delta);
        assert.ok(Object.is(out.u, shippedWrap(u, delta)), `step(${u}, ${delta}) = ${out.u}`);
        assert.equal([out.r, out.branch, out.note], [1, 'loop', 'kept'], 'a field was lost');
        assert.ok(out !== input && input.u === u, 'step must return a new object and leave its input alone');
        assert.ok(Object.is(C.step(input, 0, delta).u, out.u), 'the axis by index');
        const d = D.step({ u, r: 0.7 }, 'u', delta);
        assert.ok(Object.is(d.u, shippedWrap(u, delta)) && d.r === 0.7, 'Disk u wraps');
        assert.ok(Object.is(A.step({ u, r: 0.7 }, 'u', delta).u, shippedWrap(u, delta)), 'Annulus u wraps');
      }
    }
    assert.throws(() => C.step({ u: 0.5 }, 'u', 1), '|delta| = 1 is outside the exact formula');
    assert.throws(() => C.step({ u: 0.5 }, 'u', -1.5));
    assert.throws(() => C.step({ u: -2 }, 'u', 0.01), 'far outside the axis');
    assert.throws(() => C.step({ r: 1 }, 'u', 0.01), 'no u to step');
    assert.throws(() => C.step({ u: 0.5 }, 'v', 0.01), 'no such axis');
    assert.throws(() => C.step({ u: 0.5 }, 3, 0.01), 'no such axis index');
    assert.throws(() => C.step({ u: 0.5 }, 'u', NaN));
  });

  test('EXACT: step on a clamp axis is Math.min(max, Math.max(min, v + delta)), pinned at both ends', () => {
    const r = rng(4);
    const I = M.Interval(), S = M.Segment(), D = M.Disk(), A = M.Annulus(), I2 = M.Interval({ from: -2, to: 3 });
    for (const v of sweep(r)) {
      for (const delta of [...DELTAS, 2, -2, (r() - 0.5) * 3]) {
        assert.ok(Object.is(I.step({ u: v, r: 1 }, 'u', delta).u, clamp(v + delta)), `Interval ${v} ${delta}`);
        assert.ok(Object.is(S.step({ u: v }, 'u', delta).u, clamp(v + delta)), 'Segment');
        const ra = INNER + (1 - INNER) * v;
        const d = D.step({ u: 0.3, r: v }, 'r', delta), a = A.step({ u: 0.3, r: ra }, 'r', delta);
        assert.ok(Object.is(d.r, clamp(v + delta, 0, 1)) && d.u === 0.3, `Disk r ${v} ${delta}`);   // keydown, line 418
        assert.ok(Object.is(a.r, clamp(ra + delta, INNER, 1)), `Annulus r ${ra} ${delta}`);
        assert.ok(Object.is(D.step({ u: 0.3, r: v }, 1, delta).r, d.r), 'the r axis by index');
        assert.ok(Object.is(I2.step({ u: v }, 'u', delta).u, Math.min(3, Math.max(-2, v + delta))), 'Interval[-2,3]');
      }
    }
    assert.equal(I.step({ u: 0.995 }, 'u', 0.01).u, 1, 'pinned at 1');
    assert.equal(I.step({ u: 0.005 }, 'u', -0.01).u, 0, 'pinned at 0');
  });

  test('a wrap axis on another interval wraps by a general modulo', () => {
    const D = M.defineDomain({ id: 'w', dim: 1, axes: [{ name: 'a', min: 2, max: 5, wrap: true }], embed: ({ a }) => [a] });
    for (const [v, d, want] of [[4.5, 1, 2.5], [2.25, -0.5, 4.75], [4.9, 0.1, 2], [3, 6, 3], [2, -3, 2]]) {
      const got = D.step({ a: v }, 'a', d).a;
      assert.close(got, want, 1e-12, `step(${v}, ${d})`);
      assert.ok(got >= 2 && got < 5, 'left [2, 5)');
    }
  });

  test('PointDomain: no axes, one input, a step that copies', () => {
    const P = M.PointDomain();
    for (const mode of ['curve', 'mesh', 'pick', 'sparse']) assert.equal(P.sample({ mode }), [{}], mode);
    assert.equal(P.sample(), [{}]);
    assert.equal(P.sample({ mode: 'boundary' }), [], 'a point has no boundary');
    const input = { u: 0, r: 1 }, out = P.step(input, 'u', 0.01);
    assert.ok(out !== input, 'step must return a new object');
    assert.equal(out, { u: 0, r: 1 }, 'step must change nothing');
  });

  test('sample is deterministic, documented, and frozen', () => {
    const C = M.Circle(), I = M.Interval(), D = M.Disk(), A = M.Annulus();
    const curve = C.sample();
    assert.equal(curve.length, 145, 'curve default is i/144, i = 0 … 144');
    assert.all(curve, (x, i) => Object.is(x.u, i / 144) && Object.keys(x).join() === 'u', 'curve inputs');
    assert.equal(I.sample({ mode: 'curve', resolution: 8 }).map(x => x.u), [0, 1, 2, 3, 4, 5, 6, 7, 8].map(i => i / 8));
    // mesh: the first axis fastest — each r row is a full u walk, rows in increasing r.
    assert.equal(D.sample({ mode: 'mesh', resolution: [4, 2] }).map(x => [x.u, x.r]),
      [0, 0.5, 1].flatMap(r => [0, 0.25, 0.5, 0.75, 1].map(u => [u, r])));
    assert.equal(D.sample({ mode: 'mesh' }).length, 25 * 25);
    // pick: a wrap axis drops its far end. Circle 720; Interval 721; the Disk grid is the shipped
    // disk_any target grid (u = a/180, r = b/20), as a set — the order is the documented one.
    assert.equal(C.sample({ mode: 'pick' }).length, 720);
    assert.equal(I.sample({ mode: 'pick' }).length, 721);
    const grid = D.sample({ mode: 'pick' });
    assert.equal(grid.length, 180 * 21);
    const want = new Set();
    for (let a = 0; a < 180; a++) for (let b = 0; b <= 20; b++) want.add(`${a / 180}|${b / 20}`);
    assert.ok(grid.every(x => want.has(`${x.u}|${x.r}`)), 'the pick grid is not the shipped grid');
    // sparse: the first axis only, others at their midpoints.
    assert.equal(C.sample({ mode: 'sparse' }).map(x => x.u), [0, 1, 2, 3, 4, 5, 6, 7, 8].map(i => i / 9));
    assert.equal(I.sample({ mode: 'sparse' }).map(x => x.u), [0, 1, 2, 3, 4, 5, 6, 7, 8].map(i => i / 8));
    assert.all(A.sample({ mode: 'sparse' }), x => x.r === (INNER + 1) / 2, 'annulus sparse radius');
    // boundary: ends of clamp axes; a collapse seam's end is a point, not boundary.
    assert.equal(C.sample({ mode: 'boundary' }), []);
    assert.equal(I.sample({ mode: 'boundary' }), [{ u: 0 }, { u: 1 }]);
    const rim = D.sample({ mode: 'boundary', resolution: 4 });
    assert.equal(rim.map(x => [x.u, x.r]), [0, 0.25, 0.5, 0.75, 1].map(u => [u, 1]), 'the disk rim, not its centre');
    assert.equal(A.sample({ mode: 'boundary', resolution: 2 }).map(x => x.r), [INNER, INNER, INNER, 1, 1, 1]);
    assert.ok(Object.isFrozen(curve) && Object.isFrozen(curve[0]), 'samples are frozen');
    assert.equal(JSON.stringify(D.sample({ mode: 'pick' })), JSON.stringify(grid), 'not deterministic');
    assert.throws(() => D.sample({ mode: 'curve' }), "'curve' is 1-D");
    assert.throws(() => C.sample({ mode: 'dense' }), 'unknown mode');
    assert.throws(() => C.sample({ resolution: 0 }));
    // Frozen inputs still step: step copies.
    assert.ok(C.step(curve[3], 'u', 0.01).u > curve[3].u);
  });

  test('defineDomain uses a domain\'s own step and sample, and refuses malformed specs', () => {
    let stepped = 0;
    const D = M.defineDomain({
      id: 'custom', dim: 1, axes: [{ name: 'u', min: 0, max: 1, wrap: false }], embed: ({ u }) => [u, u],
      step: (input) => { stepped++; return { ...input, u: 0.5 }; }, sample: () => [{ u: 0.25 }],
      invert: ([x]) => ({ u: x }),
    });
    assert.equal([D.step({ u: 0 }, 'u', 0.1).u, stepped, D.sample(), D.invert([0.3]), D.label], [0.5, 1, [{ u: 0.25 }], { u: 0.3 }, 'custom']);
    const base = { id: 'x', dim: 1, axes: [{ name: 'u', min: 0, max: 1, wrap: false }], embed: () => [0] };
    for (const [bad, why] of [
      [{ ...base, id: '' }, 'empty id'], [{ ...base, dim: 2 }, 'axes do not match dim'],
      [{ ...base, axes: [{ name: 'u', min: 1, max: 0, wrap: false }] }, 'min > max'],
      [{ ...base, axes: [{ name: 'u', min: 0, max: 1 }] }, 'no wrap flag'],
      [{ ...base, embed: undefined }, 'no embed'],
      [{ ...base, seams: [{ id: 's', axis: 'v', at: [0, 1], identification: 'periodic' }] }, 'a seam on no axis'],
      [{ ...base, seams: [{ id: 's', axis: 'u', at: [0, 1], identification: 'glued' }] }, 'unknown identification'],
      [{ ...base, dim: 2, axes: [base.axes[0], base.axes[0]] }, 'duplicate axis names'],
      [{ ...base, step: 5 }, 'step not a function'],
    ]) assert.throws(() => M.defineDomain(bad), why);
  });

  test('Wedge: inputs tagged by part, dispatch on the tag, and an arrow key never jumps branch', () => {
    // eq_tail: the loop is the circle of radius .62 about (−.2, 0), the tail runs from .42 to 1.
    const loop = ({ u }) => [-0.2 + 0.62 * Math.cos(S_TAU * u), 0.62 * Math.sin(S_TAU * u)];
    const tail = ({ u }) => [0.42 + 0.58 * u, 0];
    const W = M.Wedge({ loop: { domain: M.Circle(), embed: loop }, tail: { domain: M.Interval(), embed: tail } },
                      { key: 'branch' });
    assert.equal([W.id, W.dim, W.key, Object.keys(W.parts)], ['wedge(loop,tail)', 1, 'branch', ['loop', 'tail']]);
    const r = rng(5);
    for (const u of sweep(r, 100)) {
      same(W.embed({ u, r: 1, branch: 'loop' }), loop({ u }), 'loop embed');
      same(W.embed({ u, r: 1, branch: 'tail' }), tail({ u }), 'tail embed');
      for (const delta of [0.01, -0.01]) {
        // The shipped eq keydown: branch === 'tail' ? clamp(u + delta) : (u + delta + 1) % 1 (line 591).
        const a = W.step({ u, r: 1, branch: 'tail' }, 'u', delta), b = W.step({ u, r: 1, branch: 'loop' }, 'u', delta);
        assert.ok(Object.is(a.u, clamp(u + delta)) && a.branch === 'tail' && a.r === 1, `tail step ${u}`);
        assert.ok(Object.is(b.u, shippedWrap(u, delta)) && b.branch === 'loop' && b.r === 1, `loop step ${u}`);
      }
    }
    const s = W.sample({ mode: 'sparse' });
    assert.equal(s.map(x => x.branch), [...Array(9).fill('loop'), ...Array(9).fill('tail')], 'declaration order');
    assert.equal(Object.keys(s[0]), ['branch', 'u'], 'the tag comes first, then the coordinates');
    assert.equal(W.seams, [{ id: 'loop/wrap', axis: 'u', at: [0, 1], identification: 'periodic', part: 'loop' }]);
    assert.throws(() => W.embed({ u: 0.5, branch: 'stem' }), 'an unknown part');
    assert.throws(() => W.step({ u: 0.5 }, 'u', 0.01), 'a missing tag');
    assert.throws(() => M.Wedge({}), 'no parts');
    assert.throws(() => M.Wedge({ a: { domain: M.Circle() } }, { key: 'u' }), 'the tag collides with an axis');
    assert.equal(M.Wedge({ a: { domain: M.Circle() } }).sample({ mode: 'sparse' })[0].part, 'a', 'default key is part');
  });

  // ---- maps and families ---------------------------------------------------

  test('identity returns its argument itself; constantMap one frozen point; both are frozen Maps', () => {
    const X = M.Annulus(), id = M.identity(X), p = [0.3, 0.4];
    assert.ok(id.at(p) === p, 'identity must return the very array (EXACT straightLine depends on it)');
    assert.equal([id.domain, id.codomain].map(d => d.id), ['annulus', 'annulus']);
    const k = M.constantMap(X, [0.75, 0]);
    assert.ok(k.at({ u: 0.1 }) === k.at({ u: 0.9 }) && Object.isFrozen(k.at({})), 'one frozen point');
    assert.equal(k.at({}), [0.75, 0]);
    assert.ok(Object.isFrozen(id) && Object.isFrozen(k));
    assert.throws(() => M.identity(), 'identity needs a domain');
    assert.throws(() => M.constantMap(X, 'p'));
    assert.throws(() => M.defineMap({ id: 'm' }), 'a map needs at');
  });

  test('compose is g(f(x)), its spaces are f\'s domain and g\'s codomain, and mismatches throw at construction', () => {
    const X = M.Annulus(), Y = M.Circle();
    const f = M.defineMap({ id: 'f', domain: X, codomain: Y, at: ([x, y]) => { const r = Math.hypot(x, y); return [x / r, y / r]; } });
    const g = M.defineMap({ id: 'g', domain: Y, codomain: X, at: ([x, y]) => [0.7 * x, 0.7 * y] });
    const gf = M.compose(g, f);
    const r = rng(6);
    for (let k = 0; k < 100; k++) {
      const p = sPolar(r(), INNER + (1 - INNER) * r());
      same(gf.at(p), g.at(f.at(p)), 'compose');                           // eqRoundTrip, line 443
    }
    assert.ok(gf.domain === X && gf.codomain === X, 'I2: the spaces of a composition');
    assert.equal(gf.id, 'g∘f');
    let evaluated = 0;
    const spy = M.defineMap({ id: 'h', domain: X, codomain: X, at: x => { evaluated++; return x; } });
    assert.throws(() => M.compose(spy, f), 'codomain circle, domain annulus: must throw');
    assert.equal(evaluated, 0, 'the mismatch must be found at construction, not by evaluating');
    assert.throws(() => M.compose(g, M.defineMap({ id: 'q', codomain: {}, at: x => x })), 'an id-less space cannot be checked');
    // Either side unnamed: nothing to check, so nothing throws.
    M.compose(M.defineMap({ id: 'a', at: x => x }), f);
    M.compose(g, x => x);
    const rf = M.restrict(f, M.Annulus({ inner: 0.6 }));
    assert.equal([rf.domain.id, rf.codomain.id], ['annulus(0.6,1)', 'circle']);
    same(rf.at([0.8, 0]), f.at([0.8, 0]), 'restrict');
  });

  test('frame(t).at(x) is at(x, t), and endpoints are the frames at the ends of the range', () => {
    const X = M.Annulus();
    let calls = 0;
    const H = M.defineFamily({ id: 'annulus_retract', domain: X, codomain: X,
                               at: ({ u, r }, t) => { calls++; return sPolar(u, (1 - t) * r + t * INNER); } });
    const r = rng(7);
    for (let k = 0; k < 200; k++) {
      const x = { u: r(), r: INNER + (1 - INNER) * r() }, t = r();
      same(H.frame(t).at(x), H.at(x, t), 'frame(t).at(x)');
      same(H.endpoints().start.at(x), H.at(x, 0), 'I3: endpoints().start.at(x) === at(x, 0)');
      same(H.endpoints().end.at(x), H.at(x, 1), 'endpoints().end.at(x) === at(x, 1)');
    }
    calls = 0;
    H.frame(0.3).at({ u: 0.2, r: 0.8 });
    assert.equal(calls, 1, 'a frame evaluates the family once');
    assert.ok(H.frame(0.5).domain === X && H.frame(0.5).codomain === X);
    assert.throws(() => H.frame(1.5), 'outside the range');
    assert.throws(() => H.frame(NaN));
    const K = M.defineFamily({ id: 'k', range: [2, 4], at: (x, t) => [t, 0] });
    assert.equal([K.endpoints().start.at({})[0], K.endpoints().end.at({})[0]], [2, 4]);
    assert.ok(Object.isFrozen(H) && Object.isFrozen(H.range));
    assert.throws(() => M.defineFamily({ id: 'x', at: () => [0], range: [1, 1] }));
  });

  test('reparametrize is at(x, g(t)); concat runs the first on [0, ½], the second on [½, 1]', () => {
    const A = M.defineFamily({ id: 'a', at: (x, t) => [t, 1] });
    const B = M.defineFamily({ id: 'b', at: (x, t) => [1, t] });
    const sq = A.reparametrize(t => t * t);
    assert.equal(sq.at({}, 0.5), [0.25, 1]);
    const AB = A.concat(B);
    const r = rng(8);
    for (let k = 0; k < 200; k++) {
      const t = r();
      same(AB.at({}, t), t <= 0.5 ? A.at({}, 2 * t) : B.at({}, 2 * t - 1), `concat at ${t}`);
    }
    same(AB.at({}, 0), A.at({}, 0), 'concat starts where the first starts');
    same(AB.at({}, 1), B.at({}, 1), 'concat ends where the second ends');
    same(AB.at({}, 0.5), A.at({}, 1), 'THE SEAM: at ½ exactly, the first family at its end');
    const X = M.Circle(), Y = M.Disk();
    assert.throws(() => M.defineFamily({ id: 'p', domain: X, at: () => [0] })
      .concat(M.defineFamily({ id: 'q', domain: Y, at: () => [0] })), 'concat across different domains');
    assert.throws(() => A.reparametrize(2));
  });

  test('EXACT: straightLine is f(x).map((v, i) => (1 − t)·v + t·g(x)[i]), evaluating f and g once each', () => {
    // eq_annulus on X: the round trip g∘f sends a point radially to radius .7.
    const X = M.Annulus();
    const f = ([x, y]) => { const r = Math.hypot(x, y); return [x / r, y / r]; };
    const g = ([x, y]) => [0.7 * x, 0.7 * y];
    const roundTrip = M.compose(M.defineMap({ id: 'g', at: g }), M.defineMap({ id: 'f', at: f }));
    const H = M.straightLine(M.identity(X), roundTrip);
    const Hfn = M.straightLine(p => p, p => g(f(p)));
    const r = rng(9);
    for (let k = 0; k < 300; k++) {
      const p = sPolar(r(), INNER + (1 - INNER) * r()), t = k < 3 ? [0, 1, 0.5][k] : r();
      same(H.at(p, t), shippedHomotopy(p, g(f(p)), t), `straightLine(identity, roundTrip) at t = ${t}`);
      same(Hfn.at(p, t), shippedHomotopy(p, g(f(p)), t), 'straightLine of plain functions');
    }
    // The winding case: a = polar(u, .75), b = polar(2u, .75), same expression (mapPoint, line 169).
    const W = M.straightLine(({ u }) => sPolar(u, DEST), ({ u }) => sPolar(2 * u, DEST));
    for (const u of sweep(r, 50)) {
      const t = r(), a = sPolar(u, DEST), b = sPolar(2 * u, DEST);
      same(W.at({ u, r: 1 }, t), a.map((v, i) => (1 - t) * v + t * b[i]), 'winding');
    }
    let nf = 0, ng = 0;
    const once = M.straightLine(x => { nf++; return [1, 2, 3]; }, x => { ng++; return [4, 5, 6]; });
    once.at({}, 0.3);
    assert.equal([nf, ng], [1, 1], 'f and g must each be evaluated once per point');
    assert.throws(() => M.straightLine(M.defineMap({ id: 'a', domain: M.Circle(), at: x => x }),
                                       M.defineMap({ id: 'b', domain: M.Disk(), at: x => x })), 'different domains');
  });

  test('EXACT: radialInterp, rotateBy and scaleBy reproduce the shipped retract, rotation and contraction', () => {
    const r = rng(10);
    const retract = M.radialInterp({ to: INNER });
    const rot = M.rotateBy(0.5), shrink = M.scaleBy(t => 1 - t);
    for (const u of sweep(r, 200)) {
      const t = r(), rad = r(), ra = INNER + (1 - INNER) * r();
      same(retract.at({ u, r: ra }, t), sPolar(u, (1 - t) * ra + t * INNER), 'annulus_retract (line 168)');
      same(rot.at({ u, r: 1 }, t), sPolar(u + t / 2), 'rotation (line 173)');
      const z = sPolar(u, rad);
      same(shrink.at({ u, r: rad }, t), [(1 - t) * z[0], (1 - t) * z[1]], 'disk (line 175)');
      same(shrink.at(z, t), [(1 - t) * z[0], (1 - t) * z[1]], 'scaleBy on a point');
    }
    const rp = M.rotateBy(t => 0.25).at([1, 0], 0.7);
    assert.close(rp[0], 0, 1e-15); assert.close(rp[1], 1, 1e-15, 'a quarter turn of (1, 0)');
    assert.equal(M.radialInterp({ from: 0.2, to: () => 0.9 }).at({ u: 0 }, 0.5), [0.55, 0]);
    assert.throws(() => M.radialInterp({}), 'radialInterp needs a target radius');
    assert.throws(() => M.radialInterp({ to: 0.5 }).at({ u: 0.1 }, 0.5), 'an input without r and no from');
    assert.throws(() => M.rotateBy('half'));
    assert.throws(() => M.scaleBy(0.5), 'scaleBy takes a function of t');
  });

  // ---- picking ---------------------------------------------------------------

  /** A picker over 1-D inputs whose screen position is [100·u, 0], counting evaluations. */
  function counted(opts = {}) {
    const n = { evaluate: 0, toScreen: 0, fromScreen: 0, analytic: 0 };
    const picker = M.createPicker({
      toScreen: p => { n.toScreen++; return [100 * p[0], 100 * p[1]]; },
      evaluate: (input, ctx) => { n.evaluate++; return [input.u * (ctx?.scale ?? 1), 0]; },
      ...opts,
    });
    return { picker, n };
  }

  test('picker: the FIRST candidate with the strictly smallest distance wins', () => {
    // Binary fractions, so every screen position and every tie is exact.
    const c = [{ u: 0.5, tag: 'first' }, { u: 0.5, tag: 'second' }, { u: 0.875, tag: 'far' }];
    const { picker } = counted({ candidates: c });
    assert.equal(picker.pick([50, 3]).input.tag, 'first', 'a tie must go to the earlier candidate');
    const d = [{ u: 0.875, tag: 'far' }, { u: 0.375, tag: 'a' }, { u: 0.625, tag: 'b' }];
    assert.equal(counted({ candidates: d }).picker.pick([50, 0]).input.tag, 'a', 'equidistant (12.5 px each): the earlier');
    const hit = picker.pick([85.5, 0]);
    assert.equal([hit.input.tag, hit.distance, hit.screen], ['far', 2, [87.5, 0]]);
    assert.ok(Object.isFrozen(hit));
  });

  test('picker: the threshold applies to a press only — a drag follows the pointer anywhere', () => {
    const { picker } = counted({ candidates: [{ u: 0 }], threshold: 24 });
    assert.equal(picker.pick([30, 0]), null, '30 px from the nearest candidate, not dragging');
    const drag = picker.pick([30, 0], { dragging: true });
    assert.equal([drag.input.u, drag.distance], [0, 30], 'while dragging the pick must stick');
    assert.equal(picker.pick([24, 0]).distance, 24, 'exactly at the threshold still picks (distance > threshold refuses)');
    assert.equal(picker.pick([500, 0], { dragging: true }).input.u, 0);
    assert.equal(counted({ candidates: [{ u: 0 }], threshold: 23 }).picker.pick([23.5, 0]), null, 'a custom threshold');
    assert.throws(() => picker.pick([0, 0], { dragging: 'yes' }));
  });

  test('picker: a policy refusal returns before anything is evaluated', () => {
    const { picker, n } = counted({
      candidates: () => { n.candidates = (n.candidates ?? 0) + 1; return [{ u: 0.5 }]; },
      policy: ctx => (ctx?.refuse ? { refuse: true, reason: 'Choose a point in X: an output can have several preimages.' } : 'allow'),
    });
    picker.setContext({ refuse: true });
    const out = picker.pick([50, 0]);
    assert.equal(out, { refused: true, reason: 'Choose a point in X: an output can have several preimages.' });
    assert.ok(Object.isFrozen(out));
    assert.equal([n.evaluate, n.toScreen, n.candidates ?? 0], [0, 0, 0], 'the refusal evaluated something');
    picker.setContext({ refuse: false });
    assert.equal(picker.pick([50, 0]).input.u, 0.5, "'allow' continues");
    assert.equal(counted({ candidates: [{ u: 0 }], policy: () => undefined }).picker.pick([0, 0]).input.u, 0,
      'undefined continues');
    assert.throws(() => counted({ candidates: [{ u: 0 }], policy: () => 'deny' }).picker.pick([0, 0]), 'a malformed verdict');
  });

  test('picker: the analytic path inverts through fromScreen and evaluates nothing else', () => {
    // The disk source panel: invert the screen point analytically (selectNear, 'disk', line 392).
    const D = M.Disk(), seen = [];
    const g = { cx: 100, cy: 95, radius: 86 };
    const toScreen = p => [g.cx + g.radius * p[0], g.cy - g.radius * p[1]];
    const fromScreen = ([sx, sy]) => [(sx - g.cx) / g.radius, (g.cy - sy) / g.radius];
    let evaluated = 0;
    const picker = M.createPicker({
      toScreen, fromScreen: s => { seen.push(s); return fromScreen(s); },
      evaluate: (input) => { evaluated++; return D.embed(input); },
      candidates: () => { throw new Error('candidates must not be read on the analytic path'); },
      analytic: (point, ctx) => { seen.push(['ctx', ctx]); return D.invert(point); },
    });
    picker.setContext({ t: 0.25 });
    picker.pick([120, 50]);
    assert.equal(seen, [[120, 50], ['ctx', { t: 0.25 }]], 'fromScreen got the screen point; analytic got its result and the context');
    assert.equal(evaluated, 1, 'one evaluation per analytic pick');
    seen.length = 0; evaluated = 0;
    const r = rng(11);
    for (let k = 0; k < 100; k++) {
      const p = [r() * 200, r() * 190];
      const hit = picker.pick(p, { dragging: true });
      // The shipped arithmetic, verbatim: x, y, then r = clamp(hypot), u = (atan2/TAU + 1) % 1, then hypot.
      const x = (p[0] - g.cx) / g.radius, y = (g.cy - p[1]) / g.radius;
      const best = { u: (Math.atan2(y, x) / S_TAU + 1) % 1, r: clamp(Math.hypot(x, y)) };
      const q = [g.cx + g.radius * sPolar(best.u, best.r)[0], g.cy - g.radius * sPolar(best.u, best.r)[1]];
      assert.ok(Object.is(hit.input.u, best.u) && Object.is(hit.input.r, best.r), 'analytic input');
      assert.ok(Object.is(hit.distance, Math.hypot(p[0] - q[0], p[1] - q[1])), 'analytic distance');
    }
    assert.equal(evaluated, 100, 'one evaluation per analytic pick, and no candidate scan');
    assert.throws(() => M.createPicker({ toScreen, evaluate: D.embed, analytic: D.invert }), 'analytic needs fromScreen');
    assert.equal(M.createPicker({ toScreen, fromScreen, evaluate: D.embed, analytic: () => null }).pick([0, 0]), null,
      'an analytic miss is no pick');
  });

  test('picker: an analytic that returns undefined hands the state to the candidates', () => {
    // One picker per panel, not one per scenario: the homotopy explorer has a
    // closed-form inverse for a disk and for an annulus and none for a segment,
    // and which it is depends on the state. null is "nothing is there";
    // undefined is "not my case" — and the difference is the whole reason a
    // page does not have to build two pickers and choose between them.
    const toScreen = ([x, y]) => [100 + 50 * x, 50 - 50 * y];
    const fromScreen = ([sx, sy]) => [(sx - 100) / 50, (50 - sy) / 50];
    let scans = 0;
    const make = analytic => M.createPicker({
      toScreen, fromScreen, analytic,
      evaluate: input => [input.u, 0],
      candidates: () => { scans++; return [{ u: -1 }, { u: 0 }, { u: 1 }]; },
    });
    assert.equal(make(() => undefined).pick([100, 50]).input, { u: 0 }, 'undefined falls through');
    assert.equal(scans, 1, 'and only then is the grid built');
    assert.equal(make(() => null).pick([100, 50]), null, 'null still means no pick');
    assert.equal(scans, 1, 'a definite miss reads no candidates');
    assert.equal(make(() => ({ u: 1 })).pick([150, 50]).input, { u: 1 }, 'an answer is still an answer');
    assert.equal(scans, 1);
    // The threshold applies to whichever path answered.
    assert.equal(make(() => undefined).pick([100, 200]), null, 'the fall-through obeys the threshold');
  });

  test('picker: candidate positions are cached until invalidate() or setContext()', () => {
    const cands = [{ u: 0.1 }, { u: 0.2 }, { u: 0.3 }];
    let listed = 0;
    const { picker, n } = counted({ candidates: ctx => { listed++; return cands; } });
    picker.pick([10, 0]);
    assert.equal([n.evaluate, listed], [3, 1], 'the first pick fills the cache');
    for (let k = 0; k < 10; k++) picker.pick([20 + k, 0], { dragging: true });
    assert.equal([n.evaluate, listed], [3, 1], 'a pointermove must not re-evaluate');
    picker.invalidate();
    picker.pick([10, 0]);
    assert.equal([n.evaluate, listed], [6, 2], 'invalidate() refills');
    picker.setContext({ scale: 2 });
    assert.equal(picker.context, { scale: 2 });
    const hit = picker.pick([40, 0]);
    assert.equal([n.evaluate, listed], [9, 3], 'setContext() refills');
    assert.equal(hit.input.u, 0.2, 'the refill used the new context (0.2 · 2 · 100 = 40)');
    const arr = counted({ candidates: cands });
    arr.picker.pick([0, 0]); arr.picker.pick([0, 0]);
    assert.equal(arr.n.evaluate, 3, 'an array of candidates is cached too');
    assert.equal(counted({ candidates: [] }).picker.pick([0, 0]), null, 'no candidates, no pick');
    assert.equal(counted({}).picker.pick([0, 0]), null);
    assert.equal(counted({}).picker.context, null, 'the context starts as null');
  });

  test('picker: over the shipped 721-candidate circle loop, the same input and distance to the bit', () => {
    const g = { cx: 140, cy: 111, radius: 86 };
    const screenPoint = p => [g.cx + g.radius * p[0], g.cy - g.radius * p[1]];
    const position = (input, t) => sPolar((1 - t) * input.u);            // segment_circle / circle_unwrap
    const count = 721, candidates = Array.from({ length: count }, (_, i) => ({ u: i / (count - 1), r: 1 }));
    const picker = M.createPicker({ toScreen: screenPoint, evaluate: (input, ctx) => position(input, ctx.t), candidates });
    const r = rng(12);
    for (const t of [0, 0.5, 0.9]) {
      picker.setContext({ t });
      for (let k = 0; k < 60; k++) {
        const p = [g.cx + (r() - 0.5) * 220, g.cy + (r() - 0.5) * 220];
        let best = null, bestDist = Infinity;                                  // selectNear, lines 399–403
        for (let i = 0; i < count; i++) {
          const input = { u: count === 1 ? 0 : i / (count - 1), r: 1 }, q = screenPoint(position(input, t));
          const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
          if (d < bestDist) { bestDist = d; best = input; }
        }
        const dragging = k % 2 === 0, hit = picker.pick(p, { dragging });
        if (!dragging && bestDist > 24) { assert.equal(hit, null, 'the shipped loop refused this press'); continue; }
        assert.ok(Object.is(hit.input.u, best.u) && Object.is(hit.distance, bestDist), `t = ${t}, pointer ${p}`);
      }
    }
  });

  // ---- degeneracy, escape, turning --------------------------------------------

  test('estimateImageRank reads the image\'s dimension on the shipped scenarios, as a heuristic', () => {
    const D = M.Disk(), A = M.Annulus(), C = M.Circle();
    const rank = (m, d, o) => M.estimateImageRank(m, d, o).value.rank;
    const retract = M.radialInterp({ to: INNER });
    assert.equal(rank(retract, A, { t: 1 }), 1, 'annulus_retract at t = 1: radial points meet on a circle');
    assert.equal(rank(retract, A, { t: 0.5 }), 2);
    const diskToCircle = M.defineMap({ id: 'dc', at: inp => sPolar(D.embed(inp)[0] / 2) });   // disk_any, circle
    assert.equal(rank(diskToCircle, D), 1, 'disk_any onto the circle: the diameter renderer');
    assert.equal(rank(M.defineMap({ id: 'dia', at: inp => [D.embed(inp)[0], 0] }), D), 1, 'eq_disk_segment');
    assert.equal(rank(M.defineMap({ id: 'rad', at: inp => { const [x, y] = A.embed(inp), q = Math.hypot(x, y); return [x / q, y / q]; } }), A),
      1, 'eq_annulus: the radial projection');
    assert.equal(rank(M.defineMap({ id: 'id', at: D.embed }), D), 2, 'the identity on the disk');
    assert.equal(rank(M.scaleBy(t => 1 - t), D, { t: 1 }), 0, 'disk contraction at t = 1');
    assert.equal(rank(M.scaleBy(t => 1 - t), D, { t: 0.999999 }), 2, 'a small disk is still a disk');
    for (const n of [2, 5, 25])
      assert.equal(rank(M.defineMap({ id: `p${n}`, at: inp => sPolar(n * D.embed(inp)[0]) }), D), 1, `a curve wound ${n} times`);
    assert.equal(rank(M.defineMap({ id: 'w', at: ({ u }) => sPolar(3 * u) }), C), 1);
    assert.equal(rank(M.defineMap({ id: 'pt', at: () => [1, 2] }), M.PointDomain()), 0);
    const c = M.estimateImageRank(retract, A, { t: 1 });
    assert.ok(Claim.isComputed(c) && c.sound === false && c.method === 'sampled-differential', 'a heuristic claim');
    assert.equal(c.value.degenerate, true);
    assert.equal(c.value.basis.length, 1);
    assert.close(Math.hypot(...c.value.basis[0]), 1, 1e-12, 'basis vectors are unit');
    assert.ok(c.value.singularValues[0] >= c.value.singularValues[1], 'descending');
    assert.equal(Claim.render(c).glyph, '≈');
    assert.throws(() => M.estimateImageRank(retract, A), 'a family needs t');
    assert.throws(() => M.estimateImageRank(diskToCircle, D, { t: 0.5 }), 'a map has no t');
    assert.throws(() => M.estimateImageRank(x => x, D), 'a plain function is neither');
  });

  test('estimateImageRank never evaluates a map outside its domain, so a map need only be defined there', () => {
    // A map may be undefined past its domain (a square root of 1 − r², a tail that ends).
    // The difference stencil is moved inside the axis box rather than clipped or wrapped.
    const D = M.Disk(), outside = [];
    const guarded = M.defineMap({ id: 'guarded', at: input => {
      if (!(input.u >= 0 && input.u <= 1 && input.r >= 0 && input.r <= 1)) outside.push(input);
      return [input.r * Math.cos(S_TAU * input.u), Math.sqrt(1 - input.r * input.r)];
    } });
    assert.equal(M.estimateImageRank(guarded, D).value.rank, 2);
    assert.equal(outside.length, 0, `evaluated outside the disk's axes at ${JSON.stringify(outside[0])}`);
    // A wedge differentiates each input along its OWN part's axes: this tail stops at u = 0.5.
    const W = M.Wedge({ loop: { domain: M.Circle() }, tail: { domain: M.Interval({ from: 0, to: 0.5 }), embed: ({ u }) => [1 + u, 0] } });
    const past = [];
    const onWedge = M.defineMap({ id: 'w', at: input => {
      if (input.part === 'tail' && !(input.u >= 0 && input.u <= 0.5)) past.push(input);
      return W.embed(input);
    } });
    assert.equal(M.estimateImageRank(onWedge, W).value.rank, 1);
    assert.equal(past.length, 0, `evaluated the tail past its end at ${JSON.stringify(past[0])}`);
  });

  test('isDegenerate is the numeric collapsed(), and it is memoised per map, t and domain', () => {
    const X = M.Interval(), C = M.Circle();
    let calls = 0;
    const H = M.defineFamily({ id: 'segment_circle', at: ({ u }, t) => { calls++; return sPolar((1 - t) * u); } });
    assert.equal(M.isDegenerate(H, X, { t: 1 }), true, 'segment_circle collapses at t = 1');
    assert.equal(M.isDegenerate(H, X, { t: 0.5 }), false);
    const before = calls;
    assert.equal(M.isDegenerate(H, X, { t: 1 }), true);
    assert.equal(calls, before, 'the second call must come from the memo');
    M.isDegenerate(H, C, { t: 1 });
    assert.ok(calls > before, 'a different domain must not share the memo');
    const mid = calls;
    M.isDegenerate(H, X, { t: 1, samples: 7 });
    assert.ok(calls > mid, 'a different sample count must not share the memo');
    assert.equal(M.isDegenerate(M.scaleBy(t => 1 - t), M.Disk(), { t: 1 }), true, 'disk at t = 1');
    assert.equal(M.isDegenerate(M.constantMap(C, [0, 0]), C), true, 'eq_disk_point');
    assert.equal(M.isDegenerate(M.defineMap({ id: 'tiny', at: ({ u }) => [u * 5e-9, 0] }), X), true, 'within tol.geometry');
    assert.equal(M.isDegenerate(M.defineMap({ id: 'small', at: ({ u }) => [u * 2e-8, 0] }), X), false, 'beyond it');
  });

  test('escapes: a sample outside is a proof; none found proves nothing', () => {
    // annulus_straight: (1 − t)z + t(.75, 0) (line 167) enters the hole for some t.
    const X = M.Annulus();
    const H = M.defineFamily({ id: 'annulus_straight', at: ({ u, r }, t) => { const z = sPolar(u, r); return [(1 - t) * z[0] + t * DEST, (1 - t) * z[1]]; } });
    const hole = { contains: ([x, y]) => { const d = Math.hypot(x, y); return d >= INNER - 1e-8 && d <= 1 + 1e-8; } };
    const c = M.escapes(H, X, hole, { t: 0.5 });
    assert.ok(Claim.isComputed(c) && c.sound === 'positive' && c.method === 'sampled');
    assert.equal(c.value, true);
    assert.ok(c.witnesses.length > 0 && c.witnesses.every(w => !hole.contains(w.point)), 'every witness is outside');
    same(c.witnesses[0].point, H.at(c.witnesses[0].input, 0.5), 'a witness names its input');
    assert.equal(Claim.render(c).glyph, '✓');
    const none = M.escapes(H, X, hole, { t: 0 });
    assert.equal([none.value, none.witnesses.length, Claim.render(none).glyph], [false, 0, '—'],
      'finding nothing renders as not-a-proof');
    assert.equal(none.budget.samples, 256);
    const viaOption = M.escapes(H, X, { any: 'thing' }, { t: 0.5, contains: (region, p) => hole.contains(p) });
    assert.equal(viaOption.value, true, 'the contains option');
    assert.throws(() => M.escapes(H, X, {}, { t: 0.5 }), 'a region needs contains');
    assert.throws(() => M.escapes(H, X, { contains: () => 1 }, { t: 0.5 }), 'contains must answer true or false');
  });

  test('turningNumber: the signed-angle sum in turns, sound only when every step is under π/2', () => {
    const C = M.Circle();
    const loop = f => ({ points: C.sample({ mode: 'curve' }).map(f), closed: true });
    const once = M.turningNumber(loop(({ u }) => sPolar(u)));
    assert.ok(Claim.isComputed(once) && once.sound === true);
    assert.close(once.value, 1, 1e-12);
    assert.close(once.budget.maxStep, S_TAU / 144, 1e-12, 'maxStep is reported');
    assert.close(M.turningNumber(loop(({ u }) => sPolar(2 * u, DEST))).value, 2, 1e-12, 'winding: 2 turns');
    assert.close(M.turningNumber(loop(({ u }) => sPolar(-u))).value, -1, 1e-12, 'orientation is signed');
    const local = loop(({ u }) => { const a = sPolar(u, 0.2); return [DEST + a[0], a[1]]; });
    assert.close(M.turningNumber(local).value, 0, 1e-12, 'local_loop does not wind around the hole');
    assert.close(M.turningNumber(local, { center: [DEST, 0] }).value, 1, 1e-12, 'but it winds around its own centre');
    const square = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 0]];
    assert.equal(M.turningNumber(square).reason, 'undersampled', 'steps of exactly π/2 are not < π/2');
    assert.ok(Claim.isUnknown(M.turningNumber(square)));
    const octagon = Array.from({ length: 9 }, (_, i) => sPolar(i / 8));
    assert.close(M.turningNumber(octagon).value, 1, 1e-12, 'eight steps of π/4 suffice');
    assert.close(M.turningNumber({ points: octagon.slice(0, 8), closed: true }).value, 1, 1e-12, 'closed adds the last step');
    assert.close(M.turningNumber(octagon.slice(0, 8)).value, 7 / 8, 1e-12, 'a bare array is taken as given');
    assert.equal(M.turningNumber([[0, 0], [1, 0], [0, 1]]).reason, 'passes through the centre');
    assert.equal(M.turningNumber([[1, 0]]).reason, 'fewer than two points');
    assert.throws(() => M.turningNumber([[1, 0], [0]]));
  });
});
