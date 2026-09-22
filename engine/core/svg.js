// SVG built through the DOM, not through strings.
//
// The decisive case from the inventory: the ambiguity explorer lifts the
// selected polygon above every other fill with `scene.appendChild(selected)` —
// one statement, re-parenting a node that is already in the tree, keeping its
// listeners and its focus. The same effect in the string idiom is a structural
// refactor of the builder, because paint order is emission order and emission
// order is the shape of the code. That operation is raise(), and it is the
// reason this module exists.
//
// Everything else here is the smallest set that makes the DOM idiom cheaper
// than the string idiom: one attribute coercion table, one keyed reconciler,
// four z-order moves. No virtual DOM, no template language. raw() is the
// escape hatch for the two explorers that still build strings, so the port can
// be incremental instead of a rewrite.

export const LAYER = 0;
export const SVG_NS = 'http://www.w3.org/2000/svg';

// ----------------------------------------------------------------- dev mode --
// There is no build step, so nothing can define away a development-only check.
// Strict is the default and a published page opts out explicitly; read live
// rather than captured at load, so a test can exercise both branches.
const isDev = () => globalThis.UNFOLD_DEV !== false;

// --------------------------------------------------------------- precision --
// ambiguity.md §16.21: the DOM carried points="320.00000000000006,194.99999…".
// Float noise out of a projection is not information, it is fourteen characters
// of diff in every golden file and a semantic baseline that never settles.
// Round once, on the way out, here.
//
// Eight decimals, not three and not six. Phase 3 measured three against the
// realization explorer's own drawing: its 324-cell barycentric triangle,
// redrawn with coordinates rounded to 1/1000 px, moved the antialiasing of 115
// pixels by up to 4 levels, because a cell edge shifted by 0.0005 px changes
// which fraction of a pixel it covers. Six cleared that page.
//
// Phase 4 measured again against the homotopy explorer, whose drawings carry
// far more edges — 1 152 mesh cells, a 144-segment curve — and where a pixel
// can be covered by several of them at once, so the error compounds instead of
// cancelling. At six, the winding example differed by up to 28 levels across
// 420 pixels; at seven, 5 levels across 29; at eight, nothing, at every width
// and in both schemes. The 1e-14 float noise the rounding exists to remove is
// still gone: it lives at the fourteenth decimal, not the ninth.
const DEFAULT_PRECISION = 8;
let PRECISION = DEFAULT_PRECISION;

export function setPrecision(digits = DEFAULT_PRECISION) {
  const d = Math.trunc(digits);
  if (!Number.isFinite(d) || d < 0 || d > 15)
    throw new RangeError(`setPrecision: ${digits} is outside 0..15`);
  PRECISION = d;
  return PRECISION;
}

export function getPrecision() {
  return PRECISION;
}

/** Round for the DOM and drop trailing zeros; toFixed() would write "195.000". */
function num(v) {
  const k = 10 ** PRECISION;
  return String(Math.round(v * k) / k);
}

// -------------------------------------------------------------- attributes --
const ALIAS = { className: 'class' };

/**
 * The one coercion table, used identically by el(), attr(), text() and the
 * measurer.
 *
 *   null | undefined | false   remove the attribute
 *   true                       set it to ""
 *   finite number              rounded to PRECISION, except under data-*
 *   anything else              String(v)
 *
 * The three falsy cases REMOVE rather than merely skip, because attr() is the
 * update path of reconcile(): `attr(n, { 'fill-opacity': f.alpha })` against a
 * reused node has to clear a value that used to be there, or the node keeps the
 * paint of whatever item previously held its key.
 *
 * data-* keeps full precision: the probe compares golden files against it, and
 * a rounded coordinate in the data attribute would hide exactly the drift the
 * golden file exists to catch.
 */
function put(node, name, v) {
  if (v == null || v === false) { node.removeAttribute(name); return; }
  // NaN and Infinity deliberately fall through to String(v). "NaN" makes the
  // element refuse to render, which names the bug at the first frame; silently
  // dropping it leaves the node at its previous coordinates, which does not.
  const n = typeof v === 'number' && Number.isFinite(v) && !name.startsWith('data-');
  const s = v === true ? '' : n ? num(v) : String(v);
  // Written only when it differs. setAttribute queues a mutation record and
  // invalidates style even for the value already there, so a redraw of an
  // unchanged scene would otherwise touch every attribute of every mark.
  if (node.getAttribute(name) !== s) node.setAttribute(name, s);
}

