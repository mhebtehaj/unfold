// Domains, maps, time-indexed families, and picking by forward evaluation.
//
// This module owns the PLUMBING of the homotopy explorer — evaluate, sample,
// step, compose, pick, detect a collapsed image — and none of its mathematics.
// It never asserts continuity, injectivity or homotopy-ness, and it has no
// method that could: the only continuity-adjacent fact in Layer 2 is
// parametric.js's jumpAcross, which produces witnesses of FAILURE only.
// `defineHomotopy` is `defineFamily` under a second name, for pages that would
// read strangely otherwise; the name asserts nothing (spec §2.7, Q2).
//
// What it replaces, in the shipped explorer:
//
//   - the keydown handler that branches on the example's kind to decide
//     whether an arrow key wraps (circle) or clamps (interval, radius). Here
//     `Domain.step` owns that decision, from the axes, so a keyboard handler
//     never names a domain;
//   - four hand-written nearest-candidate loops, each re-evaluating up to 3 780
//     candidates per pointermove (homotopy.md §15.13). `createPicker` evaluates
//     once per context change and scans the cache;
//   - the `collapsed()` id allowlist, by a numeric test (`isDegenerate`).
//
// Inputs are plain objects keyed by axis name — {u} on a 1-D domain, {u, r}
// on the disk and annulus. Every function here that returns an input returns a
// NEW object that preserves every field it did not change ({...input, u: next}),
// because the port keeps r: 1 on circle inputs and branch: 'loop'|'tail' on the
// wedge's, and an arrow key must not lose them.
//
// Several expressions are EXACT: they are the shipped explorer's own, token
// for token, so the port lands on the same bits. Each is marked where it is
// written. Do not "simplify" them; the tests compare with Object.is.

import { TOL } from './tolerance.js';
import { Claim } from './claim.js';
import { TAU, polar } from './parametric.js';

export const LAYER = 2;

const finite = x => typeof x === 'number' && Number.isFinite(x);
const MODES = ['curve', 'mesh', 'pick', 'sparse', 'boundary'];
const IDENTIFICATIONS = ['periodic', 'flip', 'collapse', 'none'];

// ---- domains -------------------------------------------------------------

function freezeAxis(a, where) {
  if (!a || typeof a !== 'object' || typeof a.name !== 'string' || a.name === '')
    throw new TypeError(`${where}: each axis is { name, min, max, wrap }`);
  if (!finite(a.min) || !finite(a.max) || !(a.min < a.max))
    throw new RangeError(`${where}: axis "${a.name}" needs finite min < max, got [${a.min}, ${a.max}]`);
  if (typeof a.wrap !== 'boolean') throw new TypeError(`${where}: axis "${a.name}" needs wrap: true | false`);
  return Object.freeze({ name: a.name, min: a.min, max: a.max, wrap: a.wrap });
}

function freezeSeam(s, axes, where) {
  if (!s || typeof s !== 'object' || typeof s.id !== 'string' || !Array.isArray(s.at) ||
      s.at.length !== 2 || !finite(s.at[0]) || !finite(s.at[1]) || !IDENTIFICATIONS.includes(s.identification))
    throw new TypeError(`${where}: a seam is { id, axis, at: [a, b], identification: ` +
                        `${IDENTIFICATIONS.map(x => `'${x}'`).join(' | ')} }`);
  if (!axes.some(a => a.name === s.axis))
    throw new RangeError(`${where}: seam "${s.id}" is on axis "${s.axis}", which the domain does not have`);
  const out = { id: s.id, axis: s.axis, at: Object.freeze([s.at[0], s.at[1]]), identification: s.identification };
  if (s.part !== undefined) out.part = s.part;
  return Object.freeze(out);
}

function axisIndex(axes, axis, where) {
  if (typeof axis === 'number' && Number.isInteger(axis) && axis >= 0 && axis < axes.length) return axis;
  if (typeof axis === 'string') { const i = axes.findIndex(a => a.name === axis); if (i >= 0) return i; }
  throw new RangeError(`${where}: no axis ${JSON.stringify(axis)} — the axes are ` +
                       `${axes.map(a => `'${a.name}'`).join(', ') || '(none)'}, by name or index`);
}

/** One step along one axis: wrap or clamp, from the axis alone. */
function stepAlong(a, v, delta, where) {
  if (!finite(delta)) throw new TypeError(`${where}: delta must be a finite number, got ${String(delta)}`);
  if (a.wrap) {
    if (a.min === 0 && a.max === 1) {
      // EXACT — the shipped arrow keys compute (u+delta+1)%1, and the port must
      // land on the same bits, so this is that expression rather than a
      // general modulo. It is correct for |delta| < 1 and u in [0, 1].
      if (!(Math.abs(delta) < 1))
        throw new RangeError(`${where}: |delta| must be < 1 on the wrap axis "${a.name}", got ${delta}`);
      const next = (v + delta + 1) % 1;
      if (!(next >= 0)) throw new RangeError(`${where}: ${a.name} = ${v} is outside the wrap axis [0, 1]`);
      return next;
    }
    const L = a.max - a.min;
    let next = a.min + (((v - a.min + delta) % L) + L) % L;
    if (!(next >= a.min && next < a.max)) next = a.min;      // rounding landed on max, which is min
    return next;
  }
  return Math.min(a.max, Math.max(a.min, v + delta));       // EXACT — the shipped clamp
}

function defaultStep(id, axes) {
  return (input, axis, delta) => {
    if (input === null || typeof input !== 'object')
      throw new TypeError(`${id}.step: input must be an object such as { u: 0.2 }`);
    if (!axes.length) return { ...input };     // nothing to move along
    const a = axes[axisIndex(axes, axis, `${id}.step`)];
    const v = input[a.name];
    if (typeof v !== 'number') throw new TypeError(`${id}.step: input has no numeric "${a.name}"`);
    return { ...input, [a.name]: stepAlong(a, v, delta, `${id}.step`) };
  };
}

/** a.min + (a.max − a.min)·i/res for i = 0 … res, or … res − 1 when the far end is dropped. */
function lattice(a, res, keepEnd) {
  const n = keepEnd ? res + 1 : res, out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = a.min + (a.max - a.min) * i / res;
  return out;
}

/** The product of per-axis value lists, the FIRST axis varying fastest. */
function product(axes, values) {
  let combos = [[]];
  for (let k = 0; k < axes.length; k++) {
    const next = [];
    for (const v of values[k]) for (const c of combos) next.push([...c, v]);
    combos = next;
  }
  return combos.map(c => Object.freeze(Object.fromEntries(axes.map((a, k) => [a.name, c[k]]))));
}

