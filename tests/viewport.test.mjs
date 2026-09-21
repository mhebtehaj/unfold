// core/viewport.js — the y-flip, the scale factor, and the frame that does not
// drift.
//
// Four of these assert a specific bug from the inventory rather than a
// function's happy path: the client→viewBox scale the second homotopy widget
// dropped (homotopy.md §15.3), the `g.r *= .81` that mutated the shared
// geometry cache (realization.md §16.14), the hidden tab panel that cached a
// bogus frame (homotopy.md §15.28), and the ResizeObserver that redrew per
// observation with no coalescing (realization.md §16.30).
//
// Browser-only (tools/run-tests.mjs): this needs a real layout box and a real
// ResizeObserver. Under node the module imports cleanly and registers no suite.

import { suite, assert } from './harness.mjs';
import { LAYER, Viewport } from '../engine/core/viewport.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

const nextFrame = () => new Promise(res => requestAnimationFrame(res));
/** Long enough for a ResizeObserver delivery plus the rAF it coalesces onto. */
const settle = async (n = 3) => { for (let i = 0; i < n; i++) await nextFrame(); };

/**
 * A host at a known position with an <svg> of a known CSS size inside it.
 * Everything made during the test is disposed and removed even when it throws,
 * so a failure leaks no nodes, no observers and no patched globals.
 */
const withStage = (opts, fn) => async () => {
  const { w = 400, h = 300, inset = [0, 0], hidden = false } = opts;

  const host = document.createElement('div');
  host.style.cssText = `position:absolute; left:0; top:0; width:${w + 60}px; ` +
                       `height:${h + 60}px;${hidden ? ' display:none;' : ''}`;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.style.cssText = `position:absolute; left:${inset[0]}px; top:${inset[1]}px; ` +
                      `display:block; width:${w}px; height:${h}px;`;
  host.append(svg);
  document.body.append(host);

  const made = [];
  let restoreRO = null;

  const api = {
    host,
    svg,
    viewport(o) { const vp = new Viewport(svg, o); made.push(vp); return vp; },

    /** Counts calls to measure(); the instance property shadows the prototype. */
    spyOn(vp) {
      const spy = { n: 0 };
      const orig = vp.measure;
      vp.measure = function measure(...args) { spy.n++; return orig.apply(this, args); };
      return spy;
    },

    /**
     * A ResizeObserver whose callback the test drives itself. The real one
     * already batches per frame, so only a hand-driven one can show that THIS
     * module coalesces — and it is also the only way to deliver a 0x0 entry on
     * demand, since the real observer never reports a box it has not seen grow.
     */
    fakeRO() {
      const real = globalThis.ResizeObserver;
      restoreRO = () => { globalThis.ResizeObserver = real; };
      const rec = { callbacks: [], observed: [], disconnects: 0 };
      globalThis.ResizeObserver = class {
        constructor(cb) { rec.callbacks.push(cb); }
        observe(target) { rec.observed.push(target); }
        unobserve() {}
        disconnect() { rec.disconnects++; }
      };
      return rec;
    },

    entry: (width, height) => ({ target: svg, contentRect: { width, height } }),
  };

  try {
    return await fn(api);
  } finally {
    for (const vp of made) vp.dispose();
    restoreRO?.();
    host.remove();
  }
};

register();

