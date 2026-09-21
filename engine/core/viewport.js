// The one y-flip (P2), the one layout read (P1), the one owner of viewBox.
//
// Three concrete failures, one module:
//
//  • `solidRender` does `g.r *= .81` on the object stored in the shared
//    `geometries` Map (realization.md §16.14), so the radius a later reader
//    gets depends on how many times the cache has been touched. Here the
//    measured state changes only inside measure(), and every derived frame —
//    scaled(), translated() — is a NEW frozen Frame. Nothing mutates a cache.
//
//  • The second homotopy widget drops the client→viewBox scale factor twice
//    (homotopy.md §15.3): `eqSelect` and `eqDrawConnections` take raw pixel
//    deltas out of a rect where the first widget scales them by `g.w /
//    box.width`. It works only because the viewBox happens to equal the
//    measured client size, which stops being true for every frame between a
//    resize and the next measure (realization.md §16.15 is the same bug from
//    the other side: client pixels mixed with a *cached* viewBox). fromEvent
//    and screenFromEvent are the only client→viewBox conversions in the engine
//    and they always apply the factor.
//
//  • A first draw into a hidden tab panel caches a bogus 70×90 frame
//    (homotopy.md §15.28). `live` is false when the element measured 0, so the
//    draw aborts, and a zero-size observation never schedules a redraw at all —
//    the existing pages have four tab panels, so this is the common case, not
//    the edge case.
//
// The performance claim behind P1: the pages force 2–3 synchronous layouts per
// frame (ambiguity.md §16.15). Everything downstream consumes the measured
// frame, so a frame measures once. `tools/check-layers.mjs` exempts this file
// from I4 and fails every other one.

import { clamp } from './vec.js';

export const LAYER = 0;

// ------------------------------------------------------------------ options --
// Every option is arithmetic that lands in a coordinate, so a bad one does not
// throw where it was passed — it produces a plausible wrong drawing, or a NaN
// in a `d` attribute, several modules away. They are checked here, always, not
// under a dev flag.

function finite(v, what) {
  if (typeof v !== 'number' || !Number.isFinite(v))
    throw new TypeError(`Viewport: ${what} must be a finite number, got ${v}`);
  return v;
}

function pair(v, what) {
  if (!Array.isArray(v) || v.length < 2)
    throw new TypeError(`Viewport: ${what} must be [x, y]`);
  return [finite(v[0], `${what}[0]`), finite(v[1], `${what}[1]`)];
}

/**
 * pad → {top,right,bottom,left}. Three spellings because the reserve is stated
 * three ways across the pages: one number, [x, y] (28 across / 44 down), or per
 * side. pad SIZES the drawing and `offset` POSITIONS it — an asymmetric pad
 * does not move the centre, which is what `offset` is for.
 */
function padOf(p) {
  if (typeof p === 'number') {
    const v = finite(p, 'pad');
    return { top: v, right: v, bottom: v, left: v };
  }
  if (Array.isArray(p)) {
    const [x, y] = pair(p, 'pad');
    return { top: y, right: x, bottom: y, left: x };
  }
  if (p && typeof p === 'object') {
    return {
      top: finite(p.top ?? 0, 'pad.top'),
      right: finite(p.right ?? 0, 'pad.right'),
      bottom: finite(p.bottom ?? 0, 'pad.bottom'),
      left: finite(p.left ?? 0, 'pad.left'),
    };
  }
  throw new TypeError('Viewport: pad must be a number, [x, y] or {top, right, bottom, left}');
}

function radiusOf(r) {
  const min = finite(r?.min ?? 12, 'radius.min');
  const max = r?.max ?? Infinity;
  // Infinity is the documented default for max, so it cannot go through finite().
  if (typeof max !== 'number' || Number.isNaN(max))
    throw new TypeError(`Viewport: radius.max must be a number or Infinity, got ${max}`);
  // clamp() applies the upper bound last, so an inverted range would silently
  // collapse every size to `max` and look like a fit that simply never grows.
  if (min > max) throw new RangeError(`Viewport: radius.min ${min} exceeds radius.max ${max}`);
  return { min, max };
}