function defaultSample(id, axes, seams) {
  return ({ mode = 'curve', resolution } = {}) => {
    if (!MODES.includes(mode))
      throw new RangeError(`${id}.sample: unknown mode "${mode}" — use ${MODES.map(m => `'${m}'`).join(', ')}`);
    const dim = axes.length;
    if (dim === 0) return Object.freeze(mode === 'boundary' ? [] : [Object.freeze({})]);
    const res = (k, fallback) => {
      const r = (Array.isArray(resolution) ? resolution[k] : resolution) ?? fallback;
      if (!Number.isInteger(r) || r < 1)
        throw new RangeError(`${id}.sample: resolution must be a positive integer (or one per axis), got ${String(r)}`);
      return r;
    };
    if (mode === 'curve') {
      if (dim !== 1)
        throw new RangeError(`${id}.sample: mode 'curve' is a 1-D walk and "${id}" has dim ${dim} — ` +
                             `use 'mesh', 'pick', 'sparse' or 'boundary'`);
      return Object.freeze(product(axes, [lattice(axes[0], res(0, 144), true)]));
    }
    if (mode === 'mesh') return Object.freeze(product(axes, axes.map((a, k) => lattice(a, res(k, 24), true))));
    if (mode === 'pick')
      return Object.freeze(product(axes, axes.map((a, k) =>
        lattice(a, res(k, dim === 1 ? 720 : a.wrap ? 180 : 20), !a.wrap))));
    if (mode === 'sparse')
      return Object.freeze(product(axes, axes.map((a, k) => k === 0
        ? lattice(a, res(0, a.wrap ? 9 : 8), !a.wrap)
        : [(a.min + a.max) / 2])));
    const out = [];                                            // 'boundary'
    axes.forEach((a, k) => {
      if (a.wrap) return;                                      // a periodic axis has no ends
      for (const e of [a.min, a.max]) {
        const collapsed = seams.some(s => s.axis === a.name && s.identification === 'collapse' && s.at.includes(e));
        if (collapsed) continue;                               // an end that collapses to a point is not boundary
        out.push(...product(axes, axes.map((b, j) => j === k ? [e] : lattice(b, res(j, 144), true))));
      }
    });
    return Object.freeze(out);
  };
}

function buildDomain({ id, label, dim, axes, embed, sample, step, invert, seams = [] }, extra = {}) {
  const where = `defineDomain(${JSON.stringify(id)})`;
  if (typeof id !== 'string' || id === '') throw new TypeError('defineDomain: id must be a non-empty string');
  if (label !== undefined && typeof label !== 'string') throw new TypeError(`${where}: label must be a string`);
  if (!Number.isInteger(dim) || dim < 0) throw new RangeError(`${where}: dim must be an integer >= 0`);
  if (axes === undefined && dim === 0) axes = [];
  if (!Array.isArray(axes) || axes.length !== dim)
    throw new RangeError(`${where}: axes must list one { name, min, max, wrap } per dimension (dim ${dim})`);
  const ax = Object.freeze(axes.map(a => freezeAxis(a, where)));
  if (new Set(ax.map(a => a.name)).size !== ax.length) throw new RangeError(`${where}: axis names must differ`);
  if (typeof embed !== 'function') throw new TypeError(`${where}: embed must be a function input => point`);
  for (const [name, fn] of [['sample', sample], ['step', step], ['invert', invert]])
    if (fn !== undefined && typeof fn !== 'function') throw new TypeError(`${where}: ${name} must be a function`);
  if (!Array.isArray(seams)) throw new TypeError(`${where}: seams must be an array`);
  const sm = Object.freeze(seams.map(s => freezeSeam(s, ax, where)));
  const domain = {
    id, label: label ?? id, dim, axes: ax,
    embed,
    sample: sample ?? defaultSample(id, ax, sm),
    step: step ?? defaultStep(id, ax),
  };
  if (invert) domain.invert = invert;
  domain.seams = sm;
  return Object.freeze(Object.assign(domain, extra));
}

/**
 * A domain: the inputs a map can be evaluated on, how to draw them, and how
 * the keyboard moves through them. Frozen.
 *
 *   id, label, dim
 *   axes      Readonly<{ name, min, max, wrap }>[] — one per dimension; [] at dim 0
 *   embed(input) -> Point           where the input is drawn in the source panel
 *   sample({ mode = 'curve', resolution }) -> Input[]   deterministic; see below
 *   step(input, axis, delta) -> Input   axis by name ('u', 'r') or index
 *   invert?(point) -> Input | null      an analytic inverse, when one exists
 *   seams                               Seam[] — see parametric.js
 *
 * `step` defaults from the axes (a domain may pass its own):
 *   - a wrap axis on [0, 1]: EXACT (v + delta + 1) % 1, the shipped arrow-key
 *     expression; |delta| >= 1 throws, since the expression is only right below it.
 *     A wrap axis on another interval [a, b) uses a general modulo.
 *   - a clamp axis: EXACT Math.min(max, Math.max(min, v + delta)).
 *   The result is {...input, [axis]: next}: every other field survives.
 *   At dim 0 there is nothing to move and step returns a copy of the input.
 *
 * `sample` defaults from the axes. `resolution` is a number of STEPS, one
 * number for every axis or an array with one per axis. Values along an axis are
 * min + (max − min)·i/res — on [0, 1], exactly i/res. Every mode is
 * deterministic; the order is stated because a caller may index into it:
 *   'curve'     dim 1 only (anything else throws): i = 0 … res, both ends.
 *               Default res 144, the shipped curve resolution.
 *   'mesh'      the product lattice, i = 0 … res on every axis (both ends, so
 *               the closing column is there to draw). The FIRST axis varies
 *               fastest: on {u, r}, each r row is a full u walk, rows in
 *               increasing r (index = j·(resU + 1) + i). Default res 24.
 *   'pick'      a dense product lattice for nearest-candidate search, the same
 *               order as 'mesh', but a wrap axis drops its far end (it names the
 *               same point as the near end). Default res 720 at dim 1; at dim 2,
 *               180 on a wrap axis and 20 on a clamp axis — the shipped disk grid.
 *   'sparse'    a handful, for correspondence connectors: the first axis only,
 *               pick-style (default 9 steps on a wrap axis, 8 on a clamp axis),
 *               every other axis held at its midpoint.
 *   'boundary'  for each clamp axis in order, its min end then its max end, as a
 *               lattice over the other axes (default res 144, both ends); a wrap
 *               axis has no ends, and an end named by a 'collapse' seam is a
 *               point, not boundary. Circle → [], Interval → [{u:0}, {u:1}],
 *               Disk → its rim, Annulus → inner rim then outer rim.
 * At dim 0 every mode gives [{}] except 'boundary', which gives [].
 * The returned arrays and inputs are frozen; step still works on them, since
 * it copies.
 *
 * @param {object} spec
 */
export function defineDomain(spec) {
  if (!spec || typeof spec !== 'object') throw new TypeError('defineDomain: pass { id, dim, axes, embed, … }');
  return buildDomain(spec);
}

const WRAP_SEAM = Object.freeze({ id: 'wrap', axis: 'u', at: [0, 1], identification: 'periodic' });
const U_WRAP = { name: 'u', min: 0, max: 1, wrap: true };

