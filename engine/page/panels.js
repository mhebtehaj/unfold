// Layer 4 — panels, the draw context, and the overlay that links them.
//
// A panel is a measurable box with a drawing in it. The framework owns the
// box: the frame's markup, the viewport fit, the time the drawing is resolved
// at, and the redraw policy. The page owns what is drawn, through the verbs of
// the draw context — and a page never transforms a point, sets a viewBox, or
// measures anything, which is what stopped the shipped explorers' three copies
// of every transform from drifting.
//
// The draw context is immediate-mode on the outside and retained on the
// inside: `d.face(...)`, `d.dot(...)` read like the string-building code they
// replace, but each call records a keyed primitive, and render/scene.js
// reconciles the frame against the last one. So a redraw that changes one dot
// writes one attribute, and the 1 152 mesh cells of a disk keep their nodes.
//
// Coordinates: every verb takes MODEL points (the maths), except the radii and
// offsets that the shipped drawings state in pixels — a dot is `r: 4` px, a
// caption sits 19 px under the rim, the "leaves the target" ring is
// `radius·(1−t) + 5`. Both are expressible, and which is which is in the
// signature rather than in the caller's head.

export const LAYER = 4;

import { el, attr, reconcile, getPrecision } from '../core/svg.js';
import { measureBox } from '../core/viewport.js';
import * as marks from '../render/marks.js';

// ----------------------------------------------------------------- frames --

const ns = (doc, tag, attrs = {}, text) => {
  const node = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, String(v));
  }
  if (text != null) node.textContent = String(text);
  return node;
};

const svgEl = (doc, tag, attrs = {}) => {
  const node = doc.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    node.setAttribute(k, v === true ? '' : String(v));
  }
  return node;
};

const cls = (...list) => list.filter(Boolean).join(' ') || undefined;

/**
 * The house frame: a `<figure>` with a heading that carries the sans/serif
 * split, and the drawing.
 *
 *   <figure class="uf-frame uf-frame--current">
 *     <h2><span class="uf-frame__title">Now</span> <span class="uf-sym">fₜ(x)</span></h2>
 *     <svg class="uf-drawing" data-panel="now" role="group" tabindex="0" aria-label="…"></svg>
 *   </figure>
 *
 * The title is always its own element, even when it never changes: a heading
 * whose halves are a text node and a span in one page and two spans in another
 * is how the `.plain-label` reset rule came to exist.
 *
 * `role="group"` rather than `role="img"` on a drawing that is focusable and
 * answers to the keyboard (design-system.md §8, finding 9): `img` collapses
 * the subtree and announces "image", which is a contradiction on an element
 * the page then made operable. Read-only drawings keep `img`.
 */
export function frameMarkup(doc, panel, { id }) {
  const figure = ns(doc, 'figure', {
    class: cls('uf-frame', panel.frame === 'current' && 'uf-frame--current',
      panel.frame === 'seamless' && 'uf-frame--seamless', panel.class),
    'data-uf': 'panel',
  });
  const h = ns(doc, 'h2');
  h.append(ns(doc, 'span', { class: 'uf-frame__title', 'data-uf': 'title' }, panel.title ?? ''));
  if (panel.sym != null) { h.append(doc.createTextNode(' ')); h.append(ns(doc, 'span', { class: 'uf-sym' }, panel.sym)); }
  const drawing = svgEl(doc, 'svg', {
    class: cls('uf-drawing', panel.drawing),
    'data-panel': panel.id,
    id: id(`panel-${panel.id}`),
    role: panel.interactive === false ? 'img' : 'group',
    tabindex: panel.interactive === false ? undefined : '0',
    'aria-label': panel.describe,
  });
  figure.append(h, drawing);
  return { figure, drawing, title: h.firstElementChild };
}

// ---------------------------------------------------------------- layouts --

/**
 * Two columns, each with a label rail and one drawing or a stack of them —
 * "X on the left, Y on the right", the arrangement both shipped explorers use
 * for a map. The rail is a fixed grid row, so the drawings start on the same
 * line however the labels wrap, and the stage is `position: relative` so the
 * correspondence overlay can span it.
 *
 * @param {object} o
 * @param {Array<{id:string, label?:Function, panels:string[], ariaLabel?:string, class?:string}>} o.columns
 * @param {boolean} [o.overlay=false]  add the connectors <svg>
 * @param {string} [o.class]
 */
