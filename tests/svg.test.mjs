// core/svg.js — the DOM idiom's load-bearing claims.
//
// Three things here are not "does the function run": that a reorder REUSES the
// element objects rather than rebuilding them (the whole reason for keys), that
// raise() is a genuine no-op when the node is already on top (re-inserting a
// node blurs it and restarts its transitions), and that a halo's stroke is a
// token rather than a literal. Everything else is the attribute coercion table,
// which is where an `undefined` becomes the string "undefined" in the DOM.

import { suite, assert } from './harness.mjs';
import {
  SVG_NS, el, attr, group, setPrecision, getPrecision, text,
  reconcile, raise, raiseAll, lower, raiseTo, raw, esc, on, onAll, createTextMeasurer,
} from '../engine/core/svg.js';

register();

function register() {
  // Registered only in a browser: these assert against a real DOM, and the file
  // still has to import cleanly under node (tools/check-layers.mjs, editors).
  if (typeof document === 'undefined') return;

  /** data-k of each element child, in document order. */
  const order = p => [...p.children].map(n => n.getAttribute('data-k')).join(' ');
  const items = ids => ids.map(id => ({ id }));

  /** A spec that counts creations, so "reused" can be asserted, not assumed. */
  const counting = (extra = {}) => {
    const s = {
      n: 0,
      key: it => it.id,
      create: it => { s.n++; return el('circle', { 'data-id': it.id }); },
      ...extra,
    };
    return s;
  };

  suite('svg — elements and attributes', ({ test }) => {
    test('el() creates in the SVG namespace and coerces attributes', () => {
      const n = el('circle', {
        cx: 1.23456, cy: 2, r: 4, class: 'uf-mark', fill: 'var(--violet)',
      });
      assert.equal(n.namespaceURI, SVG_NS);
      assert.equal(n.tagName, 'circle');
      assert.equal(n.getAttribute('cx'), '1.235', 'rounded to PRECISION');
      assert.equal(n.getAttribute('r'), '4', 'and trailing zeros dropped');
      assert.equal(n.getAttribute('class'), 'uf-mark');
      assert.equal(n.getAttribute('fill'), 'var(--violet)');
    });

    test('el() writes text through textContent, not markup', () => {
      const n = el('text', null, 'a < b & c');
      assert.equal(n.textContent, 'a < b & c');
      assert.equal(n.children.length, 0, 'the string is data, not a subtree');
    });

    test('undefined, null and false are omitted, never stringified', () => {
      // The bug this exists to catch: fill="undefined" renders as black, and
      // the attribute is there in the golden file to prove it was deliberate.
      const n = el('rect', { x: 0, fill: undefined, stroke: null, hidden: false, sel: true });
      assert.ok(!n.hasAttribute('fill'), 'undefined');
      assert.ok(!n.hasAttribute('stroke'), 'null');
      assert.ok(!n.hasAttribute('hidden'), 'false');
      assert.equal(n.getAttribute('sel'), '', 'true is the empty string');
      assert.ok(!/undefined|null/.test(n.outerHTML), n.outerHTML);
    });

    test('attr() clears a value that used to be there', () => {
      // reconcile()'s update path: a reused node must not keep the paint of
      // whatever item previously held its key.
      const n = el('polygon', { 'fill-opacity': 0.4 });
      assert.equal(n.getAttribute('fill-opacity'), '0.4');
      assert.ok(attr(n, { 'fill-opacity': undefined }) === n, 'returns the node');
      assert.ok(!n.hasAttribute('fill-opacity'));
    });

    test('a rounded negative zero is written as "0"', () => {
      const n = el('circle', { cx: -0.0004 });
      assert.equal(n.getAttribute('cx'), '0', 'not "-0"');
    });

    test('non-finite numbers are written, not swallowed', () => {
      // On a real coordinate this makes the element refuse to render, which
      // names the bug at the first frame; dropping it would leave the node at
      // its previous position instead. Asserted on an attribute the SVG parser
      // ignores, so the deliberate NaN does not log a console error on every
      // run and teach everyone to skip that section of the report.
      assert.equal(el('circle', { 'probe-x': NaN }).getAttribute('probe-x'), 'NaN');
      assert.equal(el('circle', { 'probe-x': Infinity }).getAttribute('probe-x'), 'Infinity');
    });

    test('data-* keeps full precision; everything else is rounded', () => {
      const before = getPrecision();
      try {
        setPrecision(1);
        const n = el('circle', { cx: 1 / 3, 'data-x': 1 / 3, data: { y: 1 / 3 } });
        assert.equal(n.getAttribute('cx'), '0.3');
        assert.equal(n.getAttribute('data-x'), String(1 / 3), 'the probe compares goldens against this');
        assert.equal(n.getAttribute('data-y'), String(1 / 3), 'nested data too');
      } finally {
        setPrecision(before);
      }
      assert.equal(getPrecision(), 3, 'restored');
    });

    test('className is an alias for class', () => {
      assert.equal(el('g', { className: 'uf-layer' }).getAttribute('class'), 'uf-layer');
    });

    test('setPrecision refuses a nonsense value', () => {
      assert.throws(() => setPrecision(-1));
      assert.throws(() => setPrecision(NaN));
      assert.equal(getPrecision(), 3, 'and leaves the module unchanged');
    });

    test('group() appends children and skips the nullish ones', () => {
      const g = group({ class: 'uf-layer', 'data-layer': 'faces' },
        [el('circle'), null, el('rect'), undefined]);
      assert.equal(g.tagName, 'g');
      assert.equal(g.children.length, 2);
      assert.equal(g.getAttribute('data-layer'), 'faces');
    });
  });

  suite('svg — keyed reconciliation', ({ test }) => {
    test('reorder reuses the same element objects', () => {
      const p = el('g');
      const s = counting();
      const first = reconcile(p, items(['a', 'b', 'c', 'd']), s);
      assert.equal(order(p), 'a b c d');
      assert.equal(s.n, 4);

      const after = reconcile(p, items(['d', 'b', 'a', 'c']), s);
      assert.equal(order(p), 'd b a c', 'document order follows the items');
      assert.equal(s.n, 4, 'nothing was recreated');
      // Identity, not structural equality: assert.equal would JSON-stringify
      // two different elements to "{}" and pass.
      assert.ok(after[0] === first[3], 'd');
      assert.ok(after[1] === first[1], 'b');
      assert.ok(after[2] === first[0], 'a');
      assert.ok(after[3] === first[2], 'c');
      assert.ok(after.every((n, i) => n === p.children[i]), 'returned in document order');
    });

    test('removing a middle key detaches it and leaves the rest alone', () => {
      const p = el('g');
      const s = counting();
      const first = reconcile(p, items(['a', 'b', 'c', 'd']), s);
      const c = first[2];

      const after = reconcile(p, items(['a', 'b', 'd']), s);
      assert.equal(order(p), 'a b d');
      assert.equal(c.parentNode, null, 'detached');
      assert.ok(!p.contains(c));
      assert.equal(s.n, 4, 'no survivor was recreated');
      assert.ok(after[0] === first[0] && after[1] === first[1] && after[2] === first[3]);
    });

    test('inserting into the middle moves only what moved', () => {
      const p = el('g');
      const s = counting();
      const first = reconcile(p, items(['a', 'c']), s);
      const after = reconcile(p, items(['a', 'b', 'c']), s);
      assert.equal(order(p), 'a b c');
      assert.equal(s.n, 3, 'only b was created');
      assert.ok(after[0] === first[0] && after[2] === first[1]);
    });

    test('exit gets the key, and the caller can unsubscribe there', () => {
      // Detaching is what makes a removed node collectable; running the
      // caller's unsubscribe in exit() is what makes it not fire in between.
      const p = el('g');
      const offs = new Map();
      const exited = [];
      let fired = 0;
      const s = counting({
        create(it) {
          s.n++;
          const n = el('circle');
          offs.set(it.id, on(n, 'click', () => { fired++; }));
          return n;
        },
        exit(n, k) { exited.push(k); offs.get(k)(); offs.delete(k); n.remove(); },
      });

      const [a] = reconcile(p, items(['a', 'b']), s);
      a.dispatchEvent(new Event('click'));
      assert.equal(fired, 1);

      reconcile(p, items(['b']), s);
      assert.equal(exited.join(''), 'a', 'exit is called with the vanished key');
      assert.equal(a.parentNode, null);
      a.dispatchEvent(new Event('click'));
      assert.equal(fired, 1, 'the listener is gone');
    });

    test('update may return a replacement; a falsy return keeps the node', () => {
      const p = el('g');
      const exited = [];
      const s = counting({
        update: (n, it) => (it.id === 'b' && n.tagName === 'circle' ? el('rect') : undefined),
        exit: (n, k) => { exited.push(k); n.remove(); },
      });
      const first = reconcile(p, items(['a', 'b']), s);
      const after = reconcile(p, items(['a', 'b']), s);

      assert.ok(after[0] === first[0], 'a: a falsy update return means "kept it"');
      assert.ok(after[1] !== first[1], 'b: a different node replaces');
      assert.equal(after[1].tagName, 'rect');
      assert.equal(first[1].parentNode, null, 'the replaced node is detached');
      assert.equal(exited.join(''), 'b', 'through the same cleanup path as a vanished key');
      assert.equal(order(p), 'a b');
    });

    test('a node raised out of band is re-sorted on the next pass', () => {
      // SvgScene applies Primitive.raise AFTER reconciliation, so the reconciler
      // has to tolerate finding its own nodes out of order.
      const p = el('g');
      const s = counting();
      reconcile(p, items(['a', 'b', 'c']), s);
      raise(p.firstElementChild);
      assert.equal(order(p), 'b c a');

      reconcile(p, items(['a', 'b', 'c']), s);
      assert.equal(order(p), 'a b c');
      assert.equal(s.n, 3, 'and nothing was rebuilt');
    });

    test('keyed nodes already in the DOM are adopted, not duplicated', () => {
      // The migration case: a group a string builder populated before this call
      // site took it over.
      const p = el('g');
      const pre = el('circle', { 'data-k': 'a' });
      p.appendChild(pre);
      const s = counting();
      const after = reconcile(p, items(['a', 'b']), s);
      assert.ok(after[0] === pre, 'adopted');
      assert.equal(s.n, 1, 'only b was created');
      assert.equal(p.children.length, 2);
    });

    test('duplicate keys throw in dev and are suffixed in production', () => {
      const s = counting();
      assert.throws(() => reconcile(el('g'), items(['a', 'a']), s),
        'two items painting into one node means one of them vanishes');

      globalThis.UNFOLD_DEV = false;
      try {
        const p = el('g');
        reconcile(p, items(['a', 'a', 'a']), s);
        assert.equal(order(p), 'a a#2 a#3', 'a published page suffixes instead of dying');
      } finally {
        delete globalThis.UNFOLD_DEV;
      }
    });
  });

  suite('svg — z-order', ({ test }) => {
    const stack = ks => {
      const p = el('g');
      const kids = ks.map(k => el('circle', { 'data-k': k }));
      for (const k of kids) p.appendChild(k);
      return [p, kids];
    };

    test('raise moves a node to the top without recreating it', () => {
      const [p, [a, b, c]] = stack(['a', 'b', 'c']);
      let fired = 0;
      on(a, 'click', () => { fired++; });

      assert.ok(raise(a) === a, 'returns the node');
      assert.ok(p.lastElementChild === a, 'the same object, now on top');
      assert.equal(order(p), 'b c a');
      assert.equal(p.children.length, 3, 'moved, not cloned');
      a.dispatchEvent(new Event('click'));
      assert.equal(fired, 1, 'listeners survive the re-parent');
      assert.ok(b.parentNode === p && c.parentNode === p);
    });

    test('raise touches nothing when the node is already on top', () => {
      // Not an optimisation: re-inserting a node blurs it if it has focus and
      // restarts any CSS transition on it.
      const [p, kids] = stack(['a', 'b', 'c']);
      const mo = new MutationObserver(() => {});
      mo.observe(p, { childList: true });
      raise(kids[2]);
      const records = mo.takeRecords();
      mo.disconnect();
      assert.equal(records.length, 0);
      assert.ok(p.lastElementChild === kids[2]);
    });

    test('raise is a no-op on an unparented node', () => {
      const orphan = el('circle');
      assert.ok(raise(orphan) === orphan);
      assert.equal(orphan.parentNode, null);
    });

    test('lower moves a node to the bottom', () => {
      const [p, kids] = stack(['a', 'b', 'c']);
      lower(kids[2]);
      assert.equal(order(p), 'c a b');
      assert.ok(p.firstElementChild === kids[2]);

      const mo = new MutationObserver(() => {});
      mo.observe(p, { childList: true });
      lower(kids[2]);
      const records = mo.takeRecords();
      mo.disconnect();
      assert.equal(records.length, 0, 'idempotent, and a genuine no-op');
    });

    test('raiseAll puts the given nodes at the end in the given order', () => {
      const [p, [a, b, c, d]] = stack(['a', 'b', 'c', 'd']);
      raiseAll([c, a]);
      assert.equal(order(p), 'b d c a');
      assert.ok(b.parentNode === p && d.parentNode === p);

      const mo = new MutationObserver(() => {});
      mo.observe(p, { childList: true });
      raiseAll([c, a]);
      const records = mo.takeRecords();
      mo.disconnect();
      assert.equal(records.length, 0, 'already the tail, in order');
    });

    test('raiseTo places among element children, clamped', () => {
      const [p, [a, b, c]] = stack(['a', 'b', 'c']);
      raiseTo(c, 0);
      assert.equal(order(p), 'c a b');
      raiseTo(c, 1);
      assert.equal(order(p), 'a c b');
      raiseTo(c, 99);
      assert.equal(order(p), 'a b c', 'clamped to the end');
      raiseTo(a, -5);
      assert.equal(order(p), 'a b c', 'clamped to the start');
      assert.ok(p.children.length === 3 && p.children[0] === a && p.children[2] === c);
    });
  });

  suite('svg — text and the halo', ({ test }) => {
    test('text() sets the geometry and the halo class', () => {
      const t = text('110', { x: 12.3456, y: -4, data: { face: '110' } });
      assert.equal(t.tagName, 'text');
      assert.equal(t.textContent, '110');
      assert.equal(t.getAttribute('x'), '12.346');
      assert.equal(t.getAttribute('text-anchor'), 'middle');
      assert.equal(t.getAttribute('dominant-baseline'), 'middle');
      assert.ok(t.getAttribute('class').split(' ').includes('uf-halo'));
      assert.equal(t.getAttribute('data-face'), '110');
    });

    test('the default halo is the class alone — unfold.css paints it', () => {
      const t = text('P', { x: 0, y: 0 });
      assert.ok(!t.hasAttribute('stroke'), 'no inline paint by default');
      assert.ok(!t.hasAttribute('paint-order'));
      assert.ok(!text('P', { x: 0, y: 0, halo: false }).getAttribute('class'),
        'halo:false leaves no class at all when none was asked for');
    });

    test('an inline halo strokes under the glyph, in a token', () => {
      const t = text('P', { x: 0, y: 0, class: 'uf-mark', halo: '--bg' });
      assert.equal(t.getAttribute('paint-order'), 'stroke',
        'stroke painted UNDER the glyph fill — that is what knocks the label out');
      assert.ok(/^var\(--[\w-]+\)$/.test(t.getAttribute('stroke')),
        `never a literal colour, got ${t.getAttribute('stroke')}`);
      assert.equal(t.getAttribute('stroke'), 'var(--bg)');
      assert.equal(t.getAttribute('stroke-linejoin'), 'round');
      assert.ok(Number(t.getAttribute('stroke-width')) > 0);
      assert.equal(t.getAttribute('class'), 'uf-mark uf-halo');
      assert.equal(text('P', { x: 0, y: 0, halo: 'var(--card)' }).getAttribute('stroke'), 'var(--card)');
    });

    test('a halo that is not a custom property is refused', () => {
      assert.throws(() => text('P', { x: 0, y: 0, halo: 'currentColor' }));
      // The fallback form is exactly where a literal gets past a source-text
      // check and then fails to adapt to the other colour scheme.
      assert.throws(() => text('P', { x: 0, y: 0, halo: 'var(--bg, 0)' }));
    });
  });

  suite('svg — raw and esc', ({ test }) => {
    test('raw() returns a DocumentFragment of SVG-namespaced nodes', () => {
      const frag = raw('<circle cx="1" cy="2" r="3"/><line x1="0" y1="0" x2="4" y2="4"/>');
      assert.equal(frag.nodeType, 11, 'DocumentFragment');
      assert.equal(frag.childNodes.length, 2);

      const p = el('g');
      p.appendChild(frag);
      assert.equal(p.children.length, 2);
      assert.equal(p.firstElementChild.namespaceURI, SVG_NS);
      assert.equal(p.firstElementChild.getAttribute('r'), '3');
      assert.equal(p.lastElementChild.tagName, 'line');
      assert.equal(frag.childNodes.length, 0, 'appending moves the nodes out');
    });

    test('raw() refuses markup that is not well formed', () => {
      // Strict parsing is what turns "you escape your own strings" from a
      // comment into a checked obligation.
      assert.throws(() => raw('<circle r="3">'), 'unclosed');
      assert.throws(() => raw('<text>a & b</text>'), 'unescaped ampersand');
    });

    test('esc() covers the five, in one pass', () => {
      assert.equal(esc(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
      assert.equal(esc('&lt;'), '&amp;lt;', 'no double-escaping of the ampersand');
      assert.equal(esc(3), '3');
    });

    test('esc() is what makes a hostile string safe for raw()', () => {
      const label = 'a & b <script>';
      const p = el('g');
      p.appendChild(raw(`<text>${esc(label)}</text>`));
      assert.equal(p.children.length, 1);
      assert.equal(p.firstElementChild.tagName, 'text');
      assert.equal(p.firstElementChild.textContent, label, 'markup became text');
      assert.equal(p.firstElementChild.children.length, 0);
    });
  });

  suite('svg — listeners and measurement', ({ test }) => {
    test('on() returns an unsubscribe that is safe to call twice', () => {
      const n = el('rect');
      let c = 0;
      const off = on(n, 'click', () => { c++; });
      n.dispatchEvent(new Event('click'));
      assert.equal(c, 1);
      off();
      off();
      n.dispatchEvent(new Event('click'));
      assert.equal(c, 1);
    });

    test('onAll unsubscribes every handler at once', () => {
      const n = el('rect');
      let c = 0;
      const off = onAll(n, { click: () => { c += 1; }, pointerdown: () => { c += 10; } });
      n.dispatchEvent(new Event('click'));
      n.dispatchEvent(new Event('pointerdown'));
      assert.equal(c, 11);
      off();
      n.dispatchEvent(new Event('click'));
      n.dispatchEvent(new Event('pointerdown'));
      assert.equal(c, 11);
    });

    test('createTextMeasurer measures once per distinct styled string', () => {
      const host = el('svg', { width: 400, height: 100 });
      document.body.appendChild(host);
      try {
        const m = createTextMeasurer(host);
        const probe = host.querySelector('text');
        assert.equal(probe.getAttribute('aria-hidden'), 'true', 'a measuring stick is not content');
        assert.equal(probe.getAttribute('visibility'), 'hidden');

        const a = m.measure('hello', { fontSize: 16 });
        assert.ok(a.w > 0, 'a laid-out string has a width');
        assert.ok(a.h > 0, 'height is derived from the font size');
        const again = m.measure('hello', { fontSize: 16 });
        assert.equal(again.w, a.w);
        assert.equal(m.stats(), { hits: 1, misses: 1 });

        assert.ok(m.measure('hello hello hello', { fontSize: 16 }).w > a.w);
        assert.ok(m.measure('hello', { fontSize: 32 }).w > a.w, 'font size is part of the key');
        assert.equal(m.stats(), { hits: 1, misses: 3 });

        m.clear();
        m.measure('hello', { fontSize: 16 });
        assert.equal(m.stats(), { hits: 1, misses: 4 }, 'clear() empties the cache, not the counters');

        m.dispose();
        assert.equal(host.querySelector('text'), null, 'the probe goes with it');
        assert.throws(() => m.measure('hello'), 'measuring after dispose is a bug, not a zero');
      } finally {
        host.remove();
      }
    });

    test('the measurement cache evicts oldest-first at the limit', () => {
      const host = el('svg', { width: 400, height: 100 });
      document.body.appendChild(host);
      try {
        const m = createTextMeasurer(host, { cacheLimit: 2 });
        m.measure('a'); m.measure('b'); m.measure('c');
        m.measure('c');
        assert.equal(m.stats(), { hits: 1, misses: 3 });
        m.measure('a');
        assert.equal(m.stats(), { hits: 1, misses: 4 }, 'a was evicted, not b or c');
        m.dispose();
      } finally {
        host.remove();
      }
    });
  });
}