/** Clamps u on [from, to]. EXACT: embed({u}) → [u]. */
export function Interval({ from = 0, to = 1 } = {}) {
  if (!finite(from) || !finite(to) || !(from < to))
    throw new RangeError(`Interval: need finite from < to, got [${from}, ${to}]`);
  return buildDomain({
    id: from === 0 && to === 1 ? 'interval' : `interval[${from},${to}]`, label: 'interval', dim: 1,
    axes: [{ name: 'u', min: from, max: to, wrap: false }],
    embed: ({ u }) => [u],
  });
}

/** u clamps on [0, 1], drawn as the diameter [−1, 1] of the unit disk. EXACT: embed({u}) → [2u − 1, 0]. */
export function Segment() {
  return buildDomain({
    id: 'segment', label: 'segment', dim: 1,
    axes: [{ name: 'u', min: 0, max: 1, wrap: false }],
    embed: ({ u }) => [2 * u - 1, 0],
  });
}

/**
 * u wraps on [0, 1], with one periodic seam at u = 0 ~ 1.
 * EXACT: embed({u}) → polar(u, 1); invert([x, y]) → { u: (atan2(y, x)/TAU + 1) % 1 }.
 */
export function Circle() {
  return buildDomain({
    id: 'circle', label: 'circle', dim: 1,
    axes: [U_WRAP],
    embed: ({ u }) => polar(u, 1),
    invert: ([x, y]) => ({ u: (Math.atan2(y, x) / TAU + 1) % 1 }),
    seams: [WRAP_SEAM],
  });
}

/**
 * The disk of radius R: u wraps on [0, 1], r clamps on [0, R]. Seams: periodic
 * on u, and a collapse at r = 0 (the whole edge r = 0 is the centre; the seam's
 * `at` is [0, 0] because only that end collapses).
 * EXACT: embed({u, r}) → polar(u, r);
 *        invert([x, y]) → { u: (atan2(y, x)/TAU + 1) % 1, r: min(R, max(0, hypot(x, y))) }.
 */
export function Disk({ r = 1 } = {}) {
  const R = r;
  if (!finite(R) || !(R > 0)) throw new RangeError(`Disk: r must be a positive number, got ${String(R)}`);
  return buildDomain({
    id: R === 1 ? 'disk' : `disk(r=${R})`, label: 'disk', dim: 2,
    axes: [U_WRAP, { name: 'r', min: 0, max: R, wrap: false }],
    embed: ({ u, r }) => polar(u, r),
    invert: ([x, y]) => ({ u: (Math.atan2(y, x) / TAU + 1) % 1, r: Math.min(R, Math.max(0, Math.hypot(x, y))) }),
    seams: [WRAP_SEAM, { id: 'center', axis: 'r', at: [0, 0], identification: 'collapse' }],
  });
}

/**
 * The annulus inner <= r <= outer: as Disk, with r clamping on [inner, outer]
 * and no collapse seam (both rims are boundary). Needs inner > 0 — at inner = 0
 * the domain is a Disk, whose centre collapses.
 * EXACT: embed({u, r}) → polar(u, r);
 *        invert([x, y]) → { u: (atan2(y, x)/TAU + 1) % 1, r: min(outer, max(inner, hypot(x, y))) }.
 */
export function Annulus({ inner = 0.45, outer = 1 } = {}) {
  if (!finite(inner) || !finite(outer) || !(inner > 0) || !(inner < outer))
    throw new RangeError(`Annulus: need 0 < inner < outer, got inner ${inner}, outer ${outer} — ` +
                         'use Disk for inner = 0');
  return buildDomain({
    id: inner === 0.45 && outer === 1 ? 'annulus' : `annulus(${inner},${outer})`, label: 'annulus', dim: 2,
    axes: [U_WRAP, { name: 'r', min: inner, max: outer, wrap: false }],
    embed: ({ u, r }) => polar(u, r),
    invert: ([x, y]) => ({
      u: (Math.atan2(y, x) / TAU + 1) % 1, r: Math.min(outer, Math.max(inner, Math.hypot(x, y))),
    }),
    seams: [WRAP_SEAM],
  });
}

/** One point. dim 0, no axes; embed() → [0, 0]; step returns a copy; sample() → [{}]. */
export function PointDomain() {
  return buildDomain({ id: 'point', label: 'point', dim: 0, axes: [], embed: () => [0, 0] });
}

/**
 * Several domains joined into one, like the circle with a tail.
 *
 * `parts` is { name: { domain, embed? } }, in declaration order; `embed`
 * overrides the part domain's own drawing (the tail's loop is not the unit
 * circle). An input is { [key]: name, ...coords }.
 *
 *   embed(input), step(input, …)   dispatch on input[key]. step moves within the
 *                                  part and keeps input[key]: an arrow key never
 *                                  jumps branch.
 *   sample(opts)                   each part's sample(opts), in declaration order,
 *                                  every input tagged { [key]: name, ...coords }
 *   dim                            the largest part dim
 *   axes                           a per-index summary for display — the name
 *                                  (the parts must agree on it), the widest
 *                                  [min, max], and wrap only if every part wraps.
 *                                  Stepping uses each part's own axes, not this.
 *   seams                          each part's seams, id prefixed "name/", with
 *                                  a `part` field naming the part
 *   parts, key                     Wedge-only members: the frozen parts and the tag
 *
 * An input whose input[key] names no part throws, naming the parts.
 *
 * @param {Record<string, {domain: object, embed?: Function}>} parts
 * @param {{key?: string, id?: string, label?: string}} [o]
 */
export function Wedge(parts, { key = 'part', id, label } = {}) {
  if (!parts || typeof parts !== 'object' || Array.isArray(parts))
    throw new TypeError('Wedge: parts must be an object { name: { domain, embed? } }, in order');
  const names = Object.keys(parts);
  if (!names.length) throw new RangeError('Wedge: give at least one part');
  if (typeof key !== 'string' || key === '') throw new TypeError('Wedge: key must be a non-empty string');
  const wid = id ?? `wedge(${names.join(',')})`;
  const frozen = {};
  for (const name of names) {
    const p = parts[name];
    const d = p?.domain;
    if (!d || typeof d.embed !== 'function' || typeof d.step !== 'function' ||
        typeof d.sample !== 'function' || !Array.isArray(d.axes))
      throw new TypeError(`Wedge: part "${name}" needs { domain } made by defineDomain or a built-in`);
    if (p.embed !== undefined && typeof p.embed !== 'function')
      throw new TypeError(`Wedge: part "${name}".embed must be a function`);
    if (d.axes.some(a => a.name === key))
      throw new RangeError(`Wedge: part "${name}" has an axis named "${key}", which is the part tag — pass another key`);
    frozen[name] = Object.freeze({ domain: d, embed: p.embed });
  }
  const dim = Math.max(...names.map(n => frozen[n].domain.dim));
  const axes = [];
  for (let k = 0; k < dim; k++) {
    const here = names.map(n => frozen[n].domain.axes[k]).filter(Boolean);
    if (new Set(here.map(a => a.name)).size !== 1)
      throw new RangeError(`Wedge: the parts name axis ${k} differently (${here.map(a => a.name).join(', ')})`);
    axes.push({ name: here[0].name, min: Math.min(...here.map(a => a.min)),
                max: Math.max(...here.map(a => a.max)), wrap: here.every(a => a.wrap) });
  }
  const partOf = (input, where) => {
    const name = input?.[key];
    if (typeof name !== 'string' || !Object.hasOwn(frozen, name))
      throw new RangeError(`${wid}.${where}: input.${key} = ${JSON.stringify(name)} is not a part — ` +
                           `the parts are ${names.map(n => `'${n}'`).join(', ')}`);
    return frozen[name];
  };
  return buildDomain({
    id: wid, label: label ?? wid, dim, axes,
    embed: input => { const p = partOf(input, 'embed'); return (p.embed ?? p.domain.embed)(input); },
    step: (input, axis, delta) => {
      const out = partOf(input, 'step').domain.step(input, axis, delta);
      return out[key] === input[key] ? out : { ...out, [key]: input[key] };
    },
    sample: (opts) => {
      const out = [];
      for (const name of names)
        for (const inp of frozen[name].domain.sample(opts)) out.push(Object.freeze({ [key]: name, ...inp }));
      return Object.freeze(out);
    },
    seams: names.flatMap(n => frozen[n].domain.seams.map(s => ({ ...s, id: `${n}/${s.id}`, part: n }))),
  }, { parts: Object.freeze(frozen), key });
}

