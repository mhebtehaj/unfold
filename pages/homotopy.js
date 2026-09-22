// The homotopy explorer, on the engine.
//
// Two explorables on one page: `homotopy` — a source space beside the start,
// current and final maps — and `equivalence` — the five-panel round trip. In
// the shipped file the second is a near-verbatim copy of the first, and eleven
// of its constants had drifted from it. Here both are built from the same
// machinery and every difference that is left is DECLARED, in `variesBy`, with
// its value visible beside the value it differs from. `assertNoDrift()` names
// any that is not.
//
// What stayed here, deliberately, is the mathematics and the words: the
// sixteen scenarios and their closed forms, the seven equivalences, the
// per-example failure predicates, the colour ramps, and every sentence. The
// engine owns none of it — `homotopy.md` §14 is emphatic that an engine which
// generalised `frameLeavesTarget` into generic sampling would replace an exact
// statement with a guess, and that the minimal pairs (segment/circle,
// shrink/blocked — byte-identical formulas distinguished only by their domain
// or their target) are the lesson, not duplication to be factored out.

import {
  explorable, mountAll, panels, control, prose, txt, cite,
} from '../engine/page/index.js';
import { hsl } from '../engine/render/palette.js';
import { createStore } from '../engine/core/state.js';
import { bindControls } from '../engine/core/controls.js';
import {
  polar, TAU, Segment, Circle, Disk, Annulus, PointDomain, Wedge, Interval,
  defineDomain, createPicker,
} from '../engine/geom/index.js';

const INNER = 0.45, DEST = 0.75, N = 144;
const A = [-1, -0.8], B = [1, -0.8], C = [0, 1];
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

// ---------------------------------------------------------------- the cases --

const EXAMPLES = {
  segment_circle: { source: 'segment [0,1]', target: 'circle', kind: 'interval', shape: 'circle',
    note: 'The image opens up, but X does not tear: 0 and 1 were always different inputs.',
    why: '<p>Initially f₀(s) = (cos 2πs, sin 2πs) wraps the segment once around Y. Its two distinct endpoints happen to have the same output.</p><p>H(s,t) = (cos 2π(1−t)s, sin 2π(1−t)s) shortens the arc. Halfway it is a semicircle; at the end all inputs map to (1,0). Every output stays on the circle.</p><p>The endpoints may separate because they are distinct points of X. This is a homotopy of maps from a segment, not a contraction of the circle as a space.</p>' },
  circle_unwrap: { source: 'circle', target: 'circle', kind: 'circle', shape: 'circle', attempt: true,
    note: 'The same “open the loop” attempt fails for X = circle: the two ends now represent one input.',
    why: '<p>Write a circle point as e²πⁱˢ. The parameters s = 0 and s = 1 denote the same point. The proposed formula e²πⁱ⁽¹⁻ᵗ⁾ˢ assigns different outputs to those two representations halfway through.</p><p>Choosing one angle at each point instead creates a discontinuity at the seam: arbitrarily close neighbors there have far-apart outputs. The image staying inside Y is not enough.</p><p>Winding also rules out any other contraction: the identity has winding 1, and a constant map has winding 0.</p>' },
  map_classes: { source: 'circle', target: 'circle', kind: 'circle', shape: 'circle',
    why: '<p>A homotopy class groups continuous maps with the same fixed domain and target that can be joined by a homotopy.</p><p>For circle → circle maps, the class is determined by the integer winding number. Here f₀(e²πⁱˢ) = e²πⁱⁿˢ and f₁(e²πⁱˢ) = e²πⁱ⁽ᵐˢ⁺¼⁾. Equal winding numbers allow the displayed rotation. Different winding numbers cannot be joined.</p><p>For unequal numbers, the displayed attempt interpolates angles but breaks continuity across the seam. Negative numbers wind in the opposite direction; 0 gives a constant map in these examples.</p>' },
  disk_any: { source: 'filled disk', kind: 'disk',
    note: 'Every continuous map f from a disk to Y can shrink to a constant: H(x,t) = f((1−t)x).',
    why: '<p>Move the input x toward the disk’s center, then apply the original map f. At t = 0 this gives f(x); at t = 1 every input gives f(0).</p><p>This works for any target space Y and any continuous starting map f: disk → Y. The outputs stay in Y because they are always outputs of f. You are deforming the map; Y itself stays fixed.</p><p>The selector shows four sample maps. For the circle target, several inputs share each output; circle an input in X to follow its color.</p>' },
  annulus_paths: { source: 'annulus', target: 'same annulus', kind: 'annulus', shape: 'annulus', attempt: true,
    note: 'Every point stays in Y, but the marked neighbors split at a seam. This is not continuous.',
    why: '<p>Each point can travel around the hole to the destination. The problem is choosing all these paths continuously together.</p><p>Look at points of radius ¾ approaching the right-hand seam from above and below. At t = ½, their outputs approach (¾,0) and (−¾,0), even though their inputs approach the same point. The halfway map is discontinuous.</p><p>This rules out this attempt. The general obstruction is winding: a loop going once around the hole cannot become a constant loop while remaining in the annulus.</p>' },
  annulus_straight: { source: 'annulus', target: 'same annulus', kind: 'annulus', shape: 'annulus', attempt: true,
    note: 'The constant map exists. This straight-line attempt to reach it passes through the missing hole.',
    why: '<p>The final point (¾,0) belongs to the annulus, so the constant map is valid. Intermediate outputs of the displayed interpolation can enter the missing hole and therefore leave Y.</p><p>Failure of this particular formula is not the full proof. Any contraction would also contract a loop going once around the hole. Its winding number would have to change from 1 to 0, which a homotopy avoiding the hole cannot do.</p>' },
  annulus_retract: { source: 'annulus', target: 'same annulus', kind: 'annulus', shape: 'annulus',
    note: 'This homotopy works: move each point radially onto the inner circle. The hole remains.',
    why: '<p>For a point of radius r and angle θ, keep θ fixed and change its radius to (1−t)r + t·0.45. This always stays between 0.45 and 1, so every intermediate map stays inside the annulus.</p><p>At the end, points on the same radial segment coincide. The image is still a whole circle, not one point.</p>' },
  winding: { source: 'circle', target: 'annulus', kind: 'circle', shape: 'annulus', attempt: true,
    note: 'No homotopy joins these maps in Y: one winds once around the hole; the other winds twice.',
    why: '<p>Drag an input once around X. Its starting image goes around the hole once, and its final image goes around twice. The two endpoint images are the same circle, but the maps are different.</p><p>A continuous deformation avoiding the hole preserves winding number. Here the endpoint winding numbers are 1 and 2, so no homotopy in this annulus exists. The displayed straight-line attempt crosses the hole.</p>' },
  local_loop: { source: 'circle', target: 'annulus', kind: 'circle', shape: 'annulus',
    note: 'This loop can shrink: it lies beside the hole and does not wind around it.',
    why: '<p>The image is a small circle centered at (¾,0), with radius 0.2(1−t). Every output has distance between 0.55 and 0.95 from the origin, hence lies in the annulus.</p><p>A hole blocks the contraction of loops that wind around it; it does not block every loop.</p>' },
  interval: { source: 'interval [0,1]', target: 'filled disk', kind: 'interval', shape: 'disk' },
  point: { source: 'one point', target: 'circle', kind: 'point', shape: 'circle' },
  rotation: { source: 'circle', target: 'circle', kind: 'circle', shape: 'circle' },
  shrink: { source: 'circle', target: 'filled disk', kind: 'circle', shape: 'disk' },
  blocked: { source: 'circle', target: 'circle', kind: 'circle', shape: 'circle' },
  disk: { source: 'filled disk', target: 'filled disk', kind: 'disk', shape: 'disk' },
  triangle: { source: 'one edge', target: 'filled triangle', kind: 'interval', shape: 'triangle' },
};

