// core/controls.js — the binding, and the four conditional-availability shapes
// the live pages actually have.
//
// Browser-only (tools/run-tests.mjs): every assertion is about what a real
// document ends up holding — .checked, aria-pressed, [hidden] resolving to
// display:none, an <output>'s value. Under node the module imports cleanly and
// registers no suite.
//
// The fixtures are cut down from the real markup, not invented: the map-variant
// row (hidden for every carrier but the circle), the solid scene picker whose
// base list changes entirely, and the extension stepper whose range is disabled
// at both ends. Those three are the cases a binder gets wrong.

import { suite, assert } from './harness.mjs';
import { LAYER, bindControls } from '../engine/core/controls.js';
import { createStore } from '../engine/core/state.js';

const DOM = typeof document !== 'undefined';

/** A container removed even when the test throws, so a failure leaks no nodes. */
const withStage = (markup, fn) => () => {
  const host = document.createElement('div');
  host.innerHTML = markup;
  document.body.append(host);
  try { return fn(host); } finally { host.remove(); }
};

const q = (host, s) => host.querySelector(s);
const ctl = (host, key) => host.querySelector(`[data-control="${key}"]`);
const fire = (node, type) => node.dispatchEvent(new Event(type, { bubbles: true }));
const setAndFire = (node, value, type) => { node.value = value; fire(node, type); };
const shown = node => getComputedStyle(node).display !== 'none';

/** console.warn captured for the dev-warning tests. */
function withWarnings(fn) {
  const seen = [];
  const real = console.warn;
  console.warn = (...a) => seen.push(a.join(' '));
  try { fn(seen); } finally { console.warn = real; }
}

// -------------------------------------------------------------- fixtures --
const PANEL = `
  <label class="form-label">Surface opacity <output data-value="opacity">28%</output>
    <input data-control="opacity" type="range" min="0" max="100" step="1" value="28">
  </label>
  <label class="form-label">Rotate x1-x4
    <output id="angle-out" for="angle-in">35&deg;</output>
    <input id="angle-in" data-control="angle14" type="range" min="0" max="360" step="1" value="35">
  </label>
  <label class="form-check"><input data-control="labels" type="checkbox" checked>
    <span class="form-check-label">Assignment labels</span></label>
  <label class="form-label">Function
    <select data-control="example">
      <option value="majority">At least two edges</option>
      <option value="parity">Odd number of edges</option>
    </select>
  </label>
  <label class="form-label">Caption <input data-control="caption" type="text" value="selector"></label>
  <button type="button" data-control="connect" aria-pressed="false">Connect points</button>
  <div class="segmented" data-control="part" aria-label="Highlight part of the prism">
    <button type="button" value="all" aria-pressed="true">Whole boundary</button>
    <button type="button" value="bottom" aria-pressed="false">Bottom</button>
    <button type="button" value="top" aria-pressed="false">Top</button>
  </div>
  <div class="viz-row" role="radiogroup" data-control="split">
    <label><input type="radio" name="split" value="output" checked><span>Function output</span></label>
    <label><input type="radio" name="split" value="query0"><span>Query x1</span></label>
  </div>
`;

const PANEL_STATE = {
  opacity: 0.28, angle14: 35 * Math.PI / 180, labels: true, example: 'majority',
  caption: 'selector', connect: false, part: 'all', split: 'output',
};

const PANEL_SPECS = {
  opacity: { type: 'range', scale: 1 / 100, suffix: '%' },
  angle14: { type: 'range', scale: Math.PI / 180, format: v => `${Math.round(v * 180 / Math.PI)}°` },
  labels: { type: 'checkbox' },
  example: { type: 'select' },
  caption: { type: 'text' },
  connect: { type: 'button' },
  part: { type: 'segmented' },
  split: { type: 'radio' },
};

const panel = (host, o) => {
  const store = createStore({ ...PANEL_STATE }, { name: 'panel' });
  return { store, controls: bindControls(host, store, PANEL_SPECS, o) };
};