function apply(node, attrs) {
  if (!attrs) return node;
  for (const k of Object.keys(attrs)) {
    const v = attrs[k];
    if (k === 'data') {
      if (v) for (const d of Object.keys(v)) put(node, `data-${d}`, v[d]);
      continue;
    }
    put(node, ALIAS[k] ?? k, v);
  }
  return node;
}

/**
 * @param {string} tag
 * @param {Record<string, string|number|boolean|null|undefined>} [attrs]
 * @param {string} [text] set via textContent — never parsed, never hand-escaped
 * @returns {SVGElement}
 */
export function el(tag, attrs, text) {
  const node = document.createElementNS(SVG_NS, tag);
  apply(node, attrs);
  // textContent, never innerHTML: the caller's string is data, so a label
  // containing "<" is a label containing "<", not a tag.
  if (text != null) node.textContent = String(text);
  return node;
}

/** Same rules as el(); null removes. @returns {SVGElement} the node. */
export function attr(node, attrs) {
  return apply(node, attrs);
}

/** @returns {SVGGElement} with `children` appended in order; nullish entries skipped. */
export function group(attrs, children) {
  const g = el('g', attrs);
  if (children) {
    if (children.nodeType) g.appendChild(children);
    else for (const c of children) if (c) g.appendChild(c);
  }
  return g;
}

// -------------------------------------------------------------------- text --
// unfold.css ships the halo, verbatim from ambiguity.md §7:
//   .uf-drawing .uf-halo { paint-order: stroke; stroke: var(--bg);
//                          stroke-width: 4px; stroke-linejoin: round; }
// paint-order:stroke puts the background-coloured stroke UNDER the glyph fill,
// which is what knocks the label out of whatever it crosses, and it is correct
// in both schemes for free because the stroke is a token.
const HALO_CLASS = 'uf-halo';
const HALO_WIDTH = 4;   // matches the stylesheet, so an inline halo looks the same

/** `--token` or `var(--token)` in, `var(--token)` out. Anything else is I3 debt. */
function cssVar(token) {
  if (/^--[\w-]+$/.test(token)) return `var(${token})`;
  if (/^var\(\s*--[\w-]+\s*\)$/.test(token)) return token;
  // Rejecting the fallback form too: `var(--x, <literal>)` is precisely where a
  // hardcoded colour gets past a source-text check and then fails to adapt to
  // dark mode (design-system.md §8 finding 7).
  throw new TypeError(
    `${JSON.stringify(token)} is not a custom property — colour reaches the DOM only as var(--token)`);
}

/**
 * @param {string} str
 * @param {object} o
 * @param {number} o.x @param {number} o.y
 * @param {'start'|'middle'|'end'} [o.anchor='middle']
 * @param {'middle'|'hanging'|'auto'|'central'} [o.baseline='middle']
 * @param {boolean|string} [o.halo=true]
 *        true  — add class "uf-halo" and let unfold.css paint it (the default).
 *        string — a custom property name, additionally written inline. See below.
 * @param {string} [o.class]
 * @param {number} [o.opacity]
 * @param {Record<string,string|number>} [o.data]
 * @returns {SVGTextElement}
 */
export function text(str, o = {}) {
  const cls = [o.class, o.halo === false ? null : HALO_CLASS].filter(Boolean).join(' ');
  const node = el('text', {
    x: o.x,
    y: o.y,
    'text-anchor': o.anchor ?? 'middle',
    'dominant-baseline': o.baseline ?? 'middle',
    class: cls || null,
    opacity: o.opacity,
    data: o.data,
  }, str);

  // Inline halo. The class alone is the documented default; a token string
  // writes the same four properties as presentation attributes, for the two
  // cases the stylesheet cannot cover: a label whose knockout has to match a
  // surface other than the page background (the widget strokes against one
  // token vocabulary and the author pages against another — phase-0 measured
  // the collision), and a standalone bundle that ships without unfold.css.
  // Presentation attributes lose to every stylesheet rule, so unfold.css still
  // wins wherever it is loaded, and the colour is still only ever a token.
  if (typeof o.halo === 'string') {
    attr(node, {
      'paint-order': 'stroke',
      stroke: cssVar(o.halo),
      'stroke-width': HALO_WIDTH,
      'stroke-linejoin': 'round',
    });
  }
  return node;
}

