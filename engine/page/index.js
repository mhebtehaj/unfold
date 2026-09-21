// Layer 4 barrel: what a page imports. Nothing inside Layer 4 imports this
// file, which is why it sits last in the layer's order.

export const LAYER = 4;

export { SITE, shell, favicon, escapeHTML, BRAND_MARK } from './shell.js';
