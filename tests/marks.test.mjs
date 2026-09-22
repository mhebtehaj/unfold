// render/marks.js — the visual vocabulary, one mark at a time.
//
// What is asserted here is the contract the scene relies on, not appearance
// (tests/realize.test.mjs and tools/parity.mjs hold appearance to a shipped
// drawing): a mark writes exactly the attributes its style asks for and
// nothing else, so a port does not grow a round cap or a default stroke on the
// way; an update reuses the node and clears whatever the style dropped; the
// pick payload (data-*) and the tooltip (<title>) follow the style; and no
// colour reaches the DOM that is not a token or a palette colour.
//
// Browser-only: marks build DOM. Under node the module imports cleanly and
// registers no suite.

import { suite, assert } from './harness.mjs';
import * as marks from '../engine/render/marks.js';
import { getPrecision } from '../engine/core/svg.js';

const DOM = typeof document !== 'undefined';

const byName = ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0);
/** Key order is not information; sort both sides so "exactly these" is what compares. */
const sorted = o => Object.fromEntries(Object.entries(o).sort(byName));
const attrs = n => Object.fromEntries([...n.attributes].map(a => [a.name, a.value]).sort(byName));
const circles = g => [...g.children].filter(n => n.localName === 'circle');

const TRI = [[10, 20], [110, 20], [60, 100]];

if (DOM) suite('marks — attributes: exactly what the style asks for', ({ test }) => {
  test('a face with no style is a path and nothing else', () => {
    const n = marks.face(TRI);
    assert.equal(n.localName, 'path');
    assert.equal(attrs(n), { d: 'M10,20L110,20L60,100Z' });
  });

  test('every MarkStyle field lands on its attribute', () => {
    const n = marks.face(TRI, {
      fill: 'data1', stroke: 'fg', width: 2, fillOpacity: 0.3, strokeOpacity: 0.8, opacity: 0.5,
      dash: 'dashed', cap: 'round', join: 'bevel', class: 'x y', interactive: false,
    });
    assert.equal(attrs(n), sorted({
      d: 'M10,20L110,20L60,100Z', fill: 'var(--data-1)', stroke: 'var(--fg)', 'stroke-width': '2',
      'fill-opacity': '0.3', 'stroke-opacity': '0.8', opacity: '0.5', 'stroke-dasharray': '5 6', 'stroke-linecap': 'round',
      'stroke-linejoin': 'bevel', class: 'x y', 'pointer-events': 'none',
    }));
  });

  test('an update reuses the node and removes what the style no longer asks for', () => {
    const n = marks.face(TRI, { fill: 'data1', width: 2, dash: 'dotted', class: 'a', interactive: false });
    const m = marks.face(TRI.slice(0, 2), { fill: 'data2' }, n);
    assert.ok(m === n, 'the same node, so its listeners and focus survive');
    assert.equal(attrs(m), sorted({ d: 'M10,20L110,20Z', fill: 'var(--data-2)' }));
  });

  test('a node of the wrong element is replaced, not repurposed', () => {
    const c = marks.point([0, 0]);
    const e = marks.edge([0, 0], [1, 1], {}, c);
    assert.equal(e.localName, 'path');
    assert.ok(e !== c);
    assert.equal(c.getAttribute('d'), null, 'the circle was left alone');
  });

  test('closed: false leaves a face open', () => {
    assert.equal(marks.face(TRI, { closed: false }).getAttribute('d'), 'M10,20L110,20L60,100');
  });

  test('an edge is one segment, unfilled unless the style fills it', () => {
    const e = marks.edge([0, 0], [10, 5], { stroke: 'gray', width: 2 });
    assert.equal(attrs(e), sorted({ d: 'M0,0L10,5', fill: 'none', stroke: 'var(--gray)', 'stroke-width': '2' }));
    assert.equal(marks.edge([0, 0], [1, 1], { fill: 'zone' }).getAttribute('fill'), 'var(--zone)');
  });

  test('the dash vocabulary: dashed, dotted, solid, or the numbers themselves', () => {
    const dash = d => marks.edge([0, 0], [1, 1], { dash: d }).getAttribute('stroke-dasharray');
    assert.equal(dash('dashed'), '5 6');
    assert.equal(dash('dotted'), '1 3');
    assert.equal(dash('solid'), null);
    assert.equal(dash([4, 4]), '4 4');
    assert.equal(dash('4 4'), '4 4');
    assert.throws(() => dash('wavy'), 'an unknown dash is a typo, not a solid line');
  });
});

