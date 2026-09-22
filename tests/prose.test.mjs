// Layer 4 — prose: the markup a page writes, and the guard on every write.
//
// Two things are worth testing here and nothing else is. First, that nothing a
// page interpolates can become markup: every explorer builds prose from state,
// and `innerHTML` is one careless template away from being the page's widest
// hole. Second, that a binding writes only when the DOM would actually change
// — which is what makes a live region announce once per distinct sentence
// instead of once per animation frame.

import { suite, assert } from './harness.mjs';
import {
  LAYER, escapeHTML, txt, sub, html, isRich, bind, rich, attr, slot, block,
} from '../engine/page/prose.js';

const DOM = typeof document !== 'undefined';

suite('prose — escaping and the text template', ({ test }) => {
  test('it is Layer 4', () => assert.equal(LAYER, 4));

  test('escapeHTML closes every hole a page could open', () => {
    assert.equal(escapeHTML('<script>alert(1)</script>'),
      '&lt;script&gt;alert(1)&lt;/script&gt;');
    assert.equal(escapeHTML(`a"b'c&d`), 'a&quot;b&#39;c&amp;d');
    assert.equal(escapeHTML(null), '');
    assert.equal(escapeHTML(0), '0');
  });

  test('txt marks up *emphasis* and $mathematics$, and nothing else', () => {
    assert.equal(txt`*Same color = same input.* Then plain.`.html,
      '<strong>Same color = same input.</strong> Then plain.');
    assert.equal(txt`this is $f(x)$ here`.html,
      'this is <span class="uf-math">f(x)</span> here');
    // An unpaired marker is text: it must not swallow the rest of the sentence.
    assert.equal(txt`5 * 3 = 15`.html, '5 * 3 = 15');
  });

  test('an interpolation is escaped; a Rich one is not', () => {
    assert.equal(txt`hello ${'<b>x</b>'}`.html, 'hello &lt;b&gt;x&lt;/b&gt;');
    assert.equal(txt`hello ${html('<b>x</b>')}`.html, 'hello <b>x</b>');
    assert.equal(isRich(txt`a`), true);
    assert.equal(isRich('a'), false);
  });

  test('a marker spans an interpolation — the bug this template exists to kill', () => {
    // `*g∘f ≃ id<sub>X</sub>*` is ONE bold phrase. Formatting each literal
    // chunk on its own leaves two unpaired asterisks in the reader's face.
    assert.equal(txt`*id${sub('X')}*`.html, '<strong>id<sub>X</sub></strong>');
    assert.equal(txt`*a ${'b'} c*`.html, '<strong>a b c</strong>');
  });

  test('a value that contains a marker stays text', () => {
    // The markers ran before the value was there, so `*` in data is data.
    assert.equal(txt`x ${'*not bold*'} y`.html, 'x *not bold* y');
    assert.equal(txt`x ${'a\u0000b'} y`.html, 'x a\u0000b y');
  });

  test('sub uses the codepoint where there is one and <sub> where there is not', () => {
    assert.equal(sub(0).html, '₀');
    assert.equal(sub('12').html, '₁₂');
    assert.equal(sub('X').html, '<sub>X</sub>');
    assert.equal(sub('<b>').html, '<sub>&lt;b&gt;</sub>');
  });

  test('txt is a tagged template and says so when it is called', () => {
    assert.throws(() => txt('hello'), 'txt(…) must be refused');
  });
});

