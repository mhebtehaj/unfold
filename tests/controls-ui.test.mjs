// Layer 4 — the controls, as components.
//
// A builder returns a DESCRIPTOR, so what is testable without a browser is the
// shape of the spec it hands to the binder, and what is testable with one is
// the markup. The thing worth holding hardest is the pair of `data-k` keys:
// they are what let the binder ADOPT the options a builder wrote instead of
// appending a second copy of every one — a bug that is invisible in a
// screenshot and doubles a select's list.

import { suite, assert } from './harness.mjs';
import * as control from '../engine/page/controls-ui.js';

const DOM = typeof document !== 'undefined';
const ctx = () => ({ doc: document, id: name => `w-${name}`, state: { mode: 'b', t: 0.25, on: true, side: 'y' } });

suite('controls-ui — descriptors', ({ test }) => {
  test('it is Layer 4', () => assert.equal(control.LAYER, 4));

  test('each builder names its key and the spec the binder needs', () => {
    assert.equal(control.select({ key: 'mode', label: 'Mode', options: [['a', 'A']] }).spec, { type: 'select' });
    assert.equal(control.toggle({ key: 'on', label: 'On' }).spec, { type: 'button' });
    assert.equal(control.check({ key: 'on', label: 'On' }).spec, { type: 'checkbox' });
    assert.equal(control.segmented({ key: 'side', options: [['x', 'X']] }).spec, { type: 'segmented' });
    assert.equal(control.slider({ key: 't', math: 't' }).spec.type, 'range');
  });

  test('a page-level spec is merged in — `{ parse: Number }` and nothing more exotic', () => {
    const d = control.select({ key: 'n', label: 'N', options: [[1, 'one']], spec: { parse: Number } });
    assert.equal(d.spec.type, 'select');
    assert.equal(d.spec.parse, Number);
  });

  test('an options function reaches the spec, an array does not', () => {
    const fn = s => [{ value: s.mode, label: s.mode }];
    assert.equal(control.select({ key: 'mode', label: 'M', options: fn }).spec.options, fn);
    assert.equal('options' in control.select({ key: 'mode', label: 'M', options: [['a', 'A']] }).spec, false);
  });

  test('options must be an array or a function of the state', () => {
    assert.throws(() => control.select({ key: 'k', label: 'L', options: 'a,b' }));
  });

  test('a transport is a play button and a slider on the same key', () => {
    const [play, slide] = control.transport({ key: 't', math: 't', duration: 4000 });
    assert.equal(play.action, 'play');
    assert.equal(play.key, 't');
    assert.equal(play.duration, 4000);
    assert.equal(slide.key, 't');
  });

  test('descriptorsOf flattens groups in document order', () => {
    const a = control.toggle({ key: 'on', label: 'On' });
    const b = control.select({ key: 'mode', label: 'M', options: [['a', 'A']] });
    const c = control.button({ label: 'Clear', action: 'clear' });
    const list = control.descriptorsOf([control.group({ class: 'row' }, a, b), c]);
    assert.equal(list, [a, b, c]);
  });

  test('group takes options first, or no options at all', () => {
    const a = control.toggle({ key: 'on', label: 'On' });
    assert.equal(control.group(a).children, [a]);
    assert.equal(control.group({ part: 'classes' }, a).part, 'classes');
  });
});

