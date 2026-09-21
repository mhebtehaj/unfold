// Layer 0 — one attribute that describes the rendered scene, and the harness
// that reads it back.
//
// ambiguity.md's most surprising finding: the explorer already writes a rich,
// machine-readable description of its scene into data-yaw, data-pitch,
// data-ambiguous-edges and full JSON dumps in data-ambiguity-faces and
// data-query-model — a finished test oracle that nothing reads. The idea is
// right, and it is the only verification strategy a static visualization site
// can afford: assert on scene structure, not on pixels. What was missing is a
// namespace. Here it is ONE attribute, `data-probe`, holding ONE JSON object,
// engine-owned keys at the top level and everything a domain module
// contributes under `domain` — which is the whole difference between this and
// today's data-ambiguity-faces / data-query-model / data-rotation4 free-for-all.
//
// Three properties make it an oracle rather than debug output.
//
//   Deterministic. Top-level keys come out in the declared schema order, every
//   nested object's keys are sorted, every number is rounded to `digits`, and
//   -0/NaN/Infinity have fixed spellings. The same scene state therefore
//   serializes byte-identically on any machine, which is the entire value of a
//   golden-file diff.
//
//   Free when off. Every mutator is gated by one boolean, and a FUNCTION
//   passed to set() is never called while disabled. That is the whole reason
//   the API takes a thunk: `set('domain.x', () => describeEverything())` costs
//   one call and one store in production.
//
//   Quiet when nothing moved. commit() is rAF-coalesced and compares the
//   serialized body; an unchanged frame writes no attribute and does not
//   advance `rev`. A harness watching the short data-probe-rev attribute
//   therefore sees exactly the frames that changed something, and never has to
//   re-parse the JSON to find out that it did not.
//
// Not in the pure set (I2): this module owns the attribute write and the
// enablement checks, so it names `document` and `location` deliberately.
// tools/check-layers.mjs records why. The split is kept in spirit anyway —
// snapshot() is pure computation over a plain object and the only DOM write is
// in commit() — because that is what lets a test assert on serialization
// without a host at all.

import { round } from './vec.js';

export const LAYER = 0;

// There is no build step, so nothing can define away a development-only check.
// Read live rather than captured at load, so a test can exercise both branches.
const isDev = () => globalThis.UNFOLD_DEV !== false;

/**
 * Declared key order for the top level. Rule 1 of the schema: the order is the
 * spec's, not the insertion accident, so two runs that set the same fields in
 * different orders produce the same bytes.
 *
 * Anything NOT declared here sorts alphabetically AFTER `warnings`, rather
 * than being dropped: a domain module that forgot its `domain.` prefix keeps
 * its data and becomes visible at a glance in a diff.
 */
const TOP_ORDER = ['schema', 'id', 'rev', 'viewport', 'camera', 'rotor', 'passes', 'layers',
                   'marks', 'labels', 'occlusion', 'state', 'domain', 'warnings'];
const TOP_SET = new Set(TOP_ORDER);

/** Default wait for nextRev()/waitForProbe(), matching the spec's harness side. */
const WAIT_MS = 2000;

/** A cycle or a pathological nesting depth is a bug in the caller's data, not a hang. */
const MAX_DEPTH = 24;

// ------------------------------------------------------------- enablement --

/**
 * Values that mean "off" wherever a trigger is spelled with a value. The spec
 * gives two contradictory sentences — the API comment enables on
 * `URLSearchParams.has('probe')`, the production-policy paragraph says `?probe=0`
 * DISABLES — so an explicit off wins over every enable, from any source. That
 * is the only reading under which both sentences are true of the same function.
 */
const OFF = new Set(['off', '0', 'false', 'no']);

const isOff = v => v != null && OFF.has(String(v).toLowerCase());

/**
 * Default: true when any of
 *   document.documentElement.hasAttribute('data-unfold-probe')  (and value !== 'off')
 *   new URLSearchParams(location.search).has('probe')
 *   globalThis.__UNFOLD_PROBE__ === true
 * and false when any of them is explicitly off: the attribute set to 'off',
 * `?probe=0`, or `globalThis.__UNFOLD_PROBE__ === false`.
 *
 * Every read is live, so a test can drive all three (history.replaceState for
 * the query string) and restore them. Callable under node, where it is false.
 */
