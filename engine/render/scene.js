// SvgScene — the draw cycle, and the contract every drawable object plugs into.
//
// A scene owns an <svg>: one layer <g> per declared layer, drawn in order, and
// nothing else below them. Objects added to it — Renderables — supply model
// points, primitives that refer to those points BY INDEX, and a style for each
// primitive. The scene does everything else: it measures once, transforms
// every point, builds each mark, reconciles it by key, places labels, lifts
// what asked to be lifted, and publishes the probe. A renderable never
// transforms a point or touches the DOM, which is what stopped the explorers'
// three copies of every transform from drifting (the viewport fits, the y-flip,
// the `g.r *= .81` cache write).
//
// This is the 2-D path: `camera: null`, points [x, y], screen = viewport. The
// 3-D half (camera, projector, depth sorting, occlusion) plugs into steps 3,
// 5 and 6 below when render/camera.js and friends land; until then a scene
// given a camera refuses it rather than drawing it wrongly.
//
// The draw cycle, in order:
//   1  measure the viewport — the one layout read (P1); hidden → skip the frame
//   2  vertices(ctx) per renderable, in model space
//   3  transform to screen; ctx.screen(i) reads it
//   4  primitives(ctx), referring to vertices by index
//   5  (occlusion — Phase 5)
//   6  order: layer by layer, in insertion order within a layer, with whatever
//      asked to be raised last in its layer
//   7  style(prim, ctx) → a mark, reconciled into its layer by key
//   8  labels(ctx) from every renderable, through one LabelPlacer
//   9  (raising is done by the order in 6, not by moving nodes after 7: the
//      same paint order, and a frame that changed nothing moves nothing)
//   10 probe: engine fields, then each renderable's under domain.<id>
// Each renderable's hooks run inside try/catch, and everything they return is
// checked there too — kinds, keys, indices, styles, label items, raw markup —
// so a renderable that throws or returns something undrawable is skipped for
// the frame and named in the warnings, instead of leaving a half-drawn scene
// and a dead widget behind. draw() itself does not throw for a renderable's
// sake.

import { el, attr, reconcile, raw } from '../core/svg.js';
import { describeSvg } from '../core/a11y.js';
import { LabelPlacer, metricText } from '../core/labels.js';
import * as marks from './marks.js';

export const LAYER = 1;

/** Which layer a primitive lands in when it does not say. */
export const KIND_TO_LAYER = Object.freeze({
  face: 'faces', region: 'faces', raw: 'faces',
  edge: 'edges', polyline: 'edges', curve: 'edges', arrow: 'edges',
  point: 'points',
  text: 'labels',
});

const KINDS = new Set(Object.keys(KIND_TO_LAYER));

/**
 * How many vertex indices a kind draws through, where a wrong count would
 * crash the mark rather than just draw nothing. Faces and polylines take any
 * number (fewer than two draws nothing, which is a legitimate degenerate
 * frame); regions and raw markup take none.
 */
const ARITY = { edge: 2, arrow: 2, point: 1, text: 1 };

/**
 * A renderable id is the first segment of every key it owns — `id/prim`,
 * `label:id/item` — and its name under `domain.` in the probe, so it may not
 * contain the separators those use.
 */
const ID = /^[A-Za-z0-9_-]+$/;

/**
 * @typedef {Object} Primitive
 * @property {string} key       stable within its renderable; the reconciliation and pick handle
 * @property {'face'|'edge'|'polyline'|'curve'|'arrow'|'point'|'region'|'text'|'raw'} kind
 * @property {number[]} [indices]   into vertices(); the points the mark is drawn through
 * @property {string} [layer]       default KIND_TO_LAYER[kind]
 * @property {boolean} [raise]      lift to the top of its layer after reconciliation
 * @property {Record<string,string|number>} [data]   data-* pick payload
 * @property {string} [title]
 * @property {string} [text]        kind 'text'
 * @property {object} [shape]       kind 'region', in screen px
 * @property {string} [markup]      kind 'raw', trusted static SVG
 * @property {any} [meta]           echoed to style() and to pick handlers
 */