// ---- maps ----------------------------------------------------------------
//
// A map's argument is whatever its caller evaluates it on — a domain input
// such as {u, r}, or an embedded point [x, y]. Layer 2 does not convert
// between the two: the shipped equivalence widget composes point-to-point
// maps, the homotopy widget evaluates families on inputs, and both are kept.
// The only structural check is the one that can be made honestly: ids.

const idOf = x => (typeof x === 'string' ? x : x?.id);

function checkSame(a, b, what) {
  if (a === undefined || a === null || b === undefined || b === null) return;
  const ia = idOf(a), ib = idOf(b);
  if (typeof ia !== 'string' || typeof ib !== 'string')
    throw new TypeError(`${what}: cannot check that the spaces agree — give each domain and codomain an id`);
  if (ia !== ib) throw new RangeError(`${what}: "${ia}" is not "${ib}"`);
}

/** A Map, or a plain function taken as an anonymous map with no spaces. */
function mapLike(m, where) {
  if (typeof m === 'function') return { id: m.name || 'fn', label: m.name || 'fn', at: m };
  if (m && typeof m.at === 'function')
    return { id: m.id ?? 'map', label: m.label ?? m.id ?? 'map', at: x => m.at(x),
             domain: m.domain, codomain: m.codomain };
  throw new TypeError(`${where}: expected a Map (defineMap, identity, …) or a function`);
}

/**
 * A map: { id, label, at, domain, codomain }, frozen. `at` is the caller's
 * function, unwrapped. domain and codomain are optional; when both sides of a
 * composition name theirs, compose checks them.
 */
export function defineMap({ id, label, at, domain, codomain } = {}) {
  if (typeof id !== 'string' || id === '') throw new TypeError('defineMap: id must be a non-empty string');
  if (label !== undefined && typeof label !== 'string') throw new TypeError(`defineMap("${id}"): label must be a string`);
  if (typeof at !== 'function') throw new TypeError(`defineMap("${id}"): at must be a function`);
  return Object.freeze({ id, label: label ?? id, at, domain, codomain });
}

/**
 * The identity on `domain`: at(x) returns x ITSELF, whatever representation x
 * is in. That is what makes straightLine(identity(X), g) reproduce the shipped
 * p.map((v, i) => (1 − t)·v + t·q[i]) exactly: f(x) is the very array p.
 */
export function identity(domain) {
  if (typeof idOf(domain) !== 'string') throw new TypeError('identity: pass the domain (it needs an id)');
  return defineMap({ id: `identity(${idOf(domain)})`, label: 'identity', at: x => x, domain, codomain: domain });
}

/** The map sending everything to one point. The point is copied and frozen, and the same array is returned every time. */
export function constantMap(domain, value) {
  if (!Array.isArray(value) || !value.every(finite)) throw new TypeError('constantMap: value must be a point, e.g. [0, 0]');
  const v = Object.freeze([...value]);
  return defineMap({ id: `constant(${v.join(',')})`, label: 'constant', at: () => v, domain });
}

/**
 * g ∘ f, evaluated as g.at(f.at(x)). Its domain is f's, its codomain g's.
 * Throws AT CONSTRUCTION when f.codomain and g.domain are both given and their
 * ids differ — a mismatched composition found at evaluation time is found in
 * a pointermove handler, by a reader.
 */
export function compose(g, f) {
  const G = mapLike(g, 'compose: g'), F = mapLike(f, 'compose: f');
  checkSame(F.codomain, G.domain, `compose(${G.id}, ${F.id}): f's codomain and g's domain differ —`);
  return defineMap({ id: `${G.id}∘${F.id}`, label: `${G.label} ∘ ${F.label}`,
                     at: x => G.at(F.at(x)), domain: F.domain, codomain: G.codomain });
}

/** The same map on a smaller domain. Inclusion is the caller's to know; nothing is checked but the id. */
export function restrict(map, subdomain) {
  const M = mapLike(map, 'restrict');
  if (typeof idOf(subdomain) !== 'string') throw new TypeError('restrict: pass the subdomain (it needs an id)');
  return defineMap({ id: `${M.id}|${idOf(subdomain)}`, label: M.label, at: M.at, domain: subdomain, codomain: M.codomain });
}

// ---- families ------------------------------------------------------------

function checkRange(range, where) {
  if (!Array.isArray(range) || range.length !== 2 || !finite(range[0]) || !finite(range[1]) || !(range[0] < range[1]))
    throw new RangeError(`${where}: range must be [a, b] with a < b, both finite`);
  return Object.freeze([range[0], range[1]]);
}

/**
 * A time-indexed family of maps H(x, t), frozen. Nothing here asserts that it
 * is continuous in x or in t.
 *
 *   at(input, t)      the caller's function, unwrapped
 *   frame(t)          the Map x ↦ at(x, t); frame(t).at(x) is at(x, t), the same
 *                     call. t outside `range` throws.
 *   endpoints()       { start: frame(range[0]), end: frame(range[1]) }
 *   reparametrize(g)  the family (x, t) ↦ at(x, g(t)), on the same range; g must
 *                     map the range into itself (not checked)
 *   concat(other)     this family on the first half of the range, `other` on the
 *                     second, each rescaled affinely to its own range. THE SEAM: at
 *                     the midpoint exactly, this family is evaluated at the end of
 *                     its range. Nothing checks that this agrees with other's start
 *                     — that agreement is what would make the result a path of maps,
 *                     and Layer 2 never asserts it. On [0, 1] the rescaling is
 *                     exactly 2t and 2t − 1, so the endpoints land on 0 and 1.
 *
 * `defineHomotopy` is this same function, for pages where "family" reads oddly.
 */