if (DOM) suite('controls: round trip', ({ test }) => {
  test('declares its layer', () => assert.equal(LAYER, 0));

  test('every supported type carries a user change into the store', withStage(PANEL, host => {
    const { store, controls } = panel(host);

    setAndFire(ctl(host, 'opacity'), '50', 'input');
    assert.close(store.get('opacity'), 0.5, 1e-12, 'raw * scale');

    ctl(host, 'labels').click();
    assert.equal(store.get('labels'), false);

    setAndFire(ctl(host, 'example'), 'parity', 'change');
    assert.equal(store.get('example'), 'parity');

    setAndFire(ctl(host, 'caption'), 'dictator', 'input');
    assert.equal(store.get('caption'), 'dictator');

    ctl(host, 'connect').click();
    assert.equal(store.get('connect'), true, 'a toggle button flips the bound boolean');

    q(host, '[value="top"]').click();
    assert.equal(store.get('part'), 'top');

    q(host, 'input[value="query0"]').click();
    assert.equal(store.get('split'), 'query0');

    controls.dispose();
  }));

  test('and a programmatic change back out into the DOM', withStage(PANEL, host => {
    const { store, controls } = panel(host);

    store.set('opacity', 0.75);
    // 0.75 / (1/100) is 74.99999999999999; the step says how many digits are real.
    assert.equal(ctl(host, 'opacity').value, '75', 'no float noise reaches the element');
    assert.equal(q(host, '[data-value="opacity"]').value, '75%');

    store.set('labels', false);
    assert.equal(ctl(host, 'labels').checked, false);

    store.set('example', 'parity');
    assert.equal(ctl(host, 'example').value, 'parity');

    store.set('caption', 'or');
    assert.equal(ctl(host, 'caption').value, 'or');

    store.set('part', 'bottom');
    assert.equal(q(host, '[value="bottom"]').getAttribute('aria-pressed'), 'true');

    store.set('split', 'query0');
    assert.equal(q(host, 'input[value="query0"]').checked, true);
    assert.equal(q(host, 'input[value="output"]').checked, false);

    controls.dispose();
  }));

  test('set() writes store, element, readout and aria in one call', withStage(PANEL, host => {
    const { store, controls } = panel(host);
    controls.set('opacity', 0.4);
    assert.equal(store.get('opacity'), 0.4);
    assert.equal(ctl(host, 'opacity').value, '40');
    assert.equal(q(host, '[data-value="opacity"]').value, '40%');
    controls.set('connect', true);
    assert.equal(ctl(host, 'connect').getAttribute('aria-pressed'), 'true');
    controls.dispose();
  }));

  test('a programmatic write does not re-enter the change handler',
    withStage(PANEL, host => {
      // The loop this rules out: sync() writes .value, the write is read back as
      // a user action, which writes the store, which syncs again. Counting DOM
      // events counts handler entries — nothing else can reach the handler.
      let domEvents = 0, changes = 0;
      const { store, controls } = panel(host, { onChange: () => changes++ });
      ctl(host, 'opacity').addEventListener('input', () => domEvents++);
      ctl(host, 'example').addEventListener('change', () => domEvents++);

      controls.set('opacity', 0.6);
      store.set('example', 'parity');
      assert.equal(domEvents, 0, 'neither write fired a DOM event');
      assert.equal(changes, 1, 'set() reports once; an external store write is reflected, not reported');

      setAndFire(ctl(host, 'opacity'), '10', 'input');
      assert.equal(domEvents, 1);
      assert.equal(changes, 2, 'one user change is one onChange, not one per sync pass');
      controls.dispose();
    }));

  test('an <output for> and a [data-value] sink both show the live value',
    withStage(PANEL, host => {
      const { store, controls } = panel(host);
      assert.equal(q(host, '#angle-out').value, '35°', 'format() runs once, at the sink');
      setAndFire(ctl(host, 'angle14'), '90', 'input');
      assert.equal(q(host, '#angle-out').value, '90°', '<output for=id> is found by id');
      store.set('opacity', 0.05);
      assert.equal(q(host, '[data-value="opacity"]').value, '5%', 'suffix is sugar over format');
      controls.dispose();
    }));

  test('aria-pressed reflects the bound boolean and never drifts',
    withStage(PANEL, host => {
      const { store, controls } = panel(host);
      const btn = ctl(host, 'connect');
      assert.equal(btn.getAttribute('aria-pressed'), 'false');
      store.set('connect', true);
      assert.equal(btn.getAttribute('aria-pressed'), 'true');
      btn.click();
      assert.equal(store.get('connect'), false);
      assert.equal(btn.getAttribute('aria-pressed'), 'false');
      controls.dispose();
    }));

  test('a segmented group keeps exactly one member pressed', withStage(PANEL, host => {
    const { store, controls } = panel(host);
    const pressed = () => [...host.querySelectorAll('.segmented button')]
      .filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.value);
    assert.equal(pressed(), ['all']);
    q(host, '[value="top"]').click();
    assert.equal(pressed(), ['top']);
    store.set('part', 'bottom');
    assert.equal(pressed(), ['bottom'], 'sync() is the only writer of the attribute');
    controls.dispose();
  }));

  test('a select mode picker gets no aria-pressed', withStage(PANEL, host => {
    const { controls } = panel(host);
    assert.ok(!ctl(host, 'example').hasAttribute('aria-pressed'),
      'the native select already exposes selection');
    controls.dispose();
  }));

  test('a range driven while the pointer is down is not yanked back',
    withStage(PANEL, host => {
      const { store, controls } = panel(host);
      const range = ctl(host, 'opacity');
      range.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      setAndFire(range, '50', 'input');
      store.set('opacity', 0.9);
      assert.equal(range.value, '50', 'the thumb stays under the finger');
      assert.equal(q(host, '[data-value="opacity"]').value, '90%',
        'but the readout still shows what the state says');
      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      assert.equal(range.value, '90', 'and it catches up on release');
      controls.dispose();
    }));

  test('invalidates reaches the frame handle, once per change', withStage(PANEL, host => {
    const levels = [];
    const store = createStore({ ...PANEL_STATE });
    const controls = bindControls(host, store, {
      opacity: { type: 'range', scale: 1 / 100, suffix: '%', invalidates: ['style'] },
      example: { type: 'select', invalidates: ['all'] },
    }, { frame: { request: l => levels.push(l) } });

    setAndFire(ctl(host, 'opacity'), '50', 'input');
    setAndFire(ctl(host, 'example'), 'parity', 'change');
    controls.set('opacity', 0.1);
    assert.equal(levels, ['style', 'all', 'style']);

    store.set('opacity', 0.2);
    assert.equal(levels.length, 3, 'an external write invalidates whatever its author says it does');
    controls.dispose();
  }));

  test("defaults:'dom' reads the HTML instead of writing it", withStage(PANEL, host => {
    const store = createStore({ ...PANEL_STATE, opacity: 0.99 });
    const controls = bindControls(host, store, PANEL_SPECS, { defaults: 'dom' });
    assert.close(store.get('opacity'), 0.28, 1e-12, 'value="28" won');
    assert.equal(ctl(host, 'opacity').value, '28');
    controls.dispose();
  }));

  test("defaults:'store' warns about drift and the store wins", withStage(PANEL, host => {
    withWarnings(seen => {
      const store = createStore({ ...PANEL_STATE, opacity: 0.99 });
      const controls = bindControls(host, store, { opacity: PANEL_SPECS.opacity });
      assert.equal(ctl(host, 'opacity').value, '99');
      assert.equal(store.get('opacity'), 0.99);
      assert.ok(seen.some(w => /opacity/.test(w) && /store/.test(w)), seen.join(' | '));
      controls.dispose();
    });
  }));
});

