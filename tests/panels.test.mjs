// Layer 4 — panels: the frame, the two layouts, and the draw context.
//
// The draw context is where a page's mathematics becomes marks, so what is
// worth pinning is the contract it keeps with render/scene.js: model points
// become vertex INDICES, every primitive gets a unique key in paint order, and
// a radius may be model units, pixels, or both. Get any of those wrong and the
// scene either throws or, worse, reconciles two different marks onto one node.
//
// Browser-only: everything here builds DOM.

import { suite, assert } from './harness.mjs';
import * as panels from '../engine/page/panels.js';

const DOM = typeof document !== 'undefined';

/** A frame stand-in: the scene's, with an identity-ish transform. */
const FRAME = { w: 200, h: 100, cx: 100, cy: 50, r: 40, toScreen: ([x, y]) => [100 + 40 * x, 50 - 40 * y] };
const begin = d => d.begin({ frame: FRAME, state: {} }, 0.5);

suite('panels — module', ({ test }) => {
  test('it is Layer 4', () => assert.equal(panels.LAYER, 4));

  test('a stage needs columns and a linked overlay needs routes', () => {
    assert.throws(() => panels.stage({ columns: [] }));
    assert.throws(() => panels.linked({ routes: [], samples: () => [], colour: () => '--fg' }));
    assert.throws(() => panels.linked({ routes: [{ from: 'a', to: 'b' }], samples: [], colour: () => '--fg' }));
    assert.throws(() => panels.linked({ routes: [{ from: 'a', to: 'b' }], samples: () => [], colour: '--fg' }));
  });

  test('linked carries its toggle — the key that decides whether it is shown', () => {
    const o = panels.linked({
      routes: [{ from: 'a', to: 'b' }], samples: () => [], colour: () => '--fg', toggle: 'connections',
    });
    assert.equal(o.toggle, 'connections');
    assert.throws(() => panels.linked({
      routes: [{ from: 'a', to: 'b' }], samples: () => [], colour: () => '--fg', toggle: true,
    }));
  });
});

if (DOM) suite('panels — frames and layouts', ({ test }) => {
  const id = name => `w-${name}`;
  const P = (pid, extra = {}) => ({ id: pid, title: 'Now', sym: 'fₜ(x)', ...extra });

  test('a frame is a figure, a two-part heading and a drawing', () => {
    const { figure, drawing, title } = panels.frameMarkup(document, P('now', { frame: 'current' }), { id });
    assert.equal(figure.tagName, 'FIGURE');
    assert.equal(figure.className, 'uf-frame uf-frame--current');
    assert.equal(title.className, 'uf-frame__title');
    assert.equal(title.textContent, 'Now');
    assert.equal(figure.querySelector('.uf-sym').textContent, 'fₜ(x)');
    assert.equal(drawing.getAttribute('data-panel'), 'now');
  });

  test('a drawing that answers to the keyboard is a group, not an image', () => {
    const { drawing } = panels.frameMarkup(document, P('now', { describe: 'A map.' }), { id });
    assert.equal(drawing.getAttribute('role'), 'group');
    assert.equal(drawing.getAttribute('tabindex'), '0');
    assert.equal(drawing.getAttribute('aria-label'), 'A map.');
    const readOnly = panels.frameMarkup(document, P('still', { interactive: false }), { id }).drawing;
    assert.equal(readOnly.getAttribute('role'), 'img');
    assert.equal(readOnly.hasAttribute('tabindex'), false);
  });

  test('the title is always its own element, even when it never changes', () => {
    const { title } = panels.frameMarkup(document, { id: 'x', title: 'Input' }, { id });
    assert.equal(title.tagName, 'SPAN');
  });

  test('a stage mounts its panels, its label rails and, when asked, the overlay', () => {
    const map = new Map([['source', P('source')], ['start', P('start')], ['now', P('now')]]);
    const block = panels.stage({
      overlay: true,
      columns: [
        { id: 'x', panels: ['source'], label: () => 'X', needs: ['cfg'] },
        { id: 'y', panels: ['start', 'now'], ariaLabel: 'The maps' },
      ],
    });
    const built = block.build({ doc: document, panels: map, id });
    assert.equal(built.root.className, 'uf-stage');
    assert.equal([...built.mounts.keys()], ['source', 'start', 'now']);
    assert.equal(built.overlay.getAttribute('data-uf'), 'overlay');
    assert.equal(built.overlay.hasAttribute('hidden'), true, 'an overlay starts out of the way');
    assert.equal([...built.labels.keys()], ['x']);
    assert.equal(built.root.querySelectorAll('.uf-column').length, 2);
    assert.equal(built.root.querySelector('.uf-stack').children.length, 2, 'two drawings stack');
    assert.equal(block.labelFor('x').needs, ['cfg']);
    assert.equal(block.labelFor('y'), null);
  });

  test('a stage names the panel it cannot find', () => {
    const block = panels.stage({ columns: [{ id: 'x', panels: ['nope'] }] });
    assert.throws(() => block.build({ doc: document, panels: new Map(), id }));
  });

  test('custom adopts the page\'s own markup and gives it the drawing affordances', () => {
    const host = document.createElement('div');
    host.innerHTML = '<figure><h2><span data-uf="title"></span></h2><svg data-panel="a"></svg></figure>' +
      '<p data-uf="label:x"></p><svg data-uf="overlay"></svg>';
    const root = document.createElement('section');
    root.id = 'adopt-me';
    root.append(host);
    const block = panels.custom(host, { labels: { x: { needs: ['cfg'], compute: () => 'X' } } });
    const built = block.build({ doc: document, panels: new Map([['a', P('a', { describe: 'A.' })]]), root });
    assert.equal(built.adopted, true);
    const svg = built.mounts.get('a').drawing;
    assert.equal(svg.getAttribute('role'), 'group');
    assert.equal(svg.getAttribute('tabindex'), '0');
    assert.equal(svg.getAttribute('aria-label'), 'A.');
    assert.equal(built.mounts.get('a').title.getAttribute('data-uf'), 'title');
    assert.equal([...built.labels.keys()], ['x']);
    assert.equal(block.labelFor('x').needs, ['cfg']);
  });

  test('custom says which handle the markup is missing', () => {
    const host = document.createElement('div');
    const root = document.createElement('section');
    root.append(host);
    assert.throws(() => panels.custom(host).build({ doc: document, panels: new Map([['a', P('a')]]), root }),
      'no [data-panel]');
    host.innerHTML = '<svg data-panel="a"></svg>';
    assert.throws(() => panels.custom(host, { labels: { x: { compute: () => 'X' } } })
      .build({ doc: document, panels: new Map([['a', P('a')]]), root }), 'no label rail');
  });
});

