// The placer's contract: scored placement, declared priority, a stated tie
// rule, and a drop that is reported rather than vanishing.
//
// Each test names the behaviour of the two copies it replaces: first-fit by
// loop order, `text.length * 3.5 + 3` as a box model, and a label that does not
// fit simply not appearing — with no leader, no shrink and no list for a
// viewer who cannot see the scene.
//
// No DOM: the placer is in the pure set, which is what lets the string-building
// explorers adopt it, so the last test checks that nothing it returns is a node.

import { suite, assert } from './harness.mjs';
import { LabelPlacer, candidates, metricText, ADVANCE } from '../engine/core/labels.js';

const overlaps = (a, b) =>
  Math.min(a.right, b.right) > Math.max(a.left, b.left) &&
  Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top);

const byId = list => Object.fromEntries(list.map(p => [p.id, p]));

/** Plain data only: no nodes, no class instances, no functions. */
function isPlainData(v, seen = []) {
  if (v === null || ['string', 'number', 'boolean', 'undefined'].includes(typeof v)) return true;
  if (Array.isArray(v)) return v.every(x => isPlainData(x, seen));
  if (typeof v !== 'object') return false;              // function, symbol, bigint
  if (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) return false;
  return Object.values(v).every(x => isPlainData(x, seen));
}

suite('labels: scoring', ({ test }) => {
  test('two labels that would overlap take different candidates', () => {
    const placer = new LabelPlacer();
    const { placed, dropped } = placer.place([
      { id: 'a', text: 'A', anchor: [100, 100] },
      { id: 'b', text: 'B', anchor: [100, 105] },
    ]);
    assert.equal(dropped.length, 0);
    assert.equal(placed.length, 2);
    const a = byId(placed).a, b = byId(placed).b;
    assert.equal(a.candidateIndex, 0, 'the first label gets the anchor');
    assert.ok(b.candidateIndex !== 0, 'the second must move');
    assert.ok(!overlaps(a.rect, b.rect), 'and the boxes must actually separate');
  });

  test('the minimum-scoring candidate wins, not the first that clears', () => {
    // Candidate 1 clears but is expensive; candidate 2 clears and is cheaper.
    // First-fit — an accident of loop order — would take candidate 1.
    const placer = new LabelPlacer();
    const { placed } = placer.place([{
      id: 'a', text: 'A', anchor: [100, 100],
      candidates: [{ dx: 0, dy: 0 }, { dx: 30, dy: 0, cost: 5 }, { dx: 0, dy: 30 }],
    }], { obstacles: [{ left: 95, right: 105, top: 95, bottom: 105 }] });

    assert.equal(placed.length, 1);
    assert.equal(placed[0].candidateIndex, 2);
  });

  test('equal-scoring candidates go to the lower index', () => {
    const placer = new LabelPlacer();
    const { placed } = placer.place([{
      id: 'a', text: 'A', anchor: [0, 0],
      candidates: [{ dx: 17, dy: 0 }, { dx: -17, dy: 0 }],   // same offset, same cost
    }]);
    assert.equal(placed[0].candidateIndex, 0);
  });

  test('a penalized overlap beats no label at all', () => {
    const wall = [{ left: 0, right: 400, top: 0, bottom: 400 }];
    const strict = new LabelPlacer();
    const soft = new LabelPlacer({ overlapPolicy: 'penalize' });
    const item = { id: 'a', text: 'A', anchor: [200, 200] };

    assert.equal(strict.place([item], { obstacles: wall }).placed.length, 0);
    const out = soft.place([item], { obstacles: wall });
    assert.equal(out.placed.length, 1);
    assert.ok(Number.isFinite(out.placed[0].score), 'and the score says how bad it is');
    assert.ok(out.placed[0].score > 0);
  });

  test('the offset penalty prefers the anchor when nothing is in the way', () => {
    const placer = new LabelPlacer();
    const { placed } = placer.place([{ id: 'a', text: 'A', anchor: [50, 50] }]);
    assert.equal(placed[0].candidateIndex, 0);
    assert.equal(placed[0].score, 0, 'candidate 0 costs nothing: no cost, no offset, no penalty');
    assert.equal([placed[0].x, placed[0].y], [50, 50]);
  });
});

