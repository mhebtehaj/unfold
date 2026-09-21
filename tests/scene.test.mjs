// render/scene.js — the draw cycle, and the contract a Renderable plugs into.
//
// The claims under test are the ones the rest of the engine leans on: every
// point is transformed by the viewport and by nothing else; a mark keeps its
// node across redraws, so a reorder moves nodes instead of rebuilding them and
// a clean redraw writes nothing at all; one broken renderable is skipped and
// named rather than leaving a half-drawn scene; a hidden panel draws nothing;
// labels from every renderable share one placer and every drop is reported;
// and a pointer resolves to the primitive under it by key.
//
// Browser-only: the scene needs a real layout box and real events. Under node
// the module imports cleanly and registers no suite.

import { suite, assert } from './harness.mjs';
import { Viewport } from '../engine/core/viewport.js';
import { createProbe } from '../engine/core/probe.js';
import { candidates } from '../engine/core/labels.js';
import { SvgScene, KIND_TO_LAYER } from '../engine/render/scene.js';

const DOM = typeof document !== 'undefined';
const SVG_NS = 'http://www.w3.org/2000/svg';
const nextFrame = () => new Promise(res => requestAnimationFrame(res));

/** An <svg> of a known CSS size at the page's top left, inside a host. */
function stage({ w = 400, h = 300, hidden = false } = {}) {
  const host = document.createElement('div');
  host.style.cssText = `position:absolute;left:0;top:0;width:${w}px;height:${h}px;${hidden ? 'display:none;' : ''}`;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.style.cssText = `display:block;width:${w}px;height:${h}px`;
  host.append(svg);
  document.body.append(host);
  return { host, svg };
}

/**
 * A stage, a Viewport on it and a scene. pad 20 and extent 1 at 400×300 give
 * cx 200, cy 150, r 130: model [1, 0] draws at (330, 150) and [0, 1] at
 * (200, 20). Everything is disposed and removed even when the test throws.
 * `o.scene` is scene options, or a function of the svg returning them.
 */
const withScene = (o, fn) => async () => {
  const { host, svg } = stage(o);
  const viewport = new Viewport(svg, { pad: 20, extent: 1, observe: false });
  let scene = null;
  try {
    const extra = typeof o.scene === 'function' ? o.scene(svg, host) : (o.scene ?? {});
    scene = new SvgScene(svg, { viewport, ...extra });
    await fn({ host, svg, viewport, scene });
  } finally {
    scene?.dispose();
    viewport.dispose();
    host.remove();
  }
};

/** A triangle with one mark per default layer: face, edge, point. */
const tri = (over = {}) => ({
  id: 'tri',
  vertices: () => [[0, 0], [1, 0], [0, 1]],
  primitives: () => [
    { key: 'f', kind: 'face', indices: [0, 1, 2] },
    { key: 'e', kind: 'edge', indices: [0, 1] },
    { key: 'p', kind: 'point', indices: [2] },
  ],
  style: prim => ({ face: { fill: 'zone' }, edge: { stroke: 'fg', width: 2 }, point: { fill: 'fg' } })[prim.kind] ?? {},
  ...over,
});

/** One point per key at the origin, in the given order. */
const dots = (id, order, extra = () => ({})) => ({
  id,
  vertices: () => [[0, 0]],
  primitives: () => order().map(k => ({ key: k, kind: 'point', indices: [0], ...extra(k) })),
  style: () => ({}),
});

const layerOf = (svg, name) => svg.querySelector(`:scope > g[data-layer="${name}"]`);
const keys = g => [...g.children].map(n => n.getAttribute('data-k'));
const sorted = o => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)));

/** Run fn with console.warn captured; returns what it would have printed. */
function quiet(fn) {
  const warn = console.warn;
  const out = [];
  console.warn = (...a) => out.push(a.join(' '));
  try { fn(); } finally { console.warn = warn; }
  return out;
}

if (DOM) suite('scene — construction', ({ test }) => {
  test('refuses anything but an <svg>, and a scene with no viewport', () => {
    const { host, svg } = stage();
    try {
      const viewport = new Viewport(svg, { observe: false });
      assert.throws(() => new SvgScene(host, { viewport }), 'a <div>');
      assert.throws(() => new SvgScene(svg, {}), 'no viewport');
      assert.throws(() => new SvgScene(svg, { viewport: {} }), 'not a viewport');
      viewport.dispose();
    } finally { host.remove(); }
  });

  test('refuses a camera or a rotor: this is the 2-D path', () => {
    const { host, svg } = stage();
    try {
      const viewport = new Viewport(svg, { observe: false });
      assert.throws(() => new SvgScene(svg, { viewport, camera: {} }));
      assert.throws(() => new SvgScene(svg, { viewport, rotor: {} }));
      assert.equal(svg.children.length, 0, 'a refused scene leaves nothing behind');
      viewport.dispose();
    } finally { host.remove(); }
  });

  test('refuses duplicate layers, and a leader-line policy it cannot draw', () => {
    const { host, svg } = stage();
    try {
      const viewport = new Viewport(svg, { observe: false });
      assert.throws(() => new SvgScene(svg, { viewport, layers: ['a', 'b', 'a'] }));
      assert.throws(() => new SvgScene(svg, { viewport, labels: { onDrop: 'leader' } }));
      viewport.dispose();
    } finally { host.remove(); }
  });

  test('one group per layer, in paint order, after the title and desc', withScene({
    scene: { a11y: { role: 'img', label: 'A triangle', title: 'Triangle', desc: 'Three vertices.' } },
  }, ({ svg }) => {
    assert.equal([...svg.children].map(n => n.localName === 'g' ? n.dataset.layer : n.localName),
      ['title', 'desc', 'faces', 'edges', 'points', 'labels']);
    assert.ok([...svg.children].filter(n => n.localName === 'g').every(g => g.classList.contains('uf-layer')));
    assert.equal([svg.getAttribute('role'), svg.getAttribute('aria-label')], ['img', 'A triangle']);
    assert.equal(svg.querySelector('title').textContent, 'Triangle');
  }));

  test("an a11y option writes only what it names, never stripping the page's own", () => {
    const { host, svg } = stage();
    try {
      svg.setAttribute('role', 'group');
      svg.setAttribute('aria-label', 'Set by the page');
      const viewport = new Viewport(svg, { observe: false });
      const scene = new SvgScene(svg, { viewport, a11y: { title: 'Triangle' } });
      assert.equal([svg.getAttribute('role'), svg.getAttribute('aria-label')], ['group', 'Set by the page']);
      scene.dispose(); viewport.dispose();
    } finally { host.remove(); }
  });

  test('KIND_TO_LAYER: faces under edges under points under labels', () => {
    assert.equal(sorted(KIND_TO_LAYER), sorted({
      face: 'faces', region: 'faces', raw: 'faces',
      edge: 'edges', polyline: 'edges', curve: 'edges', arrow: 'edges',
      point: 'points', text: 'labels',
    }));
  });
});