function register() {
  // Registered only in a browser: every assertion below is about what a real
  // layout engine reports, and the file still has to import cleanly under node.
  if (typeof document === 'undefined') return;

  suite('viewport — fit', ({ test }) => {
    test('declares its layer', () => assert.equal(LAYER, 0));

    test('fit() reproduces all three explorer fitting blocks exactly', () => {
      // homotopy: max(17, min((w-28)/2, (h-44)/2, 86))
      const a = Viewport.fit({ box: [200, 180], pad: [14, 22], extent: 1,
                               radius: { min: 17, max: 86 } });
      assert.close(a.r, Math.max(17, Math.min((200 - 28) / 2, (180 - 44) / 2, 86)), 1e-12);
      assert.equal(a.cx, 100);
      assert.equal(a.cy, 90);

      // realization: max(12, min((w-36)/2.4, (h-42)/2.4)) — the /2.4 is extent 1.2
      const b = Viewport.fit({ box: [300, 200], pad: [18, 21], extent: 1.2 });
      assert.close(b.r, Math.max(12, Math.min((300 - 36) / 2.4, (200 - 42) / 2.4)), 1e-12);

      // ambiguity: min((w-85)/span, (h-85)/span) — 85 is pad 42.5 doubled
      const c = Viewport.fit({ box: [640, 409], pad: 42.5, extent: 1.1 });
      assert.close(c.r, Math.min((640 - 85) / 2.2, (409 - 85) / 2.2), 1e-12);

      // The one deliberate difference: `cy - 5` is folded into the centre once,
      // and the 5px it moves towards the top edge comes out of the radius
      // rather than out of the reserve the legacy formula had already promised.
      const nudged = Viewport.fit({ box: [200, 180], pad: [14, 22], extent: 1,
                                    radius: { min: 17, max: 86 }, offset: [0, -5] });
      assert.equal(nudged.cy, 85);
      assert.equal(nudged.r, 63, '180 - 22 - 85, not 90 - 22');
    });

    test('fit() clamps into radius.min .. radius.max', () => {
      const tiny = Viewport.fit({ box: [40, 40], pad: 24, radius: { min: 12, max: 260 } });
      assert.equal(tiny.r, 12, 'a box smaller than its own reserve still gets radius.min');
      const huge = Viewport.fit({ box: [4000, 4000], pad: 24, radius: { min: 12, max: 260 } });
      assert.equal(huge.r, 260);
    });

    test('fit() keeps the reserve on both sides of a nudged centre', () => {
      // The legacy spelling (h/2 - pad) spends 5px of the bottom reserve on the
      // nudge without saying so; measuring per side is what keeps a reserve one.
      const f = Viewport.fit({ box: [400, 400], pad: 24, offset: [0, -5] });
      assert.equal(f.cy, 195);
      assert.equal(f.r, 171, 'bounded by the near edge: 400 - 24 - 195');
      assert.ok(f.cy + f.r <= 400 - 24, 'the bottom reserve survives');
      assert.ok(f.cy - f.r >= 24, 'and so does the top one');
    });

    test('fit() accepts a per-side pad and centres on the box, not on the reserve', () => {
      const f = Viewport.fit({ box: [400, 400], pad: { top: 0, right: 0, bottom: 60, left: 0 } });
      assert.equal(f.cy, 200, 'pad sizes the drawing; offset is what positions it');
      assert.equal(f.r, 140, 'and r clears the wider side');
    });

    test('an option that would silently produce wrong geometry throws', () => {
      assert.throws(() => Viewport.fit({ box: [400, 300], extent: 0 }), 'extent 0 divides');
      assert.throws(() => Viewport.fit({ box: [400, 300], extent: -1 }), 'a mirrored extent');
      assert.throws(() => Viewport.fit({ box: [400, NaN] }), 'NaN in the box');
      assert.throws(() => Viewport.fit({ box: [400, 300], radius: { min: 200, max: 100 } }),
        'an inverted radius range would collapse every size to max');
      assert.throws(() => new Viewport(null), 'no element');
    });
  });

  suite('viewport — measurement', ({ test }) => {
    test('measure() reports the box and owns the viewBox',
      withStage({ w: 400, h: 300 }, ({ svg, viewport }) => {
        const vp = viewport({ observe: false, pad: 24, extent: 1 });
        assert.ok(vp.el === svg, 'el() hands back the element it measures');
        assert.ok(vp.measure() === vp, 'measure() chains');
        assert.equal(vp.w, 400);
        assert.equal(vp.h, 300);
        assert.equal(vp.cx, 200);
        assert.equal(vp.cy, 150);
        assert.equal(vp.r, 126, 'min(200, 150) - 24');
        assert.equal(vp.live, true);
        assert.equal(svg.getAttribute('viewBox'), '0 0 400 300',
          '1 viewBox unit = 1 CSS pixel');
      }));

    test('measuring twice without a resize returns the same numbers — no drift',
      withStage({}, ({ viewport }) => {
        const vp = viewport({ observe: false });
        const snap = v => [v.w, v.h, v.cx, v.cy, v.r];
        vp.measure();
        const first = snap(vp);

        // What `solidRender` did per draw, three times over: take a shrunk
        // frame. The bug was that it shrank the cached object, so the radius a
        // later reader saw depended on how many draws had run.
        const a = vp.scaled(0.81);
        const b = vp.scaled(0.81);
        const c = a.scaled(0.81);

        vp.measure();
        assert.equal(snap(vp), first, 'a second measurement must not drift');
        assert.close(a.r, first[4] * 0.81, 1e-12);
        assert.equal(a.r, b.r, 'two shrunk frames from one measurement agree');
        assert.close(c.r, first[4] * 0.81 * 0.81, 1e-12, 'and a frame of a frame is its own');
        assert.equal(vp.r, first[4], 'the measurement itself is untouched');
      }));

    test('a frame is frozen, and derived frames are new objects',
      withStage({}, ({ viewport }) => {
        const vp = viewport({ observe: false });
        vp.measure();
        const f = vp.frame;
        assert.ok(Object.isFrozen(f), 'frozen');
        assert.throws(() => { f.r = 999; }, 'writing to a frame throws in a module');
        assert.equal(f.r, vp.r);

        assert.ok(vp.frame === f, 'identity is stable between measurements');
        vp.measure();
        assert.ok(vp.frame === f, 'and across a measurement that changed nothing');
        assert.ok(vp.scaled(0.81) !== f, 'scaled() is a new frame');
        assert.ok(vp.translated(3, 4) !== f, 'translated() is a new frame');

        const t = f.translated(3, 4);
        assert.equal([t.cx, t.cy, t.r, t.w], [f.cx + 3, f.cy + 4, f.r, f.w]);
        assert.equal(f.cx, vp.cx, 'and the source frame is unchanged');
      }));

    test('measure() skips the DOM write when the box is unchanged',
      withStage({}, ({ svg, viewport }) => {
        // The write is what the ResizeObserver hears; an unconditional one is a
        // feedback loop as soon as `height` writes style.height.
        const vp = viewport({ observe: false });
        const obs = new MutationObserver(() => {});
        obs.observe(svg, { attributes: true });

        vp.measure();
        assert.equal(obs.takeRecords().length, 1, 'the first measurement writes the viewBox');
        vp.measure();
        vp.measure();
        const rest = obs.takeRecords();
        obs.disconnect();
        assert.equal(rest.length, 0, `an unchanged box writes nothing, saw ${rest.length}`);
      }));

    test('a derived height is written to style.height and the viewBox agrees',
      withStage({ w: 400, h: 300 }, ({ svg, viewport }) => {
        const vp = viewport({ observe: false, height: w => Math.min(470, Math.max(320, w * 0.64)) });
        vp.measure();
        assert.equal(vp.w, 400);
        assert.equal(vp.h, 320, 'max(320, 400*0.64)');
        assert.equal(svg.style.height, '320px');
        assert.equal(svg.getAttribute('viewBox'), '0 0 400 320',
          'the derived height is computed, never read back');
      }));

    test('minSize floors the measurement; padX/padY report the reserve',
      withStage({ w: 40, h: 30 }, ({ viewport }) => {
        const vp = viewport({ observe: false, minSize: [70, 90], pad: [14, 22] });
        vp.measure();
        assert.equal(vp.w, 70);
        assert.equal(vp.h, 90);
        assert.equal(vp.live, true, 'small is not the same as hidden');
        assert.equal(vp.padX, 14);
        assert.equal(vp.padY, 22);

        const sided = viewport({ observe: false, pad: { top: 0, right: 60, bottom: 20, left: 10 } });
        assert.equal(sided.padX, 60, 'the wider side is the one r has to clear');
        assert.equal(sided.padY, 20);
      }));

    test('a 0x0 container yields a finite frame and live === false',
      withStage({ hidden: true }, ({ viewport }) => {
        // The hidden tab panel. There are four of them on the existing pages.
        const vp = viewport({ observe: false });
        vp.measure();
        assert.equal(vp.live, false, 'a hidden panel is not live — the draw must skip');
        const f = vp.frame;
        assert.all([f.w, f.h, f.cx, f.cy, f.r], Number.isFinite, 'frame');
        assert.all(f.toScreen([0.5, -0.5]), Number.isFinite, 'toScreen');

        // And with the minSize floor removed, the genuinely degenerate path.
        const bare = viewport({ observe: false, minSize: [0, 0], radius: { min: 0, max: Infinity } });
        bare.measure();
        const g = bare.frame;
        assert.all([g.w, g.h, g.cx, g.cy, g.r], Number.isFinite, 'degenerate frame');
        assert.all(g.toScreen([1, 1]), Number.isFinite, 'degenerate toScreen');
      }));
  });

  suite('viewport — conversions', ({ test }) => {
    test('the y-flip happens exactly once: +y lands ABOVE the centre',
      withStage({ w: 400, h: 300 }, ({ viewport }) => {
        const vp = viewport({ observe: false });
        vp.measure();
        const up = vp.toScreen([0, 1]);
        assert.ok(up[1] < vp.cy, `+y must be above the centre, got ${up[1]} vs cy ${vp.cy}`);
        assert.close(up[1], vp.cy - vp.r, 1e-12, 'exactly one negation');
        const down = vp.toScreen([0, -1]);
        assert.close(down[1], vp.cy + vp.r, 1e-12);
        assert.close(vp.toScreen([1, 0])[0], vp.cx + vp.r, 1e-12, 'x is not flipped');
      }));

    test('toScreen/fromScreen round-trip, at two aspect ratios',
      withStage({ w: 400, h: 300 }, async ({ svg, viewport }) => {
        const points = [[0, 0], [0.5, 0.5], [-0.37, 0.82], [1.4, -2.6], [0, -1]];
        const check = vp => {
          for (const p of points) {
            const back = vp.fromScreen(vp.toScreen(p));
            assert.close(back[0], p[0], 1e-9, `x of [${p}]`);
            assert.close(back[1], p[1], 1e-9, `y of [${p}]`);
          }
          // And the other way round, from viewBox space.
          for (const s of [[0, 0], [vp.w, vp.h], [17, vp.h - 3]]) {
            const back = vp.toScreen(vp.fromScreen(s));
            assert.close(back[0], s[0], 1e-9, `screen x of [${s}]`);
            assert.close(back[1], s[1], 1e-9, `screen y of [${s}]`);
          }
        };

        const wide = viewport({ observe: false, pad: 24 });
        wide.measure();
        check(wide);

        // A viewBox whose aspect differs from the first one, and an offset
        // centre, so the round-trip cannot be passing by symmetry.
        svg.style.width = '300px';
        svg.style.height = '500px';
        const tall = viewport({ observe: false, pad: [12, 40], offset: [7, -5], center: [0.25, -1] });
        tall.measure();
        assert.equal([tall.w, tall.h], [300, 500], 'the second aspect really is different');
        check(tall);
      }));

    test('center and offset are applied once each',
      withStage({ w: 400, h: 300 }, ({ viewport }) => {
        const centred = viewport({ observe: false, center: [1, 2] });
        centred.measure();
        const s = centred.toScreen([1, 2]);
        assert.close(s[0], centred.cx, 1e-12, 'center is the math point at the box centre');
        assert.close(s[1], centred.cy, 1e-12);

        const nudged = viewport({ observe: false, offset: [0, -5] });
        nudged.measure();
        assert.equal(nudged.cy, 145, 'the `cy - 5` idiom, in the measured centre');
        assert.close(nudged.toScreen([0, 0])[1], nudged.cy, 1e-12,
          'and applied to the centre only — not a second time in toScreen');
      }));

    test('the frame maps a point exactly as the viewport does',
      withStage({}, ({ viewport }) => {
        const vp = viewport({ observe: false, center: [0.3, -0.2], offset: [4, -5] });
        vp.measure();
        const p = [1.25, -0.75];
        assert.equal(vp.frame.toScreen(p), vp.toScreen(p), 'one formula, two call sites');
        assert.equal(vp.frame.fromScreen([31, 47]), vp.fromScreen([31, 47]));
      }));

    test('fromEvent applies the client→viewBox scale — the homotopy.md §15.3 regression',
      withStage({ w: 400, h: 300 }, ({ svg, viewport }) => {
        // `eqSelect` and `eqDrawConnections` take raw pixel deltas out of the
        // rect where the first widget scales them by `g.w / box.width`. That is
        // invisible while the viewBox equals the client box, so this test makes
        // them differ: measure at 400x300, then halve the CSS size without
        // re-measuring. kx = 400/200 = 2.
        const vp = viewport({ observe: false, pad: 0, radius: { min: 1, max: Infinity } });
        vp.measure();
        assert.equal(svg.getAttribute('viewBox'), '0 0 400 300');

        svg.style.width = '200px';
        svg.style.height = '150px';
        const rect = svg.getBoundingClientRect();
        assert.close(rect.width, 200, 0.5, 'the client box really did halve');
        assert.close(rect.height, 150, 0.5);

        const ev = { clientX: rect.left + 50, clientY: rect.top + 37.5 };
        const s = vp.screenFromEvent(ev);
        // The dropped-scale answer is [50, 37.5] — half of the right one.
        assert.close(s[0], 100, 1e-6, 'x: 50 client px is 100 viewBox px');
        assert.close(s[1], 75, 1e-6, 'y: 37.5 client px is 75 viewBox px');

        const m = vp.fromEvent(ev);
        assert.close(m[0], (100 - vp.cx) / vp.r, 1e-9, 'and fromEvent lands in math space');
        assert.close(m[1], -(75 - vp.cy) / vp.r, 1e-9, 'through the same single y-flip');

        // A corner is the cheapest end-to-end check of the same factor.
        const corner = vp.screenFromEvent({ clientX: rect.right, clientY: rect.bottom });
        assert.close(corner[0], 400, 1e-6);
        assert.close(corner[1], 300, 1e-6);
      }));

    test('fromEvent returns null for a hidden panel, never NaN',
      withStage({ hidden: true }, ({ svg, viewport }) => {
        const vp = viewport({ observe: false });
        vp.measure();
        const rect = svg.getBoundingClientRect();
        assert.equal(rect.width, 0, 'the panel really is hidden');
        assert.equal(vp.fromEvent({ clientX: 10, clientY: 10 }), null);
        assert.equal(vp.screenFromEvent({ clientX: 10, clientY: 10 }), null);
      }));

    test('an event with no usable coordinates is null, not a NaN point',
      withStage({}, ({ viewport }) => {
        const vp = viewport({ observe: false });
        vp.measure();
        assert.equal(vp.fromEvent({}), null, 'a TouchEvent has no clientX of its own');
        assert.equal(vp.fromEvent({ touches: [] , changedTouches: [] }), null);
      }));

    test('conversions write into a supplied out and never allocate',
      withStage({}, ({ svg, viewport }) => {
        const vp = viewport({ observe: false });
        vp.measure();
        const out = [0, 0];
        assert.ok(vp.toScreen([1, 1], out) === out, 'toScreen');
        assert.ok(vp.fromScreen([10, 20], out) === out, 'fromScreen');
        const rect = svg.getBoundingClientRect();
        assert.ok(vp.fromEvent({ clientX: rect.left + 4, clientY: rect.top + 4 }, out) === out,
          'fromEvent');
        // out may alias the input: index i is written only after it is read.
        const p = [0.4, -0.6];
        const expected = vp.toScreen(p);
        assert.equal(vp.toScreen(p, p), expected, 'aliased out');
      }));

    test('offsetInto and toStage map into a parent stage',
      withStage({ w: 400, h: 300, inset: [20, 10] }, ({ host, svg, viewport }) => {
        // The `box.left - bounds.left` idiom the two connection drawers each
        // spell with their own constants (realization.md §16.21).
        const vp = viewport({ observe: false });
        vp.measure();
        const [dx, dy] = vp.offsetInto(host);
        assert.close(dx, 20, 0.5, 'dx');
        assert.close(dy, 10, 0.5, 'dy');

        const centre = vp.toStage([0, 0], host);
        assert.close(centre[0], 20 + vp.cx, 0.5);
        assert.close(centre[1], 10 + vp.cy, 0.5);

        // Same scale factor as fromEvent, in the other direction: a stale CSS
        // size must not put the overlay's line in the wrong place either.
        svg.style.width = '200px';
        svg.style.height = '150px';
        const shrunk = vp.toStage([0, 0], host);
        assert.close(shrunk[0], 20 + vp.cx * 0.5, 0.5, 'viewBox units are scaled to px');
        assert.close(shrunk[1], 10 + vp.cy * 0.5, 0.5);
      }));
  });

  suite('viewport — observation', ({ test }) => {
    test('several observations in one frame produce exactly one measurement',
      withStage({}, async ({ svg, viewport, spyOn, fakeRO, entry }) => {
        const ro = fakeRO();
        let redraws = 0;
        const vp = viewport({ onResize: () => { redraws++; } });
        const spy = spyOn(vp);

        assert.equal(ro.callbacks.length, 1, 'one observer');
        assert.ok(ro.observed[0] === svg, 'observing the element by default');

        ro.callbacks[0]([entry(400, 300)]);
        ro.callbacks[0]([entry(400, 300), entry(400, 300)]);
        ro.callbacks[0]([entry(400, 300)]);
        assert.equal(spy.n, 0, 'nothing measures inside the notification');

        await settle(2);
        assert.equal(spy.n, 1, 'one measurement for three notifications');
        assert.equal(redraws, 1, 'and one redraw');
        assert.equal(vp.w, 400);
      }));

    test('a zero-size observation never measures and never redraws',
      withStage({}, async ({ viewport, spyOn, fakeRO, entry }) => {
        const ro = fakeRO();
        let redraws = 0;
        const vp = viewport({ onResize: () => { redraws++; } });
        const spy = spyOn(vp);

        ro.callbacks[0]([entry(0, 0)]);
        await settle(2);
        assert.equal(spy.n, 0, 'a hidden tab panel costs no layout read');
        assert.equal(redraws, 0, 'and no redraw');

        // The borderBoxSize spelling of the same thing.
        ro.callbacks[0]([{ target: null, borderBoxSize: [{ inlineSize: 0, blockSize: 0 }],
                           contentRect: { width: 0, height: 0 } }]);
        await settle(2);
        assert.equal(spy.n, 0);
      }));

    test('dispose() disconnects the observer and stops callbacks',
      withStage({}, async ({ viewport, spyOn, fakeRO, entry }) => {
        const ro = fakeRO();
        let redraws = 0;
        const vp = viewport({ onResize: () => { redraws++; } });
        const spy = spyOn(vp);

        vp.dispose();
        assert.equal(ro.disconnects, 1, 'the observer is detached');
        vp.dispose();
        assert.equal(ro.disconnects, 1, 'and disposing twice is a no-op');

        ro.callbacks[0]([entry(400, 300)]);   // a notification already in flight
        await settle(2);
        assert.equal(spy.n, 0, 'a late notification measures nothing');
        assert.equal(redraws, 0, 'and calls nothing back');

        vp.observe();
        assert.equal(ro.callbacks.length, 1, 'a disposed viewport cannot re-observe');
      }));

    test('observe: false attaches nothing',
      withStage({}, ({ viewport, fakeRO }) => {
        const ro = fakeRO();
        viewport({ observe: false });
        assert.equal(ro.callbacks.length, 0);
      }));

    test('a real resize measures once and reports the new box',
      withStage({ w: 400, h: 300 }, async ({ svg, viewport }) => {
        let redraws = 0;
        const vp = viewport({ onResize: () => { redraws++; } });
        await settle(3);
        const initial = redraws;
        assert.ok(initial <= 1, `at most one redraw for the first observation, saw ${initial}`);
        assert.equal(vp.w, 400, 'the observer measured the box on its own');

        svg.style.width = '260px';
        await settle(3);
        assert.equal(redraws - initial, 1, 'one redraw for one resize');
        assert.equal(vp.w, 260);
        assert.equal(svg.getAttribute('viewBox'), '0 0 260 300');

        // The write above is a mutation the observer hears; measure() skipping
        // an unchanged box is what stops it coming back round again.
        await settle(3);
        assert.equal(redraws - initial, 1, 'and no feedback loop');
      }));

    test('after dispose() a real resize changes nothing',
      withStage({ w: 400, h: 300 }, async ({ svg, viewport }) => {
        let redraws = 0;
        const vp = viewport({ onResize: () => { redraws++; } });
        await settle(3);
        vp.dispose();
        const after = redraws;

        svg.style.width = '220px';
        await settle(3);
        assert.equal(redraws, after, 'no callback after dispose');
        assert.equal(vp.w, 400, 'and no measurement either');
      }));

    test('a hidden panel never fires a redraw',
      withStage({ hidden: true }, async ({ viewport }) => {
        let redraws = 0;
        const vp = viewport({ onResize: () => { redraws++; } });
        await settle(4);
        assert.equal(redraws, 0, 'a 0x0 box must not redraw — it caches a bogus frame');
        assert.equal(vp.live, false);
      }));
  });
}