const DISK_TARGETS = {
  annulus: { target: 'ring (annulus)', shape: 'annulus' },
  circle: { target: 'circle', shape: 'circle' },
  disk: { target: 'filled disk', shape: 'disk' },
  triangle: { target: 'filled triangle', shape: 'triangle' },
};

/** The case, resolved: the two examples whose description depends on a control. */
function configOf(state) {
  if (state.example === 'disk_any') return { ...EXAMPLES.disk_any, ...DISK_TARGETS[state.diskTarget] };
  if (state.example === 'map_classes') {
    const same = state.startDegree === state.endDegree;
    return { ...EXAMPLES.map_classes, attempt: !same,
      note: `Winding ${state.startDegree} → ${state.endDegree}: ${same
        ? 'same homotopy class. The maps can deform into one another.'
        : 'different homotopy classes. No homotopy connects these maps.'}` };
  }
  return EXAMPLES[state.example];
}

// --------------------------------------------------------- maps and colours --

const DOMAINS = {
  point: PointDomain(), interval: Segment(), circle: Circle(),
  disk: Disk(), annulus: Annulus({ inner: INNER }),
};

const sourcePoint = (input, cfg) => DOMAINS[cfg.kind].embed(input);

function diskStartingMap([x, y], target) {
  switch (target) {
    case 'annulus': return polar(0.45 * x, 0.725 + 0.24 * y);
    case 'circle': return polar(x / 2);
    case 'disk': { const r = Math.hypot(x, y), angle = 0.8 * r, c = Math.cos(angle), s = Math.sin(angle);
      return [0.1 + 0.83 * (c * x - s * y), 0.83 * (s * x + c * y)]; }
    case 'triangle': { const r = Math.hypot(x, y); if (!r) return [0, 0];
      const scale = 0.9 * r / Math.max(-y / 0.8, 1.8 * Math.abs(x) + y); return [scale * x, scale * y]; }
    default: throw new Error(`unknown disk target ${target}`);
  }
}

/** Hₜ(x), per scenario. Closed forms, on purpose: see the header. */
function mapPoint(input, t, state) {
  const { u, r } = input, z = polar(u, r);
  switch (state.example) {
    case 'segment_circle': case 'circle_unwrap': return polar((1 - t) * u);
    case 'map_classes': return polar(((1 - t) * state.startDegree + t * state.endDegree) * u + t / 4);
    case 'disk_any': return diskStartingMap(z.map(v => (1 - t) * v), state.diskTarget);
    case 'annulus_paths': return polar((1 - t) * u, (1 - t) * r + t * DEST);
    case 'annulus_straight': return [(1 - t) * z[0] + t * DEST, (1 - t) * z[1]];
    case 'annulus_retract': return polar(u, (1 - t) * r + t * INNER);
    case 'winding': { const a = polar(u, DEST), b = polar(2 * u, DEST); return a.map((v, i) => (1 - t) * v + t * b[i]); }
    case 'local_loop': { const a = polar(u, 0.2 * (1 - t)); return [DEST + a[0], a[1]]; }
    case 'interval': return [Math.cos(Math.PI * u), (1 - 2 * t) * Math.sin(Math.PI * u)];
    case 'point': return [Math.cos(Math.PI * t), Math.sin(Math.PI * t)];
    case 'rotation': return polar(u + t / 2);
    case 'shrink': case 'blocked': return [(1 - t) * Math.cos(TAU * u) + t, (1 - t) * Math.sin(TAU * u)];
    case 'disk': return [(1 - t) * z[0], (1 - t) * z[1]];
    case 'triangle': return A.map((a, i) => (1 - u) * a + u * ((1 - t) * B[i] + t * C[i]));
    default: throw new Error('Unknown example');
  }
}

const TIME_OF = { source: 0, start: 0, end: 1 };
const timeOf = (view, state) => (view === 'now' ? state.t : TIME_OF[view]);
const place = (input, view, state) =>
  (view === 'source' ? sourcePoint(input, state.cfg) : mapPoint(input, timeOf(view, state), state));

/**
 * A point's colour IS its identity: the same input is the same colour in every
 * panel, which is the whole "matching colours = matching inputs" device. The
 * wheel is theme-invariant on purpose — it is the space, not a decoration.
 */
function colourOf(input, cfg) {
  const { u, r } = input;
  if (cfg.kind === 'point') return hsl(218, 82, 57);
  if (cfg.kind === 'interval') return hsl(245 - 230 * u, 80, 54);
  if (cfg.kind === 'disk' || cfg.kind === 'annulus') return hsl((230 + 360 * u) % 360, 85 * r, 74 - 20 * r);
  return hsl((230 + 360 * u) % 360, 78, 54);
}

const COLLAPSES = ['segment_circle', 'circle_unwrap', 'shrink', 'blocked', 'disk', 'disk_any',
  'annulus_paths', 'annulus_straight', 'local_loop'];

/** Does this frame send every input to one point? Authored, per scenario. */
function collapsed(state, view) {
  if (state.example === 'map_classes' && view !== 'source') {
    const t = timeOf(view, state);
    return Math.abs((1 - t) * state.startDegree + t * state.endDegree) < 1e-10;
  }
  return view !== 'source' && COLLAPSES.includes(state.example) && timeOf(view, state) === 1;
}

/**
 * Does the current frame leave Y? Exact per scenario, and deliberately not
 * sampled: a sampled "no" is not a proof, and this decides a warning a reader
 * is asked to believe.
 */
function leavesTarget(state) {
  const t = state.t;
  if (state.example === 'blocked') return t > 0 && t < 1;
  if (state.example === 'winding') return DEST * Math.abs(1 - 2 * t) < INNER - 1e-8;
  if (state.example === 'annulus_straight') {
    const c = t * DEST, low = (1 - t) * INNER, high = 1 - t;
    const minRadius = c < low ? low - c : c <= high ? 0 : c - high;
    return minRadius < INNER - 1e-8;
  }
  return false;
}

// ------------------------------------------------------------- the drawings --

const INERT = 'uf-inert', EDGE = 'uf-inert-edge', CAPTION = 'uf-caption', MARK = 'uf-mark', QUIET = 'uf-quiet';

/** The fixed target Y: its fill, then (after the image) its boundary. */
function target(d, cfg, boundary) {
  if (cfg.shape === 'annulus') {
    if (boundary) { d.circle([0, 0], 1, { class: EDGE }); d.circle([0, 0], INNER, { class: EDGE }); }
    else d.annulus([0, 0], { inner: INNER, outer: 1 }, { class: INERT });
    return;
  }
  if (cfg.shape === 'triangle') { d.face([A, B, C], { class: boundary ? EDGE : INERT }); return; }
  d.circle([0, 0], 1, { class: boundary ? EDGE : `${INERT}${cfg.shape === 'circle' ? ' uf-inert--hollow' : ''}` });
}

