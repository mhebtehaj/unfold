// Regions of the plane, as data.
//
// The carrier explorer's `region()` is a tagged union of seven shapes, and the
// homotopy explorer's whole obstruction story lives on an annulus; both test
// membership with incidental epsilons. The worst of them (realization.md
// §16.8): a `point` region demands near-exact equality and works only because
// the mapped vertex lands on it bit-exactly — in one case by a lucky 4.59e-17
// residual from cos(π/2). This module makes that tolerance AUTHORED: a point
// or a circle carries a `slack` (a radius, a ring half-thickness, in math
// units), defaulting to 0 so nothing changes silently, and every membership
// test is
//
//     contains(r, p)  ⟺  distance(r, p) <= r.slack + tol.geometry
//
// — one definition, not one per type (invariant I1).
//
// Every region is a frozen, tagged record exposing its defining data, so a
// renderer can draw an exact circle or a two-arc annulus rather than a
// polyline. The fields, by type:
//
//   point         { type, center, slack }
//   disk          { type, center, r, slack: 0 }
//   annulus       { type, center, inner, outer, angles?, slack: 0 }
//                 `angles` = [a0, a1] in RADIANS makes it a sector
//   rect          { type, x0, x1, y0, y1, slack: 0 }
//   circle        { type, center, r, slack }            the 1-manifold, not the disk
//   capsule       { type, a, b, r, slack: 0 }
//   polygon       { type, points, convex, slack: 0 }   `convex` resolved to a boolean
//   halfplane     { type, normal, offset, slack: 0 }   { p : ⟨normal, p⟩ <= offset }
//   intersection  { type, regions, slack: 0 }
//   union         { type, regions, slack: 0 }
//   difference    { type, a, b, slack: 0 }
//
// and every one carries `contains(p, opts)`, bound, equal to
// Region.contains(region, p, opts), so anything that takes a duck-typed
// region — map.js's `escapes` — takes these directly.
//
// ANGLES ARE RADIANS. parametric.js's `polar` takes turns; a sector's angles
// do not. Region.sector(c, 0.6, 0.9, [0, Math.PI / 2]) is the first quadrant.
//
// Distance is SIGNED: negative strictly inside, zero on the boundary, positive
// outside, for every type — a point, a circle and a segment have no inside, so
// theirs is never negative (I3). It is exact for every primitive (including
// sectors and non-convex polygons). The combinators see each part thickened by
// its slack, so a union keeps its parts' slack; their distance is exact for
// union from outside and a bound otherwise, but its sign is always exact, and
// the sign is all `contains` reads.
//
// Layer 2 returns numbers and polylines, never markup (spec R2): `outline`
// gives rings of points and the renderer draws them.

import { TOL } from './tolerance.js';

export const LAYER = 2;

const finite = x => typeof x === 'number' && Number.isFinite(x);
const REGIONS = new WeakSet();
const TWO_PI = 2 * Math.PI;

function point2(p, what) {
  if (!Array.isArray(p) || p.length !== 2 || !finite(p[0]) || !finite(p[1]))
    throw new TypeError(`${what} must be a finite point [x, y], got ${JSON.stringify(p) ?? String(p)}`);
  return Object.freeze([p[0], p[1]]);
}

function length(x, what) {
  if (!finite(x) || x < 0) throw new RangeError(`${what} must be a finite number >= 0, got ${String(x)}`);
  return x;
}

function tolOf(opts, where) {
  const tol = opts?.tol ?? TOL;
  const g = tol?.geometry, d = tol?.degenerate;
  if (typeof g !== 'number' || !(g >= 0) || typeof d !== 'number' || !(d >= 0))
    throw new TypeError(`${where}: tol must be TOL or a tolerance() result`);
  return tol;
}

function isRegion(r) { return REGIONS.has(r); }

function checkRegion(r, where) {
  if (!isRegion(r)) throw new TypeError(`${where}: not a Region — build one with Region.disk, Region.rect, …`);
}

function make(fields) {
  const region = { ...fields };
  region.contains = (p, opts) => contains(region, p, opts);
  Object.freeze(region);
  REGIONS.add(region);
  return region;
}