export function defineFamily({ id, label, at, domain, codomain, range = [0, 1] } = {}) {
  if (typeof id !== 'string' || id === '') throw new TypeError('defineFamily: id must be a non-empty string');
  if (label !== undefined && typeof label !== 'string') throw new TypeError(`defineFamily("${id}"): label must be a string`);
  if (typeof at !== 'function') throw new TypeError(`defineFamily("${id}"): at must be a function (input, t) => point`);
  const r = checkRange(range, `defineFamily("${id}")`);
  const name = label ?? id;
  const frame = t => {
    if (!finite(t) || t < r[0] || t > r[1])
      throw new RangeError(`family "${id}".frame: t = ${String(t)} is outside its range [${r[0]}, ${r[1]}]`);
    return defineMap({ id: `${id}@${t}`, label: name, at: x => at(x, t), domain, codomain });
  };
  return Object.freeze({
    id, label: name, domain, codomain, range: r,
    at,
    frame,
    endpoints: () => Object.freeze({ start: frame(r[0]), end: frame(r[1]) }),
    reparametrize(g) {
      if (typeof g !== 'function') throw new TypeError(`family "${id}".reparametrize: g must be a function t => t'`);
      return defineFamily({ id: `${id}∘g`, label: name, at: (x, t) => at(x, g(t)), domain, codomain, range: r });
    },
    concat(other) {
      if (!other || typeof other.at !== 'function' || !Array.isArray(other.range))
        throw new TypeError(`family "${id}".concat: other must be a Family`);
      checkSame(domain, other.domain, `family "${id}".concat: the domains differ —`);
      checkSame(codomain, other.codomain, `family "${id}".concat: the codomains differ —`);
      const [a, b] = r, m = (a + b) / 2, [a2, b2] = other.range, second = other.at;
      return defineFamily({
        id: `${id}·${other.id}`, label: `${name} then ${other.label ?? other.id}`, domain, codomain, range: r,
        at: (x, t) => {
          if (t <= m) { const s = (t - a) / (m - a); return at(x, (1 - s) * r[0] + s * r[1]); }
          const s = (t - m) / (b - m);
          return second(x, (1 - s) * a2 + s * b2);
        },
      });
    },
  });
}

export { defineFamily as defineHomotopy };

/**
 * The straight-line family from f to g: (1 − t)·f(x) + t·g(x), componentwise.
 * f and g are Maps or plain functions of the input; each is evaluated once.
 * EXACT: at(x, t) = f(x).map((v, i) => (1 - t) * v + t * g(x)[i]) — the shipped
 * eqHomotopy's expression.
 */
export function straightLine(f, g) {
  const F = mapLike(f, 'straightLine: f'), G = mapLike(g, 'straightLine: g');
  checkSame(F.domain, G.domain, `straightLine(${F.id}, ${G.id}): the domains differ —`);
  checkSame(F.codomain, G.codomain, `straightLine(${F.id}, ${G.id}): the codomains differ —`);
  const fa = F.at, ga = G.at;
  return defineFamily({
    id: `straightLine(${F.id},${G.id})`, label: 'straight line',
    domain: F.domain ?? G.domain, codomain: F.codomain ?? G.codomain,
    at: (x, t) => { const a = fa(x), b = ga(x); return a.map((v, i) => (1 - t) * v + t * b[i]); },
  });
}

/** An input read as polar parameters {u (turns), r = 1}; anything else throws. */
function polarParts(x, where) {
  if (!x || typeof x.u !== 'number') throw new TypeError(`${where}: expected an input { u, r } or a point [x, y]`);
  const r = x.r ?? 1;
  if (typeof r !== 'number') throw new TypeError(`${where}: input.r must be a number`);
  return [x.u, r];
}

/**
 * Radial interpolation: every input {u, r} keeps its angle while its radius
 * moves linearly from `from` to `to`.
 *
 *   at(input, t) = polar(input.u, (1 − t)·from(input) + t·to(input))
 *
 * `from` and `to` are numbers or functions of the input; `from` defaults to
 * the input's own r. EXACT for the shipped annulus_retract:
 * radialInterp({ to: 0.45 }) is polar(u, (1 − t)·r + t·0.45).
 */
export function radialInterp({ from, to } = {}) {
  const radius = (spec, name) => {
    if (spec === undefined && name === 'from') return input => input.r;
    if (typeof spec === 'function') return spec;
    if (finite(spec)) return () => spec;
    throw new TypeError(`radialInterp: ${name} must be a radius or a function input => radius`);
  };
  const R0 = radius(from, 'from'), R1 = radius(to, 'to');
  return defineFamily({
    id: 'radialInterp', label: 'radial interpolation',
    at: (input, t) => {
      if (!input || typeof input.u !== 'number') throw new TypeError('radialInterp: inputs are { u, r }');
      const r0 = R0(input), r1 = R1(input);
      if (!finite(r0) || !finite(r1))
        throw new TypeError(`radialInterp: the radii at this input are ${r0} and ${r1} — does it have an r?`);
      return polar(input.u, (1 - t) * r0 + t * r1);
    },
  });
}

/**
 * Rotation about the origin. `turns` is a number k — rotate by k·t turns — or
 * a function t ↦ turns.
 *
 *   an input {u, r}   polar(u + a, r ?? 1), with a the rotation in turns: exact
 *                     in the parameter, and EXACT for the shipped rotation:
 *                     rotateBy(0.5) is polar(u + t/2) (t·0.5 and t/2 are the same double)
 *   a point [x, y]    [c·x − s·y, s·x + c·y], c = cos 2πa, s = sin 2πa
 */
export function rotateBy(turns) {
  let angle;
  if (typeof turns === 'function') angle = turns;
  else if (finite(turns)) angle = t => t * turns;
  else throw new TypeError('rotateBy: turns must be a number or a function t => turns');
  return defineFamily({
    id: 'rotateBy', label: 'rotation',
    at: (x, t) => {
      const a = angle(t);
      if (Array.isArray(x)) {
        if (x.length !== 2) throw new TypeError('rotateBy: points are 2-D');
        const c = Math.cos(TAU * a), s = Math.sin(TAU * a);
        return [c * x[0] - s * x[1], s * x[0] + c * x[1]];
      }
      const [u, r] = polarParts(x, 'rotateBy');
      return polar(u + a, r);
    },
  });
}

/**
 * Scaling about the origin by s(t): x ↦ s(t)·x. A point [x, y] is scaled
 * directly; an input {u, r} is embedded by polar(u, r ?? 1) first, so the
 * shipped disk contraction [(1−t)·z₀, (1−t)·z₁] is scaleBy(t => 1 − t) exactly.
 */
export function scaleBy(s) {
  if (typeof s !== 'function') throw new TypeError('scaleBy: s must be a function t => factor');
  return defineFamily({
    id: 'scaleBy', label: 'scaling',
    at: (x, t) => {
      const k = s(t);
      const p = Array.isArray(x) ? x : polar(...polarParts(x, 'scaleBy'));
      return p.map(v => k * v);
    },
  });
}

// ---- picking -------------------------------------------------------------