export function probeEnabled() {
  const flag = globalThis.__UNFOLD_PROBE__;
  if (flag === false) return false;

  const root = typeof document === 'undefined' ? null : document.documentElement;
  const attrOn = root ? root.hasAttribute('data-unfold-probe') : false;
  const attrValue = attrOn ? root.getAttribute('data-unfold-probe') : null;
  if (attrOn && isOff(attrValue)) return false;

  const search = typeof location === 'undefined' ? '' : (location.search || '');
  const param = new URLSearchParams(search).get('probe');
  if (param !== null && isOff(param)) return false;

  // On by default. §2.8's production policy and Q1 both settle this: the cost
  // is one coalesced attribute write per changed frame plus a handful of
  // guarded no-ops, and the return is that every published page describes its
  // own rendered scene. A probe that has to be switched on is a probe that is
  // off in exactly the situation you wanted it -- a reader reporting that a
  // published page looks wrong. The three triggers above are therefore
  // opt-OUT plus an explicit force-on, not the enabling conditions.
  return true;
}

// ---------------------------------------------------------- serialization --

const isPlain = v => {
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

/**
 * Non-finite numbers become their own spelling, never JSON's `null`.
 *
 * svg.js sets the precedent for the same reason: a NaN written out as "NaN"
 * names the bug in the first frame it appears, and a NaN written out as null
 * looks exactly like a field the scene legitimately had nothing to say about.
 * `-0` cannot survive round() — that branch is the point of vec.round — so it
 * is only ever emitted as 0.
 */
function num(v, digits) {
  if (Number.isFinite(v)) return round(v, digits);
  return Number.isNaN(v) ? 'NaN' : (v > 0 ? 'Infinity' : '-Infinity');
}

/** A field that should not appear at all, distinguishable from a stored null. */
const DROP = Symbol('drop');

/**
 * Plain-object canonical form: thunks resolved, numbers rounded, object keys
 * sorted, arrays left in their order (an array's order is data — pass plan,
 * dropped-label list — and sorting it would destroy the thing being asserted).
 */
function canon(v, digits, seen, depth) {
  if (typeof v === 'function') {
    // Resolved HERE and nowhere else, which is what makes a thunk cost nothing
    // while the probe is disabled: canon only ever runs from snapshot().
    return depth > MAX_DEPTH ? '[deep]' : canon(v(), digits, seen, depth + 1);
  }
  if (v === undefined) return DROP;
  if (v === null) return null;
  if (typeof v === 'number') return num(v, digits);
  if (typeof v === 'boolean' || typeof v === 'string') return v;
  if (typeof v !== 'object') return String(v);            // bigint, symbol

  if (depth > MAX_DEPTH) return '[deep]';
  if (seen.has(v)) return '[cycle]';                       // a hang in a draw loop is worse
  seen.add(v);
  try {
    if (Array.isArray(v)) {
      const out = new Array(v.length);
      for (let i = 0; i < v.length; i++) {
        const c = canon(v[i], digits, seen, depth + 1);
        out[i] = c === DROP ? null : c;                    // holes are null, as in JSON
      }
      return out;
    }
    if (!isPlain(v)) return String(v);                     // Element, Map, class instance
    const out = {};
    // Sorted, so two runs that built the same object by different routes emit
    // the same bytes. JS itself orders integer-like keys numerically first;
    // that rule is deterministic too, so the guarantee holds either way.
    for (const k of Object.keys(v).sort()) {
      const c = canon(v[k], digits, seen, depth + 1);
      if (c !== DROP) out[k] = c;
    }
    return out;
  } finally {
    seen.delete(v);
  }
}

// ------------------------------------------------------------------ paths --

/**
 * Resolve a dotted path to its owning object, creating plain objects on the
 * way. Every mutator takes the same path syntax, so `set`, `count` and
 * `record` address one namespace rather than three.
 */
function at(root, path, label) {
  const parts = String(path).split('.');
  let node = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    const next = node[k];
    if (next === null || typeof next !== 'object') {
      // 'camera' holds a scalar and something now wants 'camera.yaw'. In dev
      // that is a naming collision worth stopping for; a published page keeps
      // drawing, and the structured value wins over the scalar.
      if (next !== undefined && isDev())
        throw new Error(`probe.${label}('${path}'): '${parts.slice(0, i + 1).join('.')}'` +
          ` already holds ${JSON.stringify(next)} — two writers disagree about that name`);
      node[k] = {};
    }
    node = node[k];
  }
  return { parent: node, key: parts[parts.length - 1] };
}