export function stage({ columns, overlay = false, class: cssClass } = {}) {
  if (!Array.isArray(columns) || !columns.length) throw new TypeError('panels.stage: give at least one column');
  return {
    kind: 'stage', columns, overlay,
    /** The binding for a label rail, looked up by the explorable. */
    labelFor(cid) {
      const column = columns.find(c => c.id === cid);
      return column && column.label ? { compute: column.label, needs: column.needs } : null;
    },
    build({ doc, panels, id }) {
      const root = ns(doc, 'div', { class: cls('uf-stage', cssClass), 'data-uf': 'stage' });
      const labels = new Map();
      const mounts = new Map();
      let overlayEl = null;
      if (overlay) {
        overlayEl = svgEl(doc, 'svg', { class: 'uf-overlay', 'data-uf': 'overlay', 'aria-hidden': 'true', hidden: true });
        root.append(overlayEl);
      }
      for (const column of columns) {
        const section = ns(doc, 'section', {
          class: cls('uf-column', column.class), 'aria-label': column.ariaLabel, 'data-uf': 'column',
        });
        if (column.label !== undefined) {
          const p = ns(doc, 'p', { class: 'uf-space-label', 'data-uf': 'space-label' });
          labels.set(column.id, p);
          section.append(p);
        }
        const list = column.panels.map(pid => {
          const panel = panels.get(pid);
          if (!panel) throw new Error(`panels.stage: no panel "${pid}"`);
          const built = frameMarkup(doc, panel, { id });
          mounts.set(pid, built);
          return built.figure;
        });
        if (list.length === 1) section.append(list[0]);
        else {
          const box = ns(doc, 'div', { class: 'uf-stack', style: undefined });
          box.append(...list);
          section.append(box);
        }
        root.append(section);
      }
      return { root, mounts, labels, overlay: overlayEl, stage: root };
    },
  };
}

/**
 * Markup the page wrote itself. The framework asks only that each panel be a
 * measurable box: the five-panel commutative diagram of the round-trip widget
 * is an explicitly placed grid with arrow glyphs in its gutter, and a generic
 * panel-grid API that could express it would be worse than the CSS.
 *
 * Panels are found by `[data-panel="<id>"]` inside the container, the overlay
 * by `[data-uf="overlay"]`, labels by `[data-uf="label:<id>"]`.
 *
 * `labels` gives those rails their reactive text, in the same shape a stage
 * column declares it — `{ x: { needs, compute } }`. The markup is the page's;
 * what goes in it is still a binding the framework owns, so the round-trip
 * diagram's two space labels are not four `textContent =` assignments spread
 * through a redraw function.
 *
 * @param {string|Element} target
 * @param {{labels?: Record<string, {needs?: string[], compute: Function}>}} [o]
 */
export function custom(target, { labels: labelSpecs } = {}) {
  return {
    kind: 'custom',
    labelFor(cid) {
      const spec = labelSpecs?.[cid];
      if (!spec) return null;
      if (typeof spec === 'function') return { compute: spec, needs: undefined };
      return { compute: spec.compute, needs: spec.needs };
    },
    build({ doc, panels, root }) {
      const host = typeof target === 'string' ? (root.querySelector(target) ?? doc.querySelector(target)) : target;
      if (!host) throw new Error(`panels.custom: nothing matches ${String(target)}`);
      const mounts = new Map();
      for (const [pid, panel] of panels) {
        const drawing = host.querySelector(`[data-panel="${pid}"]`);
        if (!drawing) throw new Error(`panels.custom: the markup has no [data-panel="${pid}"] for panel "${pid}"`);
        const figure = drawing.closest('figure') ?? drawing.parentElement;
        const title = figure?.querySelector('[data-uf="title"]') ?? null;
        // The page wrote the box; the framework still owns what makes it a
        // drawing the keyboard can reach, so adopted markup and built markup
        // cannot end up with different affordances.
        // In frameMarkup's order — role, tabindex, aria-label — so an adopted
        // drawing and a built one serialise identically.
        if (!drawing.hasAttribute('role')) drawing.setAttribute('role', panel.interactive === false ? 'img' : 'group');
        if (panel.interactive !== false && !drawing.hasAttribute('tabindex')) drawing.setAttribute('tabindex', '0');
        if (panel.describe && !drawing.hasAttribute('aria-label')) drawing.setAttribute('aria-label', panel.describe);
        mounts.set(pid, { figure, drawing, title });
      }
      const labels = new Map();
      for (const node of host.querySelectorAll('[data-uf^="label:"]'))
        labels.set(node.getAttribute('data-uf').slice(6), node);
      for (const cid of Object.keys(labelSpecs ?? {}))
        if (!labels.has(cid))
          throw new Error(`panels.custom: the markup has no [data-uf="label:${cid}"] for the "${cid}" label`);
      return { root: host, mounts, labels, overlay: host.querySelector('[data-uf="overlay"]'), stage: host, adopted: true };
    },
  };
}