if (DOM) suite('controls-ui — markup', ({ test }) => {
  const build = d => d.build(ctx());

  test('a select is built with the current value already chosen', () => {
    const el = build(control.select({ key: 'mode', label: 'Mode', options: [['a', 'A'], ['b', 'B']] }));
    const sel = el.querySelector('select');
    assert.equal(sel.value, 'b', 'the store is the truth and the markup says so');
    assert.equal(el.querySelector('label').getAttribute('for'), sel.id);
  });

  test('every option carries data-k, so a rebuild adopts instead of duplicating', () => {
    const el = build(control.select({ key: 'mode', label: 'Mode', options: [['a', 'A'], ['b', 'B']] }));
    assert.equal([...el.querySelectorAll('option')].map(o => o.getAttribute('data-k')), ['a', 'b']);
  });

  test('an options function is evaluated at build time too', () => {
    const el = build(control.select({ key: 'mode', label: 'Mode', options: s => [{ value: s.mode, label: 'now' }] }));
    assert.equal(el.querySelectorAll('option').length, 1);
    assert.equal(el.querySelector('option').value, 'b');
  });

  test('wrap:"label" puts the select inside its label — no for/id pair to keep in step', () => {
    const el = build(control.select({ key: 'mode', label: 'Start winding', wrap: 'label', options: [['b', 'B']] }));
    assert.equal(el.tagName, 'LABEL');
    assert.equal(el.querySelector('select').parentElement, el);
    assert.equal(el.textContent.startsWith('Start winding'), true);
  });

  test('a slider is a glyph, a range and an <output for> showing the value', () => {
    const el = build(control.slider({ key: 't', math: 't', ariaLabel: 'Time' }));
    const input = el.querySelector('input');
    assert.equal(input.type, 'range');
    assert.equal(input.value, '0.25');
    assert.equal(input.getAttribute('aria-label'), 'Time');
    const out = el.querySelector('output');
    assert.equal(out.textContent, '0.25');
    assert.equal(out.getAttribute('for'), input.id);
    assert.equal(out.getAttribute('data-value'), 't');
  });

  test('the play button has no aria-label: its text is its name, and the glyph is hidden', () => {
    const el = build(control.play());
    assert.equal(el.hasAttribute('aria-label'), false);
    assert.equal(el.getAttribute('data-action'), 'play');
    assert.equal(el.firstElementChild.getAttribute('aria-hidden'), 'true');
    assert.equal(el.textContent, '▶ Play');
  });

  test('a toggle IS its aria-pressed', () => {
    const el = build(control.toggle({ key: 'on', label: 'Connect points' }));
    assert.equal(el.getAttribute('aria-pressed'), 'true');
    assert.equal(el.getAttribute('data-control'), 'on');
  });

  test('a segmented row is a labelled group whose members are keyed and pressed', () => {
    const el = build(control.segmented({
      key: 'side', ariaLabel: 'Choose a round trip',
      options: s => [{ value: 'x', label: `On X ${s.side === 'x' ? '✓' : ''}` }, { value: 'y', label: 'On Y' }],
    }));
    assert.equal(el.getAttribute('role'), 'group');
    assert.equal(el.getAttribute('aria-label'), 'Choose a round trip');
    const items = [...el.querySelectorAll('button')];
    assert.equal(items.map(b => b.getAttribute('data-k')), ['x', 'y']);
    assert.equal(items.map(b => b.getAttribute('aria-pressed')), ['false', 'true']);
  });

  test('a checkbox lives inside its label', () => {
    const el = build(control.check({ key: 'on', label: 'Connect' }));
    assert.equal(el.tagName, 'LABEL');
    assert.equal(el.querySelector('input').checked, true);
  });

  test('an action button carries data-action and may start hidden', () => {
    const el = build(control.button({ label: 'Clear circle', action: 'clear', hidden: true }));
    assert.equal(el.getAttribute('data-action'), 'clear');
    assert.equal(el.hasAttribute('hidden'), true);
  });

  test('a group builds its children and can reach them again to bind', () => {
    const slotLike = {
      build: ({ doc }) => doc.createElement('span'),
      bind: node => [{ el: node, needs: null, run: () => false, writes: 0 }],
    };
    const g = control.group({ class: 'uf-status-row' }, control.button({ label: 'Clear', action: 'clear' }), slotLike);
    const box = g.build(ctx());
    assert.equal(box.className, 'uf-controls uf-status-row');
    assert.equal(box.children.length, 2);
    const bound = g.bind(box, ctx());
    assert.equal(bound.length, 1);
    assert.equal(bound[0].el, box.children[1], 'the binding reaches the node the group built');
  });

  test('a part is a visibility group on the wrapper, not on the input', () => {
    const el = build(control.select({ key: 'mode', label: 'M', options: [['a', 'A']], part: 'target' }));
    assert.equal(el.getAttribute('data-part'), 'target');
    assert.equal(el.querySelector('select').hasAttribute('data-part'), false);
  });
});