/**
 * Picking by forward evaluation: find the input whose IMAGE is drawn nearest
 * the pointer, so a pick in a target panel resolves to an input without any
 * inverse (homotopy.md §7.2).
 *
 * pick([sx, sy], { dragging = false }), in this order:
 *   1. policy(context), if given: 'allow' or undefined continues;
 *      { refuse: true, reason } returns { refused: true, reason } before anything
 *      is evaluated. Anything else throws.
 *   2. analytic, if given: input = analytic(fromScreen([sx, sy]), context).
 *      null means no pick — the pointer is somewhere this scenario has nothing.
 *      undefined means THIS scenario has no closed form, so the candidates
 *      below decide; a page whose inverse exists for a disk and not for a
 *      segment says so per state rather than building two pickers.
 *      q = toScreen(evaluate(input, context)).
 *   3. otherwise the candidates (an array, or a function of the context called
 *      once per cache fill), IN ORDER. Their screen positions are cached until
 *      invalidate() or setContext(); the best is the FIRST candidate with the
 *      strictly smallest distance (d < best), which is how the shipped loops
 *      break ties.
 *      In both paths distance = Math.hypot(sx − q[0], sy − q[1]).
 *   4. if (!dragging && distance > threshold) → null. The threshold is for the
 *      first press only; a drag follows the pointer wherever it goes.
 *   5. → { input, distance, screen: q }, frozen. No candidates → null.
 *
 * The context starts as null; setContext(ctx) replaces it and empties the cache.
 *
 * @param {object} o
 * @param {(point:number[]) => number[]} o.toScreen
 * @param {(screen:number[]) => number[]} [o.fromScreen]   required with analytic
 * @param {(input:object, context:*) => number[]} o.evaluate
 * @param {object[] | ((context:*) => object[])} [o.candidates]
 * @param {number} [o.threshold=24]      screen px
 * @param {(point:number[], context:*) => object|null|undefined} [o.analytic]
 * @param {(context:*) => 'allow'|{refuse:true, reason:string}|undefined} [o.policy]
 */
export function createPicker({ toScreen, fromScreen, evaluate, candidates, threshold = 24, analytic, policy } = {}) {
  if (typeof toScreen !== 'function') throw new TypeError('createPicker: toScreen must be a function point => [px, py]');
  if (typeof evaluate !== 'function') throw new TypeError('createPicker: evaluate must be a function (input, context) => point');
  for (const [name, fn] of [['fromScreen', fromScreen], ['analytic', analytic], ['policy', policy]])
    if (fn !== undefined && typeof fn !== 'function') throw new TypeError(`createPicker: ${name} must be a function`);
  if (analytic && !fromScreen)
    throw new TypeError('createPicker: analytic picking inverts a screen point, so fromScreen is required');
  if (candidates !== undefined && !Array.isArray(candidates) && typeof candidates !== 'function')
    throw new TypeError('createPicker: candidates must be an array of inputs or a function context => inputs');
  if (typeof threshold !== 'number' || !(threshold >= 0))
    throw new RangeError(`createPicker: threshold must be a number of px >= 0, got ${String(threshold)}`);

  let context = null;
  let cache = null;

  const fill = () => {
    const list = typeof candidates === 'function' ? candidates(context) : (candidates ?? []);
    if (!Array.isArray(list)) throw new TypeError('createPicker: candidates(context) must return an array');
    const inputs = list.slice(), screens = new Array(inputs.length);
    for (let i = 0; i < inputs.length; i++) screens[i] = toScreen(evaluate(inputs[i], context));
    cache = { inputs, screens };
  };

  function pick(screenPoint, { dragging = false } = {}) {
    if (!Array.isArray(screenPoint) || typeof screenPoint[0] !== 'number' || typeof screenPoint[1] !== 'number')
      throw new TypeError('picker.pick: pass the pointer as [sx, sy] in screen px');
    if (typeof dragging !== 'boolean') throw new TypeError('picker.pick: dragging must be true or false');
    const sx = screenPoint[0], sy = screenPoint[1];
    if (policy) {
      const verdict = policy(context);
      if (verdict !== undefined && verdict !== 'allow') {
        if (verdict && typeof verdict === 'object' && verdict.refuse === true)
          return Object.freeze({ refused: true, reason: verdict.reason });
        throw new TypeError(`picker.pick: policy must return 'allow' or { refuse: true, reason }, ` +
                            `got ${JSON.stringify(verdict) ?? String(verdict)}`);
      }
    }
    let input, q, distance, resolved = false;
    if (analytic) {
      const got = analytic(fromScreen([sx, sy]), context);
      if (got === null) return null;
      if (got !== undefined) {
        input = got;
        q = toScreen(evaluate(input, context));
        distance = Math.hypot(sx - q[0], sy - q[1]);
        resolved = true;
      }
    }
    if (!resolved) {
      if (!cache) fill();
      const { inputs, screens } = cache;
      let best = -1, bestD = Infinity;
      for (let i = 0; i < inputs.length; i++) {
        const s = screens[i], d = Math.hypot(sx - s[0], sy - s[1]);
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best < 0) return null;
      input = inputs[best]; q = screens[best]; distance = bestD;
    }
    if (!dragging && distance > threshold) return null;
    return Object.freeze({ input, distance, screen: q });
  }

  return Object.freeze({
    pick,
    invalidate() { cache = null; },
    setContext(ctx) { context = ctx; cache = null; },
    get context() { return context; },
  });
}

// ---- estimates: degeneracy, escape, turning ------------------------------

function evaluator(mapOrFamily, t, where) {
  if (!mapOrFamily || typeof mapOrFamily !== 'object' || typeof mapOrFamily.at !== 'function')
    throw new TypeError(`${where}: expected a Map or a Family`);
  if (typeof mapOrFamily.frame === 'function') {
    if (!finite(t)) throw new TypeError(`${where}: a Family is evaluated at a time — pass { t }`);
    return x => mapOrFamily.at(x, t);
  }
  if (t !== undefined) throw new TypeError(`${where}: { t } is for a Family; a Map has no time`);
  return x => mapOrFamily.at(x);
}

function geometryTol(tol, where) {
  const eps = tol?.geometry;
  if (typeof eps !== 'number' || !(eps >= 0)) throw new TypeError(`${where}: tol.geometry must be a number >= 0`);
  return eps;
}

/**
 * The domain's 'mesh' lattice at the resolution that gives about `samples`
 * inputs: exactly `samples` at dim 1, ⌈√samples⌉² at dim 2, one at dim 0.
 */
function sampleInputs(domain, samples, where) {
  if (!domain || typeof domain.sample !== 'function' || !Number.isInteger(domain.dim))
    throw new TypeError(`${where}: pass the domain to sample (defineDomain or a built-in)`);
  if (!Number.isInteger(samples) || samples < 1) throw new RangeError(`${where}: samples must be a positive integer`);
  if (domain.dim === 0) return domain.sample({ mode: 'mesh' });
  const steps = domain.dim === 1 ? samples - 1 : Math.ceil(Math.pow(samples, 1 / domain.dim)) - 1;
  return domain.sample({ mode: 'mesh', resolution: Math.max(1, steps) });
}

