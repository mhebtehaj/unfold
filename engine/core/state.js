// A tiny reactive store: a plain object in, that same plain object out.
//
// What it replaces: each explorer hand-rolls a state object and redraws
// eagerly at the call site, so a control that moves three fields draws three
// times, and a quantity computed from state (fourAmbiguity at ~1300
// evaluations, cfg() called inside the render loop) is recomputed by whoever
// happens to need it. Here a write marks keys dirty, a derived value
// recomputes only when one of its deps actually moved, and subscribers get
// one notification per settled batch.
//
// No Proxy. `get()` hands back the real object: console.table it, breakpoint
// on it, watch it. A Proxy with fabricated getters makes every one of those a
// lie about what is really stored, which is the opposite of what a debugging
// session needs.
//
// SCHEDULING, AND WHY IT IS AN ARGUMENT. state.js is in the pure set (I2), so
// it may not name the browser's frame scheduler -- that is the point of the
// rule: the two string-building explorers have to be able to import this. So
// the caller injects one:
//
//   createStore(initial, { schedule: run => {
//     const id = <the browser's frame request>(run);
//     return () => <its cancel>(id);        // optional canceller
//   }})
//
// `run` is called with the scheduler's timestamp, which becomes FrameInfo.time.
// The default scheduler is synchronous, so node tests and the probe are
// deterministic and need no clock. The consequence, stated plainly rather than
// hidden: with the default, writes coalesce inside batch(), inside update()
// and across one notification pass, but NOT across separate top-level writes
// in the same turn. Inject a deferring scheduler to get that too.

export const LAYER = 0;

/** A cascade still running after this many passes is a feedback loop, not a settling system. */
const MAX_PASSES = 20;

/** Default scheduler: run now, nothing to cancel. Keeps tests clock-free. */
const SYNC = run => { run(0); return null; };

/** Deep-ish clone: arrays and plain objects are copied, everything else passes through. */
function cloneish(v) {
  if (Array.isArray(v)) return v.map(cloneish);
  if (v && typeof v === 'object') {
    const proto = Object.getPrototypeOf(v);
    if (proto === Object.prototype || proto === null) {
      const out = {};
      for (const k of Object.keys(v)) out[k] = cloneish(v[k]);
      return out;
    }
  }
  return v;
}

const hits = (keys, changed) => {
  for (const k of keys) if (changed.has(k)) return true;
  return false;
};

/**
 * @param {Record<string, any>} initial   scalars, or small arrays replaced wholesale
 * @param {object} [o]
 * @param {Record<string, (a,b)=>boolean>} [o.equals]  per-key equality; default Object.is
 * @param {string} [o.name]              appears in devtools + probe
 * @param {boolean} [o.strict=true]      set() of an undeclared key throws in dev
 * @param {(run:(time?:number)=>void) => (()=>void)|void} [o.schedule]
 *        how a pending notification reaches subscribers; default synchronous
 * @returns {Store}
 */
