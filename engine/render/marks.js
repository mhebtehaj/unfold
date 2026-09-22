// The visual vocabulary: every mark the explorers draw, as one function each.
//
// A mark takes screen coordinates (the scene has already done every
// transform) and a MarkStyle, and returns an SVG element. Colour arrives only
// as a token or a palette colour and goes out through palette.paint(), so no
// literal can reach the DOM from here (check-layers I3).
//
// Every mark also takes an optional existing node and updates it in place when
// it can. That is what lets the scene reconcile by key: a mark whose shape is
// unchanged keeps its node, its listeners and its focus, and only the
// attributes that moved are written.
//
// Defaults are the SVG defaults, not house choices. A mark writes an attribute
// only when the style asks for it, so a drawing ported from a page that never
// set a line cap does not grow round caps on the way; the house vocabulary
// (dashes for absent-or-behind, a ring for the selection) is here as named
// options, not as silent defaults. The one sharp edge that follows: a face or
// a dot given neither a fill nor a class that sets one paints SVG's default,
// which is black in both themes.
//
// A style key a mark does not know is an error, not a silent no-op: a typo
// such as `strokeWidth` for `width` would otherwise draw the default and look
// like a rendering bug several modules away.

import { el, attr, getPrecision } from '../core/svg.js';
import { paint } from './palette.js';

export const LAYER = 1;

/**
 * @typedef {Object} MarkStyle
 * @property {string} [fill]            token or palette colour
 * @property {string} [stroke]
 * @property {number} [fillOpacity]
 * @property {number} [strokeOpacity]
 * @property {number} [opacity]         the whole mark: a grouped point or an arrow
 *                                      fades as one, not part by part
 * @property {number} [width]           stroke-width, px (= viewBox units)
 * @property {'solid'|'dashed'|'dotted'|number[]|string} [dash]
 *           'dashed' → '5 6', 'dotted' → '1 3': the house dash vocabulary
 * @property {'round'|'butt'|'square'} [cap]
 * @property {'round'|'miter'|'bevel'} [join]
 * @property {'nonzero'|'evenodd'} [fillRule]
 * @property {string} [class]
 * @property {Record<string,string|number>} [data]   data-* attributes: the pick payload.
 *           Keys are letters, digits, _ . -; k, mark and parts are the engine's own
 * @property {string} [title]           a native <title> child: a free tooltip
 * @property {boolean} [interactive]    false → pointer-events: none
 */

const DASH = { solid: null, dashed: '5 6', dotted: '1 3' };

function dashOf(d) {
  if (d == null) return null;
  if (Array.isArray(d)) return d.join(' ');
  if (Object.hasOwn(DASH, d)) return DASH[d];
  if (/^[\d.\s,]+$/.test(String(d))) return String(d);
  throw new RangeError(`marks: dash "${d}" is not solid, dashed, dotted or a number list`);
}

/**
 * Style → attributes. Undefined means "not asked for", and attr() removes an
 * attribute given null or undefined — so an update that drops a style also
 * drops its attribute instead of leaving the last frame's value behind.
 */
function paintAttrs(s) {
  return {
    fill: s.fill === undefined ? undefined : paint(s.fill),
    stroke: s.stroke === undefined ? undefined : paint(s.stroke),
    'fill-opacity': s.fillOpacity,
    'stroke-opacity': s.strokeOpacity,
    opacity: s.opacity,
    'stroke-width': s.width,
    'stroke-dasharray': dashOf(s.dash),
    'stroke-linecap': s.cap,
    'stroke-linejoin': s.join,
    // Only a shape with two subpaths needs it: a ring is one mark with an
    // even-odd fill, not a disc with the page's own colour punched over it.
    'fill-rule': s.fillRule,
    class: s.class,
    'pointer-events': s.interactive === false ? 'none' : undefined,
  };
}

/** data-* from style.data, replacing whatever a reused node carried before. */
function dataAttrs(node, data) {
  const keep = new Set(data ? Object.keys(data).map(k => `data-${k}`) : []);
  for (const a of [...node.attributes]) {
    if (a.name.startsWith('data-') && a.name !== 'data-k' && !keep.has(a.name)) node.removeAttribute(a.name);
  }
  if (data) attr(node, { data });
}