// ---- constructors ----------------------------------------------------------

/** The point p. `slack` is an authored radius: contains accepts anything within it. */
function point(p, { slack = 0 } = {}) {
  return make({ type: 'point', center: point2(p, 'Region.point: p'), slack: length(slack, 'Region.point: slack') });
}

function disk(center, r) {
  return make({ type: 'disk', center: point2(center, 'Region.disk: center'), r: length(r, 'Region.disk: r'), slack: 0 });
}

/**
 * inner <= |p − center| <= outer. With { angles: [a0, a1] } (RADIANS,
 * 0 < a1 − a0 < 2π, measured counter-clockwise from +x) it is the annular
 * sector between those angles. inner = 0 is allowed: a disk, or a pie slice.
 */
function annulus(center, inner, outer, { angles } = {}) {
  const c = point2(center, 'Region.annulus: center');
  length(inner, 'Region.annulus: inner');
  length(outer, 'Region.annulus: outer');
  if (!(inner < outer)) throw new RangeError(`Region.annulus: need inner < outer, got ${inner} and ${outer}`);
  const fields = { type: 'annulus', center: c, inner, outer, slack: 0 };
  if (angles !== undefined) {
    if (!Array.isArray(angles) || angles.length !== 2 || !finite(angles[0]) || !finite(angles[1]))
      throw new TypeError('Region.annulus: angles must be [a0, a1] in radians');
    const span = angles[1] - angles[0];
    if (!(span > 0 && span < TWO_PI))
      throw new RangeError(`Region.annulus: angles must satisfy 0 < a1 − a0 < 2π (radians — not turns); ` +
                           `got [${angles[0]}, ${angles[1]}]. Omit angles for the whole ring.`);
    fields.angles = Object.freeze([angles[0], angles[1]]);
  }
  return make(fields);
}

/** Sugar: annulus(center, inner, outer, { angles: [a0, a1] }). Angles in RADIANS. */
function sector(center, inner, outer, angles) {
  return annulus(center, inner, outer, { angles });
}

function rect({ x0, x1, y0, y1 } = {}) {
  if (![x0, x1, y0, y1].every(finite)) throw new TypeError('Region.rect: pass finite { x0, x1, y0, y1 }');
  if (!(x0 <= x1 && y0 <= y1)) throw new RangeError(`Region.rect: need x0 <= x1 and y0 <= y1`);
  return make({ type: 'rect', x0, x1, y0, y1, slack: 0 });
}

/** The CIRCLE |p − center| = r — a curve, not the disk. `slack` is an authored ring half-thickness. */
function circle(center, r, { slack = 0 } = {}) {
  return make({ type: 'circle', center: point2(center, 'Region.circle: center'), r: length(r, 'Region.circle: r'),
                slack: length(slack, 'Region.circle: slack') });
}

/** Everything within r of the segment ab: a stadium. a = b is a disk. */
function capsule(a, b, r) {
  return make({ type: 'capsule', a: point2(a, 'Region.capsule: a'), b: point2(b, 'Region.capsule: b'),
                r: length(r, 'Region.capsule: r'), slack: 0 });
}

/** Twice the signed area (positive counter-clockwise). */
function shoelace(P) {
  let s = 0;
  for (let i = 0, n = P.length; i < n; i++) {
    const a = P[i], b = P[(i + 1) % n];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s;
}

/**
 * Convex means: every turn has the same sign and the edges turn once in all —
 * the second condition is what rules out a pentagram, whose turns agree.
 * Zero-length edges and straight vertices do not count either way.
 */
function isConvex(P, tol) {
  const n = P.length;
  if (n < 3 || !(Math.abs(shoelace(P)) > tol.degenerate)) return false;
  const edges = [];
  for (let i = 0; i < n; i++) {
    const a = P[i], b = P[(i + 1) % n], e = [b[0] - a[0], b[1] - a[1]];
    if (e[0] * e[0] + e[1] * e[1] > tol.degenerate) edges.push(e);
  }
  let sign = 0, turning = 0;
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i], f = edges[(i + 1) % edges.length];
    const cross = e[0] * f[1] - e[1] * f[0], dot = e[0] * f[0] + e[1] * f[1];
    turning += Math.atan2(cross, dot);
    if (Math.abs(cross) <= tol.degenerate) continue;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return Math.abs(Math.abs(turning) - TWO_PI) <= tol.angle * edges.length + tol.angle;
}