if (DOM) suite('marks — paths', ({ test }) => {
  test('linePath: open, closed, empty', () => {
    assert.equal(marks.linePath([[0, 0], [1, 2], [3, 4]]), 'M0,0L1,2L3,4');
    assert.equal(marks.linePath([[0, 0], [1, 2], [3, 4]], true), 'M0,0L1,2L3,4Z');
    assert.equal(marks.linePath([]), '');
  });

  test('path numbers follow the kernel precision, and -0 is written 0', () => {
    const k = 10 ** getPrecision();
    assert.equal(marks.linePath([[1.23456789, -0.4 / k]]),
      `M${Math.round(1.23456789 * k) / k},0`);
  });

  test('smoothPath is Catmull-Rom at 0.5: thirds of the neighbour chord', () => {
    // Collinear, evenly spaced: every control point lands on the line at a third.
    assert.equal(marks.smoothPath([[0, 0], [3, 0], [6, 0]]), 'M0,0C0.5,0 2,0 3,0C4,0 5.5,0 6,0');
  });

  test('smoothPath interpolates: every cubic ends on the next input point', () => {
    const pts = [[0, 0], [10, 5], [20, 0], [30, 10]];
    const ends = marks.smoothPath(pts).split('C').slice(1).map(s => s.trim().split(' ').pop());
    assert.equal(ends, ['10,5', '20,0', '30,10']);
  });

  test('smoothPath closed: one cubic per side, back to the start', () => {
    const d = marks.smoothPath([[0, 0], [10, 0], [5, 8]], 0.5, true);
    assert.equal((d.match(/C/g) ?? []).length, 3);
    assert.ok(d.endsWith(' 0,0Z'), d);
  });

  test('smoothPath falls back to straight segments below three points or at smooth 0', () => {
    assert.equal(marks.smoothPath([[0, 0], [3, 0]]), 'M0,0L3,0');
    assert.equal(marks.smoothPath([[0, 0], [3, 0], [6, 0]], 0), 'M0,0L3,0L6,0');
  });

  test('polyline is open and unfilled; smooth and closed are options; curve is smooth 0.5', () => {
    const pts = [[0, 0], [10, 5], [20, 0], [30, 10]];
    assert.equal(marks.polyline(pts.slice(0, 3)).getAttribute('d'), 'M0,0L10,5L20,0');
    assert.equal(marks.polyline(pts.slice(0, 3), { closed: true }).getAttribute('d'), 'M0,0L10,5L20,0Z');
    assert.equal(marks.polyline(pts).getAttribute('fill'), 'none');
    assert.equal(marks.polyline(pts, { smooth: 0.5 }).getAttribute('d'), marks.smoothPath(pts, 0.5));
    assert.equal(marks.curve(pts).getAttribute('d'), marks.smoothPath(pts, 0.5));
    assert.equal(marks.curve(pts, { smooth: 0.2 }).getAttribute('d'), marks.smoothPath(pts, 0.2));
  });
});