/** A <title> child, kept first, updated in place, removed when the style drops it. */
function titleOf(node, title) {
  let t = node.firstElementChild?.localName === 'title' ? node.firstElementChild : null;
  if (title == null) { t?.remove(); return; }
  if (!t) { t = el('title'); node.insertBefore(t, node.firstChild); }
  if (t.textContent !== String(title)) t.textContent = String(title);
}

function styled(node, style, extra) {
  attr(node, { ...paintAttrs(style), ...extra });
  dataAttrs(node, style.data);
  titleOf(node, style.title);
  return node;
}

/**
 * A MarkStyle applied to a node the caller made — the scene's group around
 * raw markup: the same attributes, payload and tooltip any mark carries.
 * Paint set on a group is inherited by whatever inside it sets none.
 */
export function style(node, s = {}) {
  return styled(node, s, {});
}

/** Reuse `node` when it is the right element; otherwise make one. */
const reuse = (node, tag) => (node && node.localName === tag ? node : el(tag));

const SHAPES = new Set(['rect', 'circle', 'path']);

const COMMON = ['fill', 'stroke', 'fillOpacity', 'strokeOpacity', 'opacity', 'width', 'dash', 'cap', 'join',
  'fillRule', 'class', 'data', 'title', 'interactive'];
const TEXT = ['dx', 'dy', 'anchor', 'baseline', 'halo', 'class', 'opacity', 'fill', 'interactive', 'data', 'title'];
/** The style keys each mark reads. Anything else is refused by check(). */
const KEYS = {
  face: new Set([...COMMON, 'closed']),
  edge: new Set(COMMON),
  polyline: new Set([...COMMON, 'closed', 'smooth']),
  curve: new Set([...COMMON, 'closed', 'smooth']),
  arrow: new Set([...COMMON, 'head', 'headAngle', 'kind', 'bend']),
  point: new Set([...COMMON, 'r', 'halo', 'ring']),
  region: new Set(COMMON),
  raw: new Set(COMMON),
  text: new Set(TEXT),
  // A placed label's position and anchor are the placer's; the style may not move it.
  label: new Set(['halo', 'class', 'opacity', 'fill', 'interactive', 'data', 'title']),
};
const HALO_KEYS = new Set(['width', 'fill']);
const RING_KEYS = new Set(['r', 'stroke', 'width']);
/** data-k is the reconciler's; data-mark and data-parts are how a grouped mark knows its node. */
const RESERVED = new Set(['k', 'mark', 'parts']);

function known(keys, obj, what) {
  for (const k of Object.keys(obj)) if (!keys.has(k)) throw new TypeError(`${what}: unknown style key "${k}"`);
}

/**
 * Throw now, with the mark's own message, for a style the mark could not
 * draw: a colour that is not a token or a palette colour, a dash outside the
 * vocabulary, a region with no known shape, a data key the DOM cannot hold or
 * the engine reserves — and for a key the mark does not read at all, which is
 * a typo the mark itself would silently ignore. The scene calls this while it
 * builds a renderable, inside that renderable's try/catch, so one bad style
 * skips one renderable for the frame instead of stopping the draw halfway
 * through reconciliation.
 *
 * @param {string} kind   a primitive kind, or 'label'
 * @param {MarkStyle} [style]
 * @param {{shape?:object, markup?:string}} [prim]
 * @returns {true}
 */
export function check(kind, style = {}, prim = {}) {
  const keys = KEYS[kind];
  if (!keys) throw new RangeError(`marks: no mark for kind "${kind}"`);
  known(keys, style, `a ${kind}`);
  for (const k of Object.keys(style.data ?? {})) {
    if (!/^[A-Za-z0-9_.-]+$/.test(k)) throw new TypeError(`a ${kind}: "${k}" cannot be a data-* attribute name`);
    if (RESERVED.has(k)) throw new TypeError(`a ${kind}: data key "${k}" is reserved for the engine`);
  }
  if (style.fill !== undefined) paint(style.fill);
  if (style.stroke !== undefined) paint(style.stroke);
  dashOf(style.dash);
  if (kind === 'point') {
    if (style.halo && typeof style.halo === 'object') {
      known(HALO_KEYS, style.halo, 'a point halo');
      if (style.halo.fill !== undefined) paint(style.halo.fill);
    }
    if (style.ring && typeof style.ring === 'object') {
      known(RING_KEYS, style.ring, 'a point ring');
      if (style.ring.stroke !== undefined) paint(style.ring.stroke);
    }
  }
  if (kind === 'region' && !SHAPES.has(prim.shape?.type))
    throw new RangeError(`region: unknown shape type "${prim.shape?.type}"`);
  if (kind === 'raw' && typeof prim.markup !== 'string')
    throw new TypeError('raw: markup must be a string of trusted SVG');
  return true;
}