function extentOf(e) {
  finite(e, 'extent');
  // r = half-extent / extent, so zero is a division and a negative extent is a
  // mirrored drawing. Both are caller bugs that show up as geometry, not errors.
  if (!(e > 0)) throw new RangeError(`Viewport: extent must be > 0, got ${e}`);
  return e;
}

// --------------------------------------------------------------------- fit --
/**
 * The three viewport-fitting blocks this collapses (ambiguity.md §16.10), with
 * their drifted constants:
 *
 *   homotopy     max(17, min((w−28)/2, (h−44)/2, 86))          cy = h/2 − 5
 *   realization  max(12, min((w−36)/2.4, (h−42)/2.4))          cy = h/2
 *   ambiguity    min((w−85)/span, (h−85)/span), span = 2.2+…   cy = h/2
 *
 * All three are: take the half-box, subtract the reserve, divide by the
 * half-extent that has to fit, clamp. The `/2.4` is `extent = 1.2` written
 * where nothing names it, and the 85 is `pad = 42.5` doubled.
 */
function fitCore(w, h, extent, pad, radius, offset) {
  const cx = w / 2 + offset[0];
  const cy = h / 2 + offset[1];
  // Measured per side rather than as (w/2 − pad): the nudge that spells
  // `cy − 5` moves the centre towards one edge, and checking both sides is what
  // keeps the reserve a reserve instead of quietly spending it on the near one.
  const availX = Math.min(cx - pad.left, w - pad.right - cx);
  const availY = Math.min(cy - pad.top, h - pad.bottom - cy);
  return { r: clamp(Math.min(availX, availY) / extent, radius.min, radius.max), cx, cy };
}

// ------------------------------------------------------------------- frame --
// THE Y-FLIP (P2). Both directions are written once, here, and the Viewport
// methods and every Frame closure call these two functions. A second copy of
// `cy − r*y` somewhere else is exactly how one path ends up with the sign the
// other does not have.
//
// `out` may alias the input: index i is written only after index i is read, the
// same rule the elementwise operations in vec.js follow.

function toScreenInto(p, out, cx, cy, r, center) {
  out[0] = cx + r * (p[0] - center[0]);
  out[1] = cy - r * (p[1] - center[1]);
  return out;
}

function fromScreenInto(px, out, cx, cy, r, center) {
  out[0] = center[0] + (px[0] - cx) / r;
  out[1] = center[1] - (px[1] - cy) / r;
  return out;
}

/**
 * @typedef {Object} Frame an immutable measured coordinate frame
 * @property {number} w @property {number} h
 * @property {number} cx @property {number} cy
 * @property {number} r px per math unit
 */

/**
 * Frozen, and its arithmetic closes over the values it was built with rather
 * than reading the Viewport — a frame handed to a renderable keeps meaning what
 * it meant when it was taken, whatever the next resize does.
 * @returns {Frame}
 */
function frameOf(w, h, cx, cy, r, center) {
  return Object.freeze({
    w, h, cx, cy, r,
    toScreen: (p, out = [0, 0]) => toScreenInto(p, out, cx, cy, r, center),
    fromScreen: (px, out = [0, 0]) => fromScreenInto(px, out, cx, cy, r, center),
    /** The replacement for `g.r *= .81`: a new frame, same centre, cache untouched. */
    scaled(k) { return frameOf(w, h, cx, cy, r * finite(k, 'scaled(k)'), center); },
    translated(dx, dy) {
      return frameOf(w, h, cx + finite(dx, 'translated(dx)'), cy + finite(dy, 'translated(dy)'),
                     r, center);
    },
  });
}

/** A ResizeObserver entry for a box that is not on screen — a hidden tab panel. */
function zeroBox(e) {
  const b = e?.borderBoxSize?.[0];
  if (b) return b.inlineSize === 0 && b.blockSize === 0;
  const r = e?.contentRect;
  return !r || (r.width === 0 && r.height === 0);
}

export class Viewport {
  #el;
  #target;
  #pad;
  #extent;
  #minSize;
  #radius;
  #center;
  #offset;
  #height;
  #onResize;