// ----------------------------------------------------------- draw context --

/** Path numbers follow the kernel's precision, exactly as the marks do. */
function num(v) {
  const k = 10 ** getPrecision();
  return String(Math.round(v * k) / k);
}

/**
 * The verbs a panel's `draw(d, s)` uses. One instance per panel, reused every
 * frame: `begin()` clears it, the verbs record, and render/scene.js turns the
 * record into marks.
 *
 * Every verb returns nothing. Order is paint order.
 */
export class DrawContext {
  constructor({ panel, options, defs }) {
    this.panel = panel;
    this.options = options;
    this._defs = defs;
    this.frame = null;
    this.state = null;
    this.t = 0;
    this._vertices = [];
    this._prims = [];
    this._probe = null;
    this._n = 0;
  }

  /** Start a frame. `ctx` is the scene's build context. */
  begin(ctx, t) {
    this.frame = ctx.frame;
    this.state = ctx.state;
    this.t = t;
    this._vertices = [];
    this._prims = [];
    this._probe = null;
    this._n = 0;
    return this;
  }

  get vertices() { return this._vertices; }
  get primitives() { return this._prims; }
  get probeData() { return this._probe; }

  /** A model point becomes a vertex index; the scene does the transform. */
  _at(p) {
    if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1]))
      throw new TypeError(`draw: expected a model point [x, y], got ${JSON.stringify(p)}`);
    this._vertices.push(p);
    return this._vertices.length - 1;
  }

  _push(prim) {
    prim.key = `${prim.kind[0]}${this._n++}`;
    this._prims.push(prim);
  }

  /** A radius in model units, in px, or both: `frame.r · model + px`. */
  _radius(radius, where) {
    const model = typeof radius === 'number' ? radius : (radius?.model ?? 0);
    const px = typeof radius === 'number' ? 0 : (radius?.px ?? 0);
    if (!Number.isFinite(model) || !Number.isFinite(px))
      throw new TypeError(`${where}: radius must be a number of model units or { model, px }`);
    return this.frame.r * model + px;
  }

  // -- marks ---------------------------------------------------------------

  /** A filled polygon through model points; closed unless `closed: false`. */
  face(points, style = {}) {
    this._push({ kind: 'face', indices: points.map(p => this._at(p)), style });
  }

  /** One straight segment between two model points. */
  edge(a, b, style = {}) {
    this._push({ kind: 'edge', indices: [this._at(a), this._at(b)], style });
  }

  /** Connected segments through model points (a polyline, or a smooth curve). */
  polyline(points, style = {}) {
    this._push({ kind: 'polyline', indices: points.map(p => this._at(p)), style });
  }

  /** A dot at a model point, with its radius in PX (`r`, default 3.5). */
  dot(p, style = {}) {
    this._push({ kind: 'point', indices: [this._at(p)], style });
  }

  /**
   * A circle centred on a model point. `radius` is model units, px, or both —
   * the shipped "this frame leaves Y" ring is `radius·(1−t) + 5`.
   */
  circle(center, radius, style = {}) {
    const [cx, cy] = this.frame.toScreen(center);
    this._push({ kind: 'region', shape: { type: 'circle', cx, cy, r: this._radius(radius, 'd.circle') }, style });
  }

  /**
   * The ring between two radii, as one even-odd path — the shape of every
   * annulus on the site, and the reason it can be filled with one mark rather
   * than a disc with a hole punched over it.
   */
  annulus(center, { inner, outer }, style = {}) {
    const [cx, cy] = this.frame.toScreen(center);
    const R = this._radius(outer, 'd.annulus'), r = this._radius(inner, 'd.annulus');
    const ring = (c, radius) =>
      `M${num(c - radius)},${num(cy)}a${num(radius)},${num(radius)} 0 1,0 ${num(2 * radius)},0` +
      `a${num(radius)},${num(radius)} 0 1,0 ${num(-2 * radius)},0`;
    this._push({
      kind: 'region', shape: { type: 'path', d: `${ring(cx, R)} ${ring(cx, r)}` },
      style: { fillRule: 'evenodd', ...style },
    });
  }

  /** Any path, in screen px. The escape hatch; `d` is built by the caller. */
  path(d, style = {}) {
    this._push({ kind: 'region', shape: { type: 'path', d }, style });
  }

  /**
   * Text at a model point, offset by `dx`/`dy` PX — captions sit a fixed
   * distance under a rim, not a fixed distance in maths units.
   */
  text(p, str, style = {}) {
    this._push({ kind: 'text', indices: [this._at(p)], text: String(str), style });
  }

  /**
   * "This part is not in the space": a disc filled with the house 45° hatch.
   * The pattern is defined once per drawing and reused, rather than re-emitted
   * inside the mark list on every frame.
   */
  hatchDisk(center, radius, style = {}) {
    const fill = this._defs('hatch', doc => {
      const pattern = doc.createElementNS('http://www.w3.org/2000/svg', 'pattern');
      attr(pattern, { width: 6, height: 6, patternUnits: 'userSpaceOnUse' });
      pattern.append(el('path', { d: 'M0,6L6,0', stroke: 'var(--line-strong)', 'stroke-width': 0.6, opacity: 0.5 }));
      return pattern;
    });
    this.circle(center, radius, { fill, ...style });
  }

  /**
   * The selection ring: the input's own colour in the middle, a wide
   * light halo and a narrow dark ring outside it. Self-contrasting by
   * construction — it reads on a pale fill and on a fully saturated one, in
   * both schemes — which is why its two colours are the only ones on the site
   * that are deliberately not a light-dark() pair.
   *
   * The radii are the instance's `ring` option, because the shipped widgets
   * use two different sets and the fidelity rule keeps both.
   */
  ring(p, { fill, ring = this.options.ring } = {}) {
    const i = this._at(p);
    this._push({ kind: 'point', indices: [i], style: { r: ring.r, fill } });
    this._push({ kind: 'point', indices: [i], style: { r: ring.outer, fill: 'none', stroke: '--halo', width: ring.halo } });
    this._push({ kind: 'point', indices: [i], style: { r: ring.outer, fill: 'none', stroke: '--ink', width: ring.ink } });
  }

  /** Whatever this drawing decided, for the probe. Merged, not replaced. */
  probe(obj) {
    if (!obj || typeof obj !== 'object') throw new TypeError('d.probe: pass an object');
    this._probe = { ...(this._probe ?? {}), ...obj };
  }
}