function asPoints(values, where) {
  if (!values.length) throw new RangeError(`${where}: the domain sampled no inputs`);
  const d = values[0]?.length;
  for (const p of values)
    if (!Array.isArray(p) || p.length !== d || !p.every(finite))
      throw new TypeError(`${where}: the map returned something that is not a finite point of dimension ${d}`);
  return d;
}

/** The finite-difference step, as a fraction of each axis's span — Curve.tangent's default h. */
const FD_STEP = 1e-5;

/**
 * The Jacobian at one input, one column per axis the input has, per unit of
 * NORMALISED parameter (each axis span counts as 1), so axes of different
 * lengths compare.
 *
 * Every column is taken at ONE base point, the input moved just inside the
 * axis box so that a symmetric stencil fits. The stencil never wraps: a
 * difference taken across a seam would measure the seam's jump, not the map's
 * stretch. Columns at different base points, or one-sided ones at an end,
 * would differ in direction by O(h) along a curved image and make a curve look
 * two-dimensional. Each column is Richardson-extrapolated from central
 * differences at h and h/2, so truncation is O(h⁴) and what remains is
 * round-off, near 1e-11 of the stretch.
 */
function jacobianAt(F, x, axes, where) {
  const base = { ...x }, present = axes.filter(a => typeof x[a.name] === 'number');
  for (const a of present) {
    const h = FD_STEP * (a.max - a.min);
    base[a.name] = Math.min(a.max - h, Math.max(a.min + h, x[a.name]));
  }
  const diff = (a, h) => {
    const b = base[a.name], p = F({ ...base, [a.name]: b + h }), q = F({ ...base, [a.name]: b - h });
    asPoints([p, q], where);
    const w = ((b + h) - (b - h)) / (a.max - a.min);
    return p.map((c, i) => (c - q[i]) / w);
  };
  return present.map(a => {
    const h = FD_STEP * (a.max - a.min), coarse = diff(a, h), fine = diff(a, h / 2);
    return fine.map((f, i) => (4 * f - coarse[i]) / 3);
  });
}

/** The axes an input actually has: a wedge input's own part's, otherwise the domain's. */
function axesOf(domain, x) {
  if (domain.parts && typeof domain.key === 'string') return domain.parts[x[domain.key]]?.domain.axes ?? domain.axes;
  return domain.axes;
}

/**
 * Singular values (descending) and left singular vectors of the d×m matrix
 * whose columns are `cols`, by one-sided (Hestenes) Jacobi: rotate pairs of
 * columns until they are orthogonal; the column norms are then the singular
 * values and the normalised columns the left vectors.
 *
 * Not the eigenvalues of JᵀJ: forming the Gram matrix squares the condition
 * number, so a singular value below √ε·σ₁ — about 1e-6 of a stretch of 77 —
 * drowns in round-off, and a curve reads as two-dimensional. Rotating the
 * columns themselves keeps small singular values accurate to about ε·σ₁.
 */
function svdOfColumns(cols, tiny) {
  const m = cols.length;
  if (!m) return { sigma: [], left: [] };
  const C = cols.map(c => c.slice()), d = C[0].length;
  const dot = (a, b) => { let s = 0; for (let k = 0; k < d; k++) s += a[k] * b[k]; return s; };
  for (let sweep = 0; sweep < 64; sweep++) {
    let rotated = false;
    for (let p = 0; p < m; p++) for (let q = p + 1; q < m; q++) {
      const alpha = dot(C[p], C[p]), beta = dot(C[q], C[q]), gamma = dot(C[p], C[q]);
      if (!(Math.abs(gamma) > tiny * Math.sqrt(alpha * beta))) continue;
      rotated = true;
      const zeta = (beta - alpha) / (2 * gamma);
      const t = (zeta < 0 ? -1 : 1) / (Math.abs(zeta) + Math.sqrt(1 + zeta * zeta));
      const c = 1 / Math.sqrt(1 + t * t), s = c * t;
      for (let k = 0; k < d; k++) {
        const a = C[p][k], b = C[q][k];
        C[p][k] = c * a - s * b; C[q][k] = s * a + c * b;
      }
    }
    if (!rotated) break;
  }
  const norms = C.map(c => Math.sqrt(dot(c, c)));
  const order = norms.map((v, i) => i).sort((a, b) => norms[b] - norms[a] || a - b);
  return {
    sigma: order.map(i => norms[i]),
    left: order.map(i => (norms[i] > 0 ? C[i].map(v => v / norms[i]) : C[i])),
  };
}

/**
 * How many dimensions the image fills, estimated from samples: the generic
 * rank of the map's differential.
 *
 * At each of about `samples` inputs (the domain's 'mesh' lattice) the map is
 * differentiated along every axis — central differences at 1e-5 and 5e-6 of
 * the axis span, Richardson-extrapolated, all at one base point inside the
 * axis box, never across a seam — and the local rank counts the singular
 * values σᵢ (per unit of normalised parameter) above tol.geometry·max(1, σ₁):
 * sweeping the axis must move the image by more than tol.geometry, and, for
 * a large image, by more than that fraction of its largest stretch. `rank` is
 * the largest local rank found: the image's dimension where it is widest. So a
 * disk mapped onto a circle is rank 1, the identity on the disk is rank 2 (its
 * centre is rank 1 in polar parameters, and that does not lower the answer), a
 * constant map is rank 0, and a disk of radius 1e-6 is still rank 2. (Rank 0 is
 * a local test — no axis moves the image — and isDegenerate a global one — all
 * samples within tol.geometry of the first; they agree on continuous maps.)
 *
 *   singularValues[i]  the largest local stretch in the i-th direction over all
 *                      samples, per unit of normalised parameter, descending
 *   basis              the image directions (unit) of the `rank` counted
 *                      stretches, at the sample where the smallest counted one
 *                      is largest; for a curved image these are local tangents
 *   degenerate         rank < domain.dim
 *
 * Not principal components of the image points, which the specification
 * named: those measure the image's LINEAR span, so every circle — the disk
 * squeezed onto a circle, the retracted annulus at t = 1 — would read as rank
 * 2, and a renderer would draw a mesh where the specification wants a curve.
 *
 * A heuristic both ways: a sample can miss a thin feature, and a map that is
 * not differentiable at a sample is measured anyway. sound: false; the page's
 * own knowledge wins.
 *
 * @returns {Readonly<object>} Claim<{ rank, singularValues, basis, degenerate }>, method 'sampled-differential'
 */