  // Measured state. Changed only by measure(); #seed() gives it the minSize fit
  // up front so that a frame taken before the first measurement is still well
  // formed — `live` says it is not real, and nothing divides by a zero r.
  #w = 0; #h = 0; #cx = 0; #cy = 0; #r = 0;
  #live = false;
  #frame = null;
  #written = false;
  #changed = false;

  #ro = null;
  #raf = null;
  #disposed = false;

  /**
   * @param {SVGSVGElement} el
   * @param {object} [o]
   * @param {number|[number,number]|{top,right,bottom,left}} [o.pad=24]
   *        px reserved for labels — RESERVE, don't suppress (design-system.md §9.3.4)
   * @param {number} [o.extent=1]            half-width of the math box that must fit
   * @param {[number,number]} [o.minSize=[80,80]]
   * @param {{min:number,max:number}} [o.radius={min:12,max:Infinity}]
   * @param {[number,number]} [o.center=[0,0]]   math point mapped to the box centre
   * @param {[number,number]} [o.offset=[0,0]]   px nudge of that centre (the `cy − 5` idiom)
   * @param {((w:number)=>number)|null} [o.height=null]
   *        derive CSS height from measured width; writes el.style.height
   * @param {boolean} [o.observe=true]
   * @param {Element|null} [o.observeTarget=null]
   *        default el; pass the CONTAINER when `height` is a function
   * @param {(vp:Viewport)=>void} [o.onResize]
   */
  constructor(el, o = {}) {
    if (!el || typeof el.setAttribute !== 'function')
      throw new TypeError('Viewport: first argument must be an element');

    const {
      pad = 24, extent = 1, minSize = [80, 80], radius, center = [0, 0],
      offset = [0, 0], height = null, observe = true, observeTarget = null, onResize,
    } = o;

    if (height !== null && typeof height !== 'function')
      throw new TypeError('Viewport: height must be a function of the measured width, or null');

    this.#el = el;
    this.#target = observeTarget ?? el;
    this.#pad = padOf(pad);
    this.#extent = extentOf(extent);
    this.#minSize = pair(minSize, 'minSize');
    this.#radius = radiusOf(radius);
    // Copied, not held: a caller that reuses its `[0,0]` array for something
    // else would otherwise move every point the engine has ever projected.
    this.#center = pair(center, 'center');
    this.#offset = pair(offset, 'offset');
    this.#height = height;
    this.#onResize = onResize ?? null;

    this.#seed();
    if (observe) this.observe();
  }

  /** The unmeasured frame: minSize, fitted. Not a measurement — `live` is false. */
  #seed() {
    const w = this.#minSize[0];
    const h = this.#height ? Math.round(finite(this.#height(w), 'height(w)')) : this.#minSize[1];
    const { r, cx, cy } = fitCore(w, h, this.#extent, this.#pad, this.#radius, this.#offset);
    this.#w = w; this.#h = h; this.#r = r; this.#cx = cx; this.#cy = cy;
  }

  // ------------------------------------------------- measured state (r/o) --