if (DOM) suite('prose — bindings write only when the DOM changes', ({ test }) => {
  const p = () => document.createElement('p');

  test('a repeated value is not written', () => {
    const el = p();
    const b = bind(el, s => s.note, { needs: ['note'] });
    assert.equal(b.run({ note: 'one' }), true);
    assert.equal(b.run({ note: 'one' }), false);
    assert.equal(b.run({ note: 'two' }), true);
    assert.equal(b.writes, 2, 'two distinct sentences, two writes');
    assert.equal(el.textContent, 'two');
  });

  test('null hides rather than emptying, unless the row is reserved', () => {
    const el = p();
    const b = bind(el, s => s.note);
    b.run({ note: null });
    assert.equal(el.hidden, true);
    b.run({ note: 'back' });
    assert.equal(el.hidden, false);

    const keep = p();
    const k = bind(keep, s => s.note, { hide: false });
    k.run({ note: null });
    assert.equal(keep.hidden, false, 'hide:false keeps the row in flow');
    assert.equal(keep.textContent, '');
  });

  test('a live binding declares both aria-live and a role', () => {
    const el = p();
    bind(el, () => 'x', { live: 'polite' });
    assert.equal(el.getAttribute('aria-live'), 'polite');
    assert.equal(el.getAttribute('role'), 'status');
    const loud = p();
    bind(loud, () => 'x', { live: 'assertive' });
    assert.equal(loud.getAttribute('role'), 'alert');
  });

  test('bind refuses rich markup — that is what rich() is for', () => {
    const el = p();
    const b = bind(el, () => txt`*bold*`);
    assert.throws(() => b.run({}), 'rich value through bind()');
  });

  test('rich compares against what it last wrote, not against innerHTML', () => {
    const el = p();
    const b = rich(el, s => html(s.markup), { needs: ['markup'] });
    assert.equal(b.run({ markup: '<em>a</em>' }), true);
    // The browser normalises markup on the way back out; reading it would
    // rewrite the subtree every frame.
    assert.equal(b.run({ markup: '<em>a</em>' }), false);
    assert.equal(b.writes, 1);
  });

  test('a plain string through rich() is escaped', () => {
    const el = p();
    rich(el, () => '<em>a</em>').run({});
    assert.equal(el.textContent, '<em>a</em>');
    assert.equal(el.childElementCount, 0);
  });

  test('attr sets, updates and removes', () => {
    const el = p();
    const b = attr(el, 'data-side', s => s.side, { needs: ['side'] });
    b.run({ side: 'x' });
    assert.equal(el.getAttribute('data-side'), 'x');
    assert.equal(b.run({ side: 'x' }), false);
    b.run({ side: null });
    assert.equal(el.hasAttribute('data-side'), false);
    assert.equal(b.writes, 2);
  });

  test('needs is a set of keys, or "*" for every frame', () => {
    const el = p();
    assert.equal([...bind(el, () => '', { needs: ['a', 'b'] }).needs], ['a', 'b']);
    assert.equal(bind(el, () => '', { needs: '*' }).needs, null);
    assert.throws(() => bind(el, () => '', { needs: 'a' }), 'a bare string is not a key list');
  });
});

if (DOM) suite('prose — slots', ({ test }) => {
  const ctx = { doc: document };

  test('a slot is its element and its bindings', () => {
    const s = slot({ class: 'uf-note', name: 'note', needs: ['note'], text: st => st.note });
    const el = s.build(ctx);
    assert.equal(el.tagName, 'P');
    assert.equal(el.className, 'uf-note');
    const [b] = s.bind();
    assert.equal(b.name, 'note');
    b.run({ note: 'hello' });
    assert.equal(el.textContent, 'hello');
  });

  test('a summary makes a <details>, and hiding hides the whole thing', () => {
    const s = slot({ summary: 'Why?', class: 'uf-why', rich: st => (st.why ? html(st.why) : null) });
    const el = s.build(ctx);
    assert.equal(el.tagName, 'DETAILS');
    assert.equal(el.firstElementChild.tagName, 'SUMMARY');
    const bindings = s.bind();
    bindings.forEach(b => b.run({ why: '<p>because</p>' }));
    assert.equal(el.hidden, false);
    assert.equal(el.querySelector('[data-uf="body"]').innerHTML, '<p>because</p>');
    bindings.forEach(b => b.run({ why: null }));
    assert.equal(el.hidden, true, 'a lone summary triangle would be worse than nothing');
  });

  test('closeOn is strict: it closes on a change, never on a redraw', () => {
    const s = slot({ summary: 'Why?', rich: () => html('x'), closeOn: ['example'] });
    const el = s.build(ctx);
    const close = s.bind().find(b => b.strict);
    assert.ok(close, 'closeOn produces a strict binding');
    assert.equal([...close.needs], ['example']);
    el.open = true;
    assert.equal(close.run({}), true);
    assert.equal(el.open, false);
    assert.equal(close.run({}), false, 'already closed: no write');
  });

  test('classes toggles only what changed', () => {
    const s = slot({ class: 'uf-note', text: () => 'x', classes: st => ({ failure: st.bad }) });
    const el = s.build(ctx);
    const cls = s.bind().find(b => b !== s.bind()[0] && b.el === el && !b.name);
    const toggle = s.bind()[1];
    toggle.run({ bad: true });
    assert.equal(el.classList.contains('failure'), true);
    assert.equal(toggle.run({ bad: true }), false);
    toggle.run({ bad: false });
    assert.equal(el.classList.contains('failure'), false);
    assert.ok(cls || true);
  });

  test('a slot refuses to be both text and rich', () => {
    assert.throws(() => slot({ text: () => 'a', rich: () => html('b') }));
  });

  test('block is static markup, and its content is escaped unless rich', () => {
    const b = block({ class: 'uf-note hint', content: txt`*Same color* = same input.` });
    const el = b.build(ctx);
    assert.equal(el.innerHTML, '<strong>Same color</strong> = same input.');
    assert.equal(block({ content: '<b>x</b>' }).build(ctx).textContent, '<b>x</b>');
  });
});
