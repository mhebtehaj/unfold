// Layer 0 — one animation kernel for the five rAF loops the site currently has.
//
// The shape is taken from the ambiguity explorer's camera ease, which is the
// best interaction code on the site: a monotonic token retires the previous
// move, and every frame interpolates *absolutely* from values captured at the
// start. Two properties fall out of that and both are load-bearing. A
// superseded move stops on its next frame and never writes again, so two
// overlapping calls leave the target at the second one's destination. And a
// dropped or delayed frame cannot accumulate error, so the move lands exactly
// on the target instead of near it.
//
// What the source could not have, because it had exactly one loop: two token
// spaces. Transient runs share the animator's counter, so `cancelAll()` on
// pointerdown retires every camera move with one statement. Playbacks get a
// generation each, so a camera move cannot kill a homotopy scrub.
//
// The other reason this module exists: four of the five existing loops ignore
// `prefers-reduced-motion`. Here the policy is an argument with a safe default,
// so an author has to opt out rather than remember to opt in.

import { prefersReducedMotion, onMotionPreferenceChange } from './a11y.js';

export const LAYER = 0;

export const smoothstep   = t => t * t * (3 - 2 * t);      // s(0)=0 s(1)=1 s'(0)=s'(1)=0
export const smootherstep = t => t * t * t * (t * (t * 6 - 15) + 10);
export const linear       = t => t;
export const easeOutCubic = t => 1 - (1 - t) ** 3;

/**
 * How a run behaves when `prefers-reduced-motion: reduce` is set.
 * Ignored entirely when the user has not asked for reduced motion.
 *
 * 'animate' — run normally anyway (use only for motion that IS the content)
 * 'jump'    — call onFrame(1, 1) once, then onDone. No rAF. DEFAULT for run().
 * 'freeze'  — never call onFrame; call onDone({skipped:true}). For ambient decoration.
 * 'manual'  — create the Playback paused at t=0; only seek() advances it, so the user
 *             still gets the full scrub slider but nothing auto-plays.
 *             DEFAULT for loop().
 * @typedef {'animate'|'jump'|'freeze'|'manual'} MotionPolicy
 */

const clamp01 = v => (v > 1 ? 1 : v < 0 ? 0 : v);

export class Animator {
  #token = 0;
  #runs = new Set();
  #plays = new Set();
  #now;
  #query = null;
  #reduced = false;
  #offMotion = null;
  #onVisibility = null;
  #disposed = false;