/** The image of X, coloured by input. */
function image(d, s, view) {
  const cfg = s.cfg, kind = cfg.kind, o = d.options;
  const at = input => place(input, view, s);
  const colour = input => colourOf(input, cfg);

  if (collapsed(s, view)) {
    d.dot(at({ u: 0, r: 0 }), { r: 5, fill: '--fg' });
    d.text([0, -1], 'all inputs', { dy: o.captionDy, class: CAPTION });
    return;
  }
  if (kind === 'point') { d.dot(at({ u: 0, r: 1 }), { r: 6, fill: colour({ u: 0, r: 1 }) }); return; }

  if (s.example === 'disk_any' && s.diskTarget === 'circle' && view !== 'source') {
    // f depends only on the horizontal coordinate. Draw representative colours
    // from the diameter, rather than a filled mesh over the circle's interior.
    const inputAt = x => ({ u: x < 0 ? 0.5 : 0, r: Math.abs(x) });
    for (let i = 0; i < N; i++) {
      const x0 = -1 + 2 * i / N, x1 = -1 + 2 * (i + 1) / N;
      d.edge(at(inputAt(x0)), at(inputAt(x1)),
        { fill: 'none', stroke: colour(inputAt((x0 + x1) / 2)), width: o.curve.width, cap: 'round' });
    }
    return;
  }
  if (kind === 'annulus' && s.example === 'annulus_retract' && view !== 'source' && timeOf(view, s) === 1) {
    d.circle([0, 0], INNER, { fill: 'none', stroke: '--fg', width: 3 });
    d.text([0, -1], 'radial points meet', { dy: o.captionDy, class: CAPTION });
    return;
  }
  if (kind === 'disk' || kind === 'annulus') {
    // Each sector keeps its source colour, so the affine map moves the whole
    // sector and the colour says where it came from.
    const radialSteps = kind === 'annulus' ? o.mesh.radialAnnulus : o.mesh.radialDisk;
    const angularSteps = o.mesh.angular;
    const low = kind === 'annulus' ? INNER : 0;
    for (let j = 0; j < radialSteps; j++) for (let k = 0; k < angularSteps; k++) {
      const r0 = low + (1 - low) * j / radialSteps, r1 = low + (1 - low) * (j + 1) / radialSteps;
      const u0 = k / angularSteps, u1 = (k + 1) / angularSteps;
      const c = colour({ u: (u0 + u1) / 2, r: (r0 + r1) / 2 });
      d.face([{ u: u0, r: r0 }, { u: u0, r: r1 }, { u: u1, r: r1 }, { u: u1, r: r0 }].map(at),
        { fill: c, stroke: c, width: o.mesh.width });
    }
    return;
  }
  for (let i = 0; i < N; i++) {
    const u0 = i / N, u1 = (i + 1) / N;
    d.edge(at({ u: u0, r: 1 }), at({ u: u1, r: 1 }),
      { fill: 'none', stroke: colour({ u: (u0 + u1) / 2, r: 1 }), width: o.curve.width, cap: 'round' });
  }
}

/** One panel of the first widget. */
function drawMap(d, s, view) {
  const cfg = s.cfg, o = d.options;
  const isSource = view === 'source';

  if (isSource) { if (cfg.kind === 'annulus') d.annulus([0, 0], { inner: INNER, outer: 1 }, { class: INERT }); }
  else target(d, cfg, false);

  image(d, s, view);

  if (!isSource) target(d, cfg, true);
  else if (cfg.kind === 'annulus') { d.circle([0, 0], 1, { class: EDGE }); d.circle([0, 0], INNER, { class: EDGE }); }

  if (cfg.shape === 'annulus' && !isSource) d.hatchDisk([0, 0], INNER, { class: QUIET });

  // The seam probes: two inputs a hair either side of u = 0 ~ 1, which is where
  // "the same point, two parameters" becomes visible.
  if (s.example === 'annulus_paths' || s.example === 'circle_unwrap' ||
      (s.example === 'map_classes' && s.startDegree !== s.endDegree)) {
    const probeRadius = s.example === 'annulus_paths' ? DEST : 1;
    [{ u: 0.015, r: probeRadius }, { u: 0.985, r: probeRadius }].forEach((input, i) => {
      const q = place(input, view, s);
      d.dot(q, { r: 3.5, class: QUIET, fill: '--halo', stroke: '--bad', width: 1.5 });
      const shift = (isSource || timeOf(view, s) === 0) ? (i ? 17 : -12) : -10;
      if (!collapsed(s, view)) d.text(q, i ? 'b' : 'a', { dx: 9, dy: shift, class: MARK });
    });
  }

  if (s.example === 'segment_circle' && !collapsed(s, view)) {
    const a = place({ u: 0, r: 1 }, view, s), b = place({ u: 1, r: 1 }, view, s);
    const as = d.frame.toScreen(a), bs = d.frame.toScreen(b);
    if (Math.hypot(as[0] - bs[0], as[1] - bs[1]) < 1) {
      d.dot(a, { r: 4, fill: '--fg' });
      d.text(a, '0, 1', { dx: -13, dy: -12, class: MARK });
    } else {
      for (const [u, p] of [[0, a], [1, b]]) {
        d.dot(p, { r: 4, fill: colourOf({ u, r: 1 }, cfg), stroke: '--bg', width: 1.3 });
        if (!isSource) d.text(p, String(u), { dy: -12, class: MARK });
      }
    }
  }

  if (s.example === 'map_classes' && !isSource && !collapsed(s, view)) {
    const label = view === 'start' ? `winding ${s.startDegree}` : view === 'end' ? `winding ${s.endDegree}` : '';
    if (label) d.text([0, -1], label, { dy: o.captionDy, class: CAPTION });
  }
  if (s.example === 'winding' && !isSource) {
    const label = view === 'start' ? '1 turn' : view === 'end' ? '2 turns' : (leavesTarget(s) ? 'enters the hole' : '');
    if (label) d.text([0, -1], label, { dy: o.captionDy, class: CAPTION });
  }
  if (s.example === 'blocked' && view === 'now' && s.t > 0 && s.t < 1)
    d.circle([s.t, 0], { model: 1 - s.t, px: 5 }, { fill: 'none', stroke: '--bad', width: 1.5, dash: '3 4' });

  if (s.selected) d.ring(place(s.selected, view, s), { fill: colourOf(s.selected, cfg) });

  if (isSource && cfg.kind === 'interval') {
    d.text([-1, 0], s.example === 'triangle' ? 'a' : '0', { dy: 26 });
    d.text([1, 0], s.example === 'triangle' ? 'b' : '1', { dy: 26 });
  }

  d.probe({ view, kind: cfg.kind, shape: cfg.shape ?? null, collapsed: collapsed(s, view), t: timeOf(view, s) });
}

// ---------------------------------------------------------------- picking ---

/** The candidates a pick searches, per panel — the shipped grids, exactly. */
function candidatesFor(state, view) {
  const cfg = state.cfg, kind = cfg.kind;
  const out = [];
  if (state.example === 'disk_any' && view !== 'source') {
    for (let a = 0; a < 180; a++) for (let b = 0; b <= 20; b++) out.push({ u: a / 180, r: b / 20 });
    return out;
  }
  if (kind === 'annulus') {
    for (let a = 0; a < 180; a++) for (let b = 0; b <= 16; b++) out.push({ u: a / 180, r: INNER + (1 - INNER) * b / 16 });
    return out;
  }
  const count = kind === 'point' ? 1 : 721;
  for (let i = 0; i < count; i++) out.push({ u: count === 1 ? 0 : i / (count - 1), r: 1 });
  return out;
}

