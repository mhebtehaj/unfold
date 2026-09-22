// Layer 4 — an explorable: the three promises at the top of explorable.js, as
// tests.
//
//   INVALIDATION IS DERIVED    a write schedules one frame; exactly the panels
//                              and bindings whose keys moved are redrawn, and
//                              nothing in a page calls a draw function.
//   INSTANCES, NOT SINGLETONS  the same spec mounts twice and the two agree,
//                              down to the probe.
//   ONE FROZEN SET OF KNOBS    assertNoDrift() names every constant two
//                              instances of a kind disagree about and neither
//                              declared.
//
// Browser-only: an explorable measures boxes and builds SVG.

import { suite, assert } from './harness.mjs';
import { explorable, mountAll, assertNoDrift, DEFAULTS, instances } from '../engine/page/explorable.js';
import * as panels from '../engine/page/panels.js';
import * as control from '../engine/page/controls-ui.js';
import * as prose from '../engine/page/prose.js';

const DOM = typeof document !== 'undefined';

// A drawing needs a box to fit into; the test page has no stylesheet.
if (DOM && !document.getElementById('uf-test-style')) {
  const s = document.createElement('style');
  s.id = 'uf-test-style';
  s.textContent = '.uf-drawing{display:block;width:200px;height:120px}.uf-stage{position:relative;display:block}';
  document.head.append(s);
}

/** A root attached to the document, torn down by the caller. */
function host() {
  const el = document.createElement('section');
  document.body.append(el);
  return el;
}

/** The smallest useful explorable: one drawing, one derived value, one slot. */
function spec(over = {}) {
  return {
    id: over.id ?? 'w',
    kind: 'demo',
    state: { t: 0.5, example: 'a', selected: null, notice: null },
    derive: { cfg: [['example'], s => ({ name: s.example.toUpperCase() })] },
    body: [
      control.group(control.transport({ key: 't', math: 't' })),
      prose.slot({ class: 'uf-note', name: 'note', needs: ['cfg'], text: s => s.cfg.name }),
      panels.stage({ columns: [{ id: 'x', panels: ['live', 'still'] }] }),
    ],
    panels: [
      { id: 'live', title: 'Live', at: 'live', draw: (d, s) => { d.dot([s.t, 0]); } },
      { id: 'still', title: 'Still', at: 0, needs: ['example'], draw: d => { d.dot([0, 0]); } },
    ],
    ...over,
  };
}

/** One frame, so the rAF-scheduled pump has run. */
const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

suite('explorable — the spec is checked before any DOM exists', ({ test }) => {
  test('every knob has one frozen default', () => {
    assert.equal(Object.isFrozen(DEFAULTS), true);
    assert.equal(Object.isFrozen(DEFAULTS.pad), true);
    assert.equal(DEFAULTS.pickThreshold, 24);
  });

  test('an id must be a name, state and panels are required', () => {
    assert.throws(() => explorable({ id: 'a b', state: {}, panels: [{ id: 'p', draw() {} }] }));
    assert.throws(() => explorable({ id: 'a', panels: [{ id: 'p', draw() {} }] }));
    assert.throws(() => explorable({ id: 'a', state: {}, panels: [] }));
  });

  test('a panel that needs a key that is not state fails at the page\'s first line', () => {
    assert.throws(() => explorable({
      id: 'a', state: { t: 0 }, panels: [{ id: 'p', needs: ['nope'], draw() {} }],
    }), 'a typo in needs must not wait for the frame that first needed it');
    assert.throws(() => explorable({
      id: 'a', state: { t: 0 }, panels: [{ id: 'p', draw: 'not a function' }],
    }));
  });

  test('a derived key counts as a key', () => {
    explorable({
      id: 'a', state: { t: 0 }, derive: { cfg: [['t'], () => 1] },
      panels: [{ id: 'p', needs: ['cfg'], draw() {} }],
    });
  });
});

