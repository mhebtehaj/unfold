// core/anim.js — the cancellation token, absolute interpolation, and the motion
// policy that four of the site's five rAF loops currently do not honour.
//
// These run in a browser (tools/run-tests.mjs) because a real
// requestAnimationFrame is the thing under test. Under node the module is
// importable and registers nothing.

import { suite, assert } from './harness.mjs';
import {
  LAYER, Animator, smoothstep, smootherstep, linear, easeOutCubic,
} from '../engine/core/anim.js';

const DOM = typeof document !== 'undefined';

const frame = () => new Promise(res => requestAnimationFrame(() => res()));
const frames = async n => { for (let i = 0; i < n; i++) await frame(); };
const sleep = ms => new Promise(res => setTimeout(res, ms));

/** A MediaQueryList stand-in, so a test can change the preference mid-session. */
const mq = matches => {
  const bus = new EventTarget();
  return {
    matches,
    addEventListener: (...a) => bus.addEventListener(...a),
    removeEventListener: (...a) => bus.removeEventListener(...a),
    emit(v) { this.matches = v; bus.dispatchEvent(new Event('change')); },
  };
};

/** Every animator is disposed, so one leaked listener cannot colour a later test. */
const withAnimator = (opts, fn) => async () => {
  const a = new Animator({ pauseOnHidden: false, motionQuery: mq(false), ...opts });
  try { return await fn(a); } finally { a.dispose(); }
};

