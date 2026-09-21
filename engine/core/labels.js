// Label placement, as data. No DOM, no strings of markup, no side effects.
//
// The placer it replaces lives in two copies that have drifted: one tries the
// offsets [[0,0],[±17,0],[0,±17]], the inlined copy uses 16 and hands face
// labels only [[0,0]]; both size the box as `text.length * 3.5 + 3` with a
// fixed ±10 height, so nothing measures text and a caption like
// "x₁ = 0 and 1 · overlapping views" is modelled as narrower than it is; both
// take the FIRST candidate that happens to clear, which is a loop order, not a
// choice; and both drop what they cannot place with no leader, no shrink and
// no list, so a viewer who cannot see the scene is told nothing.
//
// Five fixes, in the same order: one calibrated metric (or an injected one),
// SCORED candidates instead of first-fit, priority as a number, a drop policy
// that always REPORTS, and placement data out so the two string-building
// explorers can adopt this without adopting the renderer (I2).
//
// It imports nothing. The geometry it needs is atan2 and two rectangle
// intersections; taking a dependency on vec.js to spell those would buy
// nothing and would couple label layout to a module it does not otherwise use.

export const LAYER = 0;

/** One constant for the default offset ring, instead of the 16/17 drift. */
const DEFAULT_R = 17;

/** Alphabetic baseline: the box sits mostly above the point. */
const ASCENT = 0.8;

/**
 * An overhang this small is float noise from the inset arithmetic, not a label
 * sticking out. Rejecting on it would drop a label that fits, irreproducibly.
 */
const EPS_AREA = 1e-9;

/**
 * Per-class horizontal advance, in em. Exported so it can be recalibrated
 * against a real font without editing the metric.
 *
 * `default` catches Greek, maths operators and anything else unlisted; at .55
 * it is right for the letter-like ones and narrow for a few wide operators.
 */
export const ADVANCE = {
  digit: 0.55,
  lower: 0.50,
  upper: 0.66,
  space: 0.26,
  punct: 0.30,
  script: 0.35,     // sub- and superscripts: x₁, f², ⁿ
  cjk: 1.00,
  default: 0.55,
};

/** Bold is about 3% wider on the system sans stack; lighter faces are not narrower. */
const WEIGHT_GAIN = 0.0001;

const NARROW_MARKS = '·’‘“”′″';

function classOf(ch) {
  const c = ch.codePointAt(0);
  if (ch === ' ' || /\s/.test(ch)) return 'space';
  if (c >= 0x30 && c <= 0x39) return 'digit';
  if (c >= 0x61 && c <= 0x7a) return 'lower';
  if (c >= 0x41 && c <= 0x5a) return 'upper';
  if ((c >= 0x21 && c <= 0x2f) || (c >= 0x3a && c <= 0x40) ||
      (c >= 0x5b && c <= 0x60) || (c >= 0x7b && c <= 0x7e) ||
      NARROW_MARKS.includes(ch)) return 'punct';
  if (c === 0xb2 || c === 0xb3 || c === 0xb9 || (c >= 0x2070 && c <= 0x209f)) return 'script';
  if ((c >= 0x3000 && c <= 0x9fff) || (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xff00 && c <= 0xff60)) return 'cjk';
  return 'default';
}

/**
 * Calibrated DOM-free metric. Replaces `text.length * 3.5 + 3`, which assumes
 * a uniform 7 px advance and is badly wrong for the longer captions
 * ("Resolved: f = 1", "x₁ = 0 and 1 · overlapping views").
 *
 *   w = fontSize * Σ advance(ch)      h = fontSize * 1.32
 *
 * Accuracy: ±8 % on the system sans stack. Pass
 * `measure: createTextMeasurer(svgEl).measure` from core/svg.js when that is
 * not enough — the measuring half lives in the DOM module so this one stays
 * in the pure set.
 *
 * The item's `padding` is added by the placer, not here, so a custom measurer
 * and this one pad identically.
 *
 * @param {string} text
 * @param {{fontSize?:number, weight?:number}} [style]
 * @returns {{w:number, h:number}}
 */
