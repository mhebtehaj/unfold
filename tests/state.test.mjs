// The store's contract: one notification per settled batch, derived values
// that recompute only when a dep moved, and a state object you can still
// inspect. Every test here is a bug the explorers have today — a redraw per
// field written, a derived quantity recomputed per reader — or a hazard the
// batching introduces — unsubscribing mid-notification, writing from inside a
// subscriber.
//
// No DOM: the store is in the pure set, so the scheduler is an argument.

import { suite, assert } from './harness.mjs';
import { createStore } from '../engine/core/state.js';

/** Stands in for the browser's frame scheduler, without a clock. */
function manual() {
  const q = [];
  return {
    schedule: run => {
      q.push(run);
      return () => { const i = q.indexOf(run); if (i >= 0) q.splice(i, 1); };
    },
    pending: () => q.length,
    run: (t = 0) => { for (const f of q.splice(0)) f(t); },
  };
}

const arrayEq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

suite('state: batching', ({ test }) => {
  test('three writes in one turn are one notification', () => {
    const clock = manual();
    const s = createStore({ a: 0, b: 0, c: 0 }, { schedule: clock.schedule });
    let calls = 0, seen = null;
    s.subscribe((_, changed) => { calls++; seen = changed; });

    s.set('a', 1);
    s.set('b', 2);
    s.set('c', 3);
    assert.equal(calls, 0, 'a deferring scheduler holds the pass');
    assert.equal(clock.pending(), 1, 'three writes arm the scheduler once');

    clock.run();
    assert.equal(calls, 1, 'one notification, not one per key');
    assert.equal([...seen].sort(), ['a', 'b', 'c']);
  });

  test('batch() coalesces under the synchronous default', () => {
    const s = createStore({ a: 0, b: 0, c: 0 });
    let calls = 0;
    s.subscribe(() => calls++);
    const changed = s.batch(() => { s.set('a', 1); s.set('b', 1); s.set('c', 1); });
    assert.equal(calls, 1);
    assert.equal(changed.sort(), ['a', 'b', 'c']);
  });

  test('update() applies a draft diff as one mutation', () => {
    const s = createStore({ yaw: 0, pitch: 0 });
    let calls = 0, seen = null;
    s.subscribe((_, changed) => { calls++; seen = [...changed].sort(); });
    const changed = s.update(d => { d.yaw = 1; d.pitch = 2; });
    assert.equal(calls, 1);
    assert.equal(changed.sort(), ['pitch', 'yaw']);
    assert.equal(seen, ['pitch', 'yaw']);
  });

  test('a write of an equal value is not a change', () => {
    const s = createStore({ a: 1 });
    let calls = 0;
    s.subscribe(() => calls++);
    assert.equal(s.set('a', 1), false);
    assert.equal(calls, 0);
    assert.equal(s.set('a', 2), true);
    assert.equal(calls, 1);
  });

  test('arrays are values unless an equals is supplied', () => {
    const loose = createStore({ bits: [1, 1, 0] });
    let n = 0;
    loose.subscribe(() => n++);
    loose.set('bits', [1, 1, 0]);
    assert.equal(n, 1, 'a fresh array is a new identity and must notify');

    const tight = createStore({ bits: [1, 1, 0] }, { equals: { bits: arrayEq } });
    let m = 0;
    tight.subscribe(() => m++);
    tight.set('bits', [1, 1, 0]);
    assert.equal(m, 0, 'an equals for the key is what makes it a value');
  });

  test('flush() runs the pending pass synchronously and cancels the scheduled one', () => {
    const clock = manual();
    const s = createStore({ a: 0 }, { schedule: clock.schedule });
    let n = 0;
    s.subscribe(() => n++);
    s.set('a', 1);
    assert.equal(n, 0);
    s.flush();
    assert.equal(n, 1);
    clock.run();
    assert.equal(n, 1, 'the cancelled pass must not fire a second time');
  });

  test('a subscriber declaring keys is called only for those keys', () => {
    const s = createStore({ a: 0, b: 0 });
    const seen = [];
    s.subscribe((_, changed) => seen.push([...changed].sort().join(',')), { keys: ['b'] });
    s.set('a', 1);
    s.set('b', 1);
    s.batch(() => { s.set('a', 2); s.set('b', 2); });
    assert.equal(seen, ['b', 'a,b'], 'keys gate the call; changed is still the whole set');
  });
});