// ------------------------------------------------------------------ paths --

/** Path numbers follow the kernel's precision, exactly as el() rounds attributes. */
function num(v) {
  const k = 10 ** getPrecision();
  return String(Math.round(v * k) / k);
}
const at = p => `${num(p[0])},${num(p[1])}`;

/** Straight segments: `M a L b L c` (+ `Z`), the form the explorers write by hand. */
export function linePath(points, closed = false) {
  if (!points.length) return '';
  return `M${points.map(at).join('L')}${closed ? 'Z' : ''}`;
}

/**
 * A smooth path through the points: a cardinal spline as cubic Béziers. The
 * tangent at each point is `smooth` times the chord between its neighbours;
 * 0.5 is Catmull-Rom. Open curves repeat their end points, closed ones wrap.
 */
export function smoothPath(points, smooth = 0.5, closed = false) {
  const n = points.length;
  if (n < 3 || !(smooth > 0)) return linePath(points, closed);
  const P = i => points[closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i))];
  const tangent = i => [(P(i + 1)[0] - P(i - 1)[0]) * smooth, (P(i + 1)[1] - P(i - 1)[1]) * smooth];
  let d = `M${at(points[0])}`;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = P(i), b = P(i + 1), ta = tangent(i), tb = tangent(i + 1);
    d += `C${at([a[0] + ta[0] / 3, a[1] + ta[1] / 3])} ${at([b[0] - tb[0] / 3, b[1] - tb[1] / 3])} ${at(b)}`;
  }
  return closed ? `${d}Z` : d;
}

// ------------------------------------------------------------------ marks --

/**
 * A filled polygon, closed unless asked otherwise.
 * @param {[number,number][]} points  screen px
 * @param {MarkStyle & {closed?:boolean}} [style]
 */
export function face(points, style = {}, node = null) {
  const { closed = true, ...rest } = style;
  return styled(reuse(node, 'path'), rest, { d: linePath(points, closed) });
}

/** One straight segment. Unfilled unless the style says otherwise. */
export function edge(a, b, style = {}, node = null) {
  return styled(reuse(node, 'path'), { fill: 'none', ...style }, { d: linePath([a, b]) });
}

/**
 * Connected segments, or a smooth curve through the points when `smooth` > 0.
 * @param {[number,number][]} points
 * @param {MarkStyle & {closed?:boolean, smooth?:number}} [style]
 */
export function polyline(points, style = {}, node = null) {
  const { closed = false, smooth = 0, ...rest } = style;
  return styled(reuse(node, 'path'), { fill: 'none', ...rest }, { d: smoothPath(points, smooth, closed) });
}

/** A Catmull-Rom curve: polyline with smooth 0.5. */
export function curve(points, style = {}, node = null) {
  return polyline(points, { smooth: 0.5, ...style }, node);
}

/**
 * A dot, with an optional knockout halo under it and an optional ring round it.
 *
 * The selection idiom, generalised with every argument explicit: the shipped
 * `ring(p)` read the selection from closure and `eqRing` took it as an
 * argument, with three sets of drifted radii between them. Paint order is
 * halo, dot, ring — the halo is a background-coloured disc that gives the dot
 * its own contrast against a pale fill and a saturated one alike, and the ring
 * sits outside the dot rather than recolouring it, because the dot's colour is
 * already carrying its identity.
 *
 * A bare dot is one <circle>; with a halo or a ring it is a <g>.
 *
 * @param {[number,number]} p
 * @param {MarkStyle & {
 *   r?: number,
 *   halo?: boolean|{width?:number, fill?:string},   width default 3, fill default 'bg'
 *   ring?: boolean|{r?:number, stroke?:string, width?:number},
 *          r default 2×r, stroke default 'fg', width default 1.6
 * }} [style]
 */