  get w()  { return this.#w; }
  get h()  { return this.#h; }
  get cx() { return this.#cx; }
  get cy() { return this.#cy; }
  get r()  { return this.#r; }

  /**
   * The reserve that bounds r on each axis. With a per-side pad that is the
   * LARGER side, because the centre stays at w/2 + offset: the wider reserve is
   * the one the radius has to clear.
   */
  get padX() { return Math.max(this.#pad.left, this.#pad.right); }
  get padY() { return Math.max(this.#pad.top, this.#pad.bottom); }

  /** false when the element measured 0 — a hidden panel. The draw must skip. */
  get live() { return this.#live; }

  get el() { return this.#el; }

  /**
   * A frozen snapshot of the current measurement. Identity is stable across a
   * measure() that changed nothing, so a downstream cache can compare frames by
   * reference instead of by five numbers.
   * @returns {Frame}
   */
  get frame() {
    if (!this.#frame)
      this.#frame = frameOf(this.#w, this.#h, this.#cx, this.#cy, this.#r, this.#center);
    return this.#frame;
  }

  // ------------------------------------------------------------- measuring --

  /**
   * Read clientWidth/clientHeight once, clamp to minSize, compute r within
   * radius.min/max, write viewBox="0 0 w h" and (if `height` given) style.height.
   * Skips both DOM writes when the measured box is unchanged — this is what
   * stops the ResizeObserver feedback loop.
   * @returns {this}
   */
  measure() {
    const el = this.#el;
    // THE layout read (P1, I4). Both properties in one statement, so it is one
    // forced layout and it is obvious in a diff when it stops being one.
    const rawW = el.clientWidth, rawH = el.clientHeight;

    const w = Math.max(rawW, this.#minSize[0]);
    // A derived height is computed, never read back: reading clientHeight after
    // writing style.height is the second forced layout, and before the write it
    // is last frame's height, which is how a viewBox ends up one resize stale.
    const h = this.#height
      ? Math.round(finite(this.#height(w), 'height(w)'))
      : Math.max(rawH, this.#minSize[1]);

    // Height is derived, so it cannot report the panel hidden; width can.
    this.#live = rawW > 0 && (this.#height ? h > 0 : rawH > 0);

    const { r, cx, cy } = fitCore(w, h, this.#extent, this.#pad, this.#radius, this.#offset);
    // `!#written` makes the first measurement a change however well the seeded
    // minSize happened to guess it — the first draw must not be skipped.
    this.#changed = !this.#written || w !== this.#w || h !== this.#h || r !== this.#r ||
                    cx !== this.#cx || cy !== this.#cy;

    if (!this.#written || w !== this.#w || h !== this.#h) {
      el.setAttribute('viewBox', `0 0 ${w} ${h}`);
      if (this.#height) el.style.height = `${h}px`;
      this.#written = true;
    }

    this.#w = w; this.#h = h; this.#r = r; this.#cx = cx; this.#cy = cy;
    if (this.#changed) this.#frame = null;
    return this;
  }

  // ---------------------------------------------------------- conversions --

  /** Math space → viewBox space. @returns {[number,number]} */
  toScreen(p, out = [0, 0]) {
    return toScreenInto(p, out, this.#cx, this.#cy, this.#r, this.#center);
  }

  /** viewBox space → math space; the exact inverse. @returns {[number,number]} */
  fromScreen(px, out = [0, 0]) {
    return fromScreenInto(px, out, this.#cx, this.#cy, this.#r, this.#center);
  }

  /**
   * Client (event) coordinates → viewBox space, INCLUDING the client→viewBox
   * scale factor
   *   kx = w / rect.width,  ky = h / rect.height
   * which homotopy.md §14.3 reports the second widget silently dropped. The
   * rect is re-read per call rather than cached, so a pointer event that
   * arrives between a resize and the next measure lands where it was aimed.
   * @returns {[number,number]|null} null when the element is not on screen
   */
  screenFromEvent(ev, out = [0, 0]) {
    const rect = this.#el.getBoundingClientRect();
    if (!(rect.width > 0) || !(rect.height > 0)) return null;   // hidden panel, not NaN
    // A TouchEvent carries no clientX of its own. Resolving it here rather than
    // producing NaN is the same decision as the rect guard above.
    const src = ev?.touches?.[0] ?? ev?.changedTouches?.[0] ?? ev;
    const x = src?.clientX, y = src?.clientY;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    out[0] = (x - rect.left) * (this.#w / rect.width);
    out[1] = (y - rect.top) * (this.#h / rect.height);
    return out;
  }

  /** Client (event) coordinates → math space. @returns {Vec|null} */
  fromEvent(ev, out = [0, 0]) {
    const s = this.screenFromEvent(ev, out);
    return s && fromScreenInto(s, out, this.#cx, this.#cy, this.#r, this.#center);
  }

  // -------------------------------------------------------- derived frames --

  /**
   * A NEW frozen Frame with r*k, same centre. This replaces `g.r *= .81`
   * (realization.md §16.14), which mutated the object stored in the shared
   * geometry cache so that every later reader saw whatever the last draw left
   * behind.
   * @returns {Frame}
   */
  scaled(k) { return this.frame.scaled(k); }

  /** @returns {Frame} a NEW frozen Frame, centre moved by (dx, dy) px. */
  translated(dx, dy) { return this.frame.translated(dx, dy); }

  /**
   * px from the parent box's origin to this element's — the
   * `box.left − bounds.left` idiom that drawConnections and
   * extensionConnections each spell with their own constants
   * (realization.md §16.21).
   *
   * Two rect reads, so hoist it out of a per-point loop instead of calling
   * toStage() per point; that loop is where the forced layouts came from.
   * @returns {[number,number]}
   */
  offsetInto(parentEl) {
    const s = this.#stage(parentEl);
    return [s.dx, s.dy];
  }

  /**
   * A math point in the parent's coordinate space, for an overlay drawn across
   * several widgets.
   * @returns {[number,number]}
   */
  toStage(p, parentEl, out = [0, 0]) {
    const s = this.#stage(parentEl);
    toScreenInto(p, out, this.#cx, this.#cy, this.#r, this.#center);
    out[0] = s.dx + out[0] * s.kx;
    out[1] = s.dy + out[1] * s.ky;
    return out;
  }

  /** Both rects, read once, plus this element's viewBox→px scale. */
  #stage(parentEl) {
    if (!parentEl || typeof parentEl.getBoundingClientRect !== 'function')
      throw new TypeError('Viewport: offsetInto/toStage need the stage element');
    const a = this.#el.getBoundingClientRect();
    const b = parentEl.getBoundingClientRect();
    // 1 viewBox unit = 1 CSS px is engine policy (invariant 2), so an element
    // that is not laid out falls back to it rather than collapsing the whole
    // drawing onto the stage origin.
    const kx = a.width > 0 ? a.width / this.#w : 1;
    const ky = a.height > 0 ? a.height / this.#h : 1;
    return { dx: a.left - b.left, dy: a.top - b.top, kx, ky };
  }

  // ------------------------------------------------------------ observing --

  /** Idempotent; a no-op where there is no ResizeObserver, and after dispose(). */
  observe() {
    if (this.#ro || this.#disposed || typeof ResizeObserver !== 'function') return this;
    this.#ro = new ResizeObserver(entries => this.#observed(entries));
    this.#ro.observe(this.#target);
    return this;
  }

  disconnect() {
    this.#ro?.disconnect();
    this.#ro = null;
    if (this.#raf !== null) { cancelAnimationFrame(this.#raf); this.#raf = null; }
    return this;
  }

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.disconnect();
    this.#onResize = null;
  }

  #observed(entries) {
    // A notification already in flight when dispose() ran must not schedule
    // anything: teardown means nothing is left attached, including a frame.
    if (this.#disposed) return;
    // A hidden tab panel reports 0×0 and there are four of them on the existing
    // pages. Dropping it here costs nothing: no layout read, no measurement, no
    // redraw of a panel nobody is looking at.
    if (entries.length && entries.every(zeroBox)) return;
    // One measurement per frame however many notifications arrive — the RO
    // redrew the whole tab per observation, with no coalescing at all
    // (realization.md §16.30).
    if (this.#raf !== null) return;
    this.#raf = requestAnimationFrame(() => { this.#raf = null; this.#flush(); });
  }

  #flush() {
    if (this.#disposed) return;
    this.measure();
    // Not live: the panel is hidden, and redrawing into it is what cached the
    // bogus 70×90 frame. Unchanged: our own style.height write bounces straight
    // back through the observer, and a redraw for a frame identical to the last
    // one is the feedback loop with extra steps.
    if (!this.#live || !this.#changed) return;
    this.#onResize?.(this);
  }

  /**
   * Pure, DOM-free fit. Collapses the three near-identical viewport-fitting
   * blocks (ambiguity.md §16.10) into one formula.
   * @returns {{r:number, cx:number, cy:number}}
   */
  static fit({ box, extent = 1, pad = 24, radius = { min: 12, max: Infinity }, offset = [0, 0] }) {
    const [w, h] = pair(box, 'box');
    return fitCore(w, h, extentOf(extent), padOf(pad), radiusOf(radius), pair(offset, 'offset'));
  }
}