// ------------------------------------------------------------- reconcile ----
// parent -> Map<key, node>. A WeakMap so a discarded group takes its index with
// it, and so the steady state never has to scan the DOM to find a node by key.
const INDEX = new WeakMap();

/** Two items in one node means one of them silently does not appear. */
function dedupe(k, taken) {
  if (isDev()) throw new Error(`reconcile: duplicate key ${JSON.stringify(k)}`);
  // A published page suffixes instead of dying in front of a reader.
  let n = 2;
  while (taken.has(`${k}#${n}`)) n++;
  return `${k}#${n}`;
}

/**
 * @template T
 * @param {SVGElement} parent MUST be a group owned entirely by this call site.
 * @param {T[]} items
 * @param {object} spec
 * @param {(item:T, i:number) => string} spec.key
 * @param {(item:T, i:number) => SVGElement} spec.create
 * @param {(node:SVGElement, item:T, i:number) => SVGElement} [spec.update]
 *        default (n) => n. Return a DIFFERENT node to replace.
 * @param {(node:SVGElement, key:string) => void} [spec.exit] default node.remove()
 * @returns {SVGElement[]} nodes in document order, parallel to `items`
 *
 * reconcile OWNS every element child of `parent`, which is why accessibility
 * nodes must not live inside a reconciled group: <title>, <desc>, <defs> and
 * <style> belong on the <svg> root, every drawable in a layer <g>. That is the
 * current teardown strategy (querySelectorAll('g').forEach(remove) preserves
 * <title>/<desc>, ambiguity.md §11.3) stated once instead of copy-pasted three
 * times.
 */
export function reconcile(parent, items, spec) {
  const { key, create, update = n => n, exit = n => n.remove() } = spec;

  let index = INDEX.get(parent);
  if (!index) {
    // One seeding scan of the direct children, never a querySelectorAll and
    // never in the steady state. It exists so a parent that already carries
    // keyed nodes — a reload, or a group a string builder wrote during the
    // migration — is adopted rather than duplicated.
    index = new Map();
    for (const child of parent.children) {
      const k = child.getAttribute('data-k');
      if (k !== null && !index.has(k)) index.set(k, child);
    }
  }

  const next = new Map();
  const nodes = new Array(items.length);

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    let k = String(key(item, i));
    if (next.has(k)) k = dedupe(k, next);

    let node = index.get(k);
    // Taken out from under us (a teardown, or another call site) — rebuild.
    if (node && node.parentNode !== parent) node = undefined;

    if (node === undefined) {
      node = create(item, i);
    } else {
      const returned = update(node, item, i);
      // A falsy return is the common slip — `update: (n, f) => { attr(n, …); }`
      // — and it means "kept it", not "replace with nothing".
      if (returned && returned !== node) node = returned;
    }
    put(node, 'data-k', k);   // a no-op when unchanged, like every write here
    next.set(k, node);
    nodes[i] = node;
  }

  // Exits before placement, so the default remove() is out of the way before
  // positions are compared. A node whose key survived but whose update returned
  // a replacement exits here too: same cleanup path, one call site.
  for (const [k, node] of index) {
    if (next.get(k) === node) continue;
    exit(node, k);
  }
  // Dropping the old index drops the last reference this module holds to an
  // exited node, so the node and its listeners are collectable. A caller that
  // registered its own unsubscribes runs them in `exit`.
  INDEX.set(parent, next);

  // Back to front, each node placed before the one that must follow it. This
  // moves only what actually moved: an append is zero insertBefore calls, and a
  // full reversal of n is n-1. Going forwards instead would need absolute
  // positions, which a node raised out of band (Primitive.raise, applied after
  // reconciliation) or a custom exit still fading would make wrong.
  let ref = null;
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i];
    if (node.parentNode !== parent || node.nextSibling !== ref) parent.insertBefore(node, ref);
    ref = node;
  }
  return nodes;
}