// ------------------------------------------------------------------ probe --

/** probe -> host, so harness() can write its verdict without a public back-reference. */
const HOSTS = new WeakMap();

/**
 * @param {Element} host           the element that carries data-probe
 * @param {object} o
 * @param {string} o.id            stable scene id, e.g. 'ambiguity'
 * @param {boolean} [o.enabled=probeEnabled()]
 * @param {number}  [o.schema=1]
 * @param {number}  [o.digits=4]   numeric rounding — makes snapshots platform-stable
 * @returns {Probe}
 */
export function createProbe(host, o) {
  // Unconditional, both of them: a probe with no host or no id is a scene that
  // cannot be found by a harness, and it fails identically whether or not the
  // page happens to have the probe switched on today.
  if (!host || typeof host.setAttribute !== 'function')
    throw new TypeError('createProbe: needs the element that will carry data-probe');
  if (!o || typeof o.id !== 'string' || !o.id)
    throw new TypeError("createProbe: { id } is required — it is the page's stable handle," +
      ' mirrored to data-probe-id');

  const id = o.id;
  const schema = o.schema ?? 1;
  const digits = Math.trunc(o.digits ?? 4);
  if (!Number.isFinite(digits) || digits < 0 || digits > 15)
    throw new RangeError(`createProbe: digits ${o.digits} is outside 0..15`);

  let enabled = o.enabled ?? probeEnabled();
  let rev = 0;
  let payload = { warnings: [] };
  let pending = 0;          // rAF handle
  let lastBody = null;      // last serialized body, rev excluded — see flush()
  const waiters = new Set();

  // data-probe-id goes on at construction, not at the first commit, so
  // document.querySelector(probeSelector(id)) is a stable handle from the
  // moment the scene exists — before it has drawn anything.
  if (enabled) host.setAttribute('data-probe-id', id);

  /** The canonical object minus `rev`: what a no-op commit compares. */
  function bodyObject() {
    const flat = canon({ schema, id, ...payload }, digits, new Set(), 0);
    const out = {};
    for (const k of TOP_ORDER) if (k !== 'rev' && k in flat) out[k] = flat[k];
    for (const k of Object.keys(flat)) if (!TOP_SET.has(k)) out[k] = flat[k];
    return out;
  }

  // `rev` third: the literal fixes schema/id/rev in the first three positions
  // and the spread re-supplies schema/id with identical values without moving
  // them, so one object literal buys the declared order.
  const withRev = (body, n) => ({ schema, id, rev: n, ...body });

  function setPath(path, value) {
    if (!enabled) return;                       // the thunk is NOT called
    if (typeof path !== 'string' || !path) {
      if (isDev()) throw new TypeError(`probe.set: path must be a dotted string, got ${String(path)}`);
      return;
    }
    const { parent, key } = at(payload, path, 'set');
    parent[key] = value;                        // a function is stored, resolved by canon()
  }

  function merge(obj) {
    if (!enabled || !obj) return;
    (function deep(dst, src) {
      for (const k of Object.keys(src)) {
        const v = src[k];
        const cur = dst[k];
        if (v && typeof v === 'object' && isPlain(v) &&
            cur && typeof cur === 'object' && isPlain(cur)) deep(cur, v);
        else dst[k] = v;
      }
    })(payload, obj);
  }

  /** Counters accumulate within a draw and are cleared by reset(), like every other field. */
  function count(name, n = 1) {
    if (!enabled) return;
    if (typeof name !== 'string' || !name) {
      if (isDev()) throw new TypeError(`probe.count: name must be a dotted string, got ${String(name)}`);
      return;
    }
    const { parent, key } = at(payload, name, 'count');
    const cur = parent[key];
    parent[key] = (typeof cur === 'number' ? cur : 0) + (Number(n) || 0);
  }

  /** Appends to the array at `kind`; the order IS the assertion, so it is never sorted. */
  function record(kind, entry) {
    if (!enabled) return;
    if (typeof kind !== 'string' || !kind) {
      if (isDev()) throw new TypeError(`probe.record: kind must be a dotted string, got ${String(kind)}`);
      return;
    }
    const { parent, key } = at(payload, kind, 'record');
    if (!Array.isArray(parent[key])) parent[key] = [];
    parent[key].push(entry);
  }

  /** Always an object, so `warnings` stays one shape for a matcher to walk. */
  function warn(msg, detail) {
    if (!enabled) return;
    if (!Array.isArray(payload.warnings)) payload.warnings = [];
    payload.warnings.push(detail === undefined ? { msg: String(msg) } : { msg: String(msg), detail });
  }

  function snapshot() {
    return withRev(bodyObject(), rev);
  }

  /**
   * The no-op test, and the reason `rev` is not part of what is compared: `rev`
   * is IN the JSON, so a frame that changed nothing would still differ from the
   * last one by its own revision counter and every frame would write. Compare
   * the body, and only then spend a revision.
   */
  function flush() {
    pending = 0;
    const body = bodyObject();
    const serialized = JSON.stringify(body);
    if (serialized === lastBody) return;        // unchanged: no write, no rev
    lastBody = serialized;
    rev += 1;

    const full = withRev(body, rev);
    // data-probe first, data-probe-rev second: a harness observing the short
    // attribute must never be woken to a stale payload.
    host.setAttribute('data-probe', JSON.stringify(full));
    host.setAttribute('data-probe-rev', String(rev));

    for (const w of [...waiters]) {
      if (rev <= w.from) continue;
      waiters.delete(w);
      clearTimeout(w.timer);
      w.resolve(full);
    }
  }

  function commit() {
    if (!enabled || pending) return;
    pending = requestAnimationFrame(flush);
  }

  /**
   * Start of every draw. A commit still pending from the previous draw is
   * flushed first, not cancelled: it describes the frame that was actually on
   * screen, and letting it fire after the clear would publish an empty scene.
   */
  function reset() {
    if (!enabled) return;
    if (pending) { cancelAnimationFrame(pending); flush(); }
    payload = { warnings: [] };                 // rev, id and the waiters survive
  }

  /**
   * @param {{rev?:number, timeout?:number}} [opt] rev defaults to the current one;
   *   timeout defaults to 2000ms, and <= 0 or Infinity waits forever.
   * Rejects on timeout rather than resolving with the stale snapshot, because a
   * harness that awaited a change and got the old scene back would report a
   * pass on a frame that never happened.
   */
  function nextRev(opt = {}) {
    const from = opt.rev ?? rev;
    const ms = opt.timeout ?? WAIT_MS;
    if (!enabled)
      return Promise.reject(new Error(`probe '${id}': disabled, so no commit will ever land` +
        ' — enable it with ?probe, data-unfold-probe on <html>, or { enabled: true }'));
    if (rev > from) return Promise.resolve(snapshot());
    return new Promise((resolve, reject) => {
      const w = { from, resolve, reject, timer: 0 };
      waiters.add(w);
      if (Number.isFinite(ms) && ms > 0) {
        w.timer = setTimeout(() => {
          waiters.delete(w);
          reject(new Error(`probe '${id}': no commit past rev ${from} within ${ms}ms` +
            ' — nothing called commit(), or the scene serialized identically'));
        }, ms);
      }
    });
  }

  /**
   * Leaves nothing attached: no pending frame, no pending timer, and no
   * attribute claiming to describe a scene that has been torn down.
   */
  function dispose() {
    if (pending) { cancelAnimationFrame(pending); pending = 0; }
    for (const w of [...waiters]) {
      clearTimeout(w.timer);
      w.reject(new Error(`probe '${id}': disposed while waiting for rev > ${w.from}`));
    }
    waiters.clear();
    if (enabled) {
      for (const a of ['data-probe', 'data-probe-rev', 'data-probe-id',
                       'data-probe-status', 'data-probe-report']) host.removeAttribute(a);
    }
    enabled = false;
    payload = { warnings: [] };
    lastBody = null;
  }

  const probe = {
    set: setPath, merge, count, record, warn,
    commit, snapshot, reset, nextRev, dispose,
    get enabled() { return enabled; },
    get rev() { return rev; },
  };
  HOSTS.set(probe, host);
  return probe;
}