export function metricText(text, { fontSize = 13, weight = 400 } = {}) {
  let em = 0;
  for (const ch of String(text ?? '')) em += ADVANCE[classOf(ch)] ?? ADVANCE.default;
  const gain = 1 + Math.max(0, weight - 400) * WEIGHT_GAIN;
  return { w: fontSize * em * gain, h: fontSize * 1.32 };
}

// ---- candidate generators ------------------------------------------------

/**
 * `radial` takes the outward direction AS AN ARGUMENT, in screen px with y
 * pointing down (the viewport already did the one y-flip, P2). The source
 * computes "outward" three ways with three centres and two radii; the placer
 * must not guess which one this caller means.
 */
export const candidates = {
  /** Face and centroid labels: one candidate, on the point. */
  centered: (cost = 0) => [{ dx: 0, dy: 0, cost }],

  /** Today's set, with one constant instead of two. */
  box: (r = DEFAULT_R) => [
    { dx: 0, dy: 0 }, { dx: r, dy: 0 }, { dx: -r, dy: 0 }, { dx: 0, dy: r }, { dx: 0, dy: -r },
  ],

  /**
   * A fan of `steps` candidates spanning `spread` radians centred on `outward`.
   * Index 0 is exactly outward; the rest alternate +,− by growing deviation, so
   * the order is deterministic and `cost` (default i * 0.15) prefers the
   * straightest one.
   */
  radial: (outward, r = DEFAULT_R, { steps = 8, spread = Math.PI, cost = i => i * 0.15 } = {}) => {
    const [ox = 0, oy = 0] = outward ?? [];
    const base = ox === 0 && oy === 0 ? 0 : Math.atan2(oy, ox);   // no direction → +x
    const half = spread / 2;
    const arms = Math.max(1, Math.ceil((steps - 1) / 2));
    const out = [];
    for (let i = 0; i < steps; i++) {
      const j = Math.ceil(i / 2);
      const sign = i % 2 ? 1 : -1;
      const a = base + sign * half * (j / arms);
      out.push({
        dx: r * Math.cos(a), dy: r * Math.sin(a),
        cost: typeof cost === 'function' ? cost(i) : cost,
      });
    }
    return out;
  },

  /** Evenly around the anchor, starting at +x and increasing in angle. */
  ring: (r = DEFAULT_R, { steps = 8 } = {}) => {
    const out = [];
    for (let i = 0; i < steps; i++) {
      const a = 2 * Math.PI * i / steps;
      out.push({ dx: r * Math.cos(a), dy: r * Math.sin(a) });
    }
    return out;
  },

  below: (gap = 19) => [{ dx: 0, dy: gap, baseline: 'hanging' }],
  above: (gap = 19) => [{ dx: 0, dy: -gap, baseline: 'auto' }],
};

// ---- rectangles ----------------------------------------------------------

/** Accepts {left,right,top,bottom} or {x,y,w,h}; returns the former. */
function asRect(r) {
  if (!r) return null;
  if (r.left !== undefined) return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  return { left: r.x, right: r.x + r.w, top: r.y, bottom: r.y + r.h };
}