if (DOM) suite('scene — the registry', ({ test }) => {
  test('add() checks the contract and the id', withScene({}, ({ scene }) => {
    assert.throws(() => scene.add({ id: 'x', primitives: () => [], style: () => ({}) }), 'no vertices()');
    assert.throws(() => scene.add({ id: 'x', vertices: () => [], style: () => ({}) }), 'no primitives()');
    assert.throws(() => scene.add({ id: 'x', vertices: () => [], primitives: () => [] }), 'no style()');
    for (const id of ['', 'a/b', 'a.b', 'label:x', 'a b', 3, undefined])
      assert.throws(() => scene.add(tri({ id })), `id ${JSON.stringify(id)}`);
    assert.throws(() => scene.add(tri({ id: 'x', dependsOn: 'geometry' })), 'dependsOn as a string');
    assert.throws(() => scene.add(tri({ id: 'y', attach: () => { throw new Error('no'); } })), 'attach() throws');
    assert.equal(scene.renderables, [], 'a refused renderable is not left behind');
    const r = tri();
    assert.ok(scene.add(r) === r, 'add() returns what it was given');
    assert.throws(() => scene.add(tri()), 'a second "tri"');
    assert.equal(scene.renderables.map(x => x.id), ['tri']);
  }));

  test('attach() on add, detach() on remove, and the next draw takes its marks away', withScene({}, ({ scene, svg }) => {
    const log = [];
    const r = scene.add(tri({ attach: s => log.push(['attach', s === scene]), detach: () => log.push(['detach']) }));
    scene.draw();
    assert.equal(svg.querySelectorAll('[data-k]').length, 3);
    scene.remove(r);
    scene.remove(r);                                   // twice is harmless
    scene.draw();
    assert.equal(log, [['attach', true], ['detach']]);
    assert.equal(svg.querySelectorAll('[data-k]').length, 0);
  }));

  test('a renderable removed and added again is rebuilt, not served from its old cache', withScene({}, ({ scene, svg }) => {
    let at = [0, 0];
    const r = scene.add(tri({ dependsOn: ['geometry'], vertices: () => [at, [1, 0], [0, 1]] }));
    scene.draw();
    scene.remove(r);
    at = [-1, 0];
    scene.add(r);
    scene.draw({ levels: ['style'] });
    assert.equal(layerOf(svg, 'edges').firstElementChild.getAttribute('d'), 'M70,150L330,150');
  }));

  test('clear() removes every renderable', withScene({}, ({ scene, svg }) => {
    scene.add(tri());
    scene.add(dots('more', () => ['a']));
    scene.draw();
    scene.clear();
    scene.draw();
    assert.equal(scene.renderables, []);
    assert.equal(svg.querySelectorAll('[data-k]').length, 0);
  }));
});