suite('labels: priority and determinism', ({ test }) => {
  const contested = [
    { id: 'low', text: 'L', anchor: [100, 100], priority: 0 },
    { id: 'high', text: 'H', anchor: [100, 100], priority: 10 },
  ];

  test('priority wins the contested slot regardless of input position', () => {
    const { placed } = new LabelPlacer().place(contested);
    const p = byId(placed);
    assert.equal(p.high.candidateIndex, 0, 'the vertex label gets the anchor');
    assert.ok(p.low.candidateIndex > 0, 'the assignment label moves around it');
  });

  test('equal priority is broken by input order, and only by that', () => {
    // The stated tie rule: sorted by -priority, then by input index. So a
    // shuffle of equal-priority items is not a no-op — it is the rule working.
    const a = { id: 'a', text: 'A', anchor: [100, 100] };
    const b = { id: 'b', text: 'B', anchor: [100, 100] };
    const first = new LabelPlacer().place([a, b]);
    const second = new LabelPlacer().place([b, a]);
    assert.equal(byId(first.placed).a.candidateIndex, 0);
    assert.equal(byId(second.placed).b.candidateIndex, 0);
    assert.ok(byId(first.placed).b.candidateIndex > 0);
    assert.ok(byId(second.placed).a.candidateIndex > 0);
  });

  test('a shuffle within one priority band does not disturb another band', () => {
    const mk = order => new LabelPlacer().place([
      ...order.map(id => ({ id, text: id.toUpperCase(), anchor: [100, 100], priority: 0 })),
      { id: 'top', text: 'T', anchor: [100, 100], priority: 5 },
    ]);
    assert.equal(byId(mk(['a', 'b', 'c']).placed).top.candidateIndex, 0);
    assert.equal(byId(mk(['c', 'b', 'a']).placed).top.candidateIndex, 0);
  });

  test('the same input places identically every run', () => {
    const items = [
      { id: 'v0', text: 'x₁ = 0 and 1 · overlapping views', anchor: [120, 60], priority: 10 },
      { id: 'v1', text: 'Resolved: f = 1', anchor: [118, 66], priority: 10 },
      { id: 'f0', text: 'ABC', anchor: [120, 62], candidates: candidates.centered() },
      { id: 'v2', text: 'q', anchor: [130, 70] },
    ];
    const run = () => {
      const out = new LabelPlacer({ bounds: { x: 0, y: 0, w: 240, h: 160 } }).place(items);
      return JSON.stringify(out);
    };
    assert.equal(run(), run(), 'the probe compares these strings');
    assert.equal(run(), run());
  });
});

suite('labels: drops are reported', ({ test }) => {
  const wall = [{ left: 0, right: 400, top: 0, bottom: 400 }];

  test('a label with no clear candidate comes back as dropped, not missing', () => {
    const placer = new LabelPlacer();
    const { placed, dropped } = placer.place([
      { id: 'v:3', text: 'f = 1', anchor: [200, 200], meta: { assignment: 3 } },
    ], { obstacles: wall });

    assert.equal(placed.length, 0);
    assert.equal(dropped.length, 1, 'silently vanishing is the bug this replaces');
    assert.equal(dropped[0].id, 'v:3');
    assert.equal(dropped[0].text, 'f = 1');
    assert.equal(dropped[0].reason, 'collision');
    assert.equal(dropped[0].meta, { assignment: 3 });
    assert.ok(Number.isFinite(dropped[0].bestScore),
      'bestScore is the penalized score: Infinity would say nothing about how close it came');
  });

  test('out-of-bounds is reported as its own reason', () => {
    const placer = new LabelPlacer({ bounds: { x: 0, y: 0, w: 20, h: 20 } });
    const { dropped } = placer.place([{ id: 'a', text: 'a long caption', anchor: [10, 10] }]);
    assert.equal(dropped.length, 1);
    assert.equal(dropped[0].reason, 'out-of-bounds');
  });

  test('an empty candidate list is its own reason', () => {
    const { dropped } = new LabelPlacer().place([{ id: 'a', text: 'A', anchor: [0, 0], candidates: [] }]);
    assert.equal(dropped[0].reason, 'no-candidates');
    assert.equal(dropped[0].bestScore, Infinity);
  });

  test("onDrop 'shrink' retries once and reports the size it used", () => {
    const placer = new LabelPlacer({ bounds: { x: 0, y: 0, w: 85, h: 60 }, onDrop: 'shrink' });
    const item = { id: 'a', text: 'Resolved: f = 1', anchor: [42.5, 30], candidates: candidates.centered() };
    assert.equal(new LabelPlacer({ bounds: { x: 0, y: 0, w: 85, h: 60 } }).place([item]).dropped.length, 1);

    const { placed, dropped } = placer.place([item]);
    assert.equal(dropped.length, 0);
    assert.close(placed[0].fontSize, 13 * 0.85, 1e-9);
    assert.ok(placed[0].rect.left >= 3 && placed[0].rect.right <= 82, 'and it now fits the inset frame');
  });

  test("onDrop 'leader' places the least-bad candidate and says where it came from", () => {
    const placer = new LabelPlacer({ onDrop: 'leader' });
    const { placed, dropped } = placer.place([{ id: 'a', text: 'A', anchor: [200, 200] }],
      { obstacles: wall });
    assert.equal(dropped.length, 0);
    assert.equal(placed[0].leader[0], [200, 200]);
    assert.equal(placed[0].leader[1], [placed[0].x, placed[0].y]);
  });

  test('onDrop as a function may place or refuse', () => {
    const seen = [];
    const placer = new LabelPlacer({
      onDrop: (item, ctx) => {
        seen.push(ctx.reason);
        return item.id === 'keep'
          ? { id: item.id, text: item.text, x: 0, y: 0, w: 1, h: 1, candidateIndex: -1, score: ctx.bestScore }
          : null;
      },
    });
    const { placed, dropped } = placer.place([
      { id: 'keep', text: 'K', anchor: [200, 200] },
      { id: 'lose', text: 'L', anchor: [200, 200] },
    ], { obstacles: wall });
    assert.equal(placed.length, 1);
    assert.equal(placed[0].id, 'keep');
    assert.equal(dropped.length, 1);
    assert.equal(seen, ['collision', 'collision']);
  });

  test('required takes candidate 0 whatever is in the way', () => {
    const { placed, dropped } = new LabelPlacer().place([
      { id: 'a', text: 'A', anchor: [200, 200], required: true },
    ], { obstacles: wall });
    assert.equal(dropped.length, 0);
    assert.equal(placed[0].candidateIndex, 0);
    assert.ok(placed[0].score > 0, 'and the score records that it was forced');
  });
});