/**
 * @typedef {Object} Probe
 * @property {(path:string, value:any|(()=>any)) => void} set
 *        Dotted path, e.g. 'camera.yaw'. A FUNCTION value is invoked only when
 *        enabled, and only at snapshot/commit time, so an expensive description
 *        costs nothing in production and is never stale in a golden file.
 * @property {(obj:object) => void} merge         deep merge of plain objects
 * @property {(name:string, n?:number) => void} count      counters, e.g. 'marks.face'
 * @property {(kind:string, entry:object) => void} record  append to the list at that path
 * @property {(msg:string, detail?:object) => void} warn   → warnings[]
 * @property {() => void} commit        serialize + write, rAF-coalesced, skipped if unchanged
 * @property {() => object} snapshot    the plain object incl. lazily-computed fields
 * @property {() => void} reset         called by the scene at the start of every draw
 * @property {() => void} dispose
 * @property {boolean} enabled
 * @property {number} rev
 * @property {(o?:{rev?:number,timeout?:number}) => Promise<object>} nextRev
 */

// ---------------------------------------------------------- the harness side --

/** The stable handle: `document.querySelector(probeSelector('ambiguity'))`. */
export function probeSelector(id) {
  return `[data-probe-id="${String(id).replace(/["\\]/g, '\\$&')}"]`;
}