if (DOM) suite('marks — the pick payload and the tooltip', ({ test }) => {
  test('data-* is replaced wholesale, keeps full precision, and never touches data-k', () => {
    const n = marks.face(TRI, { data: { face: 'abc', w: 0.123456789123 } });
    assert.equal(n.getAttribute('data-face'), 'abc');
    assert.equal(n.getAttribute('data-w'), '0.123456789123', 'data-* is exempt from rounding');
    n.setAttribute('data-k', 'r/f');                         // what reconcile() writes
    marks.face(TRI, { data: { n: 4 } }, n);
    assert.equal(n.getAttribute('data-face'), null, 'a key the style dropped is removed');
    assert.equal(n.getAttribute('data-n'), '4');
    assert.equal(n.getAttribute('data-k'), 'r/f', 'the reconciliation key survives');
  });

  test('title: a first-child <title>, updated in place, removed when dropped, text not markup', () => {
    const n = marks.face(TRI, { title: 'Face <abc>' });
    const t = n.firstElementChild;
    assert.equal(t?.localName, 'title');
    assert.equal(t.textContent, 'Face <abc>');
    assert.equal(t.children.length, 0);
    marks.face(TRI, { title: 'Face ab' }, n);
    assert.ok(n.firstElementChild === t, 'updated, not rebuilt');
    assert.equal(t.textContent, 'Face ab');
    marks.face(TRI, {}, n);
    assert.equal(n.children.length, 0);
  });
});

if (DOM) suite('marks — points', ({ test }) => {
  test('a bare point is one circle, r 3.5 unless asked', () => {
    assert.equal(attrs(marks.point([5, 6])), sorted({ cx: '5', cy: '6', r: '3.5' }));
    assert.equal(attrs(marks.point([5, 6], { r: 4, fill: 'data3', stroke: 'bg', width: 1.5 })),
      sorted({ cx: '5', cy: '6', r: '4', fill: 'var(--data-3)', stroke: 'var(--bg)', 'stroke-width': '1.5' }));
  });

  test('halo, dot, ring: in that paint order, with the documented defaults', () => {
    const g = marks.point([5, 6], { r: 4, fill: 'data1', halo: true, ring: true });
    assert.equal(g.localName, 'g');
    assert.equal(g.dataset.mark, 'point');
    assert.equal(g.dataset.parts, 'halo dot ring');
    const [h, dot, ring] = circles(g);
    assert.equal(attrs(h), sorted({ cx: '5', cy: '6', r: '7', fill: 'var(--bg)' }));
    assert.equal(attrs(dot), sorted({ cx: '5', cy: '6', r: '4', fill: 'var(--data-1)' }));
    assert.equal(attrs(ring), sorted({ cx: '5', cy: '6', r: '8', fill: 'none', stroke: 'var(--fg)', 'stroke-width': '1.6' }));
  });

  test('a halo and a ring take their own options', () => {
    const g = marks.point([0, 0], { r: 4, halo: { width: 2, fill: 'surface' }, ring: { r: 10, stroke: 'bad', width: 2 } });
    const [h, , ring] = circles(g);
    assert.equal([h.getAttribute('r'), h.getAttribute('fill')], ['6', 'var(--surface)']);
    assert.equal([ring.getAttribute('r'), ring.getAttribute('stroke'), ring.getAttribute('stroke-width')],
      ['10', 'var(--bad)', '2']);
  });

  test("pointRing is the explorers' selection ring: 7, 4, 8", () => {
    const g = marks.pointRing([5, 6], { fill: 'data2' });
    assert.equal(circles(g).map(c => c.getAttribute('r')), ['7', '4', '8']);
  });

  test('the group carries class, payload and tooltip; the dot carries the paint', () => {
    const g = marks.point([0, 0], { ring: true, fill: 'data1', class: 'sel', data: { v: 1 }, title: 'x', interactive: false });
    assert.equal(g.getAttribute('class'), 'sel');
    assert.equal(g.getAttribute('data-v'), '1');
    assert.equal(g.getAttribute('pointer-events'), 'none');
    assert.equal(g.firstElementChild.localName, 'title');
    const [dot] = circles(g);
    assert.equal(dot.getAttribute('class'), null);
    assert.equal(dot.getAttribute('fill'), 'var(--data-1)');
  });

  test('a grouped point updates in place, its <title> included', () => {
    const g = marks.point([0, 0], { halo: true, ring: true, class: 'sel', data: { v: 1 }, title: 'x' });
    const before = circles(g);
    const again = marks.point([3, 4], { halo: true, ring: true, class: 'sel', data: { v: 2 }, title: 'y' }, g);
    assert.ok(again === g);
    assert.ok(circles(g).every((c, i) => c === before[i]), 'the circles are the same nodes');
    assert.equal(circles(g).map(c => c.getAttribute('cx')), ['3', '3', '3']);
    assert.equal(circles(g).map(c => c.getAttribute('r')), ['6.5', '3.5', '7']);
    assert.equal([g.firstElementChild.localName, g.firstElementChild.textContent], ['title', 'y']);
    assert.equal(g.firstElementChild.getAttribute('r'), null, 'the title was not painted as a circle');
    assert.equal(g.getAttribute('data-v'), '2');
  });

  test('changing the parts rebuilds the circles in the same group', () => {
    const g = marks.point([0, 0], { halo: true, ring: true, class: 'sel', title: 'x' });
    marks.point([3, 4], { halo: true }, g);
    assert.equal(g.dataset.parts, 'halo dot');
    assert.equal(circles(g).length, 2);
    assert.equal(g.getAttribute('class'), null);
    assert.equal(g.children.length, 2, 'the title went with the style');
  });

  test('opacity fades a grouped point as one: on the group, not on the dot', () => {
    const g = marks.point([0, 0], { ring: true, halo: true, fill: 'data1', opacity: 0.3 });
    assert.equal(g.getAttribute('opacity'), '0.3');
    assert.ok(circles(g).every(c => !c.hasAttribute('opacity')), 'no part fades on its own');
    marks.point([0, 0], { ring: true, halo: true, fill: 'data1' }, g);
    assert.equal(g.getAttribute('opacity'), null);
    assert.equal(marks.point([0, 0], { opacity: 0.3 }).getAttribute('opacity'), '0.3', 'a bare dot is its own group');
  });

  test('a point changes element when it gains or loses its halo and ring', () => {
    const c = marks.point([0, 0]);
    const g = marks.point([0, 0], { ring: true }, c);
    assert.equal(g.localName, 'g');
    assert.ok(g !== c);
    assert.equal(marks.point([0, 0], {}, g).localName, 'circle');
  });
});