/**
 * The polygon on `points` (1, 2, or 3+ vertices, either orientation). One
 * vertex is a point and two a segment, neither with an inside. `convex: 'auto'`
 * decides once, here; `true` is checked and throws if it is false, because a
 * convexity the geometry does not have would silently corrupt the inside test.
 */
function polygon(points, { convex = 'auto' } = {}) {
  if (!Array.isArray(points) || points.length === 0) throw new TypeError('Region.polygon: points must be a non-empty array of [x, y]');
  const P = Object.freeze(points.map((p, i) => point2(p, `Region.polygon: points[${i}]`)));
  if (convex !== 'auto' && typeof convex !== 'boolean')
    throw new TypeError(`Region.polygon: convex must be 'auto', true or false`);
  const actual = isConvex(P, TOL);
  if (convex === true && !actual)
    throw new RangeError('Region.polygon: convex: true, but these points do not make a convex polygon ' +
                         'with an inside — pass convex: \'auto\'');
  return make({ type: 'polygon', points: P, convex: convex === 'auto' ? actual : convex, slack: 0 });
}

/** { p : ⟨normal, p⟩ <= offset }. The normal need not be unit; distance divides by its length. */
function halfplane(normal, offset) {
  const n = point2(normal, 'Region.halfplane: normal');
  if (!(n[0] * n[0] + n[1] * n[1] > TOL.degenerate)) throw new RangeError('Region.halfplane: the normal is zero');
  if (!finite(offset)) throw new TypeError('Region.halfplane: offset must be a finite number');
  return make({ type: 'halfplane', normal: n, offset, slack: 0 });
}

function parts(regions, where) {
  if (!Array.isArray(regions) || regions.length === 0) throw new TypeError(`${where}: pass a non-empty array of regions`);
  regions.forEach(r => checkRegion(r, where));
  return Object.freeze([...regions]);
}

/** Points in every region. Lazy: nothing is clipped; contains combines exact tests. */
function intersection(regions) {
  return make({ type: 'intersection', regions: parts(regions, 'Region.intersection'), slack: 0 });
}

/** Points in any region. Lazy, like intersection. */
function union(regions) {
  return make({ type: 'union', regions: parts(regions, 'Region.union'), slack: 0 });
}

/** Points in a and not in b (its closure, to tol.geometry — see distance). */
function difference(a, b) {
  checkRegion(a, 'Region.difference');
  checkRegion(b, 'Region.difference');
  return make({ type: 'difference', a, b, slack: 0 });
}

// ---- distance ----------------------------------------------------------------

function nearestOnSegment(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
  if (!(L2 > TOL.degenerate)) return a;          // a zero-length segment is its endpoint
  let s = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2;
  s = s < 0 ? 0 : s > 1 ? 1 : s;
  return [a[0] + s * dx, a[1] + s * dy];
}

const gap = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);

/** Is angle θ (radians) within [a0, a1], counter-clockwise? */
function inSpan(theta, [a0, a1]) {
  const d = (((theta - a0) % TWO_PI) + TWO_PI) % TWO_PI;
  return d <= a1 - a0;
}

/** The two radial edges of a sector, each a segment from the inner to the outer arc. */
function sectorEdges(r) {
  const [c0, c1] = r.center;
  return r.angles.map(a => {
    const x = Math.cos(a), y = Math.sin(a);
    return [[c0 + r.inner * x, c1 + r.inner * y], [c0 + r.outer * x, c1 + r.outer * y]];
  });
}