suite('state: derived values', ({ test }) => {
  test('a derived value recomputes only when a dep changes', () => {
    let runs = 0;
    const s = createStore({ split: 'q2', opacity: 0.28 });
    s.derive('queryIndex', ['split'], st => {
      runs++;
      return st.split === 'output' ? -1 : Number(st.split.slice(-1));
    });
    assert.equal(runs, 1, 'computed at registration, so get() is never stale');
    assert.equal(s.get('queryIndex'), 2);

    s.set('opacity', 0.5);
    assert.equal(runs, 1, 'an unrelated key must not recompute it — this is the fourAmbiguity bug');

    s.set('split', 'q3');
    assert.equal(runs, 2);
    assert.equal(s.get('queryIndex'), 3);

    s.set('split', 'q3');
    assert.equal(runs, 2, 'a no-op write is not a dep change');
  });

  test('a derived value notifies only when its own result changes', () => {
    const s = createStore({ n: 0 });
    s.derive('parity', ['n'], st => st.n % 2);
    const seen = [];
    s.subscribe((_, changed) => seen.push([...changed].sort().join(',')));
    s.set('n', 2);
    s.set('n', 3);
    assert.equal(seen, ['n', 'n,parity'], '0 -> 2 leaves parity alone');
  });

  test('a derived value may depend on an earlier derived value', () => {
    const s = createStore({ n: 2 });
    s.derive('sq', ['n'], st => st.n * st.n);
    s.derive('caption', ['sq'], st => `sq=${st.sq}`);
    s.set('n', 3);
    assert.equal(s.get('caption'), 'sq=9', 'registration order is evaluation order');
  });

  test('writing a derived key throws', () => {
    const s = createStore({ split: 'q1' });
    s.derive('queryIndex', ['split'], st => Number(st.split.slice(-1)));
    assert.throws(() => s.set('queryIndex', 9));
    assert.throws(() => s.update(d => { d.queryIndex = 9; }));
  });

  test('a dep that is not a key throws at registration', () => {
    const s = createStore({ split: 'q1' });
    // A typo'd dep never fires, so the value would freeze at its first result.
    assert.throws(() => s.derive('bad', ['spilt'], () => 0));
    assert.throws(() => s.derive('split', ['split'], () => 0), 'no shadowing a stored key');
  });
});

suite('state: re-entrancy', ({ test }) => {
  test('a subscriber that unsubscribes itself does not skip the next one', () => {
    const s = createStore({ a: 0 });
    const seen = [];
    let off;
    off = s.subscribe(() => { seen.push('first'); off(); });
    s.subscribe(() => seen.push('second'));
    s.set('a', 1);
    assert.equal(seen, ['first', 'second']);
    s.set('a', 2);
    assert.equal(seen, ['first', 'second', 'second'], 'and it really is gone');
  });

  test('a subscriber removed by an earlier one is not called in that pass', () => {
    const s = createStore({ a: 0 });
    const seen = [];
    let offSecond;
    s.subscribe(() => { seen.push('first'); offSecond(); });
    offSecond = s.subscribe(() => seen.push('second'));
    s.subscribe(() => seen.push('third'));
    s.set('a', 1);
    assert.equal(seen, ['first', 'third']);
  });

  test('a write inside a subscriber is notified on the next pass, not re-entrantly', () => {
    const s = createStore({ a: 0, b: 0 });
    const passes = [];
    s.subscribe((st, changed) => {
      passes.push([...changed].sort().join(','));
      if (changed.has('a')) s.set('b', st.a * 2);
    });
    s.set('a', 3);
    assert.equal(passes, ['a', 'b'], 'the pass finishes before the cascade runs');
    assert.equal(s.get('b'), 6);
  });

  test('an unbounded write loop throws and names the key', () => {
    const s = createStore({ n: 0 });
    s.subscribe(st => s.set('n', st.n + 1));
    let message = '';
    try { s.set('n', 1); } catch (e) { message = e.message; }
    assert.ok(/did not settle/.test(message), message || 'expected a throw');
    assert.ok(/\bn\b/.test(message), `expected the churning key in: ${message}`);
  });

  test('on(key) reports the value before the batch', () => {
    const s = createStore({ opacity: 0.28, yaw: 0 });
    const seen = [];
    s.on('opacity', (v, prev) => seen.push([v, prev]));
    s.set('yaw', 1);
    assert.equal(seen, [], 'other keys do not wake it');
    s.set('opacity', 0.5);
    s.batch(() => { s.set('opacity', 0.1); s.set('opacity', 0.2); });
    assert.equal(seen, [[0.5, 0.28], [0.2, 0.5]]);
  });
});