/** Where a pick is refused, and why — a statement about this scenario, not a rule. */
function pickPolicy(state, view) {
  if (collapsed(state, view) ||
      (state.example === 'annulus_retract' && view !== 'source' && timeOf(view, state) === 1))
    return { refuse: true,
      reason: `${collapsed(state, view) ? 'All' : 'Several'} inputs meet here. Choose one in X to follow it.` };
  if (view !== 'source' && (state.example === 'winding' || state.example === 'map_classes' ||
      (state.example === 'disk_any' && state.diskTarget === 'circle')))
    return { refuse: true, reason: 'Choose a point in X: an output can have several preimages.' };
  return 'allow';
}

/** An exact inverse where the scenario has one; otherwise the candidates. */
function analyticFor(state, view) {
  const kind = state.cfg.kind;
  if (kind === 'annulus' && view === 'source')
    return ([x, y]) => ({ u: (Math.atan2(y, x) / TAU + 1) % 1, r: clamp(Math.hypot(x, y), INNER, 1) });
  // The disk's inverse applies to `disk_any` too — but only in X, because in Y
  // that example's several preimages are resolved by the candidate grid below.
  if (kind === 'disk' && !(state.example === 'disk_any' && view !== 'source')) {
    const scale = view === 'source' ? 1 : 1 - timeOf(view, state);
    return ([x0, y0]) => {
      const x = x0 / scale, y = y0 / scale;
      return { u: (Math.atan2(y, x) / TAU + 1) % 1, r: clamp(Math.hypot(x, y)) };
    };
  }
  return undefined;
}

// ------------------------------------------------------------- widget one ---

const DEFAULT_SELECTION = { u: 0.35, r: 0.7 };

const mapPanel = (id, title, sym, at, extra = {}) => ({
  id, title, sym, at,
  needs: ['cfg', 'selected'],
  frame: id === 'now' ? 'current' : (id === 'source' ? 'seamless' : undefined),
  draw: (d, s) => drawMap(d, s, id),
  place: (input, s) => place(input, id, s),
  keyboard: { domain: s => DOMAINS[s.cfg.kind], start: DEFAULT_SELECTION },
  pick: {
    createPicker,
    evaluate: (input, s) => place(input, id, s),
    candidates: s => candidatesFor(s, id),
    // undefined, not null: this scenario has no closed form, so the candidate
    // grid decides. null would mean "the pointer is over nothing".
    analytic: (point, s) => {
      const fn = analyticFor(s, id);
      return fn ? fn(point) : undefined;
    },
    policy: s => pickPolicy(s, id),
  },
  ...extra,
});

const HOMOTOPY_REFERENCE = state => (state.example === 'map_classes'
  ? cite('hatcher', { pdfPage: 143, printed: '§2.2', label: 'Homotopy classes and degree' })
  : cite('hatcher', { pdfPage: 38, printed: '§1.1', label: 'Winding number' }));

function warningFor(s) {
  if (s.example === 'map_classes') {
    const d = (1 - s.t) * s.startDegree + s.t * s.endDegree;
    if (Math.abs(d - Math.round(d)) > 1e-8) return 'This angle interpolation jumps at the seam; it is not a homotopy.';
  }
  if ((s.example === 'annulus_paths' || s.example === 'circle_unwrap') && s.t > 0 && s.t < 1)
    return 'The outputs stay in Y, but the map jumps across the seam between a and b.';
  if (leavesTarget(s))
    return s.cfg.shape === 'annulus' ? 'Some outputs are in the hole, outside Y.' : 'The interior is outside the target circle.';
  return null;
}

function selectionNote(s) {
  if (s.notice) return s.notice;
  if (s.selected) {
    const p = sourcePoint(s.selected, s.cfg), n = v => (Math.abs(v) < 0.005 ? '0.00' : v.toFixed(2));
    const input = s.cfg.kind === 'point' ? 'the single input'
      : s.cfg.kind === 'interval' ? `x = ${s.selected.u.toFixed(2)}`
        : `x = (${p.map(n).join(', ')})`;
    return `Circled in every picture: ${input}.`;
  }
  return s.cfg.shape === 'annulus' ? 'The hatched hole is not part of Y.'
    : s.cfg.shape === 'circle' ? 'Only the gray circumference belongs to Y.'
      : 'Gray shows the fixed target Y.';
}

/**
 * The page's constants, shared by both widgets.
 *
 * The first widget's values ARE these; the second declares in `variesBy`
 * every one it differs in, and assertNoDrift() names any it forgot. In the
 * shipped file the two widgets each spelled all of them, and eleven had
 * drifted apart with nothing to say whether that was meant. `offset` is the
 * proof the check works both ways: both widgets centre five pixels above the
 * middle, so it belongs here and not in either list.
 */
const PAGE = {
  pad: { top: 17, right: 14, bottom: 27, left: 14 },
  offset: [0, -5],
  minSize: [70, 90],
  radius: { min: 17, max: 86 },
  ring: { r: 4, outer: 10, halo: 5, ink: 2 },
  pickThreshold: 24,
  connector: { selected: 0.9, dimmed: 0.12, live: 0.38, quiet: 0.2, width: 1.25, selectedWidth: 2.5,
    horizontal: 0.45, vertical: 0.4, dash: '3 3' },
  mesh: { angular: 96, radialDisk: 12, radialAnnulus: 8, width: 0.45 },
  curve: { segments: 144, width: 6 },
  captionDy: 19,
};

const clearNotice = s => (s.notice ? { notice: null } : null);