// ---------------------------------------------------------------- overlay --

/**
 * The correspondence overlay: one `<svg>` across the stage, with a curve from
 * an input's place in one panel to its place in another.
 *
 * This is one component for both shapes the shipped page draws by hand: a star
 * from the source panel to the three maps, and the chain around the round-trip
 * square. A route says which panels it joins and how it bends; everything else
 * — the stage box, the child-to-stage transform INCLUDING the client→viewBox
 * scale that the second shipped widget drops, the paint order, the rings on
 * the selected input — is the component's.
 *
 * @param {object} o
 * @param {Array<{from:string, to:string, curve?:'horizontal'|'vertical', bend?:number|Function,
 *                dash?:boolean, weight?:'live'|'quiet', data?:Function}>} o.routes
 * @param {(state:object) => object[]} o.samples     inputs to draw a curve for
 * @param {(input:object, state:object) => string} o.colour
 * @param {string[]} [o.rings]   panels to ring the selection in; default every panel a route touches
 * @param {string} [o.toggle]     the boolean state key that shows it
 * @param {string[]} [o.needs]    extra state keys a route or a colour reads
 */
export function linked({ routes, samples, colour, rings, data, toggle, needs } = {}) {
  if (!Array.isArray(routes) || !routes.length) throw new TypeError('panels.linked: give at least one route');
  if (typeof samples !== 'function') throw new TypeError('panels.linked: samples must be a function of the state');
  if (typeof colour !== 'function') throw new TypeError('panels.linked: colour must be a function of the input');
  if (toggle !== undefined && typeof toggle !== 'string')
    throw new TypeError('panels.linked: toggle must be the name of a boolean state key');
  return { kind: 'linked', routes, samples, colour, rings, data, toggle, needs };
}