if (DOM) suite('marks — arrows, regions, text', ({ test }) => {
  /** The three points of the head path, in order: wing, tip, wing. */
  const headOf = g => {
    const n = g.children[g.children.length - 1].getAttribute('d').match(/-?\d*\.?\d+/g).map(Number);
    return [[n[0], n[1]], [n[2], n[3]], [n[4], n[5]]];
  };
  const angle = (u, v) => Math.acos((u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v)));

  test('an arrow is a shaft and a head; the head sits on b at the given length and angle', () => {
    const g = marks.arrow([0, 0], [10, 0], { stroke: 'fg', width: 1.5, head: 6, headAngle: 0.45 });
    assert.equal(g.dataset.mark, 'arrow');
    const [shaft, head] = g.children;
    assert.equal(shaft.getAttribute('d'), 'M0,0L10,0');
    assert.equal([shaft.getAttribute('fill'), head.getAttribute('fill')], ['none', 'none']);
    assert.equal([shaft.getAttribute('stroke'), head.getAttribute('stroke')], ['var(--fg)', 'var(--fg)']);
    const [w1, tip, w2] = headOf(g);
    assert.equal(tip, [10, 0]);
    for (const w of [w1, w2]) {
      assert.close(Math.hypot(w[0] - 10, w[1]), 6, 1e-5, 'head length');
      assert.close(angle([w[0] - 10, w[1]], [-10, 0]), 0.45, 1e-5, 'half-angle from the shaft');
    }
  });

  test('opacity fades an arrow as one, so the head does not composite twice over the shaft', () => {
    const g = marks.arrow([0, 0], [10, 0], { stroke: 'fg', opacity: 0.5, interactive: false, class: 'a' });
    assert.equal([g.getAttribute('opacity'), g.getAttribute('pointer-events'), g.getAttribute('class')], ['0.5', 'none', 'a']);
    for (const p of g.children)
      assert.equal([p.getAttribute('opacity'), p.getAttribute('pointer-events'), p.getAttribute('class')], [null, null, null]);
  });

  test('a filled head is closed and filled with the stroke colour', () => {
    const g = marks.arrow([0, 0], [10, 0], { stroke: 'accent', kind: 'filled' });
    assert.ok(g.children[1].getAttribute('d').endsWith('Z'));
    assert.equal(g.children[1].getAttribute('fill'), 'var(--accent)');
  });

  test('a bend bows the shaft to the left as drawn, and the head follows the tangent', () => {
    const g = marks.arrow([0, 0], [10, 0], { stroke: 'fg', bend: 4 });
    assert.equal(g.children[0].getAttribute('d'), 'M0,0Q5,-4 10,0', 'up the screen is left of rightwards');
    const [w1, tip, w2] = headOf(g);
    assert.equal(tip, [10, 0]);
    for (const w of [w1, w2]) assert.close(angle([w[0] - 10, w[1]], [5 - 10, -4]), 0.45, 1e-5);
  });

  test('an arrow with a tooltip keeps its two paths on update', () => {
    const g = marks.arrow([0, 0], [10, 0], { stroke: 'fg', title: 'f' });
    const [shaft, head] = [...g.children].filter(n => n.localName === 'path');
    marks.arrow([0, 0], [20, 0], { stroke: 'fg', title: 'g' }, g);
    const now = [...g.children].filter(n => n.localName === 'path');
    assert.ok(now[0] === shaft && now[1] === head, 'updated in place');
    assert.equal(shaft.getAttribute('d'), 'M0,0L20,0');
    assert.equal(g.firstElementChild.textContent, 'g');
  });

  test('a region is a rect, a circle or a path in screen px, filled with the zone', () => {
    assert.equal(attrs(marks.region({ type: 'rect', x: 1, y: 2, w: 30, h: 40, rx: 3 })),
      sorted({ x: '1', y: '2', width: '30', height: '40', rx: '3', fill: 'var(--zone)' }));
    assert.equal(attrs(marks.region({ type: 'circle', cx: 5, cy: 6, r: 7 }, { fill: 'accentSoft' })),
      sorted({ cx: '5', cy: '6', r: '7', fill: 'var(--accent-soft)' }));
    const p = marks.region({ type: 'path', d: 'M0,0L1,1Z' }, { fill: 'none', stroke: 'line' });
    assert.equal([p.localName, p.getAttribute('d'), p.getAttribute('stroke')], ['path', 'M0,0L1,1Z', 'var(--line)']);
    assert.throws(() => marks.region({ type: 'ellipse' }));
    assert.throws(() => marks.region(undefined));
  });

  test('text: data not markup, offsets, anchor middle, the alphabetic baseline unwritten', () => {
    const t = marks.text([10, 20], 'a<b>', { dx: 3, dy: -2, anchor: 'start', class: 'point-label' });
    assert.equal(t.textContent, 'a<b>');
    assert.equal(t.children.length, 0);
    assert.equal(attrs(t), sorted({ x: '13', y: '18', 'text-anchor': 'start', class: 'point-label' }));
    assert.equal(marks.text([0, 0], 'x').getAttribute('text-anchor'), 'middle');
  });

  test('text updates in place: halo class, fill, opacity, payload', () => {
    const t = marks.text([0, 0], 'x', { baseline: 'middle' });
    const u = marks.text([1, 2], 'y', { halo: true, class: 'a', fill: 'bad', opacity: 0.5, data: { v: 1 } }, t);
    assert.ok(u === t);
    assert.equal(attrs(u), sorted({
      x: '1', y: '2', 'text-anchor': 'middle', class: 'a uf-halo', fill: 'var(--bad)', opacity: '0.5', 'data-v': '1',
    }));
    assert.equal(u.textContent, 'y');
  });

  test('text takes a tooltip, and keeps it across updates of its text', () => {
    const t = marks.text([0, 0], 'x', { title: 'the point x' });
    assert.equal([t.firstElementChild?.localName, t.firstElementChild?.textContent], ['title', 'the point x']);
    const title = t.firstElementChild;
    marks.text([0, 0], 'y', { title: 'the point y' }, t);
    assert.ok(t.firstElementChild === title, 'the same title node');
    assert.equal([title.textContent, t.childNodes.length, t.lastChild.data], ['the point y', 2, 'y']);
    marks.text([0, 0], 'y', {}, t);
    assert.equal([t.childNodes.length, t.textContent], [1, 'y']);
  });

  test('marks.style() gives a node of the caller\'s the same attributes, payload and tooltip', () => {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    marks.style(g, { fill: 'muted', class: 'deco', data: { part: 'rim' }, title: 'Rim' });
    assert.equal([g.getAttribute('fill'), g.getAttribute('class'), g.getAttribute('data-part'), g.firstElementChild.textContent],
      ['var(--muted)', 'deco', 'rim', 'Rim']);
  });

  test('label consumes a Placed: position, anchor, baseline, the mark class with a halo', () => {
    const placed = { id: 'r/a', text: 'A', x: 50, y: 60, anchorX: 'end', baseline: 'middle' };
    const t = marks.label(placed);
    assert.equal(attrs(t), sorted({ x: '50', y: '60', 'text-anchor': 'end', 'dominant-baseline': 'middle', class: 'uf-mark uf-halo' }));
    assert.equal(t.textContent, 'A');
  });

  test('a shrunk label carries its size inline, and loses it when it fits again', () => {
    const placed = { id: 'r/a', text: 'A', x: 50, y: 60, anchorX: 'middle', baseline: 'middle' };
    const t = marks.label({ ...placed, fontSize: 11.05, opacity: 0.4 }, { class: 'point-label', halo: false });
    assert.equal(t.getAttribute('style'), 'font-size:11.05px');
    assert.equal(t.getAttribute('class'), 'point-label');
    assert.equal(t.getAttribute('opacity'), '0.4');
    const u = marks.label(placed, {}, t);
    assert.ok(u === t);
    assert.equal([t.getAttribute('style'), t.getAttribute('opacity')], [null, null]);
  });

  test('halo() adds the knockout class, keeps the others, and is idempotent', () => {
    const t = marks.text([0, 0], 'x', { class: 'a' });
    assert.ok(marks.halo(t) === t);
    marks.halo(t);
    assert.equal(t.getAttribute('class'), 'a uf-halo');
  });
});

