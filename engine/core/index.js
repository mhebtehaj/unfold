// Layer 0 barrel.
//
// Two ways in, deliberately. The namespace exports are the ones to reach for:
// `vec.add`, `svg.el`, `a11y.liveRegion` read as what they are, and they keep
// a kernel that contains `add`, `sub`, `text`, `on`, `el`, `attr`, `group`,
// `round` and `clamp` from colonising a page's identifier space. The flat
// exports are only the principal entry points -- the handful of constructors
// and factories a page actually names -- because `new Viewport(el)` reading as
// `new viewport.Viewport(el)` helps nobody.
//
// Nothing inside Layer 0 imports this file. It is for consumers: Layer 1 and
// above, pages, and tests. That is why it sits last in the intra-layer order.

export const LAYER = 0;

// ---- namespaces --------------------------------------------------------
export * as vec from './vec.js';
export * as svg from './svg.js';
export * as a11y from './a11y.js';
export * as viewport from './viewport.js';
export * as labels from './labels.js';
export * as anim from './anim.js';
export * as state from './state.js';
export * as controls from './controls.js';
export * as probe from './probe.js';

// ---- principal entry points -------------------------------------------
export { Viewport } from './viewport.js';
export { LabelPlacer, metricText, candidates } from './labels.js';
export { Animator, smoothstep, smootherstep, linear, easeOutCubic } from './anim.js';
export { createStore } from './state.js';
export { bindControls } from './controls.js';
export { createProbe, probeEnabled } from './probe.js';
export { liveRegion, makeOperable, describeSvg, prefersReducedMotion } from './a11y.js';