function sectorDistance(r, p) {
  const dx = p[0] - r.center[0], dy = p[1] - r.center[1], d = Math.hypot(dx, dy);
  const edgeGap = Math.min(...sectorEdges(r).map(([a, b]) => gap(p, nearestOnSegment(p, a, b))));
  if (inSpan(Math.atan2(dy, dx), r.angles)) {
    if (d >= r.inner && d <= r.outer) return -Math.min(d - r.inner, r.outer - d, edgeGap);
    return d < r.inner ? r.inner - d : d - r.outer;   // the radial clamp is the nearest point
  }
  return edgeGap;                                      // outside the span: nearest is on an edge
}

function insidePolygon(P, p) {
  let inside = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [xi, yi] = P[i], [xj, yj] = P[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function polygonDistance(r, p) {
  const P = r.points, n = P.length;
  if (n === 1) return gap(p, P[0]);
  let best = Infinity;
  for (let i = 0, m = n === 2 ? 1 : n; i < m; i++) best = Math.min(best, gap(p, nearestOnSegment(p, P[i], P[(i + 1) % n])));
  if (n < 3 || !(Math.abs(shoelace(P)) > TOL.degenerate)) return best;   // no inside
  let inside;
  if (r.convex) {
    const s = Math.sign(shoelace(P));
    inside = true;
    for (let i = 0; i < n && inside; i++) {
      const a = P[i], b = P[(i + 1) % n];
      if (s * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) < 0) inside = false;
    }
  } else {
    inside = insidePolygon(P, p);                      // even-odd
  }
  return inside ? -best : best;
}

/** Signed distance to a region thickened by its own slack: what the combinators combine. */
const effective = (r, p) => raw(r, p) - r.slack;

function raw(r, p) {
  switch (r.type) {
    case 'point': return gap(p, r.center);
    case 'disk': return gap(p, r.center) - r.r;
    case 'annulus': {
      if (r.angles) return sectorDistance(r, p);
      const d = gap(p, r.center);
      return r.inner === 0 ? d - r.outer : Math.max(r.inner - d, d - r.outer);
    }
    case 'rect': {
      const qx = Math.abs(p[0] - (r.x0 + r.x1) / 2) - (r.x1 - r.x0) / 2;
      const qy = Math.abs(p[1] - (r.y0 + r.y1) / 2) - (r.y1 - r.y0) / 2;
      return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0);
    }
    case 'circle': return Math.abs(gap(p, r.center) - r.r);
    case 'capsule': return gap(p, nearestOnSegment(p, r.a, r.b)) - r.r;
    case 'polygon': return polygonDistance(r, p);
    case 'halfplane': {
      const [n0, n1] = r.normal;
      return (n0 * p[0] + n1 * p[1] - r.offset) / Math.hypot(n0, n1);
    }
    case 'intersection': return Math.max(...r.regions.map(q => effective(q, p)));
    case 'union': return Math.min(...r.regions.map(q => effective(q, p)));
    case 'difference': return Math.max(effective(r.a, p), -effective(r.b, p));
  }
  throw new TypeError(`Region: unknown type "${r.type}"`);
}

/**
 * Signed distance from p to the region: negative strictly inside, zero on the
 * boundary, positive outside (I3). Exact for every primitive. For combinators
 * each part is thickened by its slack: union is exact from outside;
 * intersection and difference give max-combinations, exact in sign and a
 * lower bound in size.
 */
function distance(region, p) {
  checkRegion(region, 'Region.distance');
  return raw(region, point2(p, 'Region.distance: p'));
}

/** distance(region, p) <= region.slack + tol.geometry. THE membership test (I1). */
function contains(region, p, opts) {
  checkRegion(region, 'Region.contains');
  const tol = tolOf(opts, 'Region.contains');
  return raw(region, point2(p, 'Region.contains: p')) <= region.slack + tol.geometry;
}

// ---- nearest -----------------------------------------------------------------

/** c + s·(p − c)/|p − c|, with +x as the direction when p is c itself. */
function towards(c, p, s) {
  const dx = p[0] - c[0], dy = p[1] - c[1], d = Math.hypot(dx, dy);
  return d > 0 ? [c[0] + s * dx / d, c[1] + s * dy / d] : [c[0] + s, c[1]];
}