// ------------------------------------------------- conditional availability --
// #map-variant: the wrapper row is hidden for every carrier case but `circle`.
const VARIANT = `
  <label class="check" id="variant-row" data-part="circle">Map
    <select data-control="variant">
      <option value="wrap">Wrap once</option>
      <option value="constant">Constant</option>
    </select>
  </label>
  <label class="check" id="nesting-row" data-part="nesting">
    <input data-control="nesting" type="checkbox"><span>Show nesting</span>
  </label>
`;

// #solid-scene drives #solid-base: prism and fill take triangle|edge, cone
// takes circle|disk|edge, and the label glyph changes with it.
const SOLID = `
  <label for="solid-scene">Explore</label>
  <select id="solid-scene" data-control="scene">
    <option value="prism">1 - The homotopy prism</option>
    <option value="cone">2 - Cylinder to cone</option>
    <option value="fill">3 - Extend from the boundary</option>
  </select>
  <label data-control="base-label" id="solid-base-label">A</label>
  <select id="solid-base" data-control="base"></select>
`;

const BASES = {
  prism: [{ value: 'triangle', label: 'Filled triangle' }, { value: 'edge', label: 'Edge' }],
  fill: [{ value: 'triangle', label: 'Filled triangle' }, { value: 'edge', label: 'Edge' }],
  cone: [{ value: 'circle', label: 'Circle (surface cone)' },
         { value: 'disk', label: 'Filled disk (solid cone)' },
         { value: 'edge', label: 'Edge' }],
};