if (DOM) suite('explorable — mounting, drawing and invalidation', ({ test }) => {
  const live = [];
  const mount = (s, target) => { const a = explorable(s).mount(target); live.push(a); return a; };
  const cleanup = () => { while (live.length) live.pop().destroy(); };

  test('it mounts its body in spec order and marks its root', async () => {
    const root = host();
    const app = mount(spec(), root);
    await frame();
    assert.equal(root.getAttribute('data-explorable'), 'w');
    assert.equal([...root.children].map(c => c.className),
      ['uf-controls', 'uf-note', 'uf-stage']);
    assert.equal(app.panel('live').viewport.live, true, 'the drawing has a box');
    assert.ok(root.querySelector('[data-panel="live"] circle'), 'and something was drawn in it');
    cleanup();
    root.remove();
  });

  test('a write redraws exactly the panels whose keys moved', async () => {
    const root = host();
    const app = mount(spec(), root);
    await frame();
    const before = { live: app.panel('live').redraws, still: app.panel('still').redraws };
    app.set('t', 0.75);
    await frame();
    assert.equal(app.panel('live').redraws, before.live + 1, 'the live panel follows t');
    assert.equal(app.panel('still').redraws, before.still, 'the fixed panel does not');
    app.set('example', 'b');
    await frame();
    assert.equal(app.panel('still').redraws, before.still + 1);
    cleanup();
    root.remove();
  });

  test('a sweep of t redraws the live panel once per frame — not once per write', async () => {
    const root = host();
    const app = mount(spec(), root);
    await frame();
    const before = app.panel('live').redraws;
    for (let i = 0; i <= 10; i++) app.set('t', i / 10);
    await frame();
    assert.equal(app.panel('live').redraws - before, 1,
      'eleven writes in one frame are one redraw');
    cleanup();
    root.remove();
  });

  test('a pick — a write that is not a control — schedules a frame like any other', async () => {
    const root = host();
    const app = mount(spec({
      panels: [
        { id: 'live', title: 'Live', at: 'live', needs: ['selected'], draw: (d, s) => { d.dot([s.selected?.u ?? 0, 0]); } },
        { id: 'still', title: 'Still', at: 0, needs: ['example'], draw: d => { d.dot([0, 0]); } },
      ],
    }), root);
    await frame();
    const before = app.panel('live').redraws;
    app.set('selected', { u: 0.3 });
    await frame();
    assert.equal(app.panel('live').redraws, before + 1);
    cleanup();
    root.remove();
  });

  test('a prose binding writes once per distinct sentence', async () => {
    const root = host();
    const app = mount(spec(), root);
    await frame();
    const note = app.bindings.find(b => b.name === 'note');
    const before = note.writes;
    app.set('example', 'b'); await frame();
    app.set('t', 0.1); await frame();
    app.set('t', 0.2); await frame();
    assert.equal(note.writes, before + 1, 'only the example changed the sentence');
    assert.equal(note.el.textContent, 'B');
    cleanup();
    root.remove();
  });

  test('a page\'s own markup is adopted in body order, not appended around', async () => {
    const root = host();
    root.innerHTML = '<h2>Heading</h2><div id="own"><svg data-panel="only"></svg></div>';
    const app = mount({
      id: 'adopted', state: { t: 0 },
      body: [
        prose.block({ class: 'first', content: 'before' }),
        panels.custom('#own'),
        prose.block({ class: 'last', content: 'after' }),
      ],
      panels: [{ id: 'only', title: 'Only', draw: d => d.dot([0, 0]) }],
    }, root);
    await frame();
    assert.equal([...root.children].map(c => c.id || c.className || c.tagName),
      ['H2', 'first', 'own', 'last']);
    cleanup();
    root.remove();
    assert.ok(app);
  });

  test('bindings reach markup the page wrote itself, and a dead selector is loud', async () => {
    const root = host();
    root.innerHTML = '<div id="own" data-side=""><svg data-panel="only"></svg><span id="leg"></span></div>';
    const app = mount({
      id: 'bound', state: { side: 'x' },
      body: [panels.custom('#own')],
      bindings: [
        { sel: '#own', attr: 'data-side', needs: ['side'], value: s => s.side },
        { sel: '#leg', needs: ['side'], text: s => (s.side === 'x' ? 'f' : 'g') },
      ],
      panels: [{ id: 'only', title: 'Only', draw: d => d.dot([0, 0]) }],
    }, root);
    await frame();
    assert.equal(root.querySelector('#own').getAttribute('data-side'), 'x');
    assert.equal(root.querySelector('#leg').textContent, 'f');
    app.set('side', 'y');
    await frame();
    assert.equal(root.querySelector('#own').getAttribute('data-side'), 'y');
    assert.equal(root.querySelector('#leg').textContent, 'g');
    cleanup();
    root.remove();

    const bad = host();
    bad.innerHTML = '<div id="own2"><svg data-panel="only"></svg></div>';
    assert.throws(() => explorable({
      id: 'dead', state: { side: 'x' },
      body: [panels.custom('#own2')],
      bindings: [{ sel: '#nowhere', text: s => s.side }],
      panels: [{ id: 'only', title: 'O', draw: d => d.dot([0, 0]) }],
    }).mount(bad));
    bad.remove();
  });

  test('destroy() puts the document back', async () => {
    const root = host();
    const app = mount(spec(), root);
    await frame();
    app.destroy();
    live.pop();
    assert.equal(root.hasAttribute('data-explorable'), false);
    assert.equal(instances.includes(app), false);
    root.remove();
  });
});