function project(r, p) {
  switch (r.type) {
    case 'point': return towards(r.center, p, r.slack);
    case 'disk': return towards(r.center, p, r.r);
    case 'annulus': {
      const dx = p[0] - r.center[0], dy = p[1] - r.center[1], d = Math.hypot(dx, dy);
      const rad = Math.min(r.outer, Math.max(r.inner, d));
      if (!r.angles) return towards(r.center, p, rad);
      const theta = Math.atan2(dy, dx);
      if (inSpan(theta, r.angles)) return [r.center[0] + rad * Math.cos(theta), r.center[1] + rad * Math.sin(theta)];
      const [e0, e1] = sectorEdges(r).map(([a, b]) => nearestOnSegment(p, a, b));
      return gap(p, e0) <= gap(p, e1) ? e0 : e1;
    }
    case 'rect': return [Math.min(r.x1, Math.max(r.x0, p[0])), Math.min(r.y1, Math.max(r.y0, p[1]))];
    case 'circle': {
      const d = gap(p, r.center);
      return towards(r.center, p, Math.min(r.r + r.slack, Math.max(Math.max(0, r.r - r.slack), d)));
    }
    case 'capsule': return towards(nearestOnSegment(p, r.a, r.b), p, r.r);
    case 'polygon': {
      const P = r.points, n = P.length;
      if (n === 1) return [P[0][0], P[0][1]];
      let best = null, bestGap = Infinity;
      for (let i = 0, m = n === 2 ? 1 : n; i < m; i++) {
        const q = nearestOnSegment(p, P[i], P[(i + 1) % n]), g = gap(p, q);
        if (g < bestGap) { bestGap = g; best = q; }
      }
      return [best[0], best[1]];
    }
    case 'halfplane': {
      const [n0, n1] = r.normal, k = (n0 * p[0] + n1 * p[1] - r.offset) / (n0 * n0 + n1 * n1);
      return [p[0] - k * n0, p[1] - k * n1];
    }
    case 'union': {
      let best = null, bestGap = Infinity;
      for (const q of r.regions) { const x = project(q, p), g = gap(p, x); if (g < bestGap) { bestGap = g; best = x; } }
      return best;
    }
  }
  throw new RangeError(`Region.nearest: there is no exact projection onto a${r.type === 'intersection' ? 'n' : ''} ` +
                       `${r.type} of arbitrary parts, and an approximate one would be a silent wrong answer — ` +
                       'project onto the parts and choose, if the shapes allow it');
}

/**
 * The nearest point of the region — thickened by its slack — to p. When
 * contains(region, p) it is p itself, the same array (I2). A union projects
 * onto its nearest part, exactly; an intersection or a difference throws for
 * a point outside it, because no exact projection exists for arbitrary parts.
 */
function nearest(region, p, opts) {
  checkRegion(region, 'Region.nearest');
  point2(p, 'Region.nearest: p');
  if (contains(region, p, opts)) return p;
  return Object.freeze(project(region, p));
}

// ---- bounds, outline, sample -----------------------------------------------------

const box = (x0, x1, y0, y1) => Object.freeze({ x0, x1, y0, y1 });

function boxOf(points) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of points) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return box(x0, x1, y0, y1);
}