// The extension tab is a five-stage stepper.
const STEPPER = `
  <div class="extension-actions">
    <button type="button" data-turn="prev">Back</button>
    <button type="button" data-turn="next">Next</button>
    <label class="extension-progress">Reveal
      <input id="ext-progress" data-control="progress" type="range" min="0" max="1" step=".001" value="1">
      <output id="ext-value" for="ext-progress">100%</output>
    </label>
    <label class="check"><input data-control="broken" type="checkbox"><span>Break agreement</span></label>
  </div>
`;

if (DOM) suite('controls: conditional availability', ({ test }) => {
  test('a data-part row is hidden unless its predicate holds', withStage(VARIANT, host => {
    // The measured case: #map-variant's PARENT carries display:none, because
    // hiding the <select> alone would leave the word "Map" floating.
    const store = createStore({ carrier: 'interval', variant: 'wrap', nesting: false });
    const controls = bindControls(host, store, {
      variant: { type: 'select' }, nesting: { type: 'checkbox' },
    });
    const row = q(host, '#variant-row');
    assert.ok(shown(row), 'untouched until visibility() declares the group');

    controls.visibility({
      circle: s => s.carrier === 'circle',
      nesting: s => s.carrier !== 'interval',
    });
    assert.ok(!shown(row), 'hidden resolves to display:none, not just an attribute');
    assert.equal(row.hidden, true);
    assert.ok(!shown(q(host, '#nesting-row')));

    store.set('carrier', 'circle');
    assert.ok(shown(row), 'and it comes back when the carrier is a circle');
    assert.ok(shown(q(host, '#nesting-row')));

    store.set('carrier', 'torus');
    assert.ok(!shown(row));
    assert.ok(shown(q(host, '#nesting-row')), 'the other group is independent');
    controls.dispose();
  }));

  test('data-part="a b" needs both predicates', withStage(
    '<p data-part="three graph">panel</p><span data-control="x">x</span>', host => {
      const store = createStore({ space: 'three', showGraph: false, x: '' });
      const controls = bindControls(host, store, { x: { type: 'text' } });
      controls.visibility({ three: s => s.space === 'three', graph: s => s.showGraph });
      assert.ok(!shown(q(host, 'p')), 'graph fails');
      store.set('showGraph', true);
      assert.ok(shown(q(host, 'p')));
      store.set('space', 'four');
      assert.ok(!shown(q(host, 'p')), 'three fails');
      controls.dispose();
    }));

  test('an undeclared data-part throws in dev and fails open in production',
    withStage('<p data-part="typo">panel</p><span data-control="x">x</span>', host => {
      const store = createStore({ x: '' });
      const controls = bindControls(host, store, { x: { type: 'text' } });
      assert.throws(() => controls.visibility({ other: () => true }),
        'a missing predicate is a typo, and silence costs an afternoon');
      controls.dispose();

      globalThis.UNFOLD_DEV = false;
      try {
        const c2 = bindControls(host, store, { x: { type: 'text' } });
        c2.visibility({ other: () => true });
        assert.ok(shown(q(host, 'p')), 'fail-open: a missing predicate never hides content');
        c2.dispose();
      } finally {
        delete globalThis.UNFOLD_DEV;
      }
    }));

  test('a dependent option list is rebuilt, keeping a selection that survives',
    withStage(SOLID, host => {
      const store = createStore({ scene: 'prism', base: 'triangle' });
      const controls = bindControls(host, store, {
        scene: { type: 'select' },
        base: {
          type: 'select',
          options: s => BASES[s.scene],
          label: s => (s.scene === 'cone' ? 'Z' : 'A'),
        },
      }, { warnOnDrift: false });   // the list is options()'s, so the HTML has none

      const values = () => [...q(host, '#solid-base').options].map(o => o.value);
      assert.equal(values(), ['triangle', 'edge']);
      assert.equal(q(host, '#solid-base').value, 'triangle');
      assert.equal(q(host, '#solid-base-label').textContent, 'A');

      const edgeNode = [...q(host, '#solid-base').options].find(o => o.value === 'edge');

      setAndFire(q(host, '#solid-scene'), 'fill', 'change');
      assert.equal(values(), ['triangle', 'edge']);
      assert.equal(store.get('base'), 'triangle', 'still valid, so it is kept');

      setAndFire(q(host, '#solid-scene'), 'cone', 'change');
      assert.equal(values(), ['circle', 'disk', 'edge'], 'a different list entirely');
      assert.equal(store.get('base'), 'circle', 'triangle is gone: fall back to the first option');
      assert.equal(q(host, '#solid-base').value, 'circle', 'and the element agrees');
      assert.equal(q(host, '#solid-base-label').textContent, 'Z');
      assert.ok([...q(host, '#solid-base').options].includes(edgeNode),
        'the keyed reconciler reused the option whose value survived');

      store.set('base', 'edge');
      setAndFire(q(host, '#solid-scene'), 'prism', 'change');
      assert.equal(values(), ['triangle', 'edge']);
      assert.equal(store.get('base'), 'edge', 'edge is in both lists, so it survives');

      controls.dispose();
    }));

  test('the fallback is reported once, through onChange', withStage(SOLID, host => {
    const seen = [];
    const store = createStore({ scene: 'prism', base: 'triangle' });
    const controls = bindControls(host, store, {
      scene: { type: 'select' },
      base: { type: 'select', options: s => BASES[s.scene] },
    }, { warnOnDrift: false, onChange: (k, v) => seen.push(`${k}=${v}`) });

    setAndFire(q(host, '#solid-scene'), 'cone', 'change');
    assert.equal(seen, ['base=circle', 'scene=cone'],
      'the repair lands inside the change that caused it, and neither repeats');
    controls.dispose();
  }));

  test('disabled and hidden are different things, and both are supported',
    withStage(STEPPER, host => {
      // #extension-progress is disabled at the first and last stage;
      // #extension-break only becomes live from stage 3. Neither is ever hidden:
      // the reader must see that the control is there and not yet usable.
      const store = createStore({ stage: 0, progress: 1, broken: false });
      const controls = bindControls(host, store, {
        progress: {
          type: 'range',
          format: v => `${Math.round(v * 100)}%`,
          disabled: s => s.stage === 0 || s.stage === 4,
        },
        broken: { type: 'checkbox', disabled: s => s.stage < 3 },
      });
      const progress = q(host, '#ext-progress');
      const broken = ctl(host, 'broken');

      assert.equal(progress.disabled, true, 'stage 0');
      assert.equal(broken.disabled, true);
      assert.ok(shown(progress) && shown(broken), 'disabled, not hidden');

      store.set('stage', 2);
      assert.equal(progress.disabled, false);
      assert.equal(broken.disabled, true, 'break is not live before stage 3');

      store.set('stage', 3);
      assert.equal(broken.disabled, false);

      store.set('stage', 4);
      assert.equal(progress.disabled, true, 'and off again at the last stage');
      assert.equal(broken.disabled, false);
      assert.ok(shown(progress), 'still visible at both ends');

      store.set('progress', 0.42);
      assert.equal(q(host, '#ext-value').value, '42%');
      controls.dispose();
    }));

  test('a hidden predicate hides the element it is declared on',
    withStage(STEPPER, host => {
      const store = createStore({ stage: 0, progress: 1, broken: false });
      const controls = bindControls(host, store, {
        progress: { type: 'range' },
        broken: { type: 'checkbox', hidden: s => s.stage < 3 },
      });
      assert.ok(!shown(ctl(host, 'broken')));
      assert.equal(ctl(host, 'broken').disabled, false, 'hidden is not disabled');
      store.set('stage', 3);
      assert.ok(shown(ctl(host, 'broken')));
      controls.dispose();
    }));

  test('sync() leaves a disabled the page set by hand alone', withStage(STEPPER, host => {
    const store = createStore({ stage: 0, progress: 1, broken: false });
    const controls = bindControls(host, store, {
      progress: { type: 'range' }, broken: { type: 'checkbox' },
    });
    ctl(host, 'broken').disabled = true;
    controls.sync();
    assert.equal(ctl(host, 'broken').disabled, true, 'no predicate means no opinion');
    controls.dispose();
  }));

  test('commands fire with the attribute value', withStage(STEPPER, host => {
    const store = createStore({ stage: 0, progress: 1, broken: false });
    const controls = bindControls(host, store, {
      progress: { type: 'range' }, broken: { type: 'checkbox' },
    });
    const seen = [];
    controls.commands({ turn: (dir, el) => seen.push(`${dir}:${el.tagName}`) });
    q(host, '[data-turn="next"]').click();
    q(host, '[data-turn="prev"]').click();
    assert.equal(seen, ['next:BUTTON', 'prev:BUTTON']);
    controls.dispose();
  }));
});