// ------------------------------------------------------------------ z-order --
// ambiguity.md §14.2. Post-hoc paint order is the DOM idiom's decisive
// advantage, so it gets a name rather than living as a bare appendChild.
//
// Every one of these checks whether the node is already where it is going. The
// check is not an optimisation: re-inserting a node blurs it if it has focus
// and restarts any CSS transition on it, so an idempotent raise has to be a
// genuine no-op, not a move to the same place.

/** Move to last among the element children of its parent. No-op if unparented. */
export function raise(node) {
  const p = node?.parentNode;
  if (p && p.lastElementChild !== node) p.appendChild(node);
  return node;
}

/** All of `nodes` at the end, in the given order. */
export function raiseAll(nodes) {
  const list = [...nodes].filter(n => n?.parentNode);
  if (!list.length) return nodes;

  // Already the tail, in order? Then touch nothing — see the note above.
  const p = list[0].parentNode;
  if (list.every(n => n.parentNode === p)) {
    const kids = p.children;
    const from = kids.length - list.length;
    if (from >= 0 && list.every((n, i) => kids[from + i] === n)) return nodes;
  }
  for (const n of list) n.parentNode.appendChild(n);
  return nodes;
}

/** Move to first among the element children of its parent. */
export function lower(node) {
  const p = node?.parentNode;
  if (p && p.firstElementChild !== node) p.insertBefore(node, p.firstElementChild);
  return node;
}

/** Move to `index` among the element children of its parent, clamped. */
export function raiseTo(node, index) {
  const p = node?.parentNode;
  if (!p) return node;
  const others = [...p.children].filter(n => n !== node);
  const i = Math.max(0, Math.min(Math.trunc(index) || 0, others.length));
  const ref = others[i] ?? null;
  if (node.nextElementSibling !== ref) p.insertBefore(node, ref);
  return node;
}

// ------------------------------------------------------------ escape hatch --
/**
 * Parse a markup string in the SVG namespace.
 *
 * @param {string} markup
 * @returns {DocumentFragment} appending it moves the nodes out and empties it
 *
 * TRUST BOUNDARY. raw() does not escape, validate, sanitize, key or diff
 * anything. What is between the angle brackets becomes DOM exactly as written,
 * so the caller owns all four of these:
 *
 *  • Escaping. Every interpolated value that did not come from this module goes
 *    through esc() first. An unescaped `<` is a tag and an unescaped `&` is an
 *    entity, in a label as much as anywhere else.
 *  • Provenance. Never build the string from input you do not control, escaped
 *    or not: `<script>` and `<image href onload>` are markup, and esc() on an
 *    attribute value does not make the attribute safe.
 *  • Identity. The nodes are anonymous — reconcile() cannot see them, nothing
 *    will update them in place, and changing one means rebuilding the fragment
 *    and replacing the subtree wholesale.
 *  • Colour. I3 applies to the string: fill="var(--token)", never a literal.
 *
 * It is for static, high-count decorative geometry — grids, tick marks, hatch
 * patterns, a 48-gon rim — and it is the migration path ambiguity.md §14.3 asks
 * for: the two string explorers keep their builders and still consume the pure
 * modules. Everything interactive uses el() + reconcile().
 *
 * Parsing is strict XML rather than innerHTML, which turns the escaping
 * obligation above into a checked one: a malformed string throws here instead
 * of silently dropping the rest of the subtree at the first bad character.
 */
export function raw(markup) {
  const doc = new DOMParser().parseFromString(
    `<svg xmlns="${SVG_NS}">${markup}</svg>`, 'image/svg+xml');
  const err = doc.getElementsByTagName('parsererror')[0];
  if (err) throw new SyntaxError(`raw(): ${err.textContent.trim().split('\n')[0]}`);

  const frag = document.createDocumentFragment();
  for (const child of doc.documentElement.childNodes) frag.appendChild(document.importNode(child, true));
  return frag;
}