if (DOM) suite('explorable — cascades', ({ test }) => {
  const cascading = over => ({
    id: 'c', state: { target: 'a', t: 0.5, notice: 'stale', selected: null },
    on: {
      target: () => ({ t: 0.5, selected: null, notice: null }),
      t: s => (s.notice ? { notice: null } : null),
    },
    body: [panels.stage({ columns: [{ id: 'x', panels: ['only'] }] })],
    panels: [{ id: 'only', title: 'O', at: 'live', draw: d => d.dot([0, 0]) }],
    ...over,
  });

  test('a rule runs for a write that came from nowhere near a control', async () => {
    const root = host();
    const app = explorable(cascading()).mount(root);
    await frame();
    assert.equal(app.get('notice'), 'stale');
    app.set('t', 0.9);
    await frame();
    assert.equal(app.get('notice'), null, 'anything the reader does clears the notice');
    app.destroy(); root.remove();
  });

  test('a rule fills in consequences; it does not overrule the same breath', async () => {
    const root = host();
    const app = explorable(cascading()).mount(root);
    await frame();
    // Two control events in one frame: choosing a target AND setting a time.
    // "Choosing a target resets the time" must not undo the time just given,
    // or the result would depend on which event the browser delivered first.
    app.patch({ target: 'b', t: 1 });
    await frame();
    assert.equal(app.get('t'), 1, 'the explicit time survives');
    assert.equal(app.get('target'), 'b');
    // On its own, the rule does reset.
    app.set('t', 0.2);
    await frame();
    app.set('target', 'c');
    await frame();
    assert.equal(app.get('t'), 0.5);
    app.destroy(); root.remove();
  });

  test('a rule for a key that is not state is a typo, not a silent no-op', () => {
    assert.throws(() => explorable(cascading({ on: { nope: () => ({}) } })));
    assert.throws(() => explorable(cascading({ on: { t: 'reset' } })));
  });
});

if (DOM) suite('explorable — two instances of a kind', ({ test }) => {
  test('the same spec mounted twice agrees with itself, down to the probe', async () => {
    const a = host(), b = host();
    const one = explorable(spec({ id: 'one' })).mount(a);
    const two = explorable(spec({ id: 'two' })).mount(b);
    await frame();
    const drive = app => { app.set('example', 'q'); app.set('t', 0.37); };
    drive(one); drive(two);
    await frame();
    // The probe's identity and revision are its own; everything else is what
    // the widget IS, and two identical mounts must not differ in any of it.
    const body = app => JSON.parse(JSON.stringify(app.probe(), (k, v) => (k === 'id' || k === 'rev' ? undefined : v)));
    assert.equal(body(one), body(two));
    one.destroy(); two.destroy(); a.remove(); b.remove();
  });

  test('assertNoDrift names a constant two instances disagree about', async () => {
    const a = host(), b = host();
    const [one, two] = mountAll([
      [explorable(spec({ id: 'one' })), a],
      [explorable(spec({ id: 'two', options: { pickThreshold: 23 } })), b],
    ]);
    await frame();
    const lines = assertNoDrift();
    assert.equal(lines.length, 1, lines.join('\n'));
    assert.ok(lines[0].includes('options.pickThreshold'), lines[0]);
    assert.ok(lines[0].includes('variesBy'), 'it says what to do about it');
    one.destroy(); two.destroy(); a.remove(); b.remove();
  });

  test('a declared difference is silence; an undeclared one anywhere is not', async () => {
    const a = host(), b = host();
    const [one, two] = mountAll([
      [explorable(spec({ id: 'one' })), a],
      [explorable(spec({
        id: 'two', variesBy: ['pickThreshold'], options: { pickThreshold: 23 },
      })), b],
    ]);
    await frame();
    assert.equal(assertNoDrift(), []);
    one.destroy(); two.destroy(); a.remove(); b.remove();
  });

  test('instances of different kinds are not compared', async () => {
    const a = host(), b = host();
    const one = explorable(spec({ id: 'one' })).mount(a);
    const two = explorable(spec({ id: 'two', kind: 'other', options: { pickThreshold: 1 } })).mount(b);
    await frame();
    assert.equal(assertNoDrift(), []);
    one.destroy(); two.destroy(); a.remove(); b.remove();
  });
});