if (DOM) suite('scene — drawing', ({ test }) => {
  test('every vertex goes through the viewport, y-flip included', withScene({}, ({ scene, svg }) => {
    scene.add(tri());
    scene.draw();
    assert.equal(layerOf(svg, 'faces').firstElementChild.getAttribute('d'), 'M200,150L330,150L200,20Z');
    assert.equal(layerOf(svg, 'edges').firstElementChild.getAttribute('d'), 'M200,150L330,150');
    const p = layerOf(svg, 'points').firstElementChild;
    assert.equal([p.getAttribute('cx'), p.getAttribute('cy')], ['200', '20']);
  }));

  test('each kind lands in its layer, and a primitive can name another', withScene({}, ({ scene, svg }) => {
    scene.add({
      id: 'all',
      vertices: () => [[0, 0], [1, 0], [0, 1]],
      primitives: () => [
        { key: 'face', kind: 'face', indices: [0, 1, 2] },
        { key: 'region', kind: 'region', shape: { type: 'rect', x: 0, y: 0, w: 5, h: 5 } },
        { key: 'raw', kind: 'raw', markup: '<circle r="1"/>' },
        { key: 'edge', kind: 'edge', indices: [0, 1] },
        { key: 'poly', kind: 'polyline', indices: [0, 1, 2] },
        { key: 'curve', kind: 'curve', indices: [0, 1, 2] },
        { key: 'arrow', kind: 'arrow', indices: [0, 1] },
        { key: 'point', kind: 'point', indices: [0] },
        { key: 'text', kind: 'text', indices: [0], text: 'o' },
        { key: 'moved', kind: 'point', indices: [1], layer: 'faces' },
      ],
      style: () => ({}),
    });
    scene.draw();
    assert.equal(keys(layerOf(svg, 'faces')), ['all/face', 'all/region', 'all/raw', 'all/moved']);
    assert.equal(keys(layerOf(svg, 'edges')), ['all/edge', 'all/poly', 'all/curve', 'all/arrow']);
    assert.equal(keys(layerOf(svg, 'points')), ['all/point']);
    assert.equal(keys(layerOf(svg, 'labels')), ['all/text']);
    assert.equal(layerOf(svg, 'labels').firstElementChild.textContent, 'o');
    assert.equal(sorted(scene.lastFrame.marks), sorted({
      face: 1, region: 1, raw: 1, point: 2, edge: 1, polyline: 1, curve: 1, arrow: 1, text: 1,
    }));
  }));

  test('within a layer: renderable order, then primitive order', withScene({}, ({ scene, svg }) => {
    scene.add(dots('a', () => ['1', '2']));
    scene.add(dots('b', () => ['1', '2']));
    scene.draw();
    assert.equal(keys(layerOf(svg, 'points')), ['a/1', 'a/2', 'b/1', 'b/2']);
  }));

  test('a redraw keeps every node; a changed style rewrites only its attribute', withScene({}, ({ scene, svg }) => {
    let fill = 'zone';
    scene.add(tri({ style: prim => (prim.kind === 'face' ? { fill } : {}) }));
    scene.draw();
    const before = [...svg.querySelectorAll('[data-k]')];
    fill = 'accentSoft';
    scene.draw();
    const after = [...svg.querySelectorAll('[data-k]')];
    assert.ok(after.length === 3 && after.every((n, i) => n === before[i]), 'same nodes');
    assert.equal(layerOf(svg, 'faces').firstElementChild.getAttribute('fill'), 'var(--accent-soft)');
  }));

  test('a reorder moves nodes rather than rebuilding them; a dropped key exits', withScene({}, ({ scene, svg }) => {
    let order = ['a', 'b', 'c'];
    scene.add(dots('r', () => order));
    scene.draw();
    const points = layerOf(svg, 'points');
    const node = Object.fromEntries([...points.children].map(n => [n.getAttribute('data-k'), n]));
    order = ['c', 'a', 'b'];
    scene.draw();
    assert.equal(keys(points), ['r/c', 'r/a', 'r/b']);
    assert.ok([...points.children].every(n => node[n.getAttribute('data-k')] === n), 'moved, not rebuilt');
    order = ['a'];
    scene.draw();
    assert.equal(keys(points), ['r/a']);
    assert.ok(!node['r/b'].isConnected && !node['r/c'].isConnected);
  }));

  test('raise lifts a primitive to the top of its layer; dropping it restores the order', withScene({}, ({ scene, svg }) => {
    let top = 'a';
    scene.add(dots('r', () => ['a', 'b', 'c'], k => ({ raise: k === top })));
    scene.draw();
    const points = layerOf(svg, 'points');
    assert.equal(keys(points), ['r/b', 'r/c', 'r/a']);
    top = null;
    scene.draw();
    assert.equal(keys(points), ['r/a', 'r/b', 'r/c']);
  }));

  test('a raised mark is not moved again by a frame that changed nothing, and keeps focus', withScene({}, ({ scene, svg }) => {
    scene.add(dots('r', () => ['a', 'b', 'c'], k => ({ raise: k === 'a' })));
    scene.draw();
    const a = layerOf(svg, 'points').lastElementChild;
    a.setAttribute('tabindex', '0');
    a.focus();
    let blurred = 0;
    a.addEventListener('blur', () => blurred++);
    const mo = new MutationObserver(() => {});
    mo.observe(svg, { childList: true, subtree: true });
    scene.draw();
    const moves = mo.takeRecords().length;
    mo.disconnect();
    assert.equal([moves, blurred, document.activeElement === a], [0, 0, true]);
  }));

  test("style() output is merged over the primitive's data and title", withScene({}, ({ scene, svg }) => {
    scene.add({
      id: 'r',
      vertices: () => [[0, 0]],
      primitives: () => [{ key: 'p', kind: 'point', indices: [0], data: { vertex: 0, w: 1 }, title: 'from the primitive' }],
      style: () => ({ data: { w: 2 } }),
    });
    scene.draw();
    const n = layerOf(svg, 'points').firstElementChild;
    assert.equal([n.getAttribute('data-vertex'), n.getAttribute('data-w')], ['0', '2']);
    assert.equal(n.querySelector('title')?.textContent, 'from the primitive');
  }));

  test('the render context: model, view, screen, depth, cue, state, frame, levels', withScene({
    scene: { store: { get: () => ({ k: 1 }) } },
  }, ({ scene }) => {
    let seen = null;
    scene.add({
      id: 'r',
      dependsOn: ['geometry'],
      vertices: () => [[0.5, 0.5]],
      primitives: ctx => {
        seen = {
          model: ctx.model(0), view: ctx.view(0), screen: ctx.screen(0), depth: ctx.depth(0),
          cue: ctx.cue(0), state: ctx.state, camera: ctx.camera, levels: [...ctx.levels],
          w: ctx.frame.w, measured: ctx.measure('ab').w > 0, scene: ctx.scene === scene,
        };
        return [];
      },
      style: () => ({}),
    });
    scene.draw();                                      // the frame add() asked for
    seen = null;
    scene.draw({ levels: ['geometry'] });
    assert.equal(seen, {
      model: [0.5, 0.5], view: [0.5, 0.5, 0], screen: [265, 85], depth: 0, cue: null,
      state: { k: 1 }, camera: null, levels: ['geometry'], w: 400, measured: true, scene: true,
    });
  }));

  test('raw markup is parsed once, and again only when it changes', withScene({}, ({ scene, svg }) => {
    let markup = '<circle r="1"/>';
    scene.add({ id: 'r', vertices: () => [], primitives: () => [{ key: 'm', kind: 'raw', markup }], style: () => ({}) });
    scene.draw();
    const g = layerOf(svg, 'faces').firstElementChild;
    const first = g.firstElementChild;
    scene.draw();
    assert.ok(g.firstElementChild === first, 'unchanged markup is not re-parsed');
    markup = '<rect width="2" height="2"/>';
    scene.draw();
    assert.ok(layerOf(svg, 'faces').firstElementChild === g);
    assert.equal(g.firstElementChild.localName, 'rect');
  }));

  test('a raw group takes its style: paint to inherit, class, payload, tooltip', withScene({}, ({ scene, svg }) => {
    scene.add({ id: 'r', vertices: () => [], primitives: () => [{ key: 'm', kind: 'raw', markup: '<circle r="1"/>' }],
      style: () => ({ fill: 'muted', class: 'deco', data: { part: 'rim' }, title: 'Rim' }) });
    scene.draw();
    const g = layerOf(svg, 'faces').firstElementChild;
    assert.equal([g.getAttribute('fill'), g.getAttribute('class'), g.getAttribute('data-part')], ['var(--muted)', 'deco', 'rim']);
    assert.equal([g.firstElementChild.localName, g.firstElementChild.textContent], ['title', 'Rim']);
    assert.equal(g.querySelector('circle')?.getAttribute('r'), '1');
  }));

  test('ctx.measure is the measure the labels are placed with', withScene({
    scene: { labels: { measure: text => ({ w: text.length * 100, h: 1 }) } },
  }, ({ scene }) => {
    let w = null;
    scene.add({ id: 'r', vertices: () => [], style: () => ({}), primitives: ctx => { w = ctx.measure('ab').w; return []; } });
    scene.draw();
    assert.equal(w, 200);
  }));
});