suite('labels: measurement', ({ test }) => {
  test('the metric is monotonic in text length', () => {
    let prev = 0;
    for (let n = 1; n <= 24; n++) {
      const { w } = metricText('a'.repeat(n));
      assert.ok(w > prev, `width must grow at n=${n}`);
      prev = w;
    }
  });

  test('the metric is class-aware, which text.length * 3.5 was not', () => {
    assert.ok(metricText('WWWW').w > metricText('wwww').w, 'uppercase is wider');
    assert.ok(metricText('....').w < metricText('0000').w, 'punctuation is narrower than digits');
    assert.ok(metricText('x₁').w < metricText('x1').w, 'a subscript is narrower than a digit');
    assert.close(metricText('AB').w, 13 * 2 * ADVANCE.upper, 1e-12, 'the table is the model');
  });

  test('size scales the box and height follows the font', () => {
    const small = metricText('hello', { fontSize: 10 });
    const large = metricText('hello', { fontSize: 20 });
    assert.close(large.w / small.w, 2, 1e-12);
    assert.close(small.h, 13.2, 1e-12);
    assert.ok(metricText('hello', { weight: 700 }).w > metricText('hello').w, 'bold is wider');
  });

  test('an injected measurer replaces the metric entirely', () => {
    // This is the seam createTextMeasurer(svgEl).measure plugs into; the placer
    // must not measure anything itself.
    const calls = [];
    const placer = new LabelPlacer({
      measure: (text, style) => { calls.push([text, style?.fontSize]); return { w: 40, h: 10 }; },
    });
    const { placed } = placer.place([{ id: 'a', text: 'A', anchor: [0, 0], padding: 0, style: { fontSize: 9 } }]);
    assert.equal(calls, [['A', 9]]);
    assert.equal([placed[0].w, placed[0].h], [40, 10]);
  });

  test('padding surrounds the measured box and rect agrees with w/h', () => {
    const placer = new LabelPlacer({ measure: () => ({ w: 40, h: 10 }) });
    const { placed } = placer.place([{ id: 'a', text: 'A', anchor: [0, 0], padding: 3 }]);
    const p = placed[0];
    assert.equal([p.w, p.h], [46, 16]);
    assert.equal(p.rect.right - p.rect.left, p.w);
    assert.equal(p.rect.bottom - p.rect.top, p.h);
    assert.equal([p.rect.left, p.rect.top], [-23, -8], 'middle/middle centres the box on the point');
  });
});