function boundsOf(r) {
  switch (r.type) {
    case 'point': case 'disk': case 'circle': {
      const e = r.type === 'point' ? r.slack : r.r + r.slack, [c0, c1] = r.center;
      return box(c0 - e, c0 + e, c1 - e, c1 + e);
    }
    case 'annulus': {
      const [c0, c1] = r.center;
      if (!r.angles) return box(c0 - r.outer, c0 + r.outer, c1 - r.outer, c1 + r.outer);
      const pts = sectorEdges(r).flat();
      const [a0, a1] = r.angles;
      for (let k = Math.ceil(a0 / (Math.PI / 2)); k * (Math.PI / 2) <= a1; k++) {
        const a = k * (Math.PI / 2);
        pts.push([c0 + r.outer * Math.cos(a), c1 + r.outer * Math.sin(a)]);
      }
      return boxOf(pts);
    }
    case 'rect': return box(r.x0, r.x1, r.y0, r.y1);
    case 'capsule': {
      const b = boxOf([r.a, r.b]);
      return box(b.x0 - r.r, b.x1 + r.r, b.y0 - r.r, b.y1 + r.r);
    }
    case 'polygon': return boxOf(r.points);
    case 'halfplane': {
      const [n0, n1] = r.normal, t = r.offset;
      if (n0 === 0) return n1 > 0 ? box(-Infinity, Infinity, -Infinity, t / n1) : box(-Infinity, Infinity, t / n1, Infinity);
      if (n1 === 0) return n0 > 0 ? box(-Infinity, t / n0, -Infinity, Infinity) : box(t / n0, Infinity, -Infinity, Infinity);
      return box(-Infinity, Infinity, -Infinity, Infinity);
    }
    case 'intersection': {
      const bs = r.regions.map(boundsOf);
      return box(Math.max(...bs.map(b => b.x0)), Math.min(...bs.map(b => b.x1)),
                 Math.max(...bs.map(b => b.y0)), Math.min(...bs.map(b => b.y1)));
    }
    case 'union': {
      const bs = r.regions.map(boundsOf);
      return box(Math.min(...bs.map(b => b.x0)), Math.max(...bs.map(b => b.x1)),
                 Math.min(...bs.map(b => b.y0)), Math.max(...bs.map(b => b.y1)));
    }
    case 'difference': return boundsOf(r.a);
  }
  throw new TypeError(`Region: unknown type "${r.type}"`);
}

/**
 * The axis-aligned box { x0, x1, y0, y1 } around the region, slack included.
 * Unbounded directions are ±Infinity (a halfplane). An intersection whose
 * parts' boxes do not meet comes back inverted (x0 > x1 or y0 > y1): it is
 * empty, and isEmpty says so.
 */
function bounds(region) {
  checkRegion(region, 'Region.bounds');
  return boundsOf(region);
}

/** `res` points on the arc of radius R about c from angle a to angle b (radians), both ends included. */
function arc(c, R, a, b, res) {
  const out = [];
  for (let i = 0; i < res; i++) {
    const t = a + (b - a) * i / (res - 1);
    out.push(Object.freeze([c[0] + R * Math.cos(t), c[1] + R * Math.sin(t)]));
  }
  return out;
}

/** `res` points evenly around the full circle, starting at +x, counter-clockwise, first point not repeated. */
function ring(c, R, res) {
  const out = [];
  for (let i = 0; i < res; i++) {
    const t = TWO_PI * i / res;
    out.push(Object.freeze([c[0] + R * Math.cos(t), c[1] + R * Math.sin(t)]));
  }
  return out;
}

function outlineOf(r, res) {
  switch (r.type) {
    case 'point': return { rings: [[r.center]], exact: true };
    case 'disk': case 'circle': return { rings: [ring(r.center, r.r, res)], exact: true };
    case 'annulus': {
      if (r.angles) {
        const [a0, a1] = r.angles;
        const outer = arc(r.center, r.outer, a0, a1, res);
        const inner = r.inner > 0 ? arc(r.center, r.inner, a1, a0, res) : [r.center];
        return { rings: [[...outer, ...inner]], exact: true };
      }
      const rings = [ring(r.center, r.outer, res)];
      if (r.inner > 0) rings.push(ring(r.center, r.inner, res).reverse());
      return { rings, exact: true };
    }
    case 'rect': return {
      rings: [[[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]].map(p => Object.freeze(p))], exact: true,
    };
    case 'capsule': {
      const dx = r.b[0] - r.a[0], dy = r.b[1] - r.a[1];
      if (!(dx * dx + dy * dy > TOL.degenerate)) return { rings: [ring(r.a, r.r, res)], exact: true };
      const phi = Math.atan2(dy, dx), h = Math.PI / 2;
      return { rings: [[...arc(r.b, r.r, phi - h, phi + h, res), ...arc(r.a, r.r, phi + h, phi + 3 * h, res)]], exact: true };
    }
    case 'polygon': return { rings: [[...r.points]], exact: true };
    case 'halfplane': return null;
    case 'intersection': case 'union': case 'difference': {
      const kids = r.type === 'difference' ? [r.a, r.b] : r.regions;
      const rings = kids.map(k => outlineOf(k, res)).filter(Boolean).flatMap(o => o.rings);
      return { rings, exact: false };
    }
  }
  throw new TypeError(`Region: unknown type "${r.type}"`);
}

