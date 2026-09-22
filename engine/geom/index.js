// Layer 2 barrel.
//
// Namespaces for the modules, and a short flat list of the names a page
// actually reaches for — the same two ways in as core/index.js, for the same
// reason: `map.compose` and `parametric.circle` read as what they are, and a
// flat `circle` beside the domain `Circle` would invite exactly the confusion
// the namespaces prevent. The flat domain constructors are the capitalised
// ones from map.js.
//
// Nothing inside Layer 2 imports this file; it sits last in the layer's order.

export const LAYER = 2;

// ---- namespaces --------------------------------------------------------
export * as tolerance from './tolerance.js';
export * as claim from './claim.js';
export * as parametric from './parametric.js';
export * as map from './map.js';
export * as region from './region.js';

// ---- principal entry points -------------------------------------------
export { TOL } from './tolerance.js';
export { Claim } from './claim.js';
export { polar, defineCurve, TAU } from './parametric.js';
// One statement per line: tools/bundle.mjs reads exports line by line.
export { defineDomain, defineFamily, defineHomotopy, createPicker } from './map.js';
export { Interval, Segment, Circle, Disk, Annulus, PointDomain, Wedge } from './map.js';
export { Region } from './region.js';