if (DOM) suite('scene — failure is contained', ({ test }) => {
  test('a throwing renderable is skipped and named; the others still draw', withScene({}, ({ scene, svg }) => {
    scene.add(tri());
    scene.add({ id: 'bad', vertices: () => { throw new Error('boom'); }, primitives: () => [], style: () => ({}) });
    const printed = quiet(() => scene.draw());
    assert.equal(scene.lastFrame.warnings, ['bad: boom']);
    assert.equal(svg.querySelectorAll('[data-k]').length, 3);
    assert.ok(printed.some(l => l.includes('bad: boom')), 'with no probe, the console hears it');
  }));

  test('every broken contract is a warning naming its renderable, never a half-drawn scene', withScene({}, ({ scene, svg }) => {
    const BROKEN = {
      kind: { primitives: () => [{ key: 'x', kind: 'blob', indices: [0] }], want: /unknown kind "blob"/ },
      nokey: { primitives: () => [{ kind: 'point', indices: [0] }], want: /has no key/ },
      dupe: { primitives: () => [{ key: 'x', kind: 'point', indices: [0] }, { key: 'x', kind: 'point', indices: [0] }], want: /share the key "x"/ },
      range: { primitives: () => [{ key: 'x', kind: 'point', indices: [3] }], want: /index 3 is outside the 1 vertices/ },
      frac: { primitives: () => [{ key: 'x', kind: 'point', indices: [0.5] }], want: /index 0\.5 is outside/ },
      arity: { primitives: () => [{ key: 'x', kind: 'edge', indices: [0] }], want: /needs 2 indices, got 1/ },
      nan: { vertices: () => [[NaN, 0]], primitives: () => [], want: /vertex 0 is not a finite point/ },
      literal: { style: () => ({ fill: '#000' }), want: /unknown colour token "#000"/ },
      dash: { style: () => ({ dash: 'wavy' }), want: /dash "wavy"/ },
      shape: { primitives: () => [{ key: 'x', kind: 'region' }], want: /unknown shape type/ },
      label: { labels: () => [{ text: 'x', anchor: [0, 0] }], want: /label item has no id/ },
      labeldupe: { labels: () => [{ id: 'l', text: 'a', anchor: [0, 0] }, { id: 'l', text: 'b', anchor: [9, 9] }], want: /two labels share the id "l"/ },
      anchor: { labels: () => [{ id: 'l', text: 'x' }], want: /anchor must be a finite/ },
      labeltext: { labels: () => [{ id: 'l', text: 3, anchor: [0, 0] }], want: /text must be a string/ },
      priority: { labels: () => [{ id: 'l', text: 'x', anchor: [0, 0], priority: 'high' }], want: /priority must be a number/ },
      cands: { labels: () => [{ id: 'l', text: 'x', anchor: [0, 0], candidates: () => { throw new Error('gen broke'); } }], want: /gen broke/ },
      candshape: { labels: () => [{ id: 'l', text: 'x', anchor: [0, 0], candidates: [{ dx: 'a' }] }], want: /candidates must be a list/ },
      markkey: { labels: () => [{ id: 'l', text: 'x', anchor: [0, 0], mark: { anchor: 'start' } }], want: /unknown style key "anchor"/ },
      rawparse: { primitives: () => [{ key: 'x', kind: 'raw', markup: '<circle r="1">' }], want: /raw\(\)/ },
      datakey: { style: () => ({ data: { 'face id': 1 } }), want: /cannot be a data-\* attribute name/ },
      reserved: { style: () => ({ data: { k: 1 } }), want: /data key "k" is reserved/ },
      typo: { style: () => ({ strokeWidth: 2 }), want: /unknown style key "strokeWidth"/ },
      labelpaint: { labels: () => [{ id: 'l', text: 'x', anchor: [0, 0], mark: { fill: 'red' } }], want: /unknown colour token "red"/ },
      thrown: { style: () => { throw new Error('style broke'); }, want: /style broke/ },
      dim: { dim: 3, want: /dim 3 needs a camera/ },
    };
    for (const [id, b] of Object.entries(BROKEN)) {
      const { want, ...over } = b;
      scene.add({ id, vertices: () => [[0, 0]], primitives: () => [{ key: 'x', kind: 'point', indices: [0] }], style: () => ({}), ...over });
    }
    scene.add(tri());
    quiet(() => scene.draw());
    const w = scene.lastFrame.warnings;
    const ids = Object.keys(BROKEN);
    assert.equal(w.length, ids.length, w.join(' | '));
    ids.forEach((id, i) => assert.ok(w[i].startsWith(`${id}: `) && BROKEN[id].want.test(w[i]), `${id} → ${w[i]}`));
    assert.equal([...svg.querySelectorAll('[data-k]')].map(n => n.getAttribute('data-k')), ['tri/f', 'tri/e', 'tri/p']);
  }));

  test('a renderable that breaks loses its marks for that frame, and gets them back', withScene({}, ({ scene, svg }) => {
    let broken = false;
    scene.add(dots('r', () => { if (broken) throw new Error('now broken'); return ['a']; }));
    const points = layerOf(svg, 'points');
    scene.draw();
    assert.equal(keys(points), ['r/a']);
    broken = true;
    quiet(() => scene.draw());
    assert.equal(keys(points), []);
    assert.equal(scene.lastFrame.warnings, ['r: now broken']);
    broken = false;
    scene.draw();
    assert.equal(keys(points), ['r/a']);
    assert.equal(scene.lastFrame.warnings, []);
  }));

  test('an error nobody anticipated inside a mark costs that mark, not the frame', withScene({}, ({ scene, svg }) => {
    // A title whose toString throws gets past every check (a title may be any
    // value) and only fails when the mark writes it.
    const bad = { toString() { throw new Error('bad title'); } };
    scene.add(dots('r', () => ['a', 'b', 'c'], k => (k === 'b' ? { title: bad } : {})));
    quiet(() => scene.draw());
    assert.equal(scene.lastFrame.warnings, ['r/b: bad title']);
    assert.equal(keys(layerOf(svg, 'points')), ['r/a', 'r/b', 'r/c']);
    assert.ok(layerOf(svg, 'points').children[1].hasAttribute('data-error'), 'an empty stand-in, keyed');
  }));

  test('a failure inside the placer drops the labels, reported, and draws the rest', withScene({
    scene: { labels: { measure: () => { throw new Error('no metrics'); } } },
  }, ({ scene, svg }) => {
    scene.add(tri({ labels: ctx => [{ id: 'a', text: 'A', anchor: ctx.screen(0) }] }));
    quiet(() => scene.draw());
    assert.equal(scene.lastFrame.warnings, ['labels: no metrics']);
    assert.equal(scene.lastFrame.labels, { placed: 0, dropped: 1, droppedIds: ['tri/a'] });
    assert.equal(svg.querySelectorAll('[data-k]').length, 3);
  }));

  test('detach() that throws does not stop remove() or dispose()', withScene({}, ({ scene, svg }) => {
    const a = scene.add(tri({ detach: () => { throw new Error('nope'); } }));
    scene.add(dots('b', () => ['x'], () => ({})));
    scene.draw();
    const printed = quiet(() => scene.remove(a));
    assert.ok(printed.some(l => l.includes('tri.detach() threw: nope')), printed.join());
    scene.draw();
    assert.equal(svg.querySelectorAll('[data-k]').length, 1);
    scene.add(tri({ id: 'again', detach: () => { throw new Error('nope'); } }));
    quiet(() => scene.dispose());
    assert.equal(svg.querySelectorAll('g').length, 0, 'the layers went anyway');
  }));

  test('a primitive naming a missing layer is a warning; the rest of its renderable draws', withScene({}, ({ scene, svg }) => {
    scene.add({
      id: 'r', vertices: () => [[0, 0]], style: () => ({}),
      primitives: () => [{ key: 'a', kind: 'point', indices: [0], layer: 'nowhere' }, { key: 'b', kind: 'point', indices: [0] }],
    });
    quiet(() => scene.draw());
    assert.equal(scene.lastFrame.warnings, ['r: primitive a names layer "nowhere", which the scene does not have']);
    assert.equal(keys(layerOf(svg, 'points')), ['r/b']);
  }));
});