function resolveHost(elOrSelector, label) {
  const el = typeof elOrSelector === 'string'
    ? (typeof document === 'undefined' ? null : document.querySelector(elOrSelector))
    : elOrSelector;
  if (!el || typeof el.getAttribute !== 'function')
    throw new Error(`${label}: nothing matches ${JSON.stringify(elOrSelector)}`);
  return el;
}

/** @returns {object} the committed scene description. */
export function readProbe(elOrSelector) {
  const el = resolveHost(elOrSelector, 'readProbe');
  const raw = el.getAttribute('data-probe');
  if (raw === null)
    throw new Error('readProbe: the element carries no data-probe' +
      ' — the probe is disabled, or nothing has committed yet');
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`readProbe: data-probe is not JSON (${e.message})`);
  }
}

/**
 * Resolves with the probe object once one is present past `rev`.
 * Watches data-probe-rev, which is exactly what that attribute exists for: one
 * short string to observe instead of re-parsing the payload on every frame.
 * @returns {Promise<object>}
 */
export function waitForProbe(elOrSelector, o = {}) {
  const want = o.rev;
  const ms = o.timeout ?? WAIT_MS;
  return new Promise((resolve, reject) => {
    let el;
    try { el = resolveHost(elOrSelector, 'waitForProbe'); } catch (e) { reject(e); return; }

    const ready = () => {
      const raw = el.getAttribute('data-probe');
      if (raw === null) return null;
      if (want != null && !(Number(el.getAttribute('data-probe-rev')) > want)) return null;
      try { return JSON.parse(raw); } catch { return null; }
    };

    let obs = null, timer = 0;
    const stop = () => { if (obs) obs.disconnect(); clearTimeout(timer); };

    const first = ready();
    if (first) { resolve(first); return; }

    obs = new MutationObserver(() => {
      const got = ready();
      if (!got) return;
      stop();
      resolve(got);
    });
    obs.observe(el, { attributes: true, attributeFilter: ['data-probe-rev'] });
    if (Number.isFinite(ms) && ms > 0) {
      timer = setTimeout(() => {
        stop();
        reject(new Error(`waitForProbe: no probe${want != null ? ` past rev ${want}` : ''}` +
          ` within ${ms}ms`));
      }, ms);
    }
  });
}