const homotopy = explorable({
  id: 'homotopy',
  kind: 'homotopy-widget',
  state: {
    example: 'segment_circle', diskTarget: 'annulus', startDegree: 1, endDegree: 1,
    t: 0.5, selected: null, connections: false, notice: null,
  },
  derive: { cfg: [['example', 'diskTarget', 'startDegree', 'endDegree'], configOf] },
  on: {
    diskTarget: () => ({ t: 0.5, selected: null, notice: null }),
    startDegree: () => ({ t: 0.5, selected: { u: 0.12, r: 1 }, notice: null }),
    endDegree: () => ({ t: 0.5, selected: { u: 0.12, r: 1 }, notice: null }),
    t: clearNotice, selected: clearNotice, example: clearNotice,
  },
  defaults: PAGE,
  visible: {
    classes: s => s.example === 'map_classes',
    target: s => s.example === 'disk_any',
  },
  body: [
    control.group({ class: 'class-controls', part: 'classes' },
      control.select({ key: 'startDegree', label: 'Start winding', wrap: 'label',
        options: [[-2, '−2'], [-1, '−1'], [0, '0'], [1, '1'], [2, '2']], spec: { parse: Number } }),
      control.select({ key: 'endDegree', label: 'End winding', wrap: 'label',
        options: [[-2, '−2'], [-1, '−1'], [0, '0'], [1, '1'], [2, '2']], spec: { parse: Number } })),
    control.select({ key: 'diskTarget', label: 'Target Y', class: 'target-control', part: 'target',
      options: [['annulus', 'Ring (annulus)'], ['circle', 'Circle'], ['disk', 'Filled disk'], ['triangle', 'Filled triangle']] }),
    control.group(
      control.transport({ key: 't', math: 't', ariaLabel: 'Time' }),
      control.toggle({ key: 'connections', label: 'Connect points' })),
    prose.slot({ class: 'uf-note example-note', name: 'note', needs: ['cfg'],
      text: s => s.cfg.note ?? null, classes: s => ({ failure: !!s.cfg.attempt }) }),
    panels.stage({
      overlay: true,
      columns: [
        // `value()` because the shipped widget writes into a <span> here and
        // its neighbour does not, and the difference is visible in the raster.
        { id: 'x', panels: ['source'], needs: ['cfg'], label: s => txt`*X* = ${prose.value(s.cfg.source)}` },
        { id: 'y', panels: ['start', 'now', 'end'], needs: ['cfg'],
          ariaLabel: 'Starting, current, and final maps', label: s => txt`*Y* = ${prose.value(s.cfg.target)}` },
      ],
    }),
    prose.block({ class: 'uf-note hint',
      content: txt`*Same color = same input.* Click or drag on a colored shape to circle corresponding points.` }),
    prose.slot({ class: 'uf-warning', name: 'warning', live: 'polite', needs: ['cfg', 't'], text: warningFor }),
    control.group({ class: 'uf-status-row' },
      control.button({ label: 'Clear circle', action: 'clear' }),
      prose.slot({ tag: 'span', name: 'status', live: 'polite', needs: ['cfg', 'selected', 'notice'],
        text: selectionNote, hide: false })),
    prose.slot({ summary: 'Why?', class: 'uf-why', name: 'why', needs: ['cfg', 'example'],
      closeOn: ['example', 'diskTarget', 'startDegree', 'endDegree'],
      rich: s => (s.cfg.why
        ? prose.html(s.cfg.why + (['disk_any', 'segment_circle'].includes(s.example)
          ? '' : HOMOTOPY_REFERENCE(s).block().html))
        : null) }),
  ],
  panels: [
    mapPanel('source', 'Input', 'x', 0, {
      describe: 'Input space. Click or drag on a colored point to select it. Arrow keys move the selection; Escape clears it.',
    }),
    mapPanel('start', 'Start', 'f₀(x)', 0, {
      describe: 'Starting map, fixed at time zero. Click a colored point to select its input.',
    }),
    mapPanel('now', s => s.t, 'fₜ(x)', 'live', {
      title: s => (s.cfg.attempt ? 'Attempt' : 'Now'), titleNeeds: ['cfg'],
      describe: 'Current map. Click or drag on a colored point to select its input.',
    }),
    mapPanel('end', 'End', 'f₁(x)', 1, {
      describe: 'Final map, fixed at time one. Click a colored point to select its input.',
    }),
  ],
  overlay: panels.linked({
    toggle: 'connections',
    routes: [
      { from: 'source', to: 'start', weight: 'quiet', data: () => ({ correspondence: 'start' }) },
      { from: 'source', to: 'now', weight: 'live', bend: input => (input.u - 0.5) * 60, data: () => ({ correspondence: 'now' }) },
      { from: 'source', to: 'end', weight: 'quiet', data: () => ({ correspondence: 'end' }) },
    ],
    rings: ['source', 'start', 'now', 'end'],
    samples: s => {
      const kind = s.cfg.kind;
      if (kind === 'point') return [{ u: 0, r: 1 }];
      const n = kind === 'circle' ? 10 : 9;
      const step = kind === 'circle' ? 10 : kind === 'interval' ? 8 : 9;
      return Array.from({ length: n }, (_, i) => ({ u: i / step, r: ['disk', 'annulus'].includes(kind) ? 0.8 : 1 }));
    },
    colour: (input, s) => colourOf(input, s.cfg),
    data: (route, input, s) => (route.data ? route.data(input, s) : undefined),
  }),
  onRefuse: (reason, app) => app.set('notice', reason),
});

// ------------------------------------------------------------- widget two ---

const EQ_CASES = {
  eq_annulus: { label: 'Annulus ↔ circle — same type', x: 'annulus', y: 'circle', goodX: true, goodY: true,
    note: 'The round trip forgets radius. It can still deform back to the identity.',
    maps: 'f sends each point radially to the unit circle. g puts that circle at radius 0.7 in the annulus.',
    proof: 'On X, g(f(reⁱθ)) = 0.7eⁱθ. The homotopy [(1−t)·r + t·0.7]eⁱθ moves the original point to its round-trip image and stays in the annulus. On Y, f∘g is already the identity.' },
  eq_disk_segment: { label: 'Disk ↔ segment — same type', x: 'disk', y: 'segment', goodX: true, goodY: true,
    note: 'The round trip flattens the disk to a diameter. The homotopy restores its height.',
    maps: 'f(x,y) = x in the segment [−1,1]. g(s) = (s,0) in the disk.',
    proof: 'On the disk, g∘f(x,y) = (x,0), and H((x,y),t) = (x,(1−t)y) stays in the disk and moves (x,y) to its round-trip image (x,0). On the segment, f∘g(s) = s exactly.' },
  eq_disk_point: { label: 'Disk ↔ point — same type', x: 'disk', y: 'point', goodX: true, goodY: true,
    note: 'Going there and back sends the disk to its center. That map is homotopic to the identity.',
    maps: 'f sends the whole disk to the single point. g sends that point to the disk’s center.',
    proof: 'On X, the composition is the constant map 0. H(x,t) = (1−t)x deforms the identity to this constant map. On the one-point space Y, the other composition is already the identity.' },
  eq_tail: { label: 'Circle with a tail ↔ circle — same type', x: 'tail', y: 'circle', goodX: true, goodY: true,
    note: 'The extra tail can collapse without changing the homotopy type.',
    maps: 'f keeps the loop (rescaled to the unit circle) and collapses the tail to its attachment point. g includes the loop back into the original space.',
    proof: 'The X round trip fixes the loop and collapses the tail. Move each tail point toward its attachment along the tail, keeping the loop fixed, to deform the identity into this composition. The Y round trip is exactly the identity.' },
  eq_circle_point: { label: 'Circle ↔ point — different types', x: 'circle', y: 'point', goodX: false, goodY: true,
    note: 'The point round trip works. The circle round trip cannot deform into the identity.',
    maps: 'f sends the circle to the point. g sends the point to (1,0) on the circle.',
    proof: 'On X, g∘f is constant (winding 0), while the identity winds once. No homotopy within the circle can join them. The displayed straight-line attempt leaves the circle. Every possible pair of maps through a point has the same obstruction.' },
  eq_annulus_disk: { label: 'Annulus ↔ disk — different types', x: 'annulus', y: 'disk', goodX: false, goodY: true,
    note: 'Both maps exist. The disk round trip works, but the annulus round trip is obstructed by its hole.',
    maps: 'f includes the annulus in the filled disk. g sends the disk to p = (0.75,0) in the annulus.',
    proof: 'Both compositions are constant. On the disk, (1−t)x + tp gives a homotopy from the identity to the constant composition. On the annulus this attempt enters the hole, and winding rules out every alternative. More generally, a space homotopy equivalent to a disk would be contractible; the annulus is not.' },
  eq_wrong_maps: { label: 'Circle ↔ circle — wrong maps', x: 'circle', y: 'circle', goodX: false, goodY: false,
    note: 'These spaces have the same type, but this choice of f and g does not witness it.',
    maps: 'f(z) = z² wraps twice around the circle. g(z) = z is the identity.',
    proof: 'Both compositions have winding 2, while the identity has winding 1. These maps fail both checks. The spaces themselves are homotopy equivalent: choosing f = g = identity would work. A failed pair of maps alone does not prove that two spaces have different types.' },
};