if (DOM) suite('scene — only what changed is redone', ({ test }) => {
  test('dependsOn: a level the renderable does not name reuses its build', withScene({}, ({ scene }) => {
    let calls = 0;
    scene.add(tri({ dependsOn: ['geometry'], vertices: () => { calls++; return [[0, 0], [1, 0], [0, 1]]; } }));
    scene.draw();
    assert.equal(calls, 1);
    scene.draw({ levels: ['style'] });
    assert.equal(calls, 1, 'style is not geometry');
    scene.draw({ levels: ['geometry'] });
    assert.equal(calls, 2);
    scene.draw();
    assert.equal(calls, 3, "no levels means 'all'");
  }));

  test('a draw that rebuilt nothing writes nothing — labels and raised marks included', withScene({}, ({ scene, svg }) => {
    scene.add(tri({
      dependsOn: ['geometry'],
      primitives: () => [
        { key: 'f', kind: 'face', indices: [0, 1, 2] },
        { key: 'p', kind: 'point', indices: [2], raise: true },
        { key: 'q', kind: 'point', indices: [1] },
      ],
      labels: ctx => [{ id: 'a', text: 'A', anchor: ctx.screen(0) }, { id: 'b', text: 'B', anchor: ctx.screen(1) }],
    }));
    scene.draw();
    const mo = new MutationObserver(() => {});
    mo.observe(svg, { attributes: true, childList: true, subtree: true, characterData: true });
    scene.draw({ levels: ['style'] });
    const records = mo.takeRecords();
    mo.disconnect();
    assert.equal(records.length, 0, `${records.length} mutation(s)`);
  }));

  test('a clean redraw does not even re-run a mark', withScene({}, ({ scene }) => {
    // Writing nothing is attr()'s doing; not re-running the mark at all is the
    // scene's. A mark turns its title into text every time it runs, and the
    // scene passes the title through untouched, so this counts mark runs.
    let runs = 0;
    const title = { toString() { runs++; return 'the face'; } };
    scene.add(tri({ dependsOn: ['geometry'], style: prim => (prim.kind === 'face' ? { title } : {}) }));
    scene.draw();
    const after = runs;
    assert.ok(after > 0);
    scene.draw({ levels: ['style'] });
    assert.equal(runs, after, 'the face mark ran again');
  }));

  test('a new frame rebuilds whatever the levels say', withScene({}, ({ scene, svg }) => {
    scene.add(tri({ dependsOn: ['geometry'] }));
    scene.draw();
    svg.style.width = '300px';
    scene.draw({ levels: ['style'] });
    const p = layerOf(svg, 'points').firstElementChild;
    assert.equal([p.getAttribute('cx'), p.getAttribute('cy')], ['150', '20']);
  }));

  test('invalidate() coalesces to one draw per frame, with the union of the levels', async () => {
    const draws = [];
    await withScene({ scene: { onDraw: ({ levels }) => draws.push([...levels].sort()) } }, async ({ scene }) => {
      scene.add(tri());                                  // add() asks for 'all'
      scene.invalidate('style');
      scene.invalidate('geometry');
      scene.invalidate('style');
      await nextFrame(); await nextFrame();
      assert.equal(draws, [['all', 'geometry', 'style']]);
      scene.invalidate('labels');
      await nextFrame(); await nextFrame();
      assert.equal(draws, [['all', 'geometry', 'style'], ['labels']]);
    })();
  });

  test('a synchronous draw() takes over a pending frame, levels and all', async () => {
    const draws = [];
    await withScene({ scene: { onDraw: ({ levels }) => draws.push([...levels].sort()) } }, async ({ scene }) => {
      scene.add(tri());                                  // a frame is pending, for 'all'
      scene.invalidate('style');
      scene.draw({ levels: ['geometry'] });
      await nextFrame(); await nextFrame();
      assert.equal(draws, [['all', 'geometry', 'style']], 'one draw, with every level');
    })();
  });

  test('a hidden viewport skips the frame and calls no hook', withScene({ hidden: true }, ({ scene, svg, host }) => {
    let calls = 0;
    scene.add(tri({ vertices: () => { calls++; return [[0, 0], [1, 0], [0, 1]]; } }));
    const out = scene.draw();
    assert.equal(out.skipped, 'hidden');
    assert.equal(calls, 0);
    assert.equal(svg.querySelectorAll('[data-k]').length, 0);
    host.style.display = '';
    scene.draw();
    assert.equal(calls, 1);
    assert.equal(svg.querySelectorAll('[data-k]').length, 3);
  }));
});