/** A RegExp or a predicate has to survive JSON.stringify into data-probe-report. */
const show = v => (v instanceof RegExp ? String(v)
  : typeof v === 'function' ? `<${v.name || 'predicate'}>` : v);

/**
 * Deep-subset matcher with numeric tolerance. Arrays compare element-wise; a
 * number in `expected` matches when |a−b| ≤ tolerance; a RegExp matches a
 * string; a function is a predicate. Keys `actual` has and `expected` does not
 * are ignored — that is what makes an assertion survive a new engine field.
 * @returns {{ pass: boolean, failures: {path:string, expected:any, actual:any}[] }}
 */
export function assertProbe(actual, expected, o = {}) {
  const tolerance = o.tolerance ?? 1e-3;
  const failures = [];
  const fail = (path, exp, got) => failures.push({ path: path || '.', expected: show(exp), actual: got });

  (function walk(path, got, exp) {
    if (exp instanceof RegExp) {
      if (typeof got !== 'string' || !exp.test(got)) fail(path, exp, got);
      return;
    }
    if (typeof exp === 'function') {
      let ok = false;
      try { ok = !!exp(got); } catch { ok = false; }
      if (!ok) fail(path, exp, got);
      return;
    }
    if (typeof exp === 'number') {
      // A tolerance, not equality: a rounded 0.4363 out of a camera is the same
      // answer as 0.43629, and a golden file that disagrees about the last
      // digit is a golden file nobody keeps.
      if (typeof got !== 'number' || !(Math.abs(got - exp) <= tolerance)) fail(path, exp, got);
      return;
    }
    if (Array.isArray(exp)) {
      if (!Array.isArray(got)) { fail(path, exp, got); return; }
      // Length is checked, so `warnings: []` means "none", not "at least none".
      if (got.length !== exp.length) { fail(`${path}.length`, exp.length, got.length); return; }
      exp.forEach((v, i) => walk(`${path}[${i}]`, got[i], v));
      return;
    }
    if (exp && typeof exp === 'object') {
      if (!got || typeof got !== 'object' || Array.isArray(got)) { fail(path, exp, got); return; }
      for (const k of Object.keys(exp)) walk(path ? `${path}.${k}` : k, got[k], exp[k]);
      return;
    }
    if (!Object.is(got, exp)) fail(path, exp, got);
  })('', actual, expected);

  return { pass: failures.length === 0, failures };
}

/**
 * In-page test runner. Runs `cases` against this probe, writes
 *   data-probe-status="pass" | "fail"  and  data-probe-report='[…]'
 * on the host. A CI job therefore needs only "load tests.html, read one
 * attribute" — no test framework, no npm.
 *
 * Each case is { name, setup?, expect?, tolerance?, timeout? }. `setup` may be
 * async; the runner then waits for the scene's next commit, and falls back to
 * the current snapshot when none arrives — a setup that changed nothing
 * produces no new rev, and that is an answer, not a failure.
 *
 * @returns {Promise<{pass:boolean, results:[]}>}
 */
export async function harness(probe, cases) {
  const host = HOSTS.get(probe);
  if (!host) throw new TypeError('harness: expects a probe returned by createProbe()');
  if (!probe.enabled)
    throw new Error('harness: the probe is disabled, so every case would assert on an empty' +
      ' scene — enable it with ?probe or data-unfold-probe on <html>');

  const results = [];
  for (const c of cases) {
    const before = probe.rev;
    let actual = null, error = null;
    try {
      if (c.setup) await c.setup();
      actual = c.setup
        ? await probe.nextRev({ rev: before, timeout: c.timeout ?? WAIT_MS })
            .catch(() => probe.snapshot())
        : probe.snapshot();
    } catch (e) {
      error = e;
    }
    const checked = error || !c.expect
      ? { pass: !error, failures: [] }
      : assertProbe(actual, c.expect, { tolerance: c.tolerance });
    results.push({
      name: c.name,
      pass: checked.pass,
      failures: checked.failures,
      error: error ? (error.message || String(error)) : null,
    });
  }

  const pass = results.every(r => r.pass);
  host.setAttribute('data-probe-status', pass ? 'pass' : 'fail');
  host.setAttribute('data-probe-report', JSON.stringify(results));
  return { pass, results };
}
