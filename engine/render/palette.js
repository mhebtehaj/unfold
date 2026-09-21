// Colour, as tokens.
//
// The engine never computes a colour and never hardcodes one: it names a token
// from engine/unfold.css and lets CSS resolve it, so every colour re-resolves
// live when the scheme flips and dark mode needs no JavaScript. This is the one
// file allowed to hold colour literals (check-layers I3), and it holds them
// only for places CSS cannot reach.
//
// Phase 2 lands what the page chrome needs: the token names, a resolver for
// token references, and the static hue values a favicon needs, because a
// favicon is rendered in isolation and cannot read the page's CSS. Phase 3 adds
// the derivations (mix, alpha) and the barycentric blend.

export const LAYER = 1;

/** Every colour token in unfold.css, by the name the engine uses for it. */
export const TOKENS = Object.freeze({
  // surfaces
  bg: '--bg', surface: '--surface', surfaceSoft: '--surface-soft', inert: '--inert',
  line: '--line', lineStrong: '--line-strong', gray: '--gray',
  // text
  fg: '--fg', muted: '--muted', onAccent: '--on-accent',
  // interaction
  accent: '--accent', accentSoft: '--accent-soft',
  // semantic
  good: '--good', bad: '--bad',
  // page hues
  violet: '--violet', teal: '--teal', orange: '--orange', pink: '--pink',
  // data encoding
  zone: '--zone',
  data1: '--data-1', data2: '--data-2', data3: '--data-3', data4: '--data-4',
  face1: '--face-1', face2: '--face-2', face3: '--face-3',
});

const NAMES = new Set(Object.values(TOKENS));

/** @param {string} ref @returns {boolean} true for a token the stylesheet defines. */
export function isToken(ref) {
  if (typeof ref !== 'string') return false;
  const s = ref.trim();
  const inner = /^var\(\s*(--[\w-]+)\s*\)$/.exec(s);
  return Object.hasOwn(TOKENS, s) || NAMES.has(s) || (inner !== null && NAMES.has(inner[1]));
}

/**
 * A token reference as a CSS value.
 *
 *   'accent'          -> 'var(--accent)'     an engine name
 *   '--accent'        -> 'var(--accent)'     a custom property, engine or page-local
 *   'var(--accent)'   -> unchanged
 *   'color-mix(...)'  -> unchanged           already a derived colour
 *
 * An unknown bare name throws: it is a typo, and a typo in a colour otherwise
 * surfaces as a silently black mark.
 * @param {string} ref
 */
export function token(ref) {
  if (typeof ref !== 'string') throw new TypeError(`token: expected a string, got ${typeof ref}`);
  const s = ref.trim();
  if (/^(var|color-mix)\(/.test(s)) return s;
  if (s.startsWith('--')) return `var(${s})`;
  if (Object.hasOwn(TOKENS, s)) return `var(${TOKENS[s]})`;
  throw new Error(`token: unknown colour token "${ref}" — see TOKENS in render/palette.js`);
}

/**
 * The page hues as static values, for contexts that cannot resolve a token.
 * Only the hues a page can take through data-hue appear here. They must equal
 * --violet, --teal and --orange in unfold.css; tests/unfold-css.test.mjs
 * resolves both and fails on any difference.
 */
export const HUES = Object.freeze({
  violet: Object.freeze({ light: '#7360b5', dark: '#b6a3ef' }),
  teal: Object.freeze({ light: '#287a76', dark: '#7bc6b9' }),
  orange: Object.freeze({ light: '#a35c37', dark: '#e3a07b' }),
});