if (DOM) suite('scene — labels', ({ test }) => {
  test('labels from every renderable share one placer: priority wins, every drop is reported', withScene({}, ({ scene, svg }) => {
    scene.add(tri({
      labels: ctx => [
        { id: 'lo', text: 'low', anchor: ctx.screen(0), candidates: candidates.centered() },
        { id: 'hi', text: 'high', anchor: ctx.screen(0), candidates: candidates.centered(), priority: 5 },
      ],
    }));
    scene.add({
      id: 'other', vertices: () => [[0, 0]], primitives: () => [], style: () => ({}),
      labels: ctx => [{ id: 'x', text: 'other', anchor: ctx.screen(0), candidates: candidates.centered(), priority: 1 }],
    });
    scene.draw();
    const L = layerOf(svg, 'labels');
    assert.equal(keys(L), ['label:tri/hi']);
    const t = L.firstElementChild;
    assert.equal([t.textContent, t.getAttribute('class')], ['high', 'uf-mark uf-halo']);
    assert.equal([t.getAttribute('x'), t.getAttribute('y'), t.getAttribute('text-anchor')], ['200', '150', 'middle']);
    assert.equal(scene.lastFrame.labels, { placed: 1, dropped: 2, droppedIds: ['other/x', 'tri/lo'] });
  }));

  test("an item's mark draws the label; its style is only measured", withScene({}, ({ scene, svg }) => {
    scene.add(tri({
      labels: ctx => [{
        id: 'a', text: 'A', anchor: ctx.screen(0), candidates: candidates.centered(),
        style: { fontSize: 13 }, mark: { class: 'point-label', halo: false, data: { v: 0 } },
      }],
    }));
    scene.draw();
    const t = layerOf(svg, 'labels').firstElementChild;
    assert.equal([t.getAttribute('class'), t.getAttribute('data-v'), t.getAttribute('style')], ['point-label', '0', null]);
  }));

  test('a label keeps its node across draws', withScene({}, ({ scene, svg }) => {
    scene.add(tri({ labels: ctx => [{ id: 'a', text: 'A', anchor: ctx.screen(0), candidates: candidates.centered() }] }));
    scene.draw();
    const t = layerOf(svg, 'labels').firstElementChild;
    scene.draw();
    assert.ok(layerOf(svg, 'labels').firstElementChild === t);
  }));

  test('with no labels layer, labels go on top', withScene({ scene: { layers: ['under', 'over'] } }, ({ scene, svg }) => {
    scene.add({
      id: 'r', vertices: () => [[0, 0]], primitives: () => [], style: () => ({}),
      labels: ctx => [{ id: 'a', text: 'A', anchor: ctx.screen(0), candidates: candidates.centered() }],
    });
    scene.draw();
    assert.equal(keys(layerOf(svg, 'over')), ['label:r/a']);
  }));

  test("onDrop 'shrink': a label that fits only smaller is drawn at that size", withScene({ scene: { labels: { onDrop: 'shrink' } } }, ({ scene, svg }) => {
    // Ten capitals at 13px measure 89.8px with padding; 41px from the inset edge
    // they overhang at full size and fit at 0.85 of it.
    scene.add({
      id: 'r', vertices: () => [], primitives: () => [], style: () => ({}),
      labels: () => [{ id: 'a', text: 'MMMMMMMMMM', anchor: [356, 150], candidates: candidates.centered() }],
    });
    scene.draw();
    assert.equal(layerOf(svg, 'labels').firstElementChild?.getAttribute('style'), 'font-size:11.05px');
    assert.equal(scene.lastFrame.labels.dropped, 0);
  }));
});