// ------------------------------------------------------------------ indexed --
const BITS = `
  <label><input data-bit="0" type="checkbox" checked><span>Edge 12</span></label>
  <label><input data-bit="1" type="checkbox"><span>Edge 13</span></label>
  <label><input data-bit="2" type="checkbox"><span>Edge 23</span></label>
  <button type="button" data-turn="left">Left</button>
  <div class="text-small" data-control="detail" aria-live="polite"></div>
`;

if (DOM) suite('controls: indexed', ({ test }) => {
  test('[data-bit] round-trips through one array key', withStage(BITS, host => {
    const store = createStore({ bits: [1, 0, 0], detail: '' });
    const controls = bindControls(host, store, { detail: { type: 'text' } });
    controls.indexed('bit', 'bits', { type: 'checkbox', parse: (raw, el) => +el.checked });

    const boxes = [...host.querySelectorAll('[data-bit]')];
    assert.equal(boxes.map(b => b.checked), [true, false, false]);

    boxes[2].click();
    assert.equal(store.get('bits'), [1, 0, 1], 'a fresh array, or the store sees no change');

    store.set('bits', [0, 1, 1]);
    assert.equal(boxes.map(b => b.checked), [false, true, true]);
    controls.dispose();
  }));

  test('a [data-control] that is not an input is a chrome sink', withStage(BITS, host => {
    // [data-control="detail"] in the ambiguity explorer is a live-region div.
    const store = createStore({ bits: [1, 0, 0], detail: '' });
    const controls = bindControls(host, store, { detail: { type: 'text' } });
    store.set('detail', '2 of 6 faces selected');
    assert.equal(ctl(host, 'detail').textContent, '2 of 6 faces selected');
    controls.dispose();
  }));
});