function intersect(a, b) {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Box for a candidate. `anchorX` and `baseline` decide where the box hangs off
 * the anchored point, so a 'start'-anchored label does not collide as if it
 * were centred — the old model assumed centred for every offset.
 */
function boxAt(ax, ay, c, w, h) {
  const x = ax + c.dx, y = ay + c.dy;
  const anchorX = c.anchorX ?? 'middle';
  const baseline = c.baseline ?? 'middle';
  const left = anchorX === 'start' ? x : anchorX === 'end' ? x - w : x - w / 2;
  const top = baseline === 'hanging' ? y : baseline === 'auto' ? y - h * ASCENT : y - h / 2;
  return { x, y, anchorX, baseline, left, right: left + w, top, bottom: top + h };
}

const sortKey = (a, b) => (b.item.priority ?? 0) - (a.item.priority ?? 0) || a.i - b.i;

export class LabelPlacer {
  /**
   * @param {object} [o]
   * @param {{x:number,y:number,w:number,h:number}} [o.bounds]   overridable per place()
   * @param {number} [o.inset=3]
   * @param {(text:string, style?:object) => {w:number,h:number}} [o.measure=metricText]
   * @param {'reject'|'penalize'} [o.overlapPolicy='reject']
   * @param {'omit'|'shrink'|'leader'|((item,ctx)=>Placed|null)} [o.onDrop='omit']
   * @param {number} [o.shrink=0.85]
   * @param {number} [o.refRadius=17]
   * @param {{cost:number, offset:number, overlap:number, bounds:number}} [o.weights]
   */
  constructor(o = {}) {
    this.bounds = o.bounds ?? null;
    this.inset = o.inset ?? 3;
    this.measure = o.measure ?? metricText;
    this.overlapPolicy = o.overlapPolicy ?? 'reject';
    this.onDrop = o.onDrop ?? 'omit';
    this.shrink = o.shrink ?? 0.85;
    this.refRadius = o.refRadius ?? DEFAULT_R;
    this.weights = { cost: 1, offset: 0.6, overlap: 8, bounds: 12, ...(o.weights ?? {}) };
    /** @type {{left,right,top,bottom}[]} accumulates across place() until reset(). */
    this.occupied = [];
  }

  /** Clears `occupied` between independent panels sharing one placer. */
  reset() {
    this.occupied = [];
  }

  /**
   * @param {LabelItem[]} items
   * @param {{bounds?, obstacles?: Rect[]}} [o]
   * @returns {{ placed: Placed[], dropped: Dropped[], occupied: Rect[] }}
   */
  place(items, o = {}) {
    const bounds = asRect(o.bounds ?? this.bounds);
    const frame = bounds ? {
      left: bounds.left + this.inset, right: bounds.right - this.inset,
      top: bounds.top + this.inset, bottom: bounds.bottom - this.inset,
    } : null;

    for (const ob of o.obstacles ?? []) this.occupied.push(asRect(ob));

    // Sorted by -priority, then input index. Stable and total: equal priorities
    // keep input order, which is what makes the result reproducible for the probe.
    const queue = (items ?? []).map((item, i) => ({ item, i })).sort(sortKey);

    const placed = [];
    const dropped = [];

    for (const { item } of queue) {
      const style = item.style ?? {};
      const best = this.#best(item, style, frame);

      if (best.chosen) {
        placed.push(this.#emit(item, best, style.fontSize));
        continue;
      }

      const policy = this.onDrop;

      if (policy === 'shrink' && best.list.length) {
        // One step only. A second would be illegible long before it fits.
        const fontSize = (style.fontSize ?? 13) * this.shrink;
        const retry = this.#best(item, { ...style, fontSize }, frame);
        if (retry.chosen) {
          placed.push(this.#emit(item, retry, fontSize));
          continue;
        }
      }

      if (policy === 'leader' && best.list.length) {
        // Take the least-bad candidate and say where it came from.
        const lead = { ...best, chosen: best.softest };
        const p = this.#emit(item, lead, style.fontSize);
        p.leader = [[item.anchor[0], item.anchor[1]], [p.x, p.y]];
        placed.push(p);
        continue;
      }

      if (typeof policy === 'function') {
        const custom = policy(item, {
          reason: best.reason, bestScore: best.bestSoft, bounds: frame,
          occupied: this.occupied.slice(), box: { w: best.w, h: best.h },
          candidates: best.list, measure: this.measure,
        });
        if (custom) {
          if (custom.rect) this.occupied.push(asRect(custom.rect));
          placed.push({ id: item.id, text: item.text, ...custom });
          continue;
        }
      }

      dropped.push({
        id: item.id, text: item.text, reason: best.reason, bestScore: best.bestSoft,
        ...(item.meta !== undefined ? { meta: item.meta } : {}),
      });
    }

    return { placed, dropped, occupied: this.occupied.slice() };
  }

  /**
   * Score every candidate and keep the minimum.
   *
   *   score = w.cost   * candidate.cost
   *         + w.offset * hypot(dx, dy) / refRadius
   *         + w.bounds * outOfBoundsArea / boxArea
   *         + w.overlap * overlapArea   / boxArea     // 'penalize' only
   *
   * Under 'reject' any overlap or any out-of-bounds scores Infinity. `soft` is
   * the same sum always including the overlap term: it is what 'leader',
   * 'required' and the drop report use, because Infinity says nothing about
   * how close a label came to fitting.
   *
   * Ties go to the lower candidate index — first-fit was an accident of loop
   * order, but ordering candidates by preference is deliberate, so the tie rule
   * follows that order.
   */
  #best(item, style, frame) {
    const gen = item.candidates ?? candidates.box(DEFAULT_R);
    const list = typeof gen === 'function' ? gen(item) : gen;
    const pad = item.padding ?? 2;
    const m = this.measure(item.text, style);
    const w = m.w + 2 * pad, h = m.h + 2 * pad;
    const area = Math.max(w * h, 1e-9);

    const out = {
      list, w, h, chosen: null, softest: null, bestSoft: Infinity,
      reason: list.length ? 'collision' : 'no-candidates',
    };
    if (!list.length) return out;

    let bestScore = Infinity;
    let allOut = true;
    const scored = [];

    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const rect = boxAt(item.anchor[0], item.anchor[1], c, w, h);

      let ov = 0;
      for (const r of this.occupied) ov += intersect(rect, r);
      const oob = frame ? area - intersect(rect, frame) : 0;

      if (oob <= EPS_AREA) allOut = false;

      const base = this.weights.cost * (c.cost ?? 0)
        + this.weights.offset * Math.hypot(c.dx, c.dy) / this.refRadius
        + this.weights.bounds * (oob / area);
      const soft = base + this.weights.overlap * (ov / area);
      const score = this.overlapPolicy === 'penalize' ? soft
        : (ov > EPS_AREA || oob > EPS_AREA ? Infinity : base);

      const cand = { rect, index: i, score, soft };
      scored.push(cand);
      if (soft < out.bestSoft) { out.bestSoft = soft; out.softest = cand; }
      if (score < bestScore) { bestScore = score; out.chosen = cand; }
    }

    // `required` takes candidate 0 whatever it collides with; it still reports a
    // finite score, so a probe can see it was forced.
    if (item.required) {
      out.chosen = { ...scored[0], score: scored[0].soft };
      return out;
    }

    // Every candidate left the frame → say so; otherwise something was in the way.
    if (!out.chosen) out.reason = allOut ? 'out-of-bounds' : 'collision';
    return out;
  }

  #emit(item, best, fontSize) {
    const c = best.chosen;
    this.occupied.push({ left: c.rect.left, right: c.rect.right, top: c.rect.top, bottom: c.rect.bottom });
    const p = {
      id: item.id,
      text: item.text,
      x: c.rect.x, y: c.rect.y,
      anchorX: c.rect.anchorX,
      baseline: c.rect.baseline,
      // w/h include the padding, so rect.right - rect.left === w by construction.
      w: best.w, h: best.h,
      rect: { left: c.rect.left, right: c.rect.right, top: c.rect.top, bottom: c.rect.bottom },
      candidateIndex: c.index,
      score: c.score,
    };
    if (item.style !== undefined) p.style = item.style;
    if (item.opacity !== undefined) p.opacity = item.opacity;
    if (item.meta !== undefined) p.meta = item.meta;
    if (fontSize !== undefined && fontSize !== (item.style ?? {}).fontSize) p.fontSize = fontSize;
    return p;
  }
}