if (DOM) suite('scene — the probe', ({ test }) => {
  test('engine fields, domain.<id> from each renderable, warnings, and a commit', async () => {
    let probe = null;
    await withScene({ scene: (svg, host) => ({ probe: (probe = createProbe(host, { id: 'scene-test', enabled: true })) }) },
      async ({ scene, host }) => {
        const r = scene.add(tri({ probe: ctx => ({ n: 3, w: ctx.frame.w }) }));
        scene.add({ id: 'bad', vertices: () => { throw new Error('boom'); }, primitives: () => [], style: () => ({}) });
        const printed = quiet(() => scene.draw());
        const snap = probe.snapshot();
        assert.equal(snap.viewport, { cx: 200, cy: 150, h: 300, live: true, r: 130, w: 400 });
        assert.equal(snap.layers, [{ count: 1, name: 'faces' }, { count: 1, name: 'edges' }, { count: 1, name: 'points' }, { count: 0, name: 'labels' }]);
        assert.equal(snap.marks, { edge: 1, face: 1, point: 1 });
        assert.equal(snap.labels, { dropped: 0, droppedIds: [], placed: 0 });
        assert.equal(snap.domain, { tri: { n: 3, w: 400 } });
        assert.equal(snap.warnings, [{ msg: 'bad: boom' }]);
        assert.equal(printed, [], 'with a probe, warnings go to the probe, not the console');
        const committed = await probe.nextRev({ rev: 0 });
        assert.equal(JSON.parse(host.getAttribute('data-probe')).domain, committed.domain);
        scene.remove(r);
        quiet(() => scene.draw());
        assert.equal(probe.snapshot().domain, undefined, 'a removed renderable leaves no stale record');
      })();
    probe?.dispose();
  });
});

let current = null;   // the store behind the stale-state pick test

