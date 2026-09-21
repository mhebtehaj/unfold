// core/probe.js — the assertion surface, asserted.
//
// Four claims here are the module's whole reason to exist, and each one is a
// way the idea fails if it is merely *mostly* true.
//
// A disabled probe must not invoke a thunk. That is the only thing standing
// between "on by default in production" and a page that builds a full scene
// description sixty times a second for nobody, so it is pinned with a spy
// rather than inspected by eye.
//
// Serialization must be byte-stable. A harness diffing snapshots is worthless
// the first time two runs that describe the same scene disagree about key
// order or the fourteenth decimal, so the same fields are set in two different
// orders and the strings are compared, not the objects.
//
// A no-op commit must write nothing. `rev` is inside the payload, so the naive
// implementation — serialize, compare, write — differs from the last frame by
// its own counter and writes every frame forever. Asserted through a
// MutationObserver, because "the attribute has the same value" and "the
// attribute was not written" are different facts and only the second one keeps
// a rev-watching harness quiet.
//
// And every enablement trigger must be live. Captured at import, they cannot
// be driven by a test, which is how a disabled-path bug survives to production.

import { suite, assert } from './harness.mjs';
import {
  LAYER, createProbe, probeEnabled,
  readProbe, waitForProbe, probeSelector, assertProbe, harness,
} from '../engine/core/probe.js';

register();

