// Layer 1 barrel. Namespaces for the modules, and the handful of names a page
// actually reaches for flat. Nothing inside Layer 1 imports this file.

export const LAYER = 1;

export * as palette from './palette.js';
export * as marks from './marks.js';

export { TOKENS, token, paint, blend, blendNumeric, mix, alpha, DATA, HUES } from './palette.js';
export { SvgScene, KIND_TO_LAYER } from './scene.js';
