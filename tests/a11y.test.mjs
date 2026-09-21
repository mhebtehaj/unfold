// core/a11y.js — the equality-guarded live region, the operable-scene binding,
// and the shared media matchers.
//
// Browser-only (tools/run-tests.mjs): every assertion here is about what a real
// document ends up holding. Under node the module imports cleanly and registers
// no suite.

import { suite, assert } from './harness.mjs';
import {
  LAYER, liveRegion, makeOperable, describeSvg, preserveFocus,
  prefersReducedMotion, onMotionPreferenceChange, coarsePointer, hitInflation,
} from '../engine/core/a11y.js';

const DOM = typeof document !== 'undefined';
const SVG_NS = 'http://www.w3.org/2000/svg';
const sleep = ms => new Promise(res => setTimeout(res, ms));

/** A container removed even when the test throws, so a failure leaks no nodes. */
const withStage = fn => async () => {
  const host = document.createElement('div');
  document.body.append(host);
  try { return await fn(host); } finally { host.remove(); }
};

const para = host => { const p = document.createElement('p'); host.append(p); return p; };
const scene = host => { const s = document.createElementNS(SVG_NS, 'svg'); host.append(s); return s; };

if (DOM) suite('a11y', ({ test }) => {
  test('declares its layer', () => assert.equal(LAYER, 0));

  // -- live regions -------------------------------------------------------

  test('a live region gets the politeness, atomicity and role the spec names',
    withStage(host => {
      const polite = para(host);
      liveRegion(polite).dispose();
      assert.equal(polite.getAttribute('aria-live'), 'polite');
      assert.equal(polite.getAttribute('aria-atomic'), 'true');
      assert.equal(polite.getAttribute('role'), 'status');

      const loud = para(host);
      liveRegion(loud, { politeness: 'assertive', atomic: false }).dispose();
      assert.equal(loud.getAttribute('aria-live'), 'assertive');
      assert.equal(loud.getAttribute('aria-atomic'), 'false');
      assert.equal(loud.getAttribute('role'), 'alert');
    }));

  test('a role the author already chose is left alone', withStage(host => {
    const p = para(host);
    p.setAttribute('role', 'log');
    liveRegion(p).dispose();
    assert.equal(p.getAttribute('role'), 'log');
  }));

  test('the equality guard: writing the same string twice touches the DOM once',
    withStage(host => {
      const p = para(host);
      const region = liveRegion(p, { debounce: 0 });
      const obs = new MutationObserver(() => {});
      obs.observe(p, { childList: true, characterData: true, subtree: true });

      assert.equal(region.announce('2 of 6 faces selected'), true);
      assert.equal(region.announce('2 of 6 faces selected'), false,
        'an identical write must be refused, not repeated');
      assert.equal(region.announce('2 of 6 faces selected'), false);

      const records = obs.takeRecords();
      obs.disconnect();
      assert.equal(records.length, 1, `expected one DOM mutation, saw ${records.length}`);
      assert.equal(region.text, '2 of 6 faces selected');
      region.dispose();
    }));

  test('force re-announces identical text without changing what it says',
    withStage(host => {
      const p = para(host);
      const region = liveRegion(p, { debounce: 0 });
      region.announce('still 3 components');
      const first = p.textContent;

      region.force('still 3 components');
      assert.ok(p.textContent !== first, 'force must change the node, or nothing is announced');
      assert.equal(region.text, 'still 3 components', 'the marker is not part of the text');

      const second = p.textContent;
      region.force('still 3 components');
      assert.ok(p.textContent !== second, 'the marker must toggle, not accumulate');
      assert.equal(region.announce('still 3 components'), false,
        'a leftover marker must not read as a difference');
      region.dispose();
    }));

  test('the debounce collapses a 60 fps burst onto its last value',
    withStage(async host => {
      const p = para(host);
      const region = liveRegion(p, { debounce: 40 });
      assert.equal(region.announce('t = 0.00'), true, 'the leading edge is immediate');
      for (let i = 1; i <= 30; i++)
        assert.equal(region.announce(`t = ${(i / 30).toFixed(2)}`), false);
      assert.equal(region.text, 't = 0.00', 'a playback loop must not flood the region');

      await sleep(90);
      assert.equal(region.text, 't = 1.00', 'the trailing write must carry the last value');
      region.dispose();
    }));

  test('clear empties the region and dispose silences a pending write',
    withStage(async host => {
      const p = para(host);
      const region = liveRegion(p, { debounce: 30 });
      region.announce('7 carriers');
      region.clear();
      assert.equal(region.text, '');

      region.announce('8 carriers');        // inside the debounce window: deferred
      region.dispose();
      await sleep(70);
      assert.equal(region.text, '', 'a disposed region wrote after teardown');
      assert.equal(region.announce('9 carriers'), false);
      assert.equal(region.text, '');
    }));

  // -- operable scenes ----------------------------------------------------

  test('an interactive scene gets group + tabindex + label + describedby',
    withStage(host => {
      const svg = scene(host);
      const op = makeOperable(svg, {
        label: 'Ambiguity cube',
        description: 'Six faces; two are selected.',
        instructions: 'Arrow keys turn the cube.',
      });
      assert.equal(svg.getAttribute('role'), 'group');
      assert.equal(svg.getAttribute('tabindex'), '0');
      assert.equal(svg.getAttribute('aria-label'), 'Ambiguity cube');

      const ids = svg.getAttribute('aria-describedby').split(' ');
      assert.equal(ids.length, 2, 'description and instructions must both be linked');
      const nodes = ids.map(id => document.getElementById(id));
      assert.all(nodes, n => n != null, 'aria-describedby points at nothing');
      assert.equal(nodes[0].textContent, 'Six faces; two are selected.');
      assert.equal(nodes[1].textContent, 'Arrow keys turn the cube.');

      // Announced, but invisible: taken out of the picture by clipping, never by
      // display:none or aria-hidden, which would take it out of the a11y tree.
      for (const n of nodes) {
        const cs = getComputedStyle(n);
        assert.equal(cs.position, 'absolute');
        assert.equal(cs.width, '1px');
        assert.equal(cs.overflow, 'hidden');
        assert.ok(cs.display !== 'none', 'display:none would hide it from AT too');
        assert.ok(cs.visibility !== 'hidden');
        assert.equal(n.getAttribute('aria-hidden'), null);
      }
      op.dispose();
    }));

  test('an existing aria-describedby is extended, not replaced', withStage(host => {
    const hint = para(host);
    hint.id = 'visible-hint';
    const svg = scene(host);
    svg.setAttribute('aria-describedby', 'visible-hint');
    const op = makeOperable(svg, { label: 'scene', description: 'more detail' });
    const ids = svg.getAttribute('aria-describedby').split(' ');
    assert.equal(ids[0], 'visible-hint');
    assert.equal(ids.length, 2);
    op.dispose();
    assert.equal(svg.getAttribute('aria-describedby'), 'visible-hint');
  }));

  test('preventDefault is called only for keys the scene handled', withStage(host => {
    const svg = scene(host);
    let turns = 0;
    const op = makeOperable(svg, { label: 'scene', keys: { ArrowLeft: () => { turns++; } } });
    const hit = key => {
      const ev = new KeyboardEvent('keydown', { key, cancelable: true, bubbles: true });
      svg.dispatchEvent(ev);
      return ev.defaultPrevented;
    };
    assert.equal(hit('ArrowLeft'), true);
    assert.equal(turns, 1);
    assert.equal(hit('Tab'), false, 'swallowing Tab traps the keyboard user in the drawing');
    assert.equal(turns, 1);

    op.dispose();
    assert.equal(hit('ArrowLeft'), false, 'a disposed binding still handled a key');
    assert.equal(turns, 1);
  }));

  test('the predicate form of keys decides for itself', withStage(host => {
    const svg = scene(host);
    const seen = [];
    const op = makeOperable(svg, {
      label: 'scene',
      keys: ev => { seen.push(ev.key); return ev.key.startsWith('Arrow'); },
    });
    const hit = key => {
      const ev = new KeyboardEvent('keydown', { key, cancelable: true });
      svg.dispatchEvent(ev);
      return ev.defaultPrevented;
    };
    assert.equal(hit('ArrowUp'), true);
    assert.equal(hit('/'), false, 'find-in-page must survive');
    assert.equal(seen.join(','), 'ArrowUp,/');
    op.dispose();
  }));

  test('a static illustration is role=img and loses its stale tabindex',
    withStage(host => {
      const svg = scene(host);
      svg.setAttribute('tabindex', '0');   // 17 SVGs on the site look exactly like this
      const op = makeOperable(svg, { label: 'A torus', role: 'img', focusable: false });
      assert.equal(svg.getAttribute('role'), 'img');
      assert.equal(svg.getAttribute('tabindex'), null,
        'role="img" plus tabindex="0" is the contradiction this exists to remove');
      op.dispose();
      assert.equal(svg.getAttribute('tabindex'), '0', 'dispose must restore what it found');
    }));

  test('dispose restores every attribute and removes the hidden prose',
    withStage(host => {
      const svg = scene(host);
      svg.setAttribute('role', 'presentation');
      const before = host.children.length;
      const op = makeOperable(svg, { label: 'scene', description: 'hint', instructions: 'keys' });
      assert.equal(host.children.length, before + 2);
      op.dispose();
      assert.equal(svg.getAttribute('role'), 'presentation');
      assert.equal(svg.getAttribute('aria-label'), null);
      assert.equal(svg.getAttribute('aria-describedby'), null);
      assert.equal(host.children.length, before);
    }));

  test('setLabel updates the accessible name in place', withStage(host => {
    const svg = scene(host);
    const op = makeOperable(svg, { label: 'nothing selected' });
    op.setLabel('face 110 selected');
    assert.equal(svg.getAttribute('aria-label'), 'face 110 selected');
    op.dispose();
    assert.equal(svg.getAttribute('aria-label'), null);
  }));

  test('instructions are appended once however often the binding is remade',
    withStage(host => {
      const svg = scene(host);
      makeOperable(svg, { label: 'a', instructions: 'Arrow keys turn the cube.' });
      const op = makeOperable(svg, { label: 'b', instructions: 'Arrow keys turn the cube.' });
      assert.equal(host.querySelectorAll('p').length, 1, 'a redraw duplicated the hidden prose');
      assert.equal(svg.getAttribute('aria-label'), 'b');
      op.dispose();
      assert.equal(host.querySelectorAll('p').length, 0);
    }));

  // -- svg description ----------------------------------------------------

  test('describeSvg seats title and desc first and updates them in place',
    withStage(host => {
      const svg = scene(host);
      const layer = document.createElementNS(SVG_NS, 'g');
      svg.append(layer);

      describeSvg(svg, { title: 'Cube', desc: 'Six faces.' });
      assert.equal(svg.children[0].localName, 'title');
      assert.equal(svg.children[1].localName, 'desc');
      assert.equal(svg.children[2], layer);

      const title = svg.children[0];
      describeSvg(svg, { title: 'Cube, 2 selected' });
      assert.equal(svg.children[0], title, 'the node must be updated, not replaced');
      assert.equal(title.textContent, 'Cube, 2 selected');
      assert.equal(svg.children[1].textContent, 'Six faces.',
        'an omitted field must leave what is there');

      // A redraw that prepends a layer must not leave the title behind it.
      svg.insertBefore(document.createElementNS(SVG_NS, 'g'), svg.firstChild);
      describeSvg(svg, { title: 'Cube, 2 selected' });
      assert.equal(svg.children[0], title);
      assert.equal(svg.children[1].localName, 'desc');
    }));

  // -- focus preservation -------------------------------------------------

  const keyed = k => {
    const b = document.createElement('button');
    b.setAttribute('data-k', k);
    b.textContent = k;
    return b;
  };

  test('preserveFocus restores focus to the node with the same key',
    withStage(host => {
      host.append(keyed('face:110'), keyed('face:011'));
      host.children[0].focus();
      assert.equal(document.activeElement, host.children[0]);

      preserveFocus(host, () => {
        host.textContent = '';                       // the redraw that drops focus to <body>
        host.append(keyed('face:011'), keyed('face:110'));
      });
      assert.equal(document.activeElement.getAttribute('data-k'), 'face:110',
        'a redraw during keyboard interaction dropped focus');
    }));

  test('preserveFocus is a no-op when the key did not survive', withStage(host => {
    host.append(keyed('face:110'));
    host.children[0].focus();
    preserveFocus(host, () => {
      host.textContent = '';
      host.append(keyed('face:001'));
    });
    assert.equal(document.activeElement.getAttribute?.('data-k') ?? null, null);
  }));

  test('preserveFocus passes the callback result through and leaves focus alone',
    withStage(host => {
      host.append(keyed('a'));
      document.body.focus();
      const out = preserveFocus(host, () => 42);
      assert.equal(out, 42);
    }));

  // -- preferences and pointers -------------------------------------------

  test('the shared matchers answer live booleans', () => {
    assert.equal(typeof prefersReducedMotion(), 'boolean');
    assert.equal(typeof coarsePointer(), 'boolean');
  });

  test('a motion subscription is removable, twice over', () => {
    let seen = 0;
    const off = onMotionPreferenceChange(() => { seen++; });
    assert.equal(typeof off, 'function');
    off();
    off();                                  // idempotent teardown must not throw
    assert.equal(seen, 0);
  });

  test('hitInflation is the SVG half of the 44px coarse-pointer policy', () => {
    const coarse = coarsePointer();
    assert.equal(hitInflation(), coarse ? 22 : 0);
    assert.equal(hitInflation({ min: 60 }), coarse ? 30 : 0);
  });
});