function register() {
  // Registered only in a browser: every case here needs a real element, a real
  // rAF and a real MutationObserver. The file still has to import cleanly under
  // node (tools/check-layers.mjs, editors), where it registers zero suites.
  if (typeof document === 'undefined') return;

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const hosts = [];

  /** An <svg> host, like the one a scene hands createProbe(). */
  function host(attach = false) {
    const n = document.createElementNS(SVG_NS, 'svg');
    if (attach) { document.body.appendChild(n); hosts.push(n); }
    return n;
  }
  const drop = () => { for (const n of hosts.splice(0)) n.remove(); };

  const mk = (o = {}) => createProbe(host(o.attach), { id: 'probe-test', enabled: true, ...o });

  const raf = () => new Promise(r => requestAnimationFrame(() => r()));
  const tick = () => new Promise(r => setTimeout(r, 0));
  /** The frame a commit() was scheduled into, plus the microtask drain that
   *  delivers MutationObserver records. */
  const settle = async () => { await raf(); await tick(); };

  /** Records every attribute mutation on `el` until stop() is called. */
  function watch(el) {
    const seen = [];
    const obs = new MutationObserver(recs => seen.push(...recs.map(r => r.attributeName)));
    obs.observe(el, { attributes: true });
    return { seen, stop: () => { obs.disconnect(); return seen; } };
  }

  suite('probe — disabled costs nothing', ({ test }) => {
    test('a thunk passed to set() is never invoked', async () => {
      const p = createProbe(host(), { id: 'off', enabled: false });
      let calls = 0;
      const spy = () => { calls++; return { expensive: true }; };

      p.set('domain.off', spy);
      p.merge({ domain: { other: spy } });
      p.commit();
      await settle();
      p.snapshot();

      assert.equal(calls, 0, 'the whole reason the API takes a thunk');
      assert.equal(p.enabled, false);
    });

    test('commit() writes no attribute at all', async () => {
      const el = host();
      const p = createProbe(el, { id: 'off', enabled: false });
      const w = watch(el);
      p.set('camera.yaw', 1);
      p.count('marks.face', 3);
      p.record('labels.droppedIds', 'f:101');
      p.warn('something');
      p.commit();
      await settle();

      assert.equal(w.stop().length, 0, 'not one mutation');
      assert.equal(el.attributes.length, 0, 'not even data-probe-id');
    });

    test('a disabled probe still snapshots, and says so', () => {
      const p = createProbe(host(), { id: 'off', enabled: false });
      p.set('camera.yaw', 1);
      assert.equal(p.snapshot(), { schema: 1, id: 'off', rev: 0, warnings: [] });
      assert.equal(p.rev, 0);
    });

    test('nextRev rejects at once rather than hanging for the timeout', async () => {
      const p = createProbe(host(), { id: 'off', enabled: false });
      let err = null;
      try { await p.nextRev(); } catch (e) { err = e; }
      assert.ok(err, 'a disabled probe will never commit, so waiting is a bug worth naming');
      assert.ok(/disabled/.test(err.message), err.message);
    });
  });

  suite('probe — the committed attribute', ({ test }) => {
    test('data-probe parses as JSON in the schema shape', async () => {
      const el = host();
      const p = createProbe(el, { id: 'ambiguity', enabled: true });
      assert.equal(el.getAttribute('data-probe-id'), 'ambiguity',
        'the handle exists before the first draw');

      p.set('camera.yaw', 0.72);
      p.set('viewport', { w: 640, h: 390, live: true });
      p.commit();
      await settle();

      const got = readProbe(el);
      assert.equal(got.schema, 1);
      assert.equal(got.id, 'ambiguity');
      assert.equal(got.rev, 1);
      assert.equal(got.camera.yaw, 0.72);
      assert.equal(got.viewport.w, 640);
      assert.equal(got.warnings, []);
      assert.equal(el.getAttribute('data-probe-rev'), '1', 'the cheap mirror');
      assert.equal(got, p.snapshot(), 'the attribute and snapshot() are the same object');
    });

    test('three commits in one frame are one write', async () => {
      const el = host();
      const p = createProbe(el, { id: 'coalesce', enabled: true });
      p.set('camera.yaw', 1); p.commit();
      p.set('camera.pitch', 2); p.commit();
      p.set('camera.roll', 3); p.commit();
      const w = watch(el);
      await settle();

      assert.equal(w.stop(), ['data-probe', 'data-probe-rev'], 'one write, not three');
      assert.equal(p.rev, 1);
      assert.equal(readProbe(el).camera, { pitch: 2, roll: 3, yaw: 1 });
    });

    test('a no-op commit advances nothing and writes nothing', async () => {
      const el = host();
      const p = createProbe(el, { id: 'noop', enabled: true });
      p.set('camera.yaw', 0.5);
      p.count('marks.face', 8);
      p.commit();
      await settle();
      const before = el.getAttribute('data-probe');
      assert.equal(p.rev, 1);

      // The draw loop, doing exactly what it did last frame.
      const w = watch(el);
      p.reset();
      p.set('camera.yaw', 0.5);
      p.count('marks.face', 8);
      p.commit();
      await settle();

      assert.equal(w.stop().length, 0, 'an identical frame must not touch the DOM');
      assert.equal(p.rev, 1, 'and must not spend a revision');
      assert.equal(el.getAttribute('data-probe'), before);

      // …and a frame that did move still lands.
      p.set('camera.yaw', 0.6);
      p.commit();
      await settle();
      assert.equal(p.rev, 2);
      assert.equal(readProbe(el).camera.yaw, 0.6);
    });

    test('reset() publishes a commit still pending from the frame on screen', async () => {
      const el = host();
      const p = createProbe(el, { id: 'flush', enabled: true });
      p.set('marks.face', 3);
      p.commit();                       // scheduled, not yet run
      p.reset();                        // the next draw starts

      assert.equal(p.rev, 1, 'the frame that was drawn is published, not discarded');
      assert.equal(readProbe(el).marks.face, 3);
      await settle();
      assert.equal(p.rev, 1, 'the cancelled frame does not fire a second time');
      assert.equal(p.snapshot().marks, undefined, 'and the payload is clear');
    });
  });

  suite('probe — deterministic serialization', ({ test }) => {
    test('the same fields in two orders produce byte-identical JSON', () => {
      const a = createProbe(host(), { id: 'det', enabled: true });
      const b = createProbe(host(), { id: 'det', enabled: true });

      a.set('camera.yaw', 0.72);
      a.set('viewport.w', 640);
      a.count('marks.face', 3);
      a.merge({ state: { view: 'all', space: 'three' } });
      a.count('marks.edge', 2);
      a.set('domain.ambiguity', () => ({ seamEdges: 6, depth: 2 }));

      b.set('domain.ambiguity', () => ({ depth: 2, seamEdges: 6 }));
      b.count('marks.edge', 1);
      b.merge({ state: { space: 'three' } });
      b.count('marks.face', 3);
      b.set('viewport.w', 640);
      b.merge({ state: { view: 'all' } });
      b.count('marks.edge', 1);
      b.set('camera.yaw', 0.72);

      assert.equal(JSON.stringify(a.snapshot()), JSON.stringify(b.snapshot()),
        'key order must not depend on which writer got there first');
    });

    test('top-level keys come out in the declared order', () => {
      const p = mk({ id: 'order' });
      p.merge({ domain: { x: 1 }, camera: { yaw: 0 }, viewport: { w: 1 }, seamEdges: 6 });
      assert.equal(Object.keys(p.snapshot()),
        ['schema', 'id', 'rev', 'viewport', 'camera', 'domain', 'warnings', 'seamEdges'],
        'undeclared keys sort after warnings, where a missing namespace is obvious');
    });

    test('nested object keys are sorted, arrays keep their order', () => {
      const p = mk({ id: 'sorted' });
      p.set('passes', { order: ['faces', 'edges', 'points'], mode: 'stratified' });
      const s = p.snapshot();
      assert.equal(Object.keys(s.passes), ['mode', 'order']);
      assert.equal(s.passes.order, ['faces', 'edges', 'points'], 'a pass plan IS its order');
    });

    test('numbers are rounded to digits and -0 never appears', () => {
      const p = mk({ id: 'round', digits: 4 });
      p.set('camera.yaw', 0.123456789);
      p.set('camera.pitch', -0.00001);
      p.set('camera.roll', -0);
      p.set('layers', [{ name: 'faces', z: -0.000004 }]);
      const s = p.snapshot();

      assert.equal(s.camera.yaw, 0.1235, 'rounded, not truncated');
      assert.ok(Object.is(s.camera.pitch, 0), 'a rounded -0 is 0');
      assert.ok(Object.is(s.camera.roll, 0));
      assert.ok(Object.is(s.layers[0].z, 0), 'inside arrays too');
      assert.ok(!JSON.stringify(s).includes('-0'), JSON.stringify(s));
    });

    test('digits is configurable', () => {
      const p = mk({ id: 'digits', digits: 2 });
      p.set('camera.yaw', 0.123456789);
      assert.equal(p.snapshot().camera.yaw, 0.12);
    });

    test('NaN and Infinity get their own spelling, never null', () => {
      const p = mk({ id: 'nonfinite' });
      p.set('domain.t', { nan: NaN, pos: Infinity, neg: -Infinity });
      const s = p.snapshot();
      assert.equal(s.domain.t.nan, 'NaN');
      assert.equal(s.domain.t.pos, 'Infinity');
      assert.equal(s.domain.t.neg, '-Infinity');
      assert.ok(!JSON.stringify(s).includes('null'),
        'null reads as "the scene had nothing to say", which is the opposite of the truth');
    });

    test('a cycle is named, not a stack overflow in the draw loop', () => {
      const p = mk({ id: 'cycle' });
      const loop = { name: 'a' };
      loop.self = loop;
      p.set('domain.loop', loop);
      assert.equal(p.snapshot().domain.loop, { name: 'a', self: '[cycle]' });
    });
  });

  suite('probe — accumulation and reset', ({ test }) => {
    test('count accumulates within a draw and reset clears it', () => {
      const p = mk({ id: 'counts' });
      p.count('marks.face');
      p.count('marks.face', 7);
      p.count('marks.edge', 2);
      assert.equal(p.snapshot().marks, { edge: 2, face: 8 });

      p.commit();
      p.reset();
      assert.equal(p.snapshot().marks, undefined, 'counters are per-draw');
      assert.equal(p.snapshot().id, 'counts', 'identity survives');
      assert.equal(p.snapshot().warnings, []);
    });

    test('reset keeps rev, so a harness watching it is never rewound', async () => {
      const p = mk({ id: 'revkeep' });
      p.set('camera.yaw', 1); p.commit(); await settle();
      assert.equal(p.rev, 1);
      p.reset();
      p.set('camera.yaw', 2); p.commit(); await settle();
      assert.equal(p.rev, 2);
    });

    test('record appends in order', () => {
      const p = mk({ id: 'records' });
      p.record('labels.droppedIds', 'f:101');
      p.record('labels.droppedIds', 'f:011');
      p.record('labels.droppedIds', 'f:111');
      assert.equal(p.snapshot().labels.droppedIds, ['f:101', 'f:011', 'f:111'],
        'the order of a dropped-label list is the assertion');
      p.reset();
      assert.equal(p.snapshot().labels, undefined);
    });

    test('warn lands in warnings[]', () => {
      const p = mk({ id: 'warns' });
      p.warn('label dropped with no leader');
      p.warn('occlusion fell back', { mode: 'bbox' });
      assert.equal(p.snapshot().warnings, [
        { msg: 'label dropped with no leader' },
        { detail: { mode: 'bbox' }, msg: 'occlusion fell back' },
      ]);
    });

    test('a thunk is resolved at snapshot time, so it is never stale', () => {
      const p = mk({ id: 'lazy' });
      let n = 1;
      p.set('domain.live', () => ({ n }));
      assert.equal(p.snapshot().domain.live, { n: 1 });
      n = 2;
      assert.equal(p.snapshot().domain.live, { n: 2 });
    });
  });

  suite('probe — domain namespacing', ({ test }) => {
    test('a domain-contributed key lands under domain, never at the top level', () => {
      const p = mk({ id: 'ambiguity' });
      p.set('domain.ambiguity', () => ({ seamEdges: 6, faces: [[], [0], [3]], depth: 2 }));
      p.merge({ domain: { tcs: { queryModel: 'q2' } } });
      const s = p.snapshot();

      assert.equal(s.domain.ambiguity.seamEdges, 6);
      assert.equal(s.domain.tcs.queryModel, 'q2');
      assert.equal(s.seamEdges, undefined, 'this is the whole point of the namespace');
      assert.equal(s.ambiguity, undefined);
      assert.equal(s.queryModel, undefined);
      assert.equal(Object.keys(s), ['schema', 'id', 'rev', 'domain', 'warnings'],
        'nothing a domain module wrote reached the top level');
    });

    test('two domains merge instead of overwriting each other', () => {
      const p = mk({ id: 'two' });
      p.set('domain.ambiguity.seamEdges', 6);
      p.set('domain.topology.genus', 2);
      assert.equal(p.snapshot().domain, { ambiguity: { seamEdges: 6 }, topology: { genus: 2 } });
    });
  });

  suite('probe — nextRev', ({ test }) => {
    test('resolves on the next commit past rev', async () => {
      const p = mk({ id: 'next' });
      const before = p.rev;
      const waiting = p.nextRev();
      p.set('camera.yaw', 1);
      p.commit();
      const got = await waiting;
      assert.equal(got.rev, before + 1);
      assert.equal(got.camera.yaw, 1);
      assert.equal(p.rev, before + 1);
    });

    test('an already-advanced rev resolves without waiting for another frame', async () => {
      const p = mk({ id: 'past' });
      p.set('camera.yaw', 1); p.commit(); await settle();
      const got = await p.nextRev({ rev: 0, timeout: 0 });
      assert.equal(got.rev, 1);
    });

    test('rejects on timeout rather than handing back the stale snapshot', async () => {
      const p = mk({ id: 'timeout' });
      p.set('camera.yaw', 1); p.commit(); await settle();
      let err = null, resolved = null;
      try { resolved = await p.nextRev({ timeout: 30 }); } catch (e) { err = e; }
      assert.equal(resolved, null, 'resolving would report a pass on a frame that never happened');
      assert.ok(err && /no commit past rev 1 within 30ms/.test(err.message), String(err));
    });

    test('a no-op commit does not satisfy a waiter', async () => {
      const p = mk({ id: 'noopwait' });
      p.set('camera.yaw', 1); p.commit(); await settle();
      let err = null;
      const waiting = p.nextRev({ timeout: 40 }).catch(e => { err = e; });
      p.commit();                      // nothing changed
      await settle();
      await waiting;
      assert.ok(err, 'rev did not advance, so nothing was waiting for');
    });

    test('dispose rejects a pending wait and takes the attributes with it', async () => {
      const el = host();
      const p = createProbe(el, { id: 'gone', enabled: true });
      p.set('camera.yaw', 1); p.commit(); await settle();
      let err = null;
      const waiting = p.nextRev({ timeout: 0 }).catch(e => { err = e; });
      p.dispose();
      await waiting;

      assert.ok(err && /disposed/.test(err.message), String(err));
      assert.equal(el.attributes.length, 0, 'no attribute left describing a torn-down scene');
      assert.equal(p.enabled, false);
    });
  });

  suite('probe — probeEnabled triggers', ({ test }) => {
    const root = document.documentElement;

    /** Every trigger is read live, so every trigger can be driven — and restored. */
    function withEnv(fn) {
      const had = root.hasAttribute('data-unfold-probe');
      const was = root.getAttribute('data-unfold-probe');
      const hadFlag = '__UNFOLD_PROBE__' in globalThis;
      const flag = globalThis.__UNFOLD_PROBE__;
      const url = location.pathname + location.search + location.hash;
      const query = q => history.replaceState(null, '', location.pathname + q + location.hash);
      try {
        return fn(query);
      } finally {
        if (had) root.setAttribute('data-unfold-probe', was); else root.removeAttribute('data-unfold-probe');
        if (hadFlag) globalThis.__UNFOLD_PROBE__ = flag; else delete globalThis.__UNFOLD_PROBE__;
        history.replaceState(null, '', url);
      }
    }

    // §2.8's production policy and the spec's Q1 both settle the default as ON:
    // a published page describes its own rendered scene, and the three triggers
    // are opt-OUT plus an explicit force-on. A probe that must be switched on
    // is off in exactly the case you wanted it — a reader reporting that a live
    // page looks wrong.
    test('on by default, and each trigger can still force it on', () => {
      withEnv(query => {
        assert.equal(probeEnabled(), true, 'no trigger needed — on is the default');

        root.setAttribute('data-unfold-probe', '');
        assert.equal(probeEnabled(), true, 'data-unfold-probe on <html>');
        root.removeAttribute('data-unfold-probe');
        assert.equal(probeEnabled(), true);

        query('?probe');
        assert.equal(probeEnabled(), true, '?probe in the query string');
        query('');
        assert.equal(probeEnabled(), true);

        globalThis.__UNFOLD_PROBE__ = true;
        assert.equal(probeEnabled(), true, 'the global injection point');
        globalThis.__UNFOLD_PROBE__ = 1;
        assert.equal(probeEnabled(), true, 'a truthy non-true neither forces nor kills');
        globalThis.__UNFOLD_PROBE__ = false;
        assert.equal(probeEnabled(), false, '=== false is the kill switch');
      });
    });

    test('an explicit off wins over every enable', () => {
      withEnv(query => {
        root.setAttribute('data-unfold-probe', 'off');
        assert.equal(probeEnabled(), false);
        query('?probe');
        assert.equal(probeEnabled(), false, 'the page said off');
        root.removeAttribute('data-unfold-probe');
        assert.equal(probeEnabled(), true);

        query('?probe=0');
        assert.equal(probeEnabled(), false, '?probe=0 disables, per the production policy');
        globalThis.__UNFOLD_PROBE__ = true;
        assert.equal(probeEnabled(), false, 'and it beats the global too');

        query('?probe=1');
        globalThis.__UNFOLD_PROBE__ = false;
        assert.equal(probeEnabled(), false, 'the global kill switch');
      });
    });

    test('createProbe takes its default from it', () => {
      withEnv(() => {
        globalThis.__UNFOLD_PROBE__ = true;
        assert.equal(createProbe(host(), { id: 'default-on' }).enabled, true);
        globalThis.__UNFOLD_PROBE__ = false;
        assert.equal(createProbe(host(), { id: 'default-off' }).enabled, false);
        assert.equal(createProbe(host(), { id: 'explicit', enabled: true }).enabled, true,
          'an explicit option still wins');
      });
    });
  });

  suite('probe — the harness side', ({ test }) => {
    test('probeSelector finds the host that createProbe marked', async () => {
      const el = host(true);
      try {
        const p = createProbe(el, { id: 'ambiguity', enabled: true });
        assert.equal(probeSelector('ambiguity'), '[data-probe-id="ambiguity"]');
        assert.ok(document.querySelector(probeSelector('ambiguity')) === el);

        p.set('camera.yaw', 0.72);
        p.commit();
        await settle();
        assert.equal(readProbe(probeSelector('ambiguity')).camera.yaw, 0.72);
      } finally { drop(); }
    });

    test('readProbe names why there is nothing to read', () => {
      assert.throws(() => readProbe(host()), 'no data-probe yet');
      assert.throws(() => readProbe('[data-probe-id="nobody"]'), 'no such element');
    });

    test('waitForProbe resolves on the next rev', async () => {
      const el = host(true);
      try {
        const p = createProbe(el, { id: 'waiting', enabled: true });
        p.set('camera.yaw', 1); p.commit(); await settle();

        const waiting = waitForProbe(probeSelector('waiting'), { rev: p.rev, timeout: 500 });
        p.set('camera.yaw', 2); p.commit();
        const got = await waiting;
        assert.equal(got.rev, 2);
        assert.equal(got.camera.yaw, 2);
      } finally { drop(); }
    });

    test('waitForProbe rejects when no frame arrives', async () => {
      const el = host(true);
      try {
        createProbe(el, { id: 'never', enabled: true });
        let err = null;
        try { await waitForProbe(el, { timeout: 30 }); } catch (e) { err = e; }
        assert.ok(err && /within 30ms/.test(err.message), String(err));
      } finally { drop(); }
    });

    test('assertProbe is a deep subset with tolerance', () => {
      const actual = {
        schema: 1, id: 'ambiguity', rev: 7,
        camera: { yaw: 0.43629, pitch: 0 },
        marks: { face: 8, edge: 14 },
        layers: [{ name: 'faces', count: 8 }],
        warnings: [],
      };
      assert.equal(assertProbe(actual, { camera: { yaw: 0.4363 } }).pass, true,
        'a rounded value is the same answer');
      assert.equal(assertProbe(actual, { camera: { yaw: 0.4363 } }, { tolerance: 1e-9 }).pass, false);
      assert.equal(assertProbe(actual, { id: /ambig/ }).pass, true, 'RegExp against a string');
      assert.equal(assertProbe(actual, { marks: { face: n => n > 4 } }).pass, true, 'a predicate');
      assert.equal(assertProbe(actual, { layers: [{ name: 'faces' }] }).pass, true,
        'arrays compare element-wise, objects by subset');
      assert.equal(assertProbe(actual, { warnings: [] }).pass, true);
    });

    test('assertProbe names the path of each failure', () => {
      const actual = { camera: { yaw: 1 }, warnings: [{ msg: 'x' }], marks: { face: 8 } };
      const r = assertProbe(actual, { camera: { yaw: 2 }, warnings: [] });
      assert.equal(r.pass, false);
      assert.equal(r.failures.map(f => f.path), ['camera.yaw', 'warnings.length'],
        'an empty expected array means none, not at-least-none');
      assert.equal(r.failures[0], { path: 'camera.yaw', expected: 2, actual: 1 });
      assert.equal(assertProbe(actual, { camera: 3 }).failures[0].path, 'camera');
      assert.equal(assertProbe(actual, { missing: { a: 1 } }).failures[0].path, 'missing');
    });

    test('harness runs cases and leaves its verdict on the host', async () => {
      const el = host();
      const p = createProbe(el, { id: 'runner', enabled: true });
      p.set('camera.yaw', 0.72);
      p.count('marks.face', 8);

      const green = await harness(p, [
        { name: 'yaw is what the camera said', expect: { camera: { yaw: 0.72 } } },
        { name: 'no warnings', expect: { warnings: [] } },
      ]);
      assert.equal(green.pass, true);
      assert.equal(el.getAttribute('data-probe-status'), 'pass');

      const red = await harness(p, [
        { name: 'eight faces', expect: { marks: { face: 8 } } },
        { name: 'nine faces', expect: { marks: { face: 9 } } },
      ]);
      assert.equal(red.pass, false);
      assert.equal(el.getAttribute('data-probe-status'), 'fail');
      const report = JSON.parse(el.getAttribute('data-probe-report'));
      assert.equal(report.map(r => r.pass), [true, false]);
      assert.equal(report[1].failures[0].path, 'marks.face');
    });

    test('harness waits for the frame its setup provoked', async () => {
      const p = mk({ id: 'setup' });
      const r = await harness(p, [
        {
          name: 'a setup that redraws',
          setup: () => { p.reset(); p.set('camera.yaw', 2); p.commit(); },
          expect: { camera: { yaw: 2 }, rev: n => n >= 1 },
        },
        {
          name: 'a setup that changes nothing still gets an answer',
          setup: () => { p.commit(); },
          timeout: 40,
          expect: { camera: { yaw: 2 } },
        },
      ]);
      assert.equal(r.results.map(x => x.pass), [true, true]);
    });

    test('harness refuses a disabled probe instead of failing every case', async () => {
      const p = createProbe(host(), { id: 'off', enabled: false });
      let err = null;
      try { await harness(p, [{ name: 'x', expect: {} }]); } catch (e) { err = e; }
      assert.ok(err && /disabled/.test(err.message), String(err));
    });
  });

  suite('probe — invariants', ({ test }) => {
    test('LAYER is 0', () => assert.equal(LAYER, 0));

    test('a probe with no host or no id is a scene no harness can find', () => {
      assert.throws(() => createProbe(null, { id: 'x' }), 'no host');
      assert.throws(() => createProbe(host(), {}), 'no id');
      assert.throws(() => createProbe(host(), { id: 'x', digits: 99 }), 'digits out of range');
    });

    test('two writers disagreeing about a name throws in dev', () => {
      const p = mk({ id: 'collide' });
      p.set('camera', 3);
      assert.throws(() => p.set('camera.yaw', 1), 'a scalar is in the way');

      // A published page keeps drawing; the structured value wins.
      const was = globalThis.UNFOLD_DEV;
      globalThis.UNFOLD_DEV = false;
      try {
        p.set('camera.yaw', 1);
        assert.equal(p.snapshot().camera, { yaw: 1 });
      } finally {
        if (was === undefined) delete globalThis.UNFOLD_DEV; else globalThis.UNFOLD_DEV = was;
      }
    });
  });
}