/**
 * @typedef {Object} Renderable
 * @property {string} id                     letters, digits, _ and -: it is the first
 *           segment of every key the renderable owns and its name in the probe
 * @property {number} [dim=2]
 * @property {string[]} [dependsOn=['all']]   invalidation levels that make it redraw
 * @property {(ctx) => number[][]} vertices
 * @property {(ctx) => Primitive[]} primitives
 * @property {(prim:Primitive, ctx) => object} style
 * @property {(ctx) => object[]} [labels]      LabelItems, anchors in screen px. An item's
 *           `style` is what the placer measures ({fontSize, weight}); its `mark` is how the
 *           placed label is drawn ({class, halo, data, interactive}, see marks.label)
 * @property {(ctx) => object} [probe]         merged under domain.<id>
 * @property {(hit, ctx) => boolean} [onPick]  true = handled
 */

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class SvgScene {
  #svg; #viewport; #layers; #kindToLayer; #probe; #store; #onDraw;
  #labelOpts; #placer = null;
  #renderables = [];
  #groups = new Map();
  #defs = null; #defIds = new Set();
  #cache = new Map();          // renderable → {frame, vertices, screen, ops, labels, probe}
  #applied = new WeakMap();    // node → the op it was last built from
  #rawOf = new WeakMap();      // raw group → the markup it holds
  #parsed = new Map();         // markup → its parsed fragment, so static markup parses once
  #index = new Map();          // full key → {op, renderable, ctx}
  #levels = new Set();
  #raf = 0;
  #picks = new Set();
  #unlisten = null;
  #last = null;
  #disposed = false;

  /** Nearest-mark fallback for picking, in px; 0 is off. */
  pickRadius = 0;

  /**
   * @param {SVGSVGElement} svgEl
   * @param {object} o
   * @param {import('../core/viewport.js').Viewport} o.viewport
   * @param {null} [o.camera=null]         the 2-D path; a camera arrives in Phase 5
   * @param {string[]} [o.layers=['faces','edges','points','labels']]  paint order
   * @param {Record<string,string>} [o.kindToLayer]
   * @param {object|null} [o.probe=null]   a core/probe.js Probe
   * @param {{get():object}|null} [o.store=null]   ctx.state comes from store.get()
   * @param {object} [o.labels]            LabelPlacer options
   * @param {{role?:string,label?:string,title?:string,desc?:string}} [o.a11y]
   * @param {(ctx:object) => void} [o.onDraw]
   */
  constructor(svgEl, o = {}) {
    if (!svgEl || svgEl.localName !== 'svg') throw new TypeError('SvgScene: first argument must be an <svg>');
    if (!o.viewport || typeof o.viewport.measure !== 'function')
      throw new TypeError('SvgScene: { viewport } is required');
    if (o.camera != null || o.rotor != null)
      throw new Error('SvgScene: this is the 2-D path; a camera or rotor arrives with render/camera.js');

    this.#svg = svgEl;
    this.#viewport = o.viewport;
    this.#layers = [...(o.layers ?? ['faces', 'edges', 'points', 'labels'])];
    if (new Set(this.#layers).size !== this.#layers.length) throw new Error('SvgScene: duplicate layer name');
    this.#kindToLayer = { ...KIND_TO_LAYER, ...o.kindToLayer };
    this.#probe = o.probe ?? null;
    this.#store = o.store ?? null;
    this.#onDraw = o.onDraw ?? null;
    this.#labelOpts = o.labels ?? {};
    // A leader-line label is placed at its least-bad spot on the promise that a
    // line will lead back to its anchor. This scene does not draw that line yet,
    // so it refuses the policy rather than stranding a label far from its point.
    if (this.#labelOpts.onDrop === 'leader')
      throw new Error("SvgScene: labels.onDrop 'leader' is not drawn yet; use 'omit' or 'shrink'");

    if (o.a11y) {
      // Only what was asked for: attr() removes an attribute given undefined, and
      // a scene that was told only a title must not strip the page's own role.
      const { role, label, title, desc } = o.a11y;
      if (role !== undefined) attr(svgEl, { role });
      if (label !== undefined) attr(svgEl, { 'aria-label': label });
      if (title != null || desc != null) describeSvg(svgEl, { title, desc });
    }
    // Layers are created up front, in paint order, after any <title>/<desc>.
    for (const name of this.#layers) {
      const g = el('g', { class: 'uf-layer', data: { layer: name } });
      svgEl.appendChild(g);
      this.#groups.set(name, g);
    }
  }

  // ---------------------------------------------------------- registry --

  add(renderable) {
    for (const k of ['vertices', 'primitives', 'style'])
      if (typeof renderable?.[k] !== 'function') throw new TypeError(`SvgScene.add: renderable needs ${k}()`);
    if (typeof renderable.id !== 'string' || !ID.test(renderable.id))
      throw new TypeError(`SvgScene.add: renderable id ${JSON.stringify(renderable.id)} must be letters, digits, _ or -`);
    if (this.#renderables.some(r => r.id === renderable.id))
      throw new Error(`SvgScene.add: a renderable "${renderable.id}" is already in the scene`);
    const deps = renderable.dependsOn;
    if (deps !== undefined && !(Array.isArray(deps) && deps.every(l => typeof l === 'string')))
      throw new TypeError(`SvgScene.add: ${renderable.id}.dependsOn must be an array of level names`);
    this.#renderables.push(renderable);
    try {
      renderable.attach?.(this);
    } catch (e) {
      this.#renderables.splice(this.#renderables.indexOf(renderable), 1);
      throw e;
    }
    this.#listen();
    this.invalidate('all');
    return renderable;
  }

  remove(renderable) {
    const i = this.#renderables.indexOf(renderable);
    if (i < 0) return;
    this.#renderables.splice(i, 1);
    this.#cache.delete(renderable);
    // Its marks stay on screen until the next draw, but out of reach of a pick.
    for (const [k, hit] of this.#index) if (hit.renderable === renderable) this.#index.delete(k);
    this.#listen();
    this.invalidate('all');
    this.#detach(renderable);
  }

  /** detach() is the renderable's code: a throw is reported, and teardown goes on. */
  #detach(r) {
    try {
      r.detach?.();
    } catch (e) {
      if (typeof console !== 'undefined') console.warn(`SvgScene: ${r.id}.detach() threw: ${e?.message ?? e}`);
    }
  }

  /** Remove every renderable; the next draw empties the layers. */
  clear() {
    for (const r of [...this.#renderables]) this.remove(r);
  }

  get renderables() { return [...this.#renderables]; }

  /**
   * A layer's group. The reconciler owns its children: a node a page hangs
   * here itself is left in place, but each draw puts the scene's marks after
   * it, so it paints underneath them. Anything that must sit among or above
   * the marks belongs in a renderable (kind 'raw' for static markup).
   */
  layer(name) {
    const g = this.#groups.get(name);
    if (!g) throw new Error(`SvgScene: no layer "${name}" (layers are ${this.#layers.join(', ')})`);
    return g;
  }

  /**
   * One-time <defs> content — a hatch pattern, a marker — created on first use
   * and reused, instead of re-emitted every frame.
   * @param {string} id
   * @param {() => SVGElement} factory
   * @returns {string} `url(#id)`
   */
  defs(id, factory) {
    if (!this.#defs) {
      this.#defs = el('defs');
      this.#svg.insertBefore(this.#defs, this.#groups.get(this.#layers[0]) ?? null);
    }
    if (!this.#defIds.has(id)) {
      const node = factory();
      node.setAttribute('id', id);
      this.#defs.appendChild(node);
      this.#defIds.add(id);
    }
    return `url(#${id})`;
  }

  // ------------------------------------------------------------- cycle --

  /**
   * Draw on the next animation frame, once, however many times this is called
   * before it. Levels accumulate; a renderable redraws when any of its
   * dependsOn is among them, or when the level is 'all'.
   */
  invalidate(level = 'all') {
    if (this.#disposed) return;
    this.#levels.add(level);
    if (this.#raf || typeof requestAnimationFrame !== 'function') return;
    this.#raf = requestAnimationFrame(time => {
      this.#raf = 0;
      const levels = new Set(this.#levels);
      this.#levels.clear();
      this.draw({ levels, time });
    });
  }

  /**
   * The full cycle, synchronously.
   * @param {{levels?: Iterable<string>, time?: number}} [o]
   * @returns {object} the frame's stats, also at `lastFrame`
   */
  draw(o = {}) {
    if (this.#disposed) throw new Error('SvgScene: draw() after dispose()');
    const t0 = now();
    const levels = new Set(o.levels ?? ['all']);
    // A synchronous draw takes over a frame already requested: that frame's
    // levels join this one's, and it does not run a second time.
    if (this.#raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.#raf);
    this.#raf = 0;
    for (const l of this.#levels) levels.add(l);
    this.#levels.clear();
    const vp = this.#viewport;

    vp.measure();                                                           // 1
    if (!vp.live) {
      this.#last = { skipped: 'hidden', levels: [...levels] };
      return this.#last;
    }
    const frame = vp.frame;
    const state = this.#state();
    const warnings = [];
    const byLayer = new Map(this.#layers.map(n => [n, []]));
    const labelItems = [];
    const domain = {};
    this.#index.clear();

    for (const r of this.#renderables) {
      let entry = this.#cache.get(r);
      const dirty = !entry || entry.frame !== frame || levels.has('all') ||
        (r.dependsOn ?? ['all']).some(l => levels.has(l));
      if (dirty) {
        try {
          entry = this.#build(r, frame, state, levels, o.time ?? t0);
          this.#cache.set(r, entry);
        } catch (e) {
          this.#cache.delete(r);
          warnings.push(`${r.id}: ${e?.message ?? e}`);
          continue;
        }
      }
      for (const op of entry.ops) {
        const list = byLayer.get(op.layer);
        if (!list) {
          warnings.push(`${r.id}: primitive ${op.prim.key} names layer "${op.layer}", which the scene does not have`);
          continue;
        }
        list.push(op);
        this.#index.set(op.key, { op, renderable: r, ctx: entry.ctx });
      }
      for (const it of entry.labels) labelItems.push({ ...it, renderable: r, ctx: entry.ctx });
      if (entry.probe !== undefined) domain[r.id] = entry.probe;
    }

    // 8 — labels: one placer, so labels from different renderables avoid each other.
    let placed = [], dropped = [];
    if (labelItems.length) {
      const layer = this.#layers.includes('labels') ? 'labels' : this.#layers[this.#layers.length - 1];
      this.#placer ??= new LabelPlacer({ measure: metricText, ...this.#labelOpts });
      this.#placer.reset();
      try {
        ({ placed, dropped } = this.#placer.place(labelItems.map(it => it.item),
          { bounds: { x: 0, y: 0, w: frame.w, h: frame.h } }));
      } catch (e) {
        // Every item was checked with its renderable, so this is the placer's
        // own failure (an injected measure that throws, say): no labels this
        // frame, every one reported, and the rest of the frame drawn.
        placed = [];
        dropped = labelItems.map(it => ({ id: it.item.id, text: it.item.text, reason: 'error' }));
        warnings.push(`labels: ${e?.message ?? e}`);
      }
      const owner = new Map(labelItems.map(it => [it.item.id, it]));
      for (const p of placed) {
        const it = owner.get(p.id);
        const op = { key: `label:${p.id}`, layer, kind: 'label', placed: p, style: it.mark,
                     prim: { key: it.localId, kind: 'label', meta: it.item.meta } };
        byLayer.get(layer).push(op);
        this.#index.set(op.key, { op, renderable: it.renderable, ctx: it.ctx });
      }
    }

    // 7 + 9 — build and reconcile. A raised primitive is ordered last in its
    // layer before reconciliation rather than moved after it: the paint order
    // is the same, and a frame in which nothing changed moves nothing — a
    // move would blur a focused mark and restart its transitions every frame.
    const counts = {};
    const layerStats = [];
    for (const [name, list] of byLayer) {
      const ops = list.some(op => op.prim.raise)
        ? [...list.filter(op => !op.prim.raise), ...list.filter(op => op.prim.raise)]
        : list;
      const nodes = reconcile(this.#groups.get(name), ops, {
        key: op => op.key,
        create: op => this.#safeMark(op, null, warnings),
        update: (node, op) => this.#safeMark(op, node, warnings),
      });
      ops.forEach((op, i) => {
        counts[op.kind] = (counts[op.kind] ?? 0) + 1;
        const hit = this.#index.get(op.key);
        if (hit) hit.node = nodes[i];
      });
      layerStats.push({ name, count: ops.length });
    }

    // 10 — the probe.
    const stats = {
      ms: now() - t0, levels: [...levels], marks: counts, layers: layerStats,
      labels: { placed: placed.length, dropped: dropped.length, droppedIds: dropped.map(d => d.id) },
      warnings,
    };
    const probe = this.#probe;
    if (probe?.enabled) {
      probe.reset();
      probe.set('viewport', { w: frame.w, h: frame.h, r: frame.r, cx: frame.cx, cy: frame.cy, live: true });
      probe.set('layers', layerStats);
      probe.set('marks', counts);
      probe.set('labels', stats.labels);
      for (const [id, v] of Object.entries(domain)) probe.set(`domain.${id}`, v);
      for (const w of warnings) probe.warn(w);
      probe.commit();
    } else if (warnings.length && typeof console !== 'undefined') {
      for (const w of warnings) console.warn(`SvgScene: ${w}`);
    }
    this.#last = stats;
    this.#onDraw?.({ scene: this, viewport: vp, frame, state, levels, stats });
    return stats;
  }

  /** What ctx.state is: the store's state now, or an empty object. */
  #state() {
    return this.#store?.get?.() ?? {};
  }

  /** The measure a label is placed with, so ctx.measure agrees with the placer. */
  #measure(str, style) {
    return (this.#labelOpts.measure ?? metricText)(str, style);
  }

  /** Raw markup, parsed once per distinct string; throws a SyntaxError if malformed. */
  #fragment(markup) {
    let f = this.#parsed.get(markup);
    if (!f) {
      f = raw(markup);
      if (this.#parsed.size >= 64) this.#parsed.clear();
      this.#parsed.set(markup, f);
    }
    return f;
  }

  /** The stats of the last draw() — marks per kind, layer sizes, labels, warnings, ms. */
  get lastFrame() { return this.#last; }

  /** Steps 2–4 and 7's style call for one renderable: everything it contributes. */
  #build(r, frame, state, levels, time) {
    const dim = r.dim ?? 2;
    if (dim !== 2) throw new Error(`dim ${dim} needs a camera; this scene is 2-D`);
    const ctx = { scene: this, viewport: this.#viewport, frame, camera: null, state, levels, time };
    const vertices = r.vertices(ctx) ?? [];                                 // 2
    const n = vertices.length;
    const screen = new Float64Array(2 * n);                                 // 3
    const tmp = [0, 0];
    for (let i = 0; i < n; i++) {
      const v = vertices[i];
      if (!v || !Number.isFinite(v[0]) || !Number.isFinite(v[1]))
        throw new Error(`vertex ${i} is not a finite point: ${JSON.stringify(v)}`);
      frame.toScreen(v, tmp);
      screen[2 * i] = tmp[0]; screen[2 * i + 1] = tmp[1];
    }
    const check = i => {
      if (!Number.isInteger(i) || i < 0 || i >= n) throw new RangeError(`index ${i} is outside the ${n} vertices`);
      return i;
    };
    Object.assign(ctx, {
      model: i => vertices[check(i)],
      view: i => [vertices[check(i)][0], vertices[i][1], 0],
      screen: i => [screen[2 * check(i)], screen[2 * i + 1]],
      depth: i => (check(i), 0),
      cue: () => null,
      measure: (str, style) => this.#measure(str, style),
    });

    const prims = r.primitives(ctx) ?? [];                                  // 4
    const seen = new Set();
    const ops = prims.map(prim => {
      if (!KINDS.has(prim.kind)) throw new Error(`primitive ${prim.key}: unknown kind "${prim.kind}"`);
      if (typeof prim.key !== 'string' || !prim.key) throw new Error(`a ${prim.kind} primitive has no key`);
      if (seen.has(prim.key)) throw new Error(`two primitives share the key "${prim.key}"`);
      seen.add(prim.key);
      const want = ARITY[prim.kind];
      if (want !== undefined && prim.indices?.length !== want)
        throw new Error(`primitive ${prim.key}: a ${prim.kind} needs ${want} ${want === 1 ? 'index' : 'indices'}, got ${prim.indices?.length ?? 0}`);
      const pts = (prim.indices ?? []).map(i => ctx.screen(i));
      const style = r.style(prim, ctx) ?? {};                               // 7 (style)
      // Throws here, inside this renderable's try/catch, for anything the mark
      // itself would throw on mid-reconciliation: a literal colour, an unknown
      // dash, a region with no known shape.
      marks.check(prim.kind, style, prim);
      if (prim.kind === 'raw') this.#fragment(prim.markup);
      return {
        key: `${r.id}/${prim.key}`, kind: prim.kind, layer: prim.layer ?? this.#kindToLayer[prim.kind],
        prim, pts, style: { ...style, data: { ...prim.data, ...style.data }, title: style.title ?? prim.title },
      };
    });
    const labels = [];
    const ids = new Set();
    for (const item of r.labels?.(ctx) ?? []) {
      const id = item?.id;
      if (typeof id !== 'string' || !id) throw new Error('a label item has no id');
      if (ids.has(id)) throw new Error(`two labels share the id "${id}"`);
      ids.add(id);
      if (typeof item.text !== 'string') throw new Error(`label ${id}: text must be a string`);
      const a = item.anchor;
      if (!a || !Number.isFinite(a[0]) || !Number.isFinite(a[1]))
        throw new Error(`label ${id}: anchor must be a finite [x, y] in screen px`);
      if (item.priority !== undefined && !Number.isFinite(item.priority))
        throw new Error(`label ${id}: priority must be a number`);
      const { mark = {}, candidates: gen, ...rest } = item;
      // A candidates function runs here, inside this renderable's try/catch,
      // not inside the placer, where one throw would stop every label.
      const list = typeof gen === 'function' ? gen(item) : gen;
      if (list !== undefined && !(Array.isArray(list) && list.every(c => Number.isFinite(c?.dx) && Number.isFinite(c?.dy))))
        throw new Error(`label ${id}: candidates must be a list of {dx, dy}`);
      marks.check('label', mark);
      labels.push({ item: { ...rest, ...(list !== undefined && { candidates: list }), id: `${r.id}/${id}` }, mark, localId: id });
    }
    const probe = r.probe ? r.probe(ctx) : undefined;
    return { frame, ctx, ops, labels, probe };
  }

  /**
   * #mark behind a last line of defence. #build checks everything a mark is
   * known to refuse, so a throw here is a case nobody anticipated; it costs
   * that one mark — an existing node keeps its last good state, a new one
   * stands empty — and a warning, never the rest of the frame.
   */
  #safeMark(op, node, warnings) {
    try {
      return this.#mark(op, node);
    } catch (e) {
      warnings.push(`${op.key}: ${e?.message ?? e}`);
      return node ?? el('g', { data: { error: '' } });
    }
  }

  /** Build or update the node for one op; a node already built from this op is left alone. */
  #mark(op, node) {
    if (node && this.#applied.get(node) === op) return node;
    const { kind, pts, style, prim } = op;
    let out;
    switch (kind) {
      case 'face': out = marks.face(pts, style, node); break;
      case 'edge': out = marks.edge(pts[0], pts[1], style, node); break;
      case 'polyline': out = marks.polyline(pts, style, node); break;
      case 'curve': out = marks.curve(pts, style, node); break;
      case 'arrow': out = marks.arrow(pts[0], pts[1], style, node); break;
      case 'point': out = marks.point(pts[0], style, node); break;
      case 'region': out = marks.region(prim.shape, style, node); break;
      case 'text': out = marks.text(pts[0], prim.text ?? '', style, node); break;
      case 'label': out = marks.label(op.placed, style, node); break;
      case 'raw': {
        // The group is kept; its content is re-parsed only when the markup
        // changed. The markup is remembered here rather than in an attribute,
        // which would carry a second copy of every grid and rim in the DOM.
        out = node && this.#rawOf.has(node) ? node : el('g');
        if (this.#rawOf.get(out) !== prim.markup) {
          out.replaceChildren(this.#fragment(prim.markup).cloneNode(true));
          this.#rawOf.set(out, prim.markup);
        }
        // The group takes the style: class, payload and tooltip, and paint the
        // markup inherits wherever it does not set its own.
        marks.style(out, style);
        break;
      }
      default: throw new Error(`no mark for kind "${kind}"`);
    }
    this.#applied.set(out, op);
    return out;
  }

  // ----------------------------------------------------------- picking --

  /**
   * What is under an event: the primitive whose mark contains the target, or,
   * with pickRadius > 0, the nearest point primitive within that many px.
   * @returns {{prim:object, renderable:object, data:object, point:[number,number], node:Element, event:Event}|null}
   */
  hitTest(event) {
    const point = this.#viewport.screenFromEvent(event);
    for (let n = event.target; n && n !== this.#svg; n = n.parentNode) {
      const k = n.getAttribute?.('data-k');
      if (k == null || this.#groups.get(n.parentNode?.dataset?.layer) !== n.parentNode) continue;
      const hit = this.#index.get(k);
      if (hit) return { prim: hit.op.prim, renderable: hit.renderable, data: hit.op.style.data ?? {}, point, node: n, event };
    }
    if (this.pickRadius > 0 && point) {
      let best = null, bestD = this.pickRadius;
      for (const hit of this.#index.values()) {
        if (hit.op.kind !== 'point') continue;
        const [x, y] = hit.op.pts[0];
        const d = Math.hypot(x - point[0], y - point[1]);
        if (d <= bestD) { best = hit; bestD = d; }
      }
      if (best) return { prim: best.op.prim, renderable: best.renderable, data: best.op.style.data ?? {}, point, node: best.node, event };
    }
    return null;
  }

  /**
   * Call `handler(hit)` for every pointerdown that lands on a primitive. The
   * primitive's own renderable sees it first; returning true there stops it.
   * @returns {() => void} unsubscribe
   */
  onPick(handler) {
    this.#picks.add(handler);
    this.#listen();
    return () => {
      this.#picks.delete(handler);
      this.#listen();
    };
  }

  /**
   * One pointerdown listener, present exactly while something wants picks: a
   * handler given to onPick(), or a renderable with an onPick of its own.
   */
  #listen() {
    const wanted = !this.#disposed && (this.#picks.size > 0 || this.#renderables.some(r => r.onPick));
    if (wanted && !this.#unlisten) {
      const listener = ev => {
        const hit = this.hitTest(ev);
        if (!hit) return;
        // The geometry is the frame that was drawn — that is what was under the
        // pointer — but the state is now, so a handler never acts on a stale one.
        const ctx = { ...this.#cache.get(hit.renderable)?.ctx, state: this.#state() };
        if (hit.renderable.onPick?.(hit, ctx) === true) return;
        for (const h of this.#picks) h(hit);
      };
      this.#svg.addEventListener('pointerdown', listener);
      this.#unlisten = () => this.#svg.removeEventListener('pointerdown', listener);
    } else if (!wanted && this.#unlisten) {
      this.#unlisten();
      this.#unlisten = null;
    }
  }

  // ------------------------------------------------------------ teardown --

  /** Stop drawing, drop every listener, and remove the layers and defs this scene made. */
  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.#raf);
    this.#raf = 0;
    this.#unlisten?.();
    this.#unlisten = null;
    this.#picks.clear();
    for (const g of this.#groups.values()) g.remove();
    this.#defs?.remove();
    const gone = this.#renderables;
    this.#renderables = [];
    this.#cache.clear();
    this.#index.clear();
    this.#parsed.clear();
    // Last, and each on its own: a detach() that throws cannot keep the rest.
    for (const r of gone) this.#detach(r);
  }
}