export function point(p, style = {}, node = null) {
  const { r = 3.5, halo = false, ring = false, ...rest } = style;
  const cx = p[0], cy = p[1];
  if (!halo && !ring) return styled(reuse(node, 'circle'), rest, { cx, cy, r });

  const g = node && node.localName === 'g' && node.dataset.mark === 'point' ? node : el('g', { data: { mark: 'point' } });
  const parts = [];
  if (halo) {
    const h = halo === true ? {} : halo;
    parts.push(['halo', { cx, cy, r: r + (h.width ?? 3), fill: paint(h.fill ?? 'bg') }]);
  }
  parts.push(['dot', null]);
  if (ring) {
    const q = ring === true ? {} : ring;
    parts.push(['ring', { cx, cy, r: q.r ?? r * 2, fill: 'none', stroke: paint(q.stroke ?? 'fg'), 'stroke-width': q.width ?? 1.6 }]);
  }
  // Rebuild the circles only when the set of parts changed; otherwise update in
  // place. The circles are found by element, not by child index, because the
  // group's <title> is a child too and sits first.
  const roles = parts.map(([role]) => role).join(' ');
  let kids = [...g.children].filter(n => n.localName === 'circle');
  if (g.dataset.parts !== roles || kids.length !== parts.length) {
    kids = parts.map(() => el('circle'));
    g.replaceChildren(...kids);
    g.dataset.parts = roles;
  }
  parts.forEach(([role, a], i) => {
    if (role === 'dot') {
      attr(kids[i], { ...paintAttrs(rest), cx, cy, r, class: undefined, opacity: undefined, 'pointer-events': undefined });
    } else {
      attr(kids[i], a);
    }
  });
  // The group carries what applies to the whole mark: its class, its opacity
  // (so halo, dot and ring fade together), its pick payload, its tooltip and
  // whether it is interactive (pointer-events inherits).
  attr(g, { class: rest.class, opacity: rest.opacity, 'pointer-events': rest.interactive === false ? 'none' : undefined });
  dataAttrs(g, { mark: 'point', parts: roles, ...rest.data });
  titleOf(g, rest.title);
  return g;
}

/** The selection ring on a dot: point() with a halo and a ring at twice the radius. */
export function pointRing(p, style = {}, node = null) {
  return point(p, { r: 4, halo: true, ring: true, ...style }, node);
}

/**
 * An arrow from a to b: a shaft, optionally bent, and a head at b.
 * @param {[number,number]} a @param {[number,number]} b
 * @param {MarkStyle & {head?:number, headAngle?:number, kind?:'open'|'filled', bend?:number}} [style]
 *        head: length in px; headAngle: half-angle in radians; bend: px the shaft
 *        bows at its middle, to the left of a→b as drawn (screen y points down)
 */
export function arrow(a, b, style = {}, node = null) {
  const { head = 6, headAngle = 0.45, kind = 'open', bend = 0, ...rest } = style;
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
  const nx = dy / len, ny = -dx / len;
  const c = [(a[0] + b[0]) / 2 + nx * bend, (a[1] + b[1]) / 2 + ny * bend];
  const shaft = bend ? `M${at(a)}Q${at(c)} ${at(b)}` : linePath([a, b]);
  // The head points along the tangent at b, which a bend turns.
  const tx = bend ? b[0] - c[0] : dx, ty = bend ? b[1] - c[1] : dy;
  const back = Math.atan2(ty, tx) + Math.PI;
  const wing = s => [b[0] + head * Math.cos(back + s * headAngle), b[1] + head * Math.sin(back + s * headAngle)];
  const tip = kind === 'filled' ? linePath([wing(-1), b, wing(1)], true) : linePath([wing(-1), b, wing(1)]);

  const g = node && node.localName === 'g' && node.dataset.mark === 'arrow' ? node : el('g');
  let paths = [...g.children].filter(n => n.localName === 'path');
  if (paths.length !== 2) { paths = [el('path'), el('path')]; g.replaceChildren(...paths); }
  // Opacity goes on the group, so the head does not composite twice where it
  // overlaps the shaft.
  const whole = { class: undefined, opacity: undefined, 'pointer-events': undefined };
  attr(paths[0], { ...paintAttrs({ ...rest, fill: 'none' }), d: shaft, ...whole });
  attr(paths[1], {
    ...paintAttrs({ ...rest, fill: kind === 'filled' ? (rest.stroke ?? rest.fill) : 'none' }),
    d: tip, ...whole,
  });
  attr(g, { class: rest.class, opacity: rest.opacity, 'pointer-events': rest.interactive === false ? 'none' : undefined });
  dataAttrs(g, { mark: 'arrow', ...rest.data });
  titleOf(g, rest.title);
  return g;
}