const EQ_NAME = { annulus: 'annulus', circle: 'circle', disk: 'filled disk', segment: 'segment', point: 'one point', tail: 'circle + tail' };

/** The circle with a whisker: two pieces, one input space. */
const TAIL_DOMAIN = Wedge({
  loop: { domain: Circle(), embed: ({ u }) => [-0.2 + 0.62 * Math.cos(TAU * u), 0.62 * Math.sin(TAU * u)] },
  tail: { domain: Interval(), embed: ({ u }) => [0.42 + 0.58 * u, 0] },
}, { key: 'branch', id: 'tail' });

const EQ_DOMAINS = {
  point: PointDomain(), segment: Segment(), circle: Circle(),
  disk: Disk(), annulus: Annulus({ inner: INNER }), tail: TAIL_DOMAIN,
};

const eqKind = s => EQ_CASES[s.example][s.side];
const eqSource = (input, s) => EQ_DOMAINS[eqKind(s)].embed(input);

function eqF(p, example) {
  const [x, y] = p;
  switch (example) {
    case 'eq_annulus': { const r = Math.hypot(x, y); return [x / r, y / r]; }
    case 'eq_disk_segment': return [x, 0];
    case 'eq_disk_point': case 'eq_circle_point': return [0, 0];
    case 'eq_tail': { if (x >= 0.42 - 1e-10 && Math.abs(y) < 1e-9) return [1, 0]; return [(x + 0.2) / 0.62, y / 0.62]; }
    case 'eq_annulus_disk': return [x, y];
    case 'eq_wrong_maps': return [x * x - y * y, 2 * x * y];
    default: throw new Error(`unknown case ${example}`);
  }
}

function eqG(p, example) {
  const [x, y] = p;
  switch (example) {
    case 'eq_annulus': return [0.7 * x, 0.7 * y];
    case 'eq_disk_segment': return [x, 0];
    case 'eq_disk_point': return [0, 0];
    case 'eq_circle_point': return [1, 0];
    case 'eq_tail': return [-0.2 + 0.62 * x, 0.62 * y];
    case 'eq_annulus_disk': return [DEST, 0];
    case 'eq_wrong_maps': return [x, y];
    default: throw new Error(`unknown case ${example}`);
  }
}

const eqRoundTrip = (p, s) => (s.side === 'x' ? eqG(eqF(p, s.example), s.example) : eqF(eqG(p, s.example), s.example));

/**
 * The straight line from a point to its round-trip image. For the annulus the
 * two lie on the same radial segment, and for the tail on the same edge; for
 * the convex cases it stays inside. The failing cases deliberately show the
 * attempt leaving the space — that is what they are for.
 */
const eqHomotopy = (p, t, s) => { const q = eqRoundTrip(p, s); return p.map((v, i) => (1 - t) * v + t * q[i]); };

function eqPlace(input, view, s) {
  const p = eqSource(input, s);
  if (view === 'source') return p;
  if (view === 'middle' || view === 'copy') return s.side === 'x' ? eqF(p, s.example) : eqG(p, s.example);
  if (view === 'compose') return eqRoundTrip(p, s);
  return eqHomotopy(p, s.t, s);
}

function eqColour(input, s) {
  const kind = eqKind(s), { u, r = 1, branch = 'loop' } = input;
  if (kind === 'point') return hsl(218, 82, 57);
  if (kind === 'segment') return hsl(245 - 230 * u, 80, 54);
  if (kind === 'tail' && branch === 'tail') return hsl(230, 78, 54 + 25 * u);
  if (kind === 'disk' || kind === 'annulus') return hsl((230 + 360 * u) % 360, 85 * r, 74 - 20 * r);
  return hsl((230 + 360 * u) % 360, 78, 54);
}

function eqSamples(s, dense = false) {
  const kind = eqKind(s);
  if (kind === 'point') return [{ u: 0, r: 1 }];
  if (kind === 'tail') return [
    ...Array.from({ length: dense ? 240 : 9 }, (_, i) => ({ u: i / (dense ? 240 : 9), r: 1, branch: 'loop' })),
    ...Array.from({ length: dense ? 101 : 4 }, (_, i) => ({ u: i / (dense ? 100 : 3), r: 1, branch: 'tail' })),
  ];
  if (dense && (kind === 'disk' || kind === 'annulus'))
    return Array.from({ length: 180 * 21 }, (_, i) => ({
      u: (i % 180) / 180,
      r: (kind === 'annulus' ? INNER : 0) + (1 - (kind === 'annulus' ? INNER : 0)) * Math.floor(i / 180) / 20,
    }));
  const n = dense ? 241 : 9;
  return Array.from({ length: n }, (_, i) => ({
    u: i / (kind === 'segment' ? n - 1 : n), r: kind === 'annulus' ? 0.8 : kind === 'disk' ? 0.8 : 1,
  }));
}

/** Numeric, not authored: every sample lands within a whisker of the first. */
function eqCollapsed(s, view) {
  const points = eqSamples(s).map(input => eqPlace(input, view, s)), a = points[0];
  return points.every(p => Math.hypot(p[0] - a[0], p[1] - a[1]) < 1e-9);
}

const eqShape = (view, s) => ((view === 'middle' || view === 'copy')
  ? EQ_CASES[s.example][s.side === 'x' ? 'y' : 'x'] : eqKind(s));

function eqBoundary(d, kind, outline) {
  const klass = outline ? EDGE : INERT;
  if (kind === 'annulus') {
    if (outline) { d.circle([0, 0], 1, { class: EDGE }); d.circle([0, 0], INNER, { class: EDGE }); }
    else d.annulus([0, 0], { inner: INNER, outer: 1 }, { class: INERT });
    return;
  }
  if (kind === 'point') { d.circle([0, 0], { px: 5 }, { class: klass }); return; }
  if (kind === 'segment') { d.edge([-1, 0], [1, 0], { stroke: '--line-strong', width: 2 }); return; }
  if (kind === 'tail') {
    d.circle([-0.2, 0], 0.62, { fill: 'none', stroke: '--line-strong', width: 2 });
    d.edge([0.42, 0], [1, 0], { stroke: '--line-strong', width: 2 });
    return;
  }
  d.circle([0, 0], 1, { class: `${klass}${kind === 'circle' && !outline ? ' uf-inert--hollow' : ''}` });
}