suite('state: frames', ({ test }) => {
  test('one render per scheduled pass, with the union of levels and keys', () => {
    const clock = manual();
    const s = createStore({ opacity: 1, yaw: 0 }, { schedule: clock.schedule });
    const calls = [];
    const f = s.frame(
      info => calls.push({ levels: [...info.levels].sort(), keys: [...info.keys].sort(), time: info.time }),
      { levels: ['all', 'style'] });
    s.subscribe(() => f.request('all'));
    s.on('opacity', () => f.request('style'));

    s.set('opacity', 0.5);
    s.set('yaw', 1);
    clock.run(16);

    assert.equal(calls.length, 1, 'two writes and two requests are still one render');
    assert.equal(calls[0].levels, ['all', 'style']);
    assert.equal(calls[0].keys, ['opacity', 'yaw']);
    assert.equal(calls[0].time, 16, 'the scheduler supplies the timestamp');
  });

  test('levels and keys are cleared after each render', () => {
    const clock = manual();
    const s = createStore({ a: 0 }, { schedule: clock.schedule });
    const calls = [];
    const f = s.frame(info => calls.push([...info.keys]));
    s.subscribe(() => f.request());
    s.set('a', 1);
    clock.run();
    s.set('a', 2);
    clock.run();
    assert.equal(calls, [['a'], ['a']], 'not accumulated across renders');
  });

  test('an undeclared level throws rather than silently widening the redraw', () => {
    const s = createStore({ a: 0 });
    const f = s.frame(() => {}, { levels: ['all', 'style'] });
    assert.throws(() => f.request('styel'));
  });

  test('flushNow renders a pending request once', () => {
    const clock = manual();
    const s = createStore({ a: 0 }, { schedule: clock.schedule });
    let n = 0;
    const f = s.frame(() => n++);
    f.request();
    assert.equal(n, 0);
    f.flushNow();
    assert.equal(n, 1);
    clock.run();
    assert.equal(n, 1, 'the scheduled pump must not render it again');
  });

  test('cancel() drops a pending render', () => {
    const clock = manual();
    const s = createStore({ a: 0 }, { schedule: clock.schedule });
    let n = 0;
    const f = s.frame(() => n++);
    f.request();
    f.cancel();
    clock.run();
    assert.equal(n, 0);
  });
});

suite('state: debuggability', ({ test }) => {
  test('the state is a plain inspectable object', () => {
    const s = createStore({ a: 1, bits: [1, 1, 0] });
    s.derive('ones', ['bits'], st => st.bits.filter(Boolean).length);
    const st = s.get();

    assert.equal(Object.getPrototypeOf(st), Object.prototype, 'no exotic wrapper');
    assert.ok(!Object.getOwnPropertyDescriptor(st, 'ones').get,
      'a derived value is stored, not a getter that lies to the debugger');
    assert.equal(Object.getOwnPropertyDescriptor(st, 'a').value, 1);
    assert.equal(s.get(), st, 'the same object every call');
    assert.equal(s.get('a'), 1, 'single-key overload');
    assert.equal(JSON.parse(JSON.stringify(st)), { a: 1, bits: [1, 1, 0], ones: 2 });
  });

  test('snapshot is a copy, restore recomputes derived values', () => {
    const s = createStore({ bits: [1, 1, 0], k: 1 }, { equals: { bits: arrayEq } });
    s.derive('ones', ['bits'], st => st.bits.filter(Boolean).length);
    const snap = s.snapshot();

    s.set('bits', [0, 0, 0]);
    assert.equal(snap.bits, [1, 1, 0], 'the snapshot is not a live view');
    assert.equal(s.get('ones'), 0);

    s.restore(snap);
    assert.equal(s.get('bits'), [1, 1, 0]);
    assert.equal(s.get('ones'), 2, 'derived keys in the snapshot are ignored and recomputed');
  });

  test('strict mode refuses an undeclared key', () => {
    const s = createStore({ a: 1 });
    assert.throws(() => s.set('typo', 1));
    const loose = createStore({ a: 1 }, { strict: false });
    loose.set('b', 2);
    assert.equal(loose.get('b'), 2);
  });

  test('dispose stops notifications and refuses writes', () => {
    const s = createStore({ a: 0 }, { name: 'ambiguity' });
    let n = 0;
    s.subscribe(() => n++);
    s.dispose();
    assert.throws(() => s.set('a', 1));
    assert.equal(n, 0);
    assert.equal(s.get('a'), 0, 'reads still work on a disposed store');
  });

  test('the name appears in the error a page will actually read', () => {
    const s = createStore({ a: 0 }, { name: 'ambiguity' });
    let message = '';
    try { s.set('typo', 1); } catch (e) { message = e.message; }
    assert.ok(/^ambiguity\./.test(message), message);
  });
});