/**
 * A filled region in screen px: a rectangle, a circle or any path.
 * @param {{type:'rect',x:number,y:number,w:number,h:number,rx?:number}
 *        |{type:'circle',cx:number,cy:number,r:number}
 *        |{type:'path',d:string}} shape
 * @param {MarkStyle} [style]   fill default 'zone'
 */
export function region(shape, style = {}, node = null) {
  const s = { fill: 'zone', ...style };
  if (shape?.type === 'rect')
    return styled(reuse(node, 'rect'), s, { x: shape.x, y: shape.y, width: shape.w, height: shape.h, rx: shape.rx });
  if (shape?.type === 'circle')
    return styled(reuse(node, 'circle'), s, { cx: shape.cx, cy: shape.cy, r: shape.r });
  if (shape?.type === 'path') return styled(reuse(node, 'path'), s, { d: shape.d });
  throw new RangeError(`region: unknown shape type "${shape?.type}"`);
}

/**
 * Text at a fixed point: a label that needs no placement. Colour comes from
 * its class (the page's drawing-text rules), so a role like "the point you
 * are following" is one class in CSS rather than a fill written per node.
 * `halo: true` adds the knockout class `uf-halo`; its rule joins unfold.css
 * with the drawing rules, when the first explorer port can verify them.
 * The anchor defaults to 'middle', as core/svg.js text() does; the baseline to
 * the alphabetic one, which is SVG's own and is therefore not written.
 * @param {[number,number]} p
 * @param {string} str
 * @param {MarkStyle & {dx?:number, dy?:number, anchor?:'start'|'middle'|'end',
 *        baseline?:'auto'|'middle'|'hanging'|'central', halo?:boolean}} [style]
 */
export function text(p, str, style = {}, node = null) {
  const { dx = 0, dy = 0, anchor = 'middle', baseline = 'auto', halo = false, ...rest } = style;
  const t = reuse(node, 'text');
  attr(t, {
    x: p[0] + dx, y: p[1] + dy,
    'text-anchor': anchor, 'dominant-baseline': baseline === 'auto' ? undefined : baseline,
    class: [rest.class, halo ? 'uf-halo' : null].filter(Boolean).join(' ') || undefined,
    opacity: rest.opacity,
    fill: rest.fill === undefined ? undefined : paint(rest.fill),
    'pointer-events': rest.interactive === false ? 'none' : undefined,
  });
  // A text node, never markup: a label is data. It is found and updated in
  // place rather than set through textContent, which would also wipe the
  // <title> tooltip beside it.
  let tn = null;
  for (const n of [...t.childNodes]) {
    if (n.nodeType === 3 && !tn) tn = n;
    else if (n.localName !== 'title') n.remove();
  }
  if (!tn) tn = t.appendChild(t.ownerDocument.createTextNode(''));
  if (tn.data !== String(str)) tn.data = String(str);
  dataAttrs(t, rest.data);
  titleOf(t, rest.title);
  return t;
}

/**
 * A label the LabelPlacer placed.
 *
 * When the placer's 'shrink' policy fired, the label fits only at the smaller
 * size it was measured at (`placed.fontSize`), so that size is written as an
 * inline style: the page's drawing rules set the font size in CSS, and a
 * presentation attribute would lose to them.
 *
 * @param {import('../core/labels.js').Placed} placed
 * @param {{class?:string, halo?:boolean, data?:object, interactive?:boolean,
 *          opacity?:number, fill?:string}} [o]  halo on by default: a placed
 *        label sits on whatever the drawing put there
 */
export function label(placed, o = {}, node = null) {
  const { class: cls = 'uf-mark', halo = true, ...rest } = o;
  const t = text([placed.x, placed.y], placed.text, {
    anchor: placed.anchorX, baseline: placed.baseline, class: cls, halo,
    opacity: placed.opacity, ...rest,
  }, node);
  attr(t, { style: placed.fontSize === undefined ? undefined : `font-size:${num(placed.fontSize)}px` });
  return t;
}

/** Add the knockout halo to an existing text node. */
export function halo(node) {
  node.classList.add('uf-halo');
  return node;
}