  /**
   * @param {object} [o]
   * @param {boolean} [o.pauseOnHidden=true]
   * @param {() => number} [o.now=() => performance.now()]
   * @param {MediaQueryList|null} [o.motionQuery]  injectable for tests
   */
  constructor(o = {}) {
    const { pauseOnHidden = true, now, motionQuery = null } = o;
    this.#now = now ?? (() => performance.now());

    // Cached matcher, one 'change' listener, never re-queried per call. The
    // listener is the point: a user who turns reduced motion on mid-session
    // must get it on the next run, not on the next page load.
    if (motionQuery) {
      this.#query = motionQuery;
      this.#reduced = motionQuery.matches === true;
      const onChange = () => { this.#reduced = this.#query.matches === true; };
      motionQuery.addEventListener('change', onChange);
      this.#offMotion = () => motionQuery.removeEventListener('change', onChange);
    } else {
      this.#reduced = prefersReducedMotion();
      this.#offMotion = onMotionPreferenceChange(v => { this.#reduced = v; });
    }

    if (pauseOnHidden && typeof document !== 'undefined') {
      this.#onVisibility = () => { if (document.visibilityState === 'hidden') this.#hide(); };
      document.addEventListener('visibilitychange', this.#onVisibility);
    }
  }

  get reducedMotion() { return this.#reduced; }

  /** The monotonic transient counter — exposed for debugging. */
  get token() { return this.#token; }

  /**
   * A transient, absolutely-interpolated move.
   * @param {object} o
   * @param {number}   [o.duration=420]
   * @param {(t:number)=>number} [o.ease=smoothstep]
   * @param {(s:number, t:number)=>void} o.onFrame   s = eased, t = raw ∈ [0,1]
   * @param {(info:{completed:boolean,skipped?:boolean})=>void} [o.onDone]
   * @param {MotionPolicy} [o.reducedMotion='jump']
   * @param {string} [o.label]
   * @returns {Handle}
   */
  run(o) {
    const {
      duration = 420, ease = smoothstep, onFrame, onDone,
      reducedMotion = 'jump', label = '',
    } = o;

    // `const token = ++moving`, with the bookkeeping the original could not
    // have. The bump alone retires every earlier frame callback; the sweep
    // settles their handles so nobody is left awaiting a promise that a
    // superseded animation will never resolve.
    if (this.#disposed) throw new Error('Animator is disposed');
    const token = ++this.#token;
    this.#retireRuns();

    let settle;
    const finished = new Promise(res => { settle = res; });
    const rec = { token, label, onFrame, onDone, settle, done: false };
    /** @type {Handle} */
    const handle = {
      id: token,
      label,
      finished,
      cancel: () => this.#settleRun(rec, { completed: false }),
      get done() { return rec.done; },
    };

    const policy = this.#reduced ? reducedMotion : 'animate';
    if (policy === 'freeze') {
      this.#settleRun(rec, { completed: false, skipped: true });
      return handle;
    }
    if (policy !== 'animate') {
      // 'jump', and 'manual' too: a transient move has no scrub slider to fall
      // back on, so the only safe reduced-motion behaviour is the end state.
      // Leaving the camera half-turned is worse than not animating it.
      onFrame(1, 1);
      this.#settleRun(rec, { completed: true });
      return handle;
    }

    this.#runs.add(rec);
    const start = this.#now();
    const step = () => {
      // Retired — silently. Checked before anything is read or written, which
      // is what makes "never writes again" true on the very next frame.
      if (rec.done || token !== this.#token) return;
      const t = duration > 0 ? Math.min(1, (this.#now() - start) / duration) : 1;
      onFrame(ease(t), t);
      if (t < 1) requestAnimationFrame(step);
      else this.#settleRun(rec, { completed: true });
    };
    requestAnimationFrame(step);
    return handle;
  }

  /**
   * Looping / scrubbable playback.
   * @param {object} o
   * @param {number} [o.duration=7000]
   * @param {(t:number)=>void} o.onFrame
   * @param {() => void} [o.onDone]
   * @param {boolean} [o.loop=false]
   * @param {number} [o.maxStep=100]
   * @param {(t:number)=>number} [o.ease=linear]
   * @param {MotionPolicy} [o.reducedMotion='manual']
   * @returns {Playback}
   */
  loop(o) {
    const {
      duration = 7000, onFrame, onDone, loop: repeat = false,
      maxStep = 100, ease = linear, reducedMotion = 'manual',
    } = o;
    if (this.#disposed) throw new Error('Animator is disposed');

    const span = duration > 0 ? duration : 1;
    const subs = { frame: new Set(), play: new Set(), pause: new Set(), done: new Set() };
    const emit = (evt, ...args) => { for (const fn of [...subs[evt]]) fn(...args); };

    let t = 0;               // raw parameter; what a slider binds to
    let playing = false;
    let wasPlaying = false;
    let gen = 0;             // per-Playback generation — a camera move cannot touch it
    let t0 = 0;              // parameter at the anchor
    let anchor = 0;          // clock reading the parameter is measured from
    let disposed = false;

    const apply = () => {
      const s = ease(t);
      onFrame(s);
      emit('frame', s, t);
    };

    const pause = () => {
      if (disposed) return;
      // Bump first: the frame already queued for this tick must not write back
      // the pre-pause parameter after the pause has landed.
      gen++;
      if (!playing) return;
      playing = false;
      emit('pause');
    };

    const play = () => {
      if (disposed || playing) return;
      playing = true;
      wasPlaying = false;
      // Re-anchor on every resume. This is what keeps a paused interval — or a
      // hidden tab, or a scrub — out of the integral: sim time advances only
      // while the loop is running.
      t0 = t;
      anchor = this.#now();
      const mine = ++gen;
      const step = () => {
        if (disposed || mine !== gen) return;
        let dt = this.#now() - anchor;
        // Stall guard. One frame can never advance more than maxStep of sim
        // time; shifting the anchor rather than clamping t keeps the parameter
        // absolute from (t0, anchor) on every later frame.
        if (dt > maxStep) { anchor += dt - maxStep; dt = maxStep; }
        let next = t0 + dt / span;
        if (next >= 1) {
          if (repeat) {
            next -= Math.floor(next);
            t0 = next;
            anchor = this.#now();   // re-anchor per cycle; the overshoot is kept in t0
          } else {
            next = 1;
          }
        }
        t = next;
        apply();
        if (!repeat && t >= 1) {
          playing = false;
          gen++;
          emit('pause');
          emit('done');
          onDone?.();
          return;
        }
        requestAnimationFrame(step);
      };
      emit('play');
      requestAnimationFrame(step);
    };

    const seek = v => {
      if (disposed) return;
      pause();
      t = clamp01(Number(v) || 0);
      t0 = t;
      anchor = this.#now();
      apply();
    };

    const dispose = () => {
      if (disposed) return;
      disposed = true;
      gen++;
      playing = false;
      for (const set of Object.values(subs)) set.clear();
      this.#plays.delete(core);
    };

    /** @type {Playback} */
    const api = {
      get t() { return t; },
      set t(v) { seek(v); },
      get playing() { return playing; },
      get wasPlaying() { return wasPlaying; },
      play,
      pause,
      toggle() { if (playing) pause(); else play(); },
      seek,
      replay() { seek(0); play(); },
      on(evt, fn) {
        const set = subs[evt];
        if (!set) return () => {};
        set.add(fn);
        return () => set.delete(fn);
      },
      dispose,
    };

    const core = {
      api,
      pause,
      dispose,
      hidden() {
        if (!playing) return;
        pause();
        wasPlaying = true;   // set after pause(), which does not touch it
      },
    };
    this.#plays.add(core);

    const policy = this.#reduced ? reducedMotion : 'animate';
    if (policy === 'animate') {
      play();
    } else if (policy === 'jump') {
      // The end state is still the news, so apply it — just without the motion.
      t = 1; t0 = 1;
      anchor = this.#now();
      apply();
      emit('done');
      onDone?.();
    } else if (policy === 'freeze') {
      emit('done');
      onDone?.();
    }
    // 'manual': paused at t=0 with no frame written. The scrub slider still
    // works, and an explicit play() still plays — the preference is about
    // motion the user did not ask for, not about disabling a button.

    return api;
  }

  /**
   * Retire every in-flight transient run immediately (one token bump).
   * Playbacks are NOT affected unless {playbacks:true}, in which case they are
   * paused — cancelAll is a retire, not a teardown; dispose() is the teardown.
   * @param {{playbacks?:boolean}} [o]
   */
  cancelAll(o = {}) {
    ++this.#token;
    this.#retireRuns();
    if (o.playbacks) for (const core of [...this.#plays]) core.pause();
  }

  /** @param {Handle} handle */
  cancel(handle) {
    // The handle closes over its own record, so there is nothing to look up.
    handle?.cancel?.();
  }

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.cancelAll();
    for (const core of [...this.#plays]) core.dispose();
    this.#plays.clear();
    this.#offMotion?.();
    this.#offMotion = null;
    if (this.#onVisibility) {
      document.removeEventListener('visibilitychange', this.#onVisibility);
      this.#onVisibility = null;
    }
  }

  #retireRuns() {
    for (const rec of [...this.#runs]) this.#settleRun(rec, { completed: false });
  }

  #settleRun(rec, info) {
    if (rec.done) return;
    rec.done = true;
    this.#runs.delete(rec);
    rec.onDone?.(info);
    rec.settle(info);
  }

  #hide() {
    // A half-finished camera move that resumes ten minutes later is worse than
    // one that finished, so transients land on their target. Playbacks remember
    // that they were playing and leave the decision to resume to the page.
    for (const rec of [...this.#runs]) {
      rec.onFrame(1, 1);
      this.#settleRun(rec, { completed: true });
    }
    for (const core of [...this.#plays]) core.hidden();
  }
}

/**
 * @typedef {Object} Handle
 * @property {number} id
 * @property {() => void} cancel
 * @property {Promise<{completed:boolean}>} finished
 * @property {boolean} done
 */

/**
 * @typedef {Object} Playback
 * @property {number} t
 * @property {boolean} playing
 * @property {boolean} wasPlaying
 * @property {() => void} play
 * @property {() => void} pause
 * @property {() => void} toggle
 * @property {(t:number) => void} seek
 * @property {() => void} replay
 * @property {(evt:'frame'|'play'|'pause'|'done', fn:Function) => () => void} on
 * @property {() => void} dispose
 */