/**
 * Draw the overlay. Called by explorable.js after the panels of a frame, with
 * the panels' own viewports, so every point is where it was just drawn.
 */
export function drawOverlay({ spec, node, stage, state, panels, options, selected, evaluate }) {
  const box = measureBox(stage);
  attr(node, { viewBox: `0 0 ${box.width} ${box.height}` });

  // One pair of rect reads per panel, not one per point: the shipped code
  // reads two rects inside a loop over samples × views.
  const frames = new Map();
  for (const [id, panel] of panels) {
    if (!panel.viewport.live) continue;
    frames.set(id, panel.viewport.stageFrame(stage));
  }
  const at = (input, panelId) => {
    const f = frames.get(panelId);
    if (!f) return null;
    const p = evaluate(input, panelId);
    return p && f.toStage(p);
  };

  const conn = options.connector;
  const items = [];
  const curve = (a, b, route, bend) => {
    if (route.curve === 'vertical') {
      const dy = b[1] - a[1];
      const c = [a[0] + bend, a[1] + dy * conn.vertical];
      const e = [b[0] + bend, b[1] - dy * conn.vertical];
      return `M${num(a[0])},${num(a[1])}C${num(c[0])},${num(c[1])} ${num(e[0])},${num(e[1])} ${num(b[0])},${num(b[1])}`;
    }
    const dx = b[0] - a[0];
    const c = [a[0] + dx * conn.horizontal, a[1] + bend];
    const e = [b[0] - dx * conn.horizontal, b[1] + bend];
    return `M${num(a[0])},${num(a[1])}C${num(c[0])},${num(c[1])} ${num(e[0])},${num(e[1])} ${num(b[0])},${num(b[1])}`;
  };

  const line = (input, route, isSelected) => {
    const a = at(input, route.from), b = at(input, route.to);
    if (!a || !b) return;
    const bend = typeof route.bend === 'function' ? route.bend(input, state) : (route.bend ?? 0);
    const opacity = isSelected ? conn.selected
      : (selected ? conn.dimmed : (route.weight === 'live' ? conn.live : conn.quiet));
    items.push({
      key: `${route.from}-${route.to}:${isSelected ? 'sel' : input.__k}`,
      kind: 'path',
      d: curve(a, b, route, bend),
      style: {
        fill: 'none', stroke: spec.colour(input, state),
        width: isSelected ? conn.selectedWidth : conn.width,
        opacity, dash: route.dash ? conn.dash : undefined,
        data: spec.data ? spec.data(route, input, state) : undefined,
      },
    });
  };

  const list = spec.samples(state);
  list.forEach((input, i) => { input.__k = i; });
  for (const input of list) for (const route of spec.routes) line(input, route, false);
  if (selected) {
    for (const route of spec.routes) line(selected, route, true);
    const ringPanels = spec.rings ?? [...new Set(spec.routes.flatMap(r => [r.from, r.to]))];
    const ring = options.ring;
    for (const id of ringPanels) {
      const p = at(selected, id);
      if (!p) continue;
      items.push({ key: `ring:${id}:0`, kind: 'dot', p, style: { r: ring.r, fill: spec.colour(selected, state) } });
      items.push({ key: `ring:${id}:1`, kind: 'dot', p, style: { r: ring.outer, fill: 'none', stroke: '--halo', width: ring.halo } });
      items.push({ key: `ring:${id}:2`, kind: 'dot', p, style: { r: ring.outer, fill: 'none', stroke: '--ink', width: ring.ink } });
    }
  }

  reconcile(node, items, {
    key: item => item.key,
    create: item => paint(item, null),
    update: (n, item) => paint(item, n),
  });
  return items.length;
}

function paint(item, node) {
  return item.kind === 'dot'
    ? marks.point(item.p, item.style, node)
    : marks.region({ type: 'path', d: item.d }, item.style, node);
}