// The two-digit numeric form for the apostrophe, not the zero-padded one: a
// zero-padded numeric entity reads as a hex colour to a regex denylist, and
// &apos; is not defined in HTML.
const ENTITY = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** &, <, >, ", ' → entities. The half of raw()'s contract the caller can automate. */
export function esc(str) {
  return String(str).replace(/[&<>"']/g, c => ENTITY[c]);
}

// --------------------------------------------------------------- listeners --
/** @returns {() => void} unsubscribe; safe to call more than once. */
export function on(node, type, handler, options) {
  node.addEventListener(type, handler, options);
  let live = true;
  return () => {
    if (!live) return;   // a second call must not remove a listener re-added since
    live = false;
    node.removeEventListener(type, handler, options);
  };
}

/** @param {Record<string, EventListener>} map @returns {() => void} unsubscribes all. */
export function onAll(node, map, options) {
  const offs = Object.keys(map).map(type => on(node, type, map[type], options));
  return () => { for (const off of offs) off(); };
}

// ------------------------------------------------------------- measurement --
// The only DOM-reading function in this module. It is exempt from P1 because it
// reads text metrics, not a layout box: getComputedTextLength() on one reused
// node, never a bounding box, which is what Viewport measures once per frame.
const LINE = 1.2;   // default line-height; see the note on `h` below

/**
 * @param {SVGSVGElement} svgEl
 * @param {object} [o]
 * @param {string} [o.class='uf-mark'] class applied to the probe text node
 * @param {number} [o.cacheLimit=2000]
 * @returns {{ measure(text:string, style?:object): {w:number,h:number},
 *             clear(): void, dispose(): void, stats(): {hits:number,misses:number} }}
 */
export function createTextMeasurer(svgEl, o = {}) {
  const limit = o.cacheLimit ?? 2000;
  const probe = el('text', {
    class: o.class ?? 'uf-mark',
    x: 0,
    y: 0,
    // visibility, not display:none — an element that is not laid out has no
    // computed text length. aria-hidden because it is a measuring stick, and
    // pointer-events:none because it sits over the drawing.
    visibility: 'hidden',
    'pointer-events': 'none',
    'aria-hidden': 'true',
  });
  // The root, not a layer <g>: reconcile() owns the element children of every
  // group it is handed, and would exit this node on the first pass.
  svgEl.appendChild(probe);

  const cache = new Map();
  let hits = 0, misses = 0, basePx = 0, disposed = false;

  const px = v => (typeof v === 'number' ? v : v == null ? null : parseFloat(v));

  /** The class's own font size, for the h of a call that named no size. */
  const base = () => {
    // Not memoized until it is real: before the svg is laid out this reads
    // empty, and caching the 0 would give every label zero height for the rest
    // of the session.
    if (!basePx) {
      const v = parseFloat(getComputedStyle(probe).fontSize);
      if (Number.isFinite(v) && v > 0) basePx = v;
    }
    return basePx;
  };

  return {
    measure(str, style = {}) {
      if (disposed) throw new Error('createTextMeasurer: measure() after dispose()');
      const s = String(str);
      const key = `${s}|${style.fontSize ?? ''}|${style.weight ?? ''}|${style.family ?? ''}`;
      const hit = cache.get(key);
      if (hit) { hits++; return { w: hit.w, h: hit.h }; }
      misses++;

      // null removes, so an unspecified axis falls back to the class's CSS
      // rather than inheriting the previous call's value.
      attr(probe, {
        'font-size': style.fontSize ?? null,
        'font-weight': style.weight ?? null,
        'font-family': style.family ?? null,
      });
      probe.textContent = s;

      // h is derived, not measured: the only call that returns a text box is a
      // bounding-box read, which I4 reserves for Viewport. Font size times the
      // default line height is the line box, and LabelPlacer places lines, not
      // ink — a per-string ink height would make placement jitter as the label
      // text changed.
      const size = px(style.fontSize) ?? base();
      const out = { w: probe.getComputedTextLength(), h: size * LINE };

      // FIFO, not a flush: a full clear at the limit would re-measure the
      // entire scene on the frame it happened.
      if (cache.size >= limit) cache.delete(cache.keys().next().value);
      cache.set(key, out);
      return { w: out.w, h: out.h };
    },

    clear() { cache.clear(); basePx = 0; },

    dispose() { disposed = true; cache.clear(); probe.remove(); },

    /** Lifetime counters; clear() empties the cache but does not reset them. */
    stats() { return { hits, misses }; },
  };
}