/**
 * The region's boundary as polylines: { rings: Point2[][], exact }. Rings are
 * closed — the first point is NOT repeated at the end — and the renderer
 * closes them. `res` is the number of points on each arc (both ends
 * included) and on each full circle, so a sector at the default 51 is one ring
 * of 102 points: the outer arc a0 → a1, then the inner arc back. An annulus is
 * two rings, the inner one reversed so either fill rule shows the hole.
 *
 * `exact: true` says the rings are this region's boundary, arcs tessellated
 * at `res`. A combinator cannot be outlined without polygon clipping, which a
 * zero-dependency engine does not have: it returns its parts' rings, possibly
 * overlapping, with `exact: false` (gap G6). A halfplane has no finite
 * outline and throws; inside a combinator it is left out.
 */
function outline(region, { res = 51 } = {}) {
  checkRegion(region, 'Region.outline');
  if (!Number.isInteger(res) || res < 3) throw new RangeError('Region.outline: res must be an integer >= 3');
  const o = outlineOf(region, res);
  if (!o) throw new RangeError('Region.outline: a halfplane is unbounded — intersect it with a rect to draw it');
  return Object.freeze({ rings: Object.freeze(o.rings.map(r => Object.freeze(r))), exact: o.exact });
}

/** Regions with no inside: sampling their interior means sampling them. */
function thin(r) {
  return r.type === 'point' || r.type === 'circle' ||
         (r.type === 'polygon' && (r.points.length < 3 || !(Math.abs(shoelace(r.points)) > TOL.degenerate)));
}

/**
 * Points of the region, deterministically.
 *
 *   'interior'  the centres of a res × res grid over bounds(), rows in
 *               increasing y and x increasing within a row, kept when the region
 *               contains them. A region with no inside — a point, a circle, a
 *               polygon of one or two vertices or no area — gives its own points
 *               instead: the point; `res` points around the circle; res + 1 along
 *               the segment; the vertices otherwise.
 *   'boundary'  the outline's rings at `res`, concatenated.
 *
 * Unbounded regions throw.
 */
function sample(region, { res = 24, mode = 'interior' } = {}) {
  checkRegion(region, 'Region.sample');
  if (!Number.isInteger(res) || res < 1) throw new RangeError('Region.sample: res must be a positive integer');
  if (mode === 'boundary') return Object.freeze(outline(region, { res: Math.max(3, res) }).rings.flat());
  if (mode !== 'interior') throw new RangeError(`Region.sample: mode must be 'interior' or 'boundary', got "${mode}"`);
  const r = region;
  if (thin(r)) {
    if (r.type === 'point') return Object.freeze([r.center]);
    if (r.type === 'circle') return Object.freeze(ring(r.center, r.r, Math.max(3, res)));
    if (r.points.length === 2) {
      const [a, b] = r.points;
      return Object.freeze(Array.from({ length: res + 1 }, (_, i) =>
        Object.freeze([(1 - i / res) * a[0] + (i / res) * b[0], (1 - i / res) * a[1] + (i / res) * b[1]])));
    }
    return Object.freeze([...r.points]);
  }
  const b = boundsOf(r);
  if (![b.x0, b.x1, b.y0, b.y1].every(finite)) throw new RangeError('Region.sample: the region is unbounded');
  const out = [];
  for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
    const p = [b.x0 + (i + 0.5) * (b.x1 - b.x0) / res, b.y0 + (j + 0.5) * (b.y1 - b.y0) / res];
    if (raw(r, p) <= r.slack + TOL.geometry) out.push(Object.freeze(p));
  }
  return Object.freeze(out);
}