suite('labels: candidates and bookkeeping', ({ test }) => {
  test("box() is one constant, not the source's 16-and-17", () => {
    assert.equal(candidates.box(), [
      { dx: 0, dy: 0 }, { dx: 17, dy: 0 }, { dx: -17, dy: 0 }, { dx: 0, dy: 17 }, { dx: 0, dy: -17 },
    ]);
    assert.equal(candidates.box(9).length, 5);
    assert.equal(candidates.centered(2), [{ dx: 0, dy: 0, cost: 2 }]);
  });

  test('radial puts the supplied outward direction first', () => {
    const c = candidates.radial([0, -1], 20, { steps: 3 });
    assert.close(c[0].dx, 0, 1e-9);
    assert.close(c[0].dy, -20, 1e-9, 'index 0 is exactly outward — the caller owns that notion');
    assert.equal(c[0].cost, 0);
    assert.ok(c[1].cost < c[2].cost, 'cost grows with deviation, so the straightest wins ties');
    assert.equal(c.length, 3);
    assert.close(candidates.radial([0, 0])[0].dx, 17, 1e-9, 'no direction falls back to +x');
  });

  test('ring and below/above carry the anchoring the name implies', () => {
    const r = candidates.ring(10, { steps: 4 });
    assert.equal(r.length, 4);
    assert.close(r[1].dy, 10, 1e-9, 'increasing angle, screen y down');
    assert.equal(candidates.below(19), [{ dx: 0, dy: 19, baseline: 'hanging' }]);
    assert.equal(candidates.above(19), [{ dx: 0, dy: -19, baseline: 'auto' }]);
  });

  test('anchorX and baseline move the box off the point', () => {
    const placer = new LabelPlacer({ measure: () => ({ w: 40, h: 10 }) });
    const { placed } = placer.place([
      { id: 's', text: 'S', anchor: [0, 0], padding: 0, candidates: [{ dx: 0, dy: 0, anchorX: 'start' }] },
      { id: 'e', text: 'E', anchor: [0, 100], padding: 0, candidates: [{ dx: 0, dy: 0, anchorX: 'end' }] },
      { id: 'h', text: 'H', anchor: [0, 200], padding: 0, candidates: [{ dx: 0, dy: 0, baseline: 'hanging' }] },
    ]);
    const p = byId(placed);
    assert.equal([p.s.rect.left, p.s.rect.right], [0, 40]);
    assert.equal([p.e.rect.left, p.e.rect.right], [-40, 0]);
    assert.equal([p.h.rect.top, p.h.rect.bottom], [200, 210]);
    assert.equal([p.s.anchorX, p.s.baseline], ['start', 'middle'], 'the defaults are echoed back');
  });

  test('occupied accumulates across place() until reset()', () => {
    const placer = new LabelPlacer();
    const item = { id: 'a', text: 'A', anchor: [50, 50] };
    const first = placer.place([item]);
    assert.equal(first.occupied.length, 1);

    const second = placer.place([{ ...item, id: 'b' }]);
    assert.equal(second.occupied.length, 2);
    assert.ok(second.placed[0].candidateIndex > 0, 'the second panel sees the first panel');

    placer.reset();
    const third = placer.place([{ ...item, id: 'c' }]);
    assert.equal(third.occupied.length, 1);
    assert.equal(third.placed[0].candidateIndex, 0);
  });

  test('style, opacity and meta are echoed back untouched, and only when given', () => {
    const style = { fontSize: 11, weight: 600 };
    const meta = { vertex: 4 };
    const { placed } = new LabelPlacer().place([
      { id: 'a', text: 'A', anchor: [0, 0], style, opacity: 0.4, meta },
      { id: 'b', text: 'B', anchor: [200, 0] },
    ]);
    const p = byId(placed);
    assert.ok(p.a.style === style && p.a.meta === meta, 'same references, untouched');
    assert.equal(p.a.opacity, 0.4);
    assert.ok(!('fontSize' in p.a), "fontSize appears only when onDrop:'shrink' fired");
    assert.ok(!('opacity' in p.b) && !('meta' in p.b) && !('leader' in p.b));
  });

  test('nothing in the result is anything but plain data', () => {
    const { placed, dropped, occupied } = new LabelPlacer({
      bounds: { x: 0, y: 0, w: 60, h: 60 }, onDrop: 'leader',
    }).place([
      { id: 'a', text: 'A', anchor: [30, 30], meta: { i: 1 } },
      { id: 'b', text: 'a very long caption indeed', anchor: [30, 30] },
    ]);
    assert.ok(isPlainData({ placed, dropped, occupied }), 'a node here would break the string renderers');
    assert.equal(JSON.parse(JSON.stringify(placed)).length, placed.length);
  });
});