// ----------------------------------------------------------------- teardown --
if (DOM) suite('controls: teardown', ({ test }) => {
  test('after dispose, DOM events change nothing and state changes touch no DOM',
    withStage(PANEL, host => {
      const { store, controls } = panel(host);
      controls.dispose();

      setAndFire(ctl(host, 'opacity'), '50', 'input');
      assert.close(store.get('opacity'), 0.28, 1e-12, 'the listener is gone');
      ctl(host, 'labels').click();
      assert.equal(store.get('labels'), true);

      store.set('opacity', 0.9);
      assert.equal(ctl(host, 'opacity').value, '50',
        'the store subscription is gone too: the element keeps what the user left');
      assert.equal(q(host, '[data-value="opacity"]').value, '28%', 'and the readout is stale');
      store.set('connect', true);
      assert.equal(ctl(host, 'connect').getAttribute('aria-pressed'), 'false');
    }));

  test('dispose also drops the command and indexed listeners', withStage(BITS, host => {
    const store = createStore({ bits: [1, 0, 0], detail: '' });
    const controls = bindControls(host, store, { detail: { type: 'text' } });
    let commands = 0;
    controls.indexed('bit', 'bits', { type: 'checkbox' });
    controls.commands({ turn: () => commands++ });
    controls.dispose();

    host.querySelectorAll('[data-bit]')[1].click();
    q(host, '[data-turn="left"]').click();
    assert.equal(store.get('bits'), [1, 0, 0]);
    assert.equal(commands, 0);
  }));

  test('binding the same root again after dispose does not double-fire',
    withStage(PANEL, host => {
      const store = createStore({ ...PANEL_STATE });
      let changes = 0;
      const first = bindControls(host, store, PANEL_SPECS, { onChange: () => changes++ });
      first.dispose();
      const second = bindControls(host, store, PANEL_SPECS, { onChange: () => changes++ });

      setAndFire(ctl(host, 'opacity'), '50', 'input');
      assert.equal(changes, 1, 'the first binder left nothing attached');
      second.dispose();
    }));

  test('redefining a key replaces its listener instead of stacking one',
    withStage(PANEL, host => {
      const store = createStore({ ...PANEL_STATE });
      let changes = 0;
      const controls = bindControls(host, store, PANEL_SPECS, { onChange: () => changes++ });
      controls.define('opacity', { type: 'range', scale: 1 / 100, suffix: '%' });
      controls.define('opacity', { type: 'range', scale: 1 / 100, suffix: '%' });

      setAndFire(ctl(host, 'opacity'), '50', 'input');
      assert.equal(changes, 1);
      controls.dispose();
    }));

  test('undefine() stops one key and leaves the rest bound', withStage(PANEL, host => {
    const { store, controls } = panel(host);
    controls.undefine('opacity');
    setAndFire(ctl(host, 'opacity'), '50', 'input');
    assert.close(store.get('opacity'), 0.28, 1e-12);
    ctl(host, 'labels').click();
    assert.equal(store.get('labels'), false, 'the others still work');
    controls.dispose();
  }));

  test('element() finds the bound node, and a missing control is a dev error',
    withStage(PANEL, host => {
      const { controls } = panel(host);
      assert.equal(controls.element('opacity'), ctl(host, 'opacity'));
      assert.equal(controls.element('nope'), null);
      assert.throws(() => controls.define('missing', { type: 'range' }),
        'a typo in a data-control name is silent otherwise');
      controls.dispose();
    }));

  test('a second live binder on one root is called out', withStage(PANEL, host => {
    withWarnings(seen => {
      const { controls } = panel(host);
      const second = bindControls(host, createStore({ ...PANEL_STATE }), {});
      assert.ok(seen.some(w => /already has a live binder/.test(w)), seen.join(' | '));
      second.dispose();
      controls.dispose();
    });
  }));
});