export function createStore(initial, o = {}) {
  const label = o.name ?? 'store';
  const strict = o.strict !== false;
  const eqFor = o.equals ?? {};
  const schedule = o.schedule ?? SYNC;

  const state = { ...initial };
  const declared = new Set(Object.keys(state));
  const derived = new Map();          // key -> {deps:Set, fn, equals}
  const evalOrder = [];               // derived keys, registration order == evaluation order

  let subs = [];                      // {fn, keys:Set|null, key:string|undefined, dead:boolean}
  const frames = new Set();
  const dueFrames = new Set();

  let pendingKeys = new Set();        // changed, not yet notified
  let pendingFrom = new Map();        // key -> value before the current pending span
  let depth = 0;                      // mutate() nesting
  let dirty = null;                   // keys touched by the current top-level mutation
  let armed = false;
  let cancelPump = null;
  let pumping = false;
  let disposed = false;

  // -- the pump: one scheduled unit of work, so a notification and the render
  // it requests coalesce into a single pass instead of two trips. ------------
  function pump(time = 0) {
    armed = false;
    cancelPump = null;
    if (pumping || disposed) return;
    pumping = true;
    try {
      let pass = 0;
      while (pendingKeys.size || dueFrames.size) {
        if (++pass > MAX_PASSES) {
          const churn = [...pendingKeys].join(', ');
          throw new Error(`${label}: did not settle after ${MAX_PASSES} passes (still changing: ${churn})` +
            ` — a subscriber is writing state that re-triggers it`);
        }
        if (pendingKeys.size) notifyPass();
        else renderDue(time);
      }
    } finally {
      pumping = false;
    }
  }

  const arm = () => {
    // No new schedule while pumping: the loop above picks the work up, and with
    // the synchronous default a schedule from inside a subscriber would recurse.
    if (armed || pumping || disposed) return;
    armed = true;
    const h = schedule(pump);
    if (armed) cancelPump = typeof h === 'function' ? h : null;
  };

  /**
   * One notification pass. A write made by a subscriber lands in `pendingKeys`
   * and is notified by the NEXT pass, so every subscriber in this pass sees the
   * same state and none is re-entered half way down the list.
   */
  function notifyPass() {
    const changed = pendingKeys;
    const from = pendingFrom;
    pendingKeys = new Set();
    pendingFrom = new Map();

    for (const f of frames) for (const k of changed) f.keys.add(k);

    // Iterate a copy and re-check `dead`: unsubscribing during notification is
    // legal, must not skip the next subscriber, and must not call the one that
    // just went away.
    for (const s of subs.slice()) {
      if (s.dead) continue;
      if (s.keys && !hits(s.keys, changed)) continue;
      if (s.key !== undefined) s.fn(state[s.key], from.get(s.key));
      else s.fn(state, changed);
    }
  }

  function renderDue(time) {
    for (const rec of [...dueFrames]) {
      dueFrames.delete(rec);
      runFrame(rec, time);
    }
  }

  function runFrame(rec, time) {
    const info = { levels: rec.levels, keys: rec.keys, state, time };
    rec.levels = new Set();     // fresh sets, so the render may keep the ones it got
    rec.keys = new Set();
    rec.render(info);
  }

  // -- writes ---------------------------------------------------------------
  function applyWrite(key, value) {
    if (disposed) throw new Error(`${label}.set('${key}'): the store is disposed`);
    if (derived.has(key))
      throw new Error(`${label}.set('${key}'): derived values are read-only` +
        ` — set one of its deps (${[...derived.get(key).deps].join(', ')})`);
    if (!declared.has(key)) {
      if (strict)
        throw new Error(`${label}.set('${key}'): undeclared key` +
          ` — name it in createStore's initial object, or pass { strict: false }`);
      declared.add(key);
    }
    const prev = state[key];
    const eq = eqFor[key] ?? Object.is;
    if (key in state && eq(prev, value)) return false;

    state[key] = value;
    if (store.log) console.log(label, { key, from: prev, to: value });
    if (!pendingFrom.has(key)) pendingFrom.set(key, prev);
    pendingKeys.add(key);
    dirty.add(key);
    return true;
  }

  /** Recompute the derived values whose deps moved, in registration order. */
  function refresh() {
    for (const key of evalOrder) {
      const d = derived.get(key);
      if (!hits(d.deps, dirty)) continue;         // this is the memoisation
      const next = d.fn(state);
      const prev = state[key];
      const eq = d.equals ?? Object.is;
      if (eq(prev, next)) continue;
      state[key] = next;
      if (store.log) console.log(label, { key, from: prev, to: next });
      if (!pendingFrom.has(key)) pendingFrom.set(key, prev);
      pendingKeys.add(key);
      dirty.add(key);                             // so a derived-on-derived cascades
    }
  }

  /**
   * The one mutation boundary. Derived values settle and subscribers are armed
   * once, when the outermost mutation closes — that is what makes three writes
   * one notification.
   * @returns {string[]} keys that changed inside `body`, derived included
   */
  function mutate(body) {
    const mark = depth > 0 ? new Set(dirty) : null;
    if (depth++ === 0) dirty = new Set();
    const seen = dirty;
    try {
      body();
    } finally {
      if (--depth === 0) {
        refresh();
        dirty = null;
        if (pendingKeys.size) arm();
      }
    }
    return mark ? [...seen].filter(k => !mark.has(k)) : [...seen];
  }

  function get(key) {
    return arguments.length === 0 ? state : state[key];
  }

  function set(key, value) {
    if (typeof key === 'string') {
      let changed = false;
      mutate(() => { changed = applyWrite(key, value); });
      return changed;
    }
    const patch = key;
    return mutate(() => { for (const k of Object.keys(patch)) applyWrite(k, patch[k]); });
  }

  /** `fn` mutates a shallow copy; the diff is applied. Deleting a key from the draft is ignored. */
  function update(fn) {
    const draft = { ...state };
    fn(draft);
    return mutate(() => {
      for (const k of Object.keys(draft)) {
        if (derived.has(k)) {
          if (!Object.is(draft[k], state[k]))
            throw new Error(`${label}.update: '${k}' is derived and read-only`);
          continue;
        }
        applyWrite(k, draft[k]);
      }
    });
  }

  const batch = fn => mutate(fn);

  function subscribe(fn, opt = {}) {
    const rec = { fn, keys: opt.keys ? new Set(opt.keys) : null, key: undefined, dead: false };
    subs.push(rec);
    // `changed` is always the full changed set; `keys` decides whether to call,
    // not what the subscriber is told.
    if (opt.immediate) fn(state, new Set(rec.keys ?? Object.keys(state)));
    return () => {
      if (rec.dead) return;
      rec.dead = true;
      const i = subs.indexOf(rec);
      if (i >= 0) subs.splice(i, 1);
    };
  }

  function on(key, fn) {
    const rec = { fn, keys: new Set([key]), key, dead: false };
    subs.push(rec);
    return () => {
      if (rec.dead) return;
      rec.dead = true;
      const i = subs.indexOf(rec);
      if (i >= 0) subs.splice(i, 1);
    };
  }

  function derive(key, deps, fn, opt = {}) {
    if (derived.has(key)) throw new Error(`${label}.derive('${key}'): already derived`);
    if (declared.has(key))
      throw new Error(`${label}.derive('${key}'): '${key}' is a stored key — a derived value may not shadow one`);
    if (strict) {
      // A dep that is not a key never fires, so the derived value silently
      // freezes at its first value. Catch the typo at registration.
      for (const dep of deps)
        if (!declared.has(dep))
          throw new Error(`${label}.derive('${key}'): dep '${dep}' is not a key of this store`);
    }
    derived.set(key, { deps: new Set(deps), fn, equals: opt.equals });
    evalOrder.push(key);
    declared.add(key);
    state[key] = fn(state);          // compute now, so get() is never stale
  }

  /**
   * @param {(f:FrameInfo)=>void} render
   * @param {{levels?:string[]}} [opt] declared levels; requesting another throws,
   *   because a typo'd level would otherwise widen the redraw in silence.
   */
  function frame(render, opt = {}) {
    const allowed = opt.levels ? new Set(opt.levels) : null;
    const rec = { render, levels: new Set(), keys: new Set() };
    frames.add(rec);
    return {
      request(level = 'all') {
        if (disposed) return;
        if (allowed && !allowed.has(level))
          throw new Error(`${label}: frame level '${level}' is not declared (${[...allowed].join(', ')})`);
        rec.levels.add(level);
        dueFrames.add(rec);
        arm();
      },
      cancel() {
        rec.levels.clear();
        dueFrames.delete(rec);
      },
      flushNow() {
        if (!dueFrames.has(rec)) return;
        dueFrames.delete(rec);
        runFrame(rec, 0);
      },
    };
  }

  function flush() {
    if (disposed) return;
    if (cancelPump) cancelPump();
    cancelPump = null;
    armed = false;
    pump(0);
  }

  const snapshot = () => cloneish(state);

  /** Derived keys in `obj` are ignored — they are recomputed from the restored deps. */
  function restore(obj) {
    return mutate(() => {
      for (const k of Object.keys(obj)) {
        if (derived.has(k)) continue;
        applyWrite(k, obj[k]);
      }
    });
  }

  function dispose() {
    disposed = true;
    if (cancelPump) cancelPump();
    cancelPump = null;
    armed = false;
    for (const s of subs) s.dead = true;
    subs = [];
    frames.clear();
    dueFrames.clear();
    pendingKeys.clear();
    pendingFrom.clear();
  }

  const store = {
    name: label,
    log: false,
    get, set, update, batch, subscribe, on, derive, frame, flush, snapshot, restore, dispose,
  };
  return store;
}