if (DOM) suite('panels — the draw context', ({ test }) => {
  const make = (options = {}) => new panels.DrawContext({
    panel: { id: 'now' },
    options: { ring: { r: 4, outer: 10, halo: 5, ink: 2 }, ...options },
    defs: (name, factory) => { factory(document); return `url(#uf-${name})`; },
  });

  test('a model point becomes a vertex index, in the order it was drawn', () => {
    const d = make(); begin(d);
    d.edge([0, 0], [1, 1]);
    assert.equal(d.vertices, [[0, 0], [1, 1]]);
    assert.equal(d.primitives[0].indices, [0, 1]);
    assert.equal(d.primitives[0].kind, 'edge');
  });

  test('every primitive has a unique key, and paint order is call order', () => {
    const d = make(); begin(d);
    d.face([[0, 0], [1, 0], [0, 1]]);
    d.dot([0, 0]);
    d.text([0, 0], 'a');
    const keys = d.primitives.map(p => p.key);
    assert.equal(new Set(keys).size, keys.length, 'no two primitives share a key');
    assert.equal(d.primitives.map(p => p.kind), ['face', 'point', 'text']);
  });

  test('begin() clears the record, so a redraw is not an accumulation', () => {
    const d = make(); begin(d);
    d.dot([0, 0]);
    begin(d);
    assert.equal(d.primitives.length, 0);
    assert.equal(d.vertices.length, 0);
  });

  test('a point that is not a finite pair is refused where it is written', () => {
    const d = make(); begin(d);
    assert.throws(() => d.dot([0, NaN]));
    assert.throws(() => d.dot('0,0'));
  });

  test('a radius may be model units, pixels, or frame.r·model + px', () => {
    const d = make(); begin(d);
    d.circle([0, 0], 1);
    d.circle([0, 0], { px: 5 });
    d.circle([0, 0], { model: 0.5, px: 5 });
    assert.equal(d.primitives.map(p => p.shape.r), [40, 5, 25]);
    assert.equal(d.primitives[0].shape.cx, 100);
    assert.equal(d.primitives[0].shape.cy, 50);
    assert.throws(() => d.circle([0, 0], { model: 'big' }));
  });

  test('an annulus is one even-odd path, not a disc with a hole punched over it', () => {
    const d = make(); begin(d);
    d.annulus([0, 0], { inner: 0.45, outer: 1 });
    const [prim] = d.primitives;
    assert.equal(prim.kind, 'region');
    assert.equal(prim.style.fillRule, 'evenodd');
    assert.equal(prim.shape.d.split('M').length - 1, 2, 'two subpaths');
  });

  test('a hatch is defined once and referenced, not re-emitted per frame', () => {
    let made = 0;
    const d = new panels.DrawContext({
      panel: { id: 'now' }, options: {},
      defs: (name, f) => { made++; f(document); return `url(#uf-${name})`; },
    });
    begin(d);
    d.hatchDisk([0, 0], 0.45);
    begin(d);
    d.hatchDisk([0, 0], 0.45);
    assert.equal(made, 2, 'the context asks once per frame; the scene caches by id');
    assert.equal(d.primitives[0].style.fill, 'url(#uf-hatch)');
  });

  test('the selection ring is three marks on one vertex, in the instance\'s radii', () => {
    const d = make({ ring: { r: 3.5, outer: 8, halo: 4, ink: 1.7 } }); begin(d);
    d.ring([0, 0], { fill: '--fg' });
    assert.equal(d.vertices.length, 1, 'one vertex, three marks');
    assert.equal(d.primitives.map(p => p.style.r), [3.5, 8, 8]);
    assert.equal(d.primitives.map(p => p.indices[0]), [0, 0, 0]);
    assert.equal(d.primitives[1].style.stroke, '--halo');
    assert.equal(d.primitives[2].style.stroke, '--ink');
  });

  test('probe data is merged, not replaced', () => {
    const d = make(); begin(d);
    d.probe({ a: 1 });
    d.probe({ b: 2 });
    assert.equal(d.probeData, { a: 1, b: 2 });
    assert.throws(() => d.probe('a'));
  });
});