if (DOM) suite('scene — picking', ({ test }) => {
  const picked = over => tri({
    primitives: () => [
      { key: 'f', kind: 'face', indices: [0, 1, 2], data: { face: 'abc' } },
      { key: 'p', kind: 'point', indices: [2], data: { vertex: 2 } },
    ],
    style: prim => (prim.kind === 'face' ? { fill: 'zone' } : { fill: 'fg', ring: true, r: 4 }),
    ...over,
  });
  /** A pointerdown on `target`, at viewBox (x, y) — 1 unit is 1 CSS px here. */
  const down = (svg, target, x, y) => {
    const rect = svg.getBoundingClientRect();
    target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: rect.left + x, clientY: rect.top + y }));
  };

  test('a pointerdown resolves to the primitive under it, by key', withScene({}, ({ scene, svg }) => {
    const r = scene.add(picked());
    scene.draw();
    const hits = [];
    const off = scene.onPick(h => hits.push(h));
    const face = layerOf(svg, 'faces').firstElementChild;
    down(svg, face, 250, 120);
    assert.equal(hits.length, 1);
    const [h] = hits;
    assert.ok(h.renderable === r && h.node === face);
    assert.equal([h.prim.key, h.data], ['f', { face: 'abc' }]);
    assert.close(h.point[0], 250, 1e-6);
    assert.close(h.point[1], 120, 1e-6);
    const g = layerOf(svg, 'points').firstElementChild;
    down(svg, g.querySelector('circle'), 200, 20);
    assert.equal([hits[1].prim.key, hits[1].node === g, hits[1].data], ['p', true, { vertex: 2 }]);
    down(svg, svg, 390, 290);
    assert.equal(hits.length, 2, 'nothing under the pointer, no hit');
    off();
    down(svg, face, 250, 120);
    assert.equal(hits.length, 2, 'unsubscribed');
  }));

  test("the renderable's own onPick sees the hit first, and true stops it there", withScene({}, ({ scene, svg }) => {
    const own = [];
    scene.add(picked({ onPick: (hit, ctx) => { own.push([hit.prim.key, ctx.frame.w]); return hit.prim.key === 'f'; } }));
    scene.draw();
    const hits = [];
    scene.onPick(h => hits.push(h.prim.key));
    down(svg, layerOf(svg, 'faces').firstElementChild, 250, 120);
    down(svg, layerOf(svg, 'points').firstElementChild.querySelector('circle'), 200, 20);
    assert.equal(own, [['f', 400], ['p', 400]]);
    assert.equal(hits, ['p']);
  }));

  test("a pick sees the store's state now, not the state its renderable was built with", withScene({
    scene: { store: { get: () => ({ selected: current }) } },
  }, ({ scene, svg }) => {
    current = null;
    const seen = [];
    scene.add(picked({ dependsOn: ['geometry'], onPick: (hit, ctx) => { seen.push(ctx.state.selected); } }));
    scene.draw();
    current = 'p';
    scene.draw({ levels: ['selection'] });           // the renderable is not rebuilt
    down(svg, layerOf(svg, 'faces').firstElementChild, 250, 120);
    assert.equal(seen, ['p']);
  }));

  test('a removed renderable is out of reach of a pick at once', withScene({}, ({ scene, svg }) => {
    const r = scene.add(picked());
    scene.draw();
    const hits = [];
    scene.onPick(h => hits.push(h));
    scene.remove(r);
    down(svg, layerOf(svg, 'faces').firstElementChild, 250, 120);   // its node is still there until the next draw
    assert.equal(hits.length, 0);
  }));

  test('a label is pickable: its item id, its renderable, its mark payload', withScene({}, ({ scene, svg }) => {
    const r = scene.add(tri({ labels: ctx => [{ id: 'a', text: 'A', anchor: ctx.screen(0), meta: 7, mark: { data: { vertex: 0 } } }] }));
    scene.draw();
    const hits = [];
    scene.onPick(h => hits.push(h));
    down(svg, layerOf(svg, 'labels').firstElementChild, 200, 150);
    assert.equal(hits.length, 1);
    assert.ok(hits[0].renderable === r);
    assert.equal([hits[0].prim.key, hits[0].prim.kind, hits[0].prim.meta, hits[0].data], ['a', 'label', 7, { vertex: 0 }]);
  }));

  test("a renderable's onPick needs no page handler, and the listener goes with it", withScene({}, ({ scene, svg }) => {
    const seen = [];
    const r = scene.add(picked({ onPick: hit => { seen.push(hit.prim.key); } }));
    scene.draw();
    const face = layerOf(svg, 'faces').firstElementChild;
    down(svg, face, 250, 120);
    assert.equal(seen, ['f']);
    scene.remove(r);
    scene.add(picked({ id: 'plain' }));
    scene.draw();
    down(svg, layerOf(svg, 'faces').firstElementChild, 250, 120);
    assert.equal(seen, ['f'], 'removed, and nothing else was listening');
  }));

  test('pickRadius: the nearest point within reach, nothing beyond it', withScene({}, ({ scene, svg }) => {
    scene.add(picked());
    scene.draw();
    const hits = [];
    scene.onPick(h => hits.push(h));
    scene.pickRadius = 12;
    down(svg, svg, 205, 25);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].prim.key, 'p');
    assert.ok(hits[0].node === layerOf(svg, 'points').firstElementChild);
    down(svg, svg, 230, 60);
    assert.equal(hits.length, 1, '50px away is out of reach');
  }));

  test("a data-k inside raw markup is not mistaken for one of the scene's keys", withScene({}, ({ scene, svg }) => {
    // Even under a group that calls itself a layer: only the scene's own layer
    // groups hold its marks.
    scene.add(picked());
    scene.add({ id: 'deco', vertices: () => [], style: () => ({}),
      primitives: () => [{ key: 'm', kind: 'raw', markup: '<g data-layer="faces"><circle data-k="tri/f" r="3"/></g>' }] });
    scene.draw();
    const hits = [];
    scene.onPick(h => hits.push(`${h.renderable.id}/${h.prim.key}`));
    down(svg, svg.querySelector('[data-k="deco/m"] circle'), 0, 0);
    assert.equal(hits, ['deco/m']);
  }));
});

if (DOM) suite('scene — defs and teardown', ({ test }) => {
  test('defs(): one <defs> before the layers, each id made once', withScene({}, ({ scene, svg }) => {
    let made = 0;
    const factory = () => { made++; return document.createElementNS(SVG_NS, 'pattern'); };
    assert.equal(scene.defs('hatch', factory), 'url(#hatch)');
    assert.equal(scene.defs('hatch', factory), 'url(#hatch)');
    assert.equal(made, 1);
    const defs = svg.querySelector(':scope > defs');
    assert.ok(defs.nextElementSibling === layerOf(svg, 'faces'));
    assert.equal(defs.querySelector('#hatch').localName, 'pattern');
  }));

  test("layer() hands out a layer group; a page's own node in it paints under the marks", withScene({}, ({ scene, svg }) => {
    assert.ok(scene.layer('points') === layerOf(svg, 'points'));
    assert.throws(() => scene.layer('nowhere'));
    scene.add(dots('r', () => ['a', 'b']));
    scene.draw();
    const mine = document.createElementNS(SVG_NS, 'circle');
    scene.layer('points').append(mine);
    scene.draw();
    assert.ok(scene.layer('points').firstElementChild === mine, 'kept, and underneath');
    assert.equal(keys(scene.layer('points')).slice(1), ['r/a', 'r/b']);
  }));

  test('dispose(): layers, defs and the listener go; renderables detach; a pending frame never draws', async () => {
    const { host, svg } = stage();
    const viewport = new Viewport(svg, { observe: false });
    // A frame that fired anyway would throw inside requestAnimationFrame, where
    // nothing catches it; the page's error event is the only place it shows.
    const uncaught = [];
    const onError = e => uncaught.push(e.message);
    window.addEventListener('error', onError);
    try {
      let draws = 0, detached = 0;
      const scene = new SvgScene(svg, { viewport, onDraw: () => draws++ });
      scene.add(tri({ detach: () => detached++ }));        // a frame is now pending
      scene.defs('x', () => document.createElementNS(SVG_NS, 'pattern'));
      const hits = [];
      scene.onPick(h => hits.push(h));
      scene.dispose();
      await nextFrame(); await nextFrame();
      assert.equal(draws, 0, 'the pending frame was cancelled');
      assert.equal(uncaught, [], 'and did not fire into a disposed scene');
      assert.equal(detached, 1);
      assert.equal(svg.children.length, 0);
      svg.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      assert.equal(hits.length, 0);
      assert.throws(() => scene.draw());
      scene.invalidate();
      scene.dispose();
    } finally { window.removeEventListener('error', onError); viewport.dispose(); host.remove(); }
  });
});