function eqImage(d, s, view) {
  const o = d.options, kind = eqKind(s);
  const at = input => eqPlace(input, view, s);
  const curve = (inputAt, n = 144) => {
    for (let i = 0; i < n; i++) {
      d.edge(at(inputAt(i / n)), at(inputAt((i + 1) / n)),
        { stroke: eqColour(inputAt((i + 0.5) / n), s), width: o.curve.width, cap: 'round', fill: 'none' });
    }
  };

  if (eqCollapsed(s, view)) {
    const single = kind === 'point', input = eqSamples(s)[0];
    d.dot(at(input), { r: 5, fill: single ? eqColour(input, s) : '--fg' });
    if (!single) d.text([0, -1], 'all inputs', { dy: o.captionDy, class: CAPTION });
    return;
  }
  const settled = view === 'middle' || view === 'copy' || view === 'compose' || (view === 'now' && s.t === 1);
  const radialProjection = s.example === 'eq_annulus' && s.side === 'x' && settled;
  const diameterProjection = s.example === 'eq_disk_segment' && s.side === 'x' && settled;

  if ((kind === 'disk' || kind === 'annulus') && !radialProjection && !diameterProjection) {
    const low = kind === 'annulus' ? INNER : 0;
    const radialSteps = o.mesh.radialDisk, angularSteps = o.mesh.angular;
    for (let j = 0; j < radialSteps; j++) for (let k = 0; k < angularSteps; k++) {
      const r0 = low + (1 - low) * j / radialSteps, r1 = low + (1 - low) * (j + 1) / radialSteps;
      const u0 = k / angularSteps, u1 = (k + 1) / angularSteps;
      const c = eqColour({ u: (u0 + u1) / 2, r: (r0 + r1) / 2 }, s);
      d.face([{ u: u0, r: r0 }, { u: u0, r: r1 }, { u: u1, r: r1 }, { u: u1, r: r0 }].map(at),
        { fill: c, stroke: c, width: o.mesh.width });
    }
    return;
  }
  if (diameterProjection) curve(u => { const x = 2 * u - 1; return { u: x < 0 ? 0.5 : 0, r: Math.abs(x) }; });
  else if (radialProjection) curve(u => ({ u, r: 0.75 }));
  else if (kind === 'tail') {
    curve(u => ({ u, r: 1, branch: 'loop' }));
    if (settled) d.dot(at({ u: 0, r: 1, branch: 'tail' }), { r: 4, fill: '--fg' });
    else curve(u => ({ u, r: 1, branch: 'tail' }), 48);
  } else curve(u => ({ u, r: 1 }));
}

function drawEq(d, s, view) {
  const kind = eqShape(view, s);
  eqBoundary(d, kind, false);
  eqImage(d, s, view);
  eqBoundary(d, kind, true);
  if (kind === 'annulus') d.hatchDisk([0, 0], INNER, {});
  if (s.selected) d.ring(eqPlace(s.selected, view, s), { fill: eqColour(s.selected, s) });
  d.probe({ view, kind, collapsed: eqCollapsed(s, view) });
}

function eqInvalid(s) {
  const good = EQ_CASES[s.example][s.side === 'x' ? 'goodX' : 'goodY'];
  if (good || !(s.t > 0 && s.t < 1)) return false;
  const kind = eqKind(s);
  if (kind === 'circle') return true;
  if (kind === 'annulus') {
    const c = s.t * DEST, low = (1 - s.t) * INNER, high = 1 - s.t;
    const minRadius = c < low ? low - c : c <= high ? 0 : c - high;
    return minRadius < INNER - 1e-8;
  }
  return false;
}

const EQ_PANELS = ['source', 'middle', 'now', 'compose', 'copy'];
/** Paint order for the selection rings — the shipped file's `eqViews`, kept. */
const EQ_RING_ORDER = ['source', 'middle', 'copy', 'compose', 'now'];
const EQ_DEFAULT_SELECTION = { u: 0.16, r: 0.82, branch: 'loop' };
/** Where an arrow key starts when nothing is circled — not the same point the
 *  example chooses, in the shipped file, and the difference is kept. */
const EQ_KEY_START = { u: 0.15, r: 0.8, branch: 'loop' };

const eqPanel = (id, at, describe) => ({
  id, at, describe,
  title: s => EQ_TITLES[id](s),
  titleNeeds: ['cfg', 'side'],
  needs: ['cfg', 'side', 'selected'],
  draw: (d, s) => drawEq(d, s, id),
  place: (input, s) => eqPlace(input, id, s),
  keyboard: { domain: s => EQ_DOMAINS[eqKind(s)], start: EQ_KEY_START },
  pick: {
    createPicker,
    evaluate: (input, s) => eqPlace(input, id, s),
    candidates: s => eqSamples(s, true),
    policy: s => (id !== 'source' && eqCollapsed(s, id) && eqKind(s) !== 'point'
      ? { refuse: true, reason: `Several inputs meet here. Choose one in the top ${s.side.toUpperCase()} picture.` }
      : 'allow'),
  },
});

const eqWord = s => (s.side === 'x' ? { input: 'x', first: 'f', second: 'g' } : { input: 'y', first: 'g', second: 'f' });

const EQ_TITLES = {
  source: s => `${eqWord(s).input} · t = 0`,
  middle: s => `${eqWord(s).first}(${eqWord(s).input})`,
  copy: s => `${eqWord(s).first}(${eqWord(s).input}) · copy`,
  compose: s => `${eqWord(s).second}(${eqWord(s).first}(${eqWord(s).input})) · t = 1`,
  now: s => `${EQ_CASES[s.example][s.side === 'x' ? 'goodX' : 'goodY'] ? 'Homotopy' : 'Attempt'} Hₜ(${eqWord(s).input})`,
};