export function estimateImageRank(mapOrFamily, domain, { t, samples = 64, tol = TOL } = {}) {
  const F = evaluator(mapOrFamily, t, 'estimateImageRank');
  const eps = geometryTol(tol, 'estimateImageRank');
  const tiny = tol.degenerate;
  if (typeof tiny !== 'number' || !(tiny >= 0))
    throw new TypeError('estimateImageRank: tol.degenerate must be a number >= 0');
  const inputs = sampleInputs(domain, samples, 'estimateImageRank');
  let rank = 0, widest = -1, basis = [];
  const sv = [];
  for (const x of inputs) {
    const { sigma, left } = svdOfColumns(jacobianAt(F, x, axesOf(domain, x), 'estimateImageRank'), tiny);
    sigma.forEach((s, i) => { if (!(sv[i] >= s)) sv[i] = s; });
    const cut = eps * Math.max(1, sigma[0] ?? 0);
    const local = sigma.filter(s => s > cut).length;
    const weakest = local ? sigma[local - 1] : 0;
    if (local > rank || (local === rank && local > 0 && weakest > widest)) {
      rank = local; widest = weakest; basis = left.slice(0, local);
    }
  }
  return Claim.computed(Object.freeze({
    rank,
    singularValues: Object.freeze(sv),
    basis: Object.freeze(basis.map(b => Object.freeze(b))),
    degenerate: rank < domain.dim,
  }), { method: 'sampled-differential', sound: false, budget: { samples: inputs.length } });
}

const DEGENERATE_MEMO = new WeakMap();

/**
 * Is the image a single point: every sample within tol.geometry of the first?
 * The numeric replacement for the shipped collapsed() id allowlist.
 *
 * Memoised per (map, t) — and per domain, sample count and tolerance, since a
 * memo keyed on less would answer a different question from the cache. The
 * memo trusts the map's IDENTITY: a map whose `at` reads mutable page state
 * must be a new object whenever that state changes, or the memo is stale.
 *
 * @returns {boolean}
 */
export function isDegenerate(mapOrFamily, domain, { t, tol = TOL, samples = 32 } = {}) {
  const F = evaluator(mapOrFamily, t, 'isDegenerate');
  const eps = geometryTol(tol, 'isDegenerate');
  if (!domain || typeof domain !== 'object') throw new TypeError('isDegenerate: pass the domain to sample');
  let byDomain = DEGENERATE_MEMO.get(mapOrFamily);
  if (!byDomain) DEGENERATE_MEMO.set(mapOrFamily, byDomain = new WeakMap());
  let table = byDomain.get(domain);
  if (!table) byDomain.set(domain, table = new Map());
  const key = `${t}|${samples}|${eps}`;
  if (table.has(key)) return table.get(key);
  const points = sampleInputs(domain, samples, 'isDegenerate').map(F);
  asPoints(points, 'isDegenerate');
  const a = points[0];
  const result = points.every(p => {
    let s = 0;
    for (let k = 0; k < a.length; k++) { const e = p[k] - a[k]; s += e * e; }
    return Math.sqrt(s) <= eps;
  });
  table.set(key, result);
  return result;
}

/**
 * Does the image leave `region`? Samples the domain (about `samples` inputs),
 * evaluates, and tests each image with the region's contains(point, { tol }).
 *
 * `region` is anything with a contains(point) method — every Region from
 * region.js has one — or pass { contains(region, point, { tol }) } alongside
 * any other object. (region.js comes after this module in the layer order, so
 * this cannot import it; the method is the contract.)
 *
 * sound: 'positive'. An image outside the region is a proof that the family
 * escapes it at this t, and each one is a witness { input, point }. Finding
 * none proves nothing.
 *
 * @returns {Readonly<object>} Claim<boolean>, method 'sampled'
 */
export function escapes(mapOrFamily, domain, region, { t, samples = 256, tol = TOL, contains } = {}) {
  const F = evaluator(mapOrFamily, t, 'escapes');
  let test;
  if (contains !== undefined) {
    if (typeof contains !== 'function') throw new TypeError('escapes: contains must be a function (region, point) => boolean');
    test = p => contains(region, p, { tol });
  } else if (region && typeof region.contains === 'function') {
    test = p => region.contains(p, { tol });
  } else {
    throw new TypeError('escapes: region needs a contains(point) method, or pass { contains(region, point) }');
  }
  const inputs = sampleInputs(domain, samples, 'escapes');
  const witnesses = [];
  for (const input of inputs) {
    const point = F(input), inside = test(point);
    if (typeof inside !== 'boolean') throw new TypeError('escapes: contains must return true or false');
    if (!inside) witnesses.push(Object.freeze({ input, point }));
  }
  return Claim.computed(witnesses.length > 0, {
    method: 'sampled', sound: 'positive', witnesses, budget: { samples: inputs.length },
  });
}

/**
 * The signed angle a polyline sweeps around `center`, in turns: the sum over
 * consecutive points of atan2(a × b, a · b) with a, b taken from the centre,
 * divided by TAU. ARITHMETIC — calling it a winding number, and a homotopy
 * invariant, is Layer 3's job (spec §1.5).
 *
 * `polyline` is an array of [x, y] or a Curve.polyline() result. With
 * { points, closed: true } the closing step back to the first point is added
 * unless the last point already repeats it; a bare array is taken as given,
 * so pass a loop with its first point repeated.
 *
 * sound: true exactly when every step subtends less than π/2 — then no step
 * can be mistaken for its complement — with the largest step reported as
 * budget.maxStep (radians) and the step count as budget.samples. Otherwise
 * Claim.unknown('undersampled'). A point within tol.geometry of the centre has
 * no angle: Claim.unknown('passes through the centre').
 *
 * @returns {Readonly<object>} Claim<number>, method 'signed-angle sum'
 */
export function turningNumber(polyline, { center = [0, 0], tol = TOL } = {}) {
  let points, closed = false;
  if (Array.isArray(polyline)) points = polyline;
  else if (polyline && Array.isArray(polyline.points)) { points = polyline.points; closed = polyline.closed === true; }
  else throw new TypeError('turningNumber: pass an array of [x, y] points or a Curve.polyline() result');
  const eps = geometryTol(tol, 'turningNumber');
  const ok = p => Array.isArray(p) && p.length === 2 && finite(p[0]) && finite(p[1]);
  if (!ok(center)) throw new TypeError('turningNumber: center must be a point [x, y]');
  if (!points.every(ok)) throw new TypeError('turningNumber: every point must be a finite [x, y]');
  if (points.length < 2) return Claim.unknown('fewer than two points');
  const [c0, c1] = center;
  const first = points[0], last = points[points.length - 1];
  const seq = closed && Math.hypot(last[0] - first[0], last[1] - first[1]) > eps ? [...points, first] : points;
  if (seq.some(p => Math.hypot(p[0] - c0, p[1] - c1) <= eps)) return Claim.unknown('passes through the centre');
  let total = 0, maxStep = 0;
  for (let i = 1; i < seq.length; i++) {
    const ax = seq[i - 1][0] - c0, ay = seq[i - 1][1] - c1, bx = seq[i][0] - c0, by = seq[i][1] - c1;
    const step = Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
    total += step;
    if (Math.abs(step) > maxStep) maxStep = Math.abs(step);
  }
  if (!(maxStep < Math.PI / 2)) return Claim.unknown('undersampled');
  return Claim.computed(total / TAU, {
    method: 'signed-angle sum', sound: true, budget: { samples: seq.length - 1, maxStep },
  });
}