if (DOM) suite('anim', ({ test }) => {
  test('declares its layer', () => assert.equal(LAYER, 0));

  // -- easings ------------------------------------------------------------

  test('every easing pins its endpoints and is strictly increasing', () => {
    const grid = Array.from({ length: 129 }, (_, i) => i / 128);
    for (const [name, ease] of Object.entries({ linear, smoothstep, smootherstep, easeOutCubic })) {
      assert.equal(ease(0), 0, `${name}(0)`);
      assert.equal(ease(1), 1, `${name}(1)`);
      const v = grid.map(ease);
      assert.all(v.slice(1), (x, i) => x > v[i], `${name} is not monotonic`);
    }
  });

  test('smoothstep is t*t*(3-2*t)', () => {
    assert.equal(smoothstep(0.5), 0.5);
    assert.close(smoothstep(0.25), 0.15625, 1e-12);
  });

  // -- cancellation -------------------------------------------------------

  test('a superseded run stops on its next frame and never writes again',
    withAnimator({}, async a => {
      let target = 0, firstWrites = 0;
      const first = a.run({
        duration: 600, label: 'first',
        onFrame: s => { firstWrites++; target = 100 * s; },
      });
      await frames(2);
      const wrote = firstWrites;
      assert.ok(wrote > 0, 'the first run never started');

      const second = a.run({ duration: 60, label: 'second', onFrame: s => { target = 200 * s; } });
      assert.equal(first.done, true, 'starting a run must retire the previous one at once');
      assert.equal((await first.finished).completed, false);

      await second.finished;
      await frames(3);
      assert.equal(firstWrites, wrote, 'the retired run wrote again after being superseded');
      // Exact, not close: smoothstep(1) is exactly 1, so absolute interpolation
      // lands on the destination rather than near it.
      assert.equal(target, 200, 'the value must be the second call destination');
    }));

  test('cancelAll retires transients and leaves playbacks alone',
    withAnimator({}, async a => {
      let runs = 0, plays = 0;
      const h = a.run({ duration: 900, onFrame: () => { runs++; } });
      const pb = a.loop({ duration: 9000, onFrame: () => { plays++; } });
      await frames(2);
      a.cancelAll();
      const atRun = runs, atPlay = plays;
      await frames(3);
      assert.equal(runs, atRun, 'cancelAll must retire the transient');
      assert.equal(h.done, true);
      assert.ok(plays > atPlay, 'a camera move must not be able to kill a playback');
      assert.equal(pb.playing, true);

      a.cancelAll({ playbacks: true });
      assert.equal(pb.playing, false);
      const held = plays;
      await frames(3);
      assert.equal(plays, held);
      pb.dispose();
    }));

  test('a handle can be cancelled individually', withAnimator({}, async a => {
    let n = 0;
    const h = a.run({ duration: 900, onFrame: () => { n++; } });
    await frames(2);
    a.cancel(h);
    assert.equal(h.done, true);
    const at = n;
    await frames(3);
    assert.equal(n, at);
    assert.equal((await h.finished).completed, false, 'a cancelled handle must still settle');
  }));

  // -- absolute interpolation ---------------------------------------------

  test('an uneven clock still lands exactly on the end value', async () => {
    let clock = 0;
    const a = new Animator({ pauseOnHidden: false, motionQuery: mq(false), now: () => clock });
    try {
      // Frames of 7, 3, 41, 2, 19 and 96 ms: a dropped frame and a long stall.
      // Incremental accumulation would drift; absolute interpolation cannot.
      const gaps = [7, 3, 41, 2, 19, 96];
      const seen = [];
      let i = 0;
      const start = clock;
      const h = a.run({
        duration: 100,
        onFrame: (s, t) => {
          seen.push({ s, t, want: Math.min(1, (clock - start) / 100) });
          clock += gaps[i++ % gaps.length];
        },
      });
      assert.equal((await h.finished).completed, true);
      assert.ok(seen.length > 3, 'too few frames to prove anything');
      assert.all(seen, f => Object.is(f.t, f.want),
        'the parameter must be recomputed from the captured start, not accumulated');
      const last = seen[seen.length - 1];
      assert.equal(last.t, 1);
      assert.equal(last.s, 1);
    } finally { a.dispose(); }
  });

  test('ease is opt-out: linear gives s === t', withAnimator({}, async a => {
    const seen = [];
    const h = a.run({ duration: 60, ease: linear, onFrame: (s, t) => seen.push([s, t]) });
    await h.finished;
    assert.all(seen, ([s, t]) => Object.is(s, t));
  }));

  // -- motion policy ------------------------------------------------------

  test('reduced motion + jump applies the end state immediately, without rAF', () => {
    const a = new Animator({ pauseOnHidden: false, motionQuery: mq(true) });
    try {
      assert.equal(a.reducedMotion, true);
      let calls = 0, s = null, t = null, info = null;
      const h = a.run({
        duration: 900,
        onFrame: (es, rt) => { calls++; s = es; t = rt; },
        onDone: i => { info = i; },
      });
      assert.equal(calls, 1, 'jump is exactly one frame');
      assert.equal(s, 1, 'the end state must still be applied');
      assert.equal(t, 1);
      assert.equal(h.done, true);
      assert.equal(info.completed, true);
    } finally { a.dispose(); }
  });

  test('reduced motion + freeze writes no frame but still reports', () => {
    const a = new Animator({ pauseOnHidden: false, motionQuery: mq(true) });
    try {
      let calls = 0, info = null;
      a.run({ reducedMotion: 'freeze', onFrame: () => { calls++; }, onDone: i => { info = i; } });
      assert.equal(calls, 0);
      assert.equal(info.skipped, true);
      assert.equal(info.completed, false);
    } finally { a.dispose(); }
  });

  test('reduced motion + animate still animates', withAnimator({ motionQuery: mq(true) }, async a => {
    let calls = 0;
    const h = a.run({ duration: 60, reducedMotion: 'animate', onFrame: () => { calls++; } });
    await h.finished;
    assert.ok(calls > 1, 'motion that IS the content must be allowed to run');
  }));

  test('the preference is listened to, not read once at construction', () => {
    const q = mq(false);
    const a = new Animator({ pauseOnHidden: false, motionQuery: q });
    try {
      assert.equal(a.reducedMotion, false);
      q.emit(true);                       // the user flips the OS setting mid-session
      assert.equal(a.reducedMotion, true);
      let calls = 0;
      a.run({ duration: 900, onFrame: () => { calls++; } });
      assert.equal(calls, 1, 'the next run must honour the new preference');
    } finally { a.dispose(); }
  });

  test('reduced motion + manual leaves a playback paused at 0 but scrubbable', () => {
    const a = new Animator({ pauseOnHidden: false, motionQuery: mq(true) });
    try {
      let last = null;
      const pb = a.loop({ duration: 2000, onFrame: t => { last = t; } });
      assert.equal(pb.playing, false, 'nothing auto-plays under manual');
      assert.equal(pb.t, 0);
      assert.equal(last, null);
      pb.seek(0.5);
      assert.equal(last, 0.5, 'the full scrub slider still works');
      pb.dispose();
    } finally { a.dispose(); }
  });

  test('reduced motion + jump applies a playback end state too', () => {
    const a = new Animator({ pauseOnHidden: false, motionQuery: mq(true) });
    try {
      let last = null, done = 0;
      const pb = a.loop({
        duration: 2000, reducedMotion: 'jump',
        onFrame: t => { last = t; }, onDone: () => { done++; },
      });
      assert.equal(last, 1, 'jump to the end state, not skip it');
      assert.equal(pb.t, 1);
      assert.equal(pb.playing, false);
      assert.equal(done, 1);
      pb.dispose();
    } finally { a.dispose(); }
  });

  // -- playback -----------------------------------------------------------

  test('a scrub while playing does not regress time on the next frame',
    withAnimator({}, async a => {
      let seen = -1;
      const pb = a.loop({ duration: 5000, onFrame: t => { seen = t; } });
      assert.equal(pb.playing, true);
      await frames(3);
      assert.ok(pb.t > 0, 'the playback never advanced');

      pb.t = 0.8;                        // the settable property IS seek
      assert.equal(pb.playing, false, 'seek pauses');
      assert.equal(pb.t, 0.8);
      assert.equal(seen, 0.8, 'a scrub must render its frame');

      await frames(2);
      assert.equal(pb.t, 0.8, 'the already-queued frame fought the seek');

      pb.play();
      await frames(2);
      assert.ok(pb.t >= 0.8, `time regressed to ${pb.t}`);
      assert.ok(pb.t < 0.86, `resume jumped to ${pb.t}`);
      pb.dispose();
    }));

  test('a paused interval is not integrated on resume', withAnimator({}, async a => {
    const pb = a.loop({ duration: 5000, onFrame: () => {} });
    await frames(3);
    pb.pause();
    const held = pb.t;
    await sleep(120);
    assert.equal(pb.t, held, 'a paused playback must not advance');
    pb.play();
    await frames(1);
    assert.ok(pb.t - held < 0.05, `resume integrated the paused interval (+${pb.t - held})`);
    pb.dispose();
  }));

  test('maxStep caps how much sim time one frame can advance', async () => {
    let clock = 0;
    const a = new Animator({ pauseOnHidden: false, motionQuery: mq(false), now: () => clock });
    try {
      const pb = a.loop({ duration: 1000, maxStep: 100, onFrame: () => {} });
      await frames(2);
      clock += 5000;                     // a backgrounded tab, or a long GC
      await frames(2);
      assert.close(pb.t, 0.1, 1e-12, 'one frame advanced more than maxStep');
      pb.dispose();
    } finally { a.dispose(); }
  });

  test('a non-looping playback finishes at exactly 1', withAnimator({}, async a => {
    let last = -1, done = 0;
    const pb = a.loop({ duration: 60, onFrame: t => { last = t; }, onDone: () => { done++; } });
    await new Promise(res => pb.on('done', res));
    assert.equal(last, 1);
    assert.equal(pb.t, 1);
    assert.equal(pb.playing, false);
    assert.equal(done, 1);
    await frames(3);
    assert.equal(done, 1, 'done must fire once');
    pb.dispose();
  }));

  test('a looping playback wraps instead of stopping', withAnimator({}, async a => {
    let wraps = 0, prev = 0;
    const pb = a.loop({
      duration: 60, loop: true,
      onFrame: t => { if (t < prev) wraps++; prev = t; },
    });
    await sleep(200);
    assert.ok(wraps >= 1, 'the playback never wrapped');
    assert.equal(pb.playing, true);
    assert.ok(pb.t >= 0 && pb.t <= 1, `t left the unit interval: ${pb.t}`);
    pb.dispose();
  }));

  test('on() returns a working unsubscribe', withAnimator({}, async a => {
    let n = 0;
    const pb = a.loop({ duration: 5000, onFrame: () => {} });
    const off = pb.on('frame', () => { n++; });
    await frames(2);
    assert.ok(n > 0);
    off();
    const at = n;
    await frames(3);
    assert.equal(n, at, 'an unsubscribed listener kept firing');
    pb.dispose();
  }));

  // -- teardown -----------------------------------------------------------

  test('dispose stops every callback', async () => {
    const a = new Animator({ pauseOnHidden: false, motionQuery: mq(false) });
    let runFrames = 0, playFrames = 0;
    a.run({ duration: 4000, onFrame: () => { runFrames++; } });
    const pb = a.loop({ duration: 4000, onFrame: () => { playFrames++; } });
    await frames(2);
    assert.ok(runFrames > 0 && playFrames > 0, 'nothing ran to begin with');
    a.dispose();
    const r = runFrames, p = playFrames;
    await frames(4);
    assert.equal(runFrames, r, 'a disposed animator kept running a transient');
    assert.equal(playFrames, p, 'a disposed animator kept running a playback');
    pb.dispose();                       // idempotent
  });

  test('a disposed playback is inert', withAnimator({}, async a => {
    let n = 0;
    const pb = a.loop({ duration: 4000, onFrame: () => { n++; } });
    await frames(2);
    pb.dispose();
    const at = n;
    pb.play(); pb.seek(0.5); pb.replay();
    await frames(3);
    assert.equal(n, at, 'a disposed playback must ignore play/seek/replay');
  }));

  // -- hidden tab ---------------------------------------------------------

  test('a hidden tab completes transients and remembers a playing playback', async () => {
    const a = new Animator({ motionQuery: mq(false) });      // pauseOnHidden defaults true
    const pb = a.loop({ duration: 4000, onFrame: () => {} });
    let s = 0;
    const h = a.run({ duration: 4000, onFrame: v => { s = v; } });
    await frames(2);

    const own = Object.getOwnPropertyDescriptor(document, 'visibilityState');
    try {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    } finally {
      if (own) Object.defineProperty(document, 'visibilityState', own);
      else delete document.visibilityState;
    }

    assert.equal(s, 1, 'a camera move that resumes ten minutes later is worse than one that finished');
    assert.equal(h.done, true);
    assert.equal(pb.playing, false);
    assert.equal(pb.wasPlaying, true, 'the page decides whether to resume, so the flag must survive');

    const held = pb.t;
    await sleep(120);
    pb.play();
    await frames(1);
    assert.ok(pb.t - held < 0.05, `the hidden interval was integrated (+${pb.t - held})`);
    assert.equal(pb.wasPlaying, false, 'play() clears the flag');
    pb.dispose();
    a.dispose();
  });
});