const equivalence = explorable({
  id: 'equivalence',
  kind: 'homotopy-widget',
  state: { example: 'eq_annulus', side: 'x', t: 0.5, selected: null, connections: true, notice: null },
  derive: { cfg: [['example'], s => EQ_CASES[s.example]] },
  on: {
    side: () => ({ t: 0.5, selected: EQ_DEFAULT_SELECTION, notice: null }),
    t: clearNotice, selected: clearNotice, example: clearNotice,
  },
  // Every value this widget does not share with the first. In the shipped file
  // each of these had drifted silently; here the difference is the declaration.
  variesBy: ['pad', 'minSize', 'radius', 'ring', 'pickThreshold', 'connector', 'mesh', 'curve', 'captionDy'],
  defaults: PAGE,
  options: {
    pad: { top: 12.5, right: 9, bottom: 22.5, left: 9 },
    minSize: [40, 80],
    radius: { min: 10, max: 72 },
    ring: { r: 3.5, outer: 8, halo: 4, ink: 1.7 },
    pickThreshold: 23,
    connector: { selected: 0.9, dimmed: 0.09, live: 0.24, quiet: 0.24, width: 1, selectedWidth: 2.2,
      horizontal: 0.45, vertical: 0.4, dash: '3 3' },
    mesh: { angular: 72, radialDisk: 8, radialAnnulus: 8, width: 0.35 },
    curve: { segments: 144, width: 4.5 },
    captionDy: 16,
  },
  body: [
    prose.block({ class: 'uf-note type-definition',
      content: txt`Same homotopy type: *g∘f ≃ id${prose.sub('X')}* and *f∘g ≃ id${prose.sub('Y')}*.` }),
    control.segmented({ key: 'side', class: 'roundtrip-choices', ariaLabel: 'Choose a round trip',
      options: s => [
        { value: 'x', label: `On X · ${s.cfg.goodX ? '✓' : '✕'} g∘f ≃ id_X` },
        { value: 'y', label: `On Y · ${s.cfg.goodY ? '✓' : '✕'} f∘g ≃ id_Y` },
      ] }),
    control.group(
      control.transport({ key: 't', math: 't', ariaLabel: 'Round-trip homotopy time' }),
      control.toggle({ key: 'connections', label: 'Connect points' })),
    panels.custom('#eq-spaces', {
      labels: {
        x: { needs: ['cfg'], compute: s => txt`*X* · ${EQ_NAME[s.cfg.x]}` },
        y: { needs: ['cfg'], compute: s => txt`*Y* · ${EQ_NAME[s.cfg.y]}` },
      },
    }),
    prose.slot({ class: 'uf-note example-note eq-note', name: 'note', needs: ['cfg'],
      text: s => s.cfg.note, classes: s => ({ failure: !s.cfg.goodX || !s.cfg.goodY }) }),
    prose.block({ class: 'uf-note hint',
      content: txt`*Same color = same original input.* Follow the solid lines around the loop. The dashed lines track the homotopy from the top row to the bottom row.` }),
    prose.slot({ class: 'uf-warning', name: 'warning', live: 'polite', needs: ['cfg', 'side', 't'],
      text: s => (eqInvalid(s) ? `This attempted deformation leaves ${s.side.toUpperCase()}.` : null) }),
    control.group({ class: 'uf-status-row' },
      control.button({ label: 'Clear circle', action: 'clear' }),
      prose.slot({ tag: 'span', name: 'status', live: 'polite', needs: ['cfg', 'side', 'selected', 'notice'],
        hide: false,
        text: s => (s.notice ? s.notice : s.selected
          ? 'The circled point keeps the color of its original input.'
          : `Click or drag in the top ${s.side.toUpperCase()} picture. Both round-trip checks are required.`) })),
    prose.slot({ summary: 'Why? / The two maps', class: 'uf-why', name: 'why', needs: ['cfg', 'side'],
      closeOn: ['example', 'side'],
      rich: s => prose.html(
        `<p>${s.cfg.maps}</p><p>${s.cfg.proof}</p><p>The top and bottom ${s.side === 'x' ? 'Y' : 'X'} pictures show ` +
        `exactly the same intermediate output. The homotopy is in ${s.side.toUpperCase()}: at t = 0 it matches the ` +
        'original input above, and at t = 1 it matches the composition below. The homotopy need not be one-to-one.</p>' +
        cite('hatcher', { pdfPage: 12, label: 'homotopy equivalence' }).block().html) }),
  ],
  bindings: [
    { sel: '#eq-spaces', attr: 'data-side', needs: ['side'], value: s => s.side },
    { sel: '#eq-top-map', needs: ['side'], text: s => eqWord(s).first },
    { sel: '#eq-top-arrow', needs: ['side'], text: s => (s.side === 'x' ? '→' : '←') },
    { sel: '#eq-bottom-map', needs: ['side'], text: s => eqWord(s).second },
    { sel: '#eq-bottom-arrow', needs: ['side'], text: s => (s.side === 'x' ? '←' : '→') },
  ],
  panels: [
    eqPanel('source', 0, 'Original input and identity map, fixed at time zero. Click or drag to follow a point.'),
    eqPanel('middle', 0, 'Output of the first map, in the top row.'),
    eqPanel('now', 'live', 'Current homotopy between the original input above and the round-trip result below.'),
    eqPanel('compose', 1, 'Fixed round-trip composition, at time one.'),
    eqPanel('copy', 0, 'A copy of the same output of the first map, ready to map back.'),
  ],
  overlay: panels.linked({
    toggle: 'connections',
    routes: [
      { from: 'source', to: 'middle', curve: 'horizontal', data: () => ({ 'eq-link': 'source-middle', homotopy: 'false' }) },
      { from: 'middle', to: 'copy', curve: 'vertical', data: () => ({ 'eq-link': 'middle-copy', homotopy: 'false' }) },
      { from: 'copy', to: 'compose', curve: 'horizontal', data: () => ({ 'eq-link': 'copy-compose', homotopy: 'false' }) },
      { from: 'source', to: 'now', curve: 'vertical', dash: true, bend: (input, s) => (s.side === 'x' ? -12 : 12),
        data: () => ({ 'eq-link': 'source-now', homotopy: 'true' }) },
      { from: 'now', to: 'compose', curve: 'vertical', dash: true, bend: (input, s) => (s.side === 'x' ? -12 : 12),
        data: () => ({ 'eq-link': 'now-compose', homotopy: 'true' }) },
    ],
    rings: EQ_RING_ORDER,
    samples: s => eqSamples(s),
    colour: (input, s) => eqColour(input, s),
    data: (route, input, s) => route.data(input, s),
  }),
  onRefuse: (reason, app) => app.set('notice', reason),
});

// ------------------------------------------------------------ the toolbar ---

const CATEGORIES = {
  homotopies: [['segment_circle', 'Segment → circle: open and shrink'], ['disk_any', 'Disk → choose Y — always works'],
    ['interval', 'Interval → disk'], ['point', 'Point → circle'], ['rotation', 'Circle → circle: rotation'],
    ['shrink', 'Circle → disk: shrink'], ['disk', 'Disk → disk: contraction'], ['triangle', 'Edge → filled triangle']],
  obstructions: [['circle_unwrap', 'Circle: open the loop? — fails'], ['annulus_paths', 'Annulus: go around the hole? — fails'],
    ['annulus_straight', 'Annulus: straight to a point — fails'], ['annulus_retract', 'Annulus → its inner circle — works'],
    ['winding', 'Around the hole once → twice — impossible'], ['local_loop', 'A loop beside the hole → a point — works'],
    ['blocked', 'Circle → circle: straight shrink — fails']],
  classes: [['map_classes', 'Circle → circle: choose the winding']],
  types: Object.entries(EQ_CASES).map(([id, c]) => [id, c.label]),
};

/** Which widget a category belongs to, and what choosing an example resets. */
const CHOOSE = {
  types: (app, example) => app.patch({
    example, side: 'x', t: 0.5, selected: EQ_DEFAULT_SELECTION, notice: null,
  }),
  default: (app, example) => app.patch({
    example, t: 0.5, notice: null,
    selected: (example === 'winding' || example === 'map_classes') ? { u: 0.12, r: 1 } : null,
  }),
};

export function start() {
  const apps = mountAll([[homotopy, '#homotopy'], [equivalence, '#equivalence']]);
  const [first, second] = apps;
  const sections = { homotopy: document.querySelector('#homotopy'), equivalence: document.querySelector('#equivalence') };

  const nav = createStore({ category: 'homotopies', example: 'segment_circle' }, { name: 'toolbar' });
  const host = document.querySelector('#choose');
  const ctx = { doc: document, id: name => `choose-${name}`, state: nav.get() };
  host.append(
    control.select({ key: 'category', label: 'Category', class: 'category-control',
      options: [['homotopies', 'Homotopies'], ['obstructions', 'Can / cannot'],
        ['classes', 'Homotopy classes (maps)'], ['types', 'Homotopy types (spaces)']] }).build(ctx),
    control.select({ key: 'example', label: 'Example',
      options: s => CATEGORIES[s.category].map(([value, label]) => ({ value, label })) }).build(ctx));

  // The example is chosen BEFORE the section is revealed, and the write is
  // settled before it. A hidden drawing has no box, so it does not draw; the
  // frame that reveals it is its first. Revealing first means that frame races
  // the patch below — the widget draws its previous example, and the drawing
  // it makes leaves a <defs> entry behind that nothing then uses. Which of the
  // two won varied between runs, which is how the golden capture found it.
  const show = category => {
    const types = category === 'types';
    const app = types ? second : first;
    (types ? CHOOSE.types : CHOOSE.default)(app, nav.get('example'));
    app.flush();
    sections.homotopy.hidden = types;
    sections.equivalence.hidden = !types;
    app.timeline?.pause();
    (types ? first : second).timeline?.pause();
    app.invalidate('*');
  };

  bindControls(host, nav, {
    category: { type: 'select' },
    example: { type: 'select', options: s => CATEGORIES[s.category].map(([value, label]) => ({ value, label })) },
  }, { onChange: key => show(nav.get('category')) });

  show('homotopies');
  return apps;
}