// ---- area, emptiness -----------------------------------------------------------

function segmentsCross(a, b, c, d) {
  const o = (p, q, s) => Math.sign((q[0] - p[0]) * (s[1] - p[1]) - (q[1] - p[1]) * (s[0] - p[0]));
  const on = (p, q, s) => Math.min(p[0], q[0]) <= s[0] && s[0] <= Math.max(p[0], q[0]) &&
                          Math.min(p[1], q[1]) <= s[1] && s[1] <= Math.max(p[1], q[1]);
  const o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  return (o1 === 0 && on(a, b, c)) || (o2 === 0 && on(a, b, d)) || (o3 === 0 && on(c, d, a)) || (o4 === 0 && on(c, d, b));
}

/** No two non-adjacent edges meet. O(n²); n is small. */
function isSimple(P) {
  const n = P.length;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (j === i + 1 || (i === 0 && j === n - 1)) continue;
    if (segmentsCross(P[i], P[(i + 1) % n], P[j], P[(j + 1) % n])) return false;
  }
  return true;
}

/**
 * The area of the defining set — slack is a membership tolerance, not
 * geometry, so it does not count. null where it cannot be given exactly: an
 * unbounded region, a combinator, a self-intersecting polygon.
 */
function area(region) {
  checkRegion(region, 'Region.area');
  const r = region;
  switch (r.type) {
    case 'point': case 'circle': return 0;
    case 'disk': return Math.PI * r.r * r.r;
    case 'annulus': {
      const ring2 = r.outer * r.outer - r.inner * r.inner;
      return r.angles ? (r.angles[1] - r.angles[0]) / 2 * ring2 : Math.PI * ring2;
    }
    case 'rect': return (r.x1 - r.x0) * (r.y1 - r.y0);
    case 'capsule': return Math.PI * r.r * r.r + 2 * r.r * gap(r.a, r.b);
    case 'polygon':
      if (r.points.length < 3) return 0;
      return r.convex || isSimple(r.points) ? Math.abs(shoelace(r.points)) / 2 : null;
  }
  return null;
}

function emptyOf(r, tol) {
  switch (r.type) {
    case 'union': return r.regions.every(q => emptyOf(q, tol));
    case 'intersection': case 'difference': {
      const b = boundsOf(r);
      if (b.x0 > b.x1 + tol.geometry || b.y0 > b.y1 + tol.geometry) return true;
      if (r.type === 'difference' && emptyOf(r.a, tol)) return true;
      const pool = r.type === 'difference' ? [r.a] : r.regions;
      for (const q of pool) {
        if (!finite(boundsOf(q).x0) && q.type === 'halfplane') continue;
        let candidates;
        try { candidates = [...sample(q, { res: 16 }), ...sample(q, { res: 16, mode: 'boundary' })]; } catch { continue; }
        if (candidates.some(p => raw(r, p) <= tol.geometry)) return false;   // a witness: not empty
      }
      throw new RangeError(`Region.isEmpty: cannot decide whether this ${r.type} is empty — its parts' boxes meet ` +
                           'but no sampled point lies in it, and sampling cannot prove emptiness');
    }
  }
  return false;       // every primitive holds at least its defining point
}

/**
 * Is the region empty? Every primitive is non-empty by construction, and a
 * union is empty exactly when all its parts are. An intersection or a
 * difference is empty when the boxes prove it, non-empty when a sampled point
 * lies in it (a witness), and otherwise THROWS: this is a bare boolean, and a
 * bare boolean is only allowed where the answer is decided (spec §1.2 Q3).
 */
function isEmpty(region, opts) {
  checkRegion(region, 'Region.isEmpty');
  return emptyOf(region, tolOf(opts, 'Region.isEmpty'));
}

/** The 2-D region algebra. Constructors, then the operations; see the header for the record fields. */
export const Region = Object.freeze({
  point, disk, annulus, sector, rect, circle, capsule, polygon, halfplane,
  intersection, union, difference,
  contains, distance, nearest, bounds, sample, outline, area, isEmpty,
});