if (DOM) suite('marks — no literal colour reaches the DOM', ({ test }) => {
  // hsl()'s numeric form is palette.hsl()'s output, not a literal, so the
  // literal that stands for it here is the comma spelling no palette function
  // can produce.
  const LITERALS = ['#ff0000', 'red', 'tomato', 'hsl(0, 50%, 50%)', 'oklch(0.5 0.1 20)', 'black', 'white'];

  test('a literal is refused wherever a colour goes', () => {
    for (const c of LITERALS) {
      assert.throws(() => marks.face(TRI, { fill: c }), `fill ${c}`);
      assert.throws(() => marks.edge([0, 0], [1, 1], { stroke: c }), `stroke ${c}`);
      assert.throws(() => marks.point([0, 0], { halo: { fill: c } }), `halo ${c}`);
      assert.throws(() => marks.point([0, 0], { ring: { stroke: c } }), `ring ${c}`);
      assert.throws(() => marks.text([0, 0], 'x', { fill: c }), `text ${c}`);
      assert.throws(() => marks.region({ type: 'rect', x: 0, y: 0, w: 1, h: 1 }, { fill: c }), `region ${c}`);
    }
  });

  test('tokens, custom properties, palette output and the paint keywords pass', () => {
    for (const c of ['fg', '--page-local', 'var(--accent)', 'color-mix(in srgb, var(--fg) 50%, transparent)', 'none', 'currentColor'])
      assert.ok(marks.face(TRI, { fill: c }).getAttribute('fill'), c);
    assert.equal(marks.face(TRI, { fill: '--page-local' }).getAttribute('fill'), 'var(--page-local)');
  });

  test('check() throws exactly when the mark would', () => {
    const cases = [
      ['face', { fill: 'zone', dash: 'dashed' }], ['face', { fill: '#fff' }], ['face', { stroke: 'nope' }],
      ['face', { dash: [3, 3] }], ['face', { dash: 'x' }], ['face', { fill: null }],
      ['point', { halo: { fill: 'white' } }], ['point', { ring: { stroke: 'bg' } }], ['point', { ring: { stroke: 'black' } }],
    ];
    const draw = (kind, s) => kind === 'face' ? marks.face(TRI, s) : marks.point([0, 0], s);
    for (const [kind, s] of cases) {
      let a = null, b = null;
      try { marks.check(kind, s); } catch (e) { a = e; }
      try { draw(kind, s); } catch (e) { b = e; }
      assert.equal(Boolean(a), Boolean(b), `${kind} ${JSON.stringify(s)}`);
    }
  });

  test('check() refuses a style key its mark does not read, nested ones included', () => {
    assert.throws(() => marks.check('face', { strokeWidth: 2 }), 'a typo for width');
    assert.throws(() => marks.check('edge', { r: 3 }), 'r is a point key');
    assert.throws(() => marks.check('point', { halo: { width: 2, colour: 'bg' } }));
    assert.throws(() => marks.check('point', { ring: { radius: 8 } }));
    assert.throws(() => marks.check('label', { anchor: 'start' }), "a label's anchor is the placer's");
    assert.throws(() => marks.check('text', { stroke: 'bg' }), 'text is painted by class and halo');
    assert.throws(() => marks.check('blob', {}), 'an unknown kind');
    for (const [kind, style] of [
      ['face', { closed: false, fill: 'zone', data: { v: 1 }, title: 't' }],
      ['polyline', { closed: true, smooth: 0.5, stroke: 'fg' }], ['curve', { smooth: 0.2 }],
      ['arrow', { head: 5, headAngle: 0.4, kind: 'filled', bend: 3, stroke: 'fg' }],
      ['point', { r: 4, halo: { width: 3, fill: 'bg' }, ring: { r: 8, stroke: 'fg', width: 1.6 } }],
      ['text', { dx: 1, dy: 2, anchor: 'end', baseline: 'middle', halo: true, class: 'c', fill: 'bad' }],
      ['label', { class: 'c', halo: false, data: { v: 0 }, interactive: false }],
    ]) assert.equal(marks.check(kind, style), true, kind);
  });

  test('check() refuses data keys the DOM cannot hold and the engine reserves', () => {
    for (const k of ['face id', 'a/b', 'x:y', ''])
      assert.throws(() => marks.check('face', { data: { [k]: 1 } }), JSON.stringify(k));
    for (const k of ['k', 'mark', 'parts'])
      assert.throws(() => marks.check('point', { data: { [k]: 1 } }), k);
    assert.equal(marks.check('face', { data: { face: 1, 'w.0': 2, 'a-b_c': 3, X9: 4 } }), true);
  });

  test('check() also refuses a region with no known shape and raw with no markup', () => {
    assert.throws(() => marks.check('region', {}, { shape: { type: 'ellipse' } }));
    assert.throws(() => marks.check('region', {}, {}));
    assert.equal(marks.check('region', {}, { shape: { type: 'rect', x: 0, y: 0, w: 1, h: 1 } }), true);
    assert.throws(() => marks.check('raw', {}, {}));
    assert.equal(marks.check('raw', {}, { markup: '<g/>' }), true);
  });
});
