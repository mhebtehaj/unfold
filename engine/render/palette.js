// Colour, as tokens.
//
// The engine never hardcodes a colour: it names a token from engine/unfold.css
// and lets CSS resolve it, so every colour re-resolves live when the scheme
// flips and dark mode needs no JavaScript. This is the one file allowed to
// hold colour literals (check-layers I3), and it holds them only for places
// CSS cannot reach.
//
// Derived colours are CSS too. mix(), alpha() and the barycentric blend()
// return color-mix() expressions over tokens, never numbers, so a derived
// colour follows the theme exactly as its tokens do. blendNumeric() is the one
// exception, and it says why where it is defined.

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
  // the selection ring, deliberately not a light-dark() pair: a wide light halo
  // under a narrow dark ring reads on either ground and on any data colour
  halo: '--halo', ink: '--ink',
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
  if (/^(var|color-mix)\(/.test(s)) { checkColour(s, 'token'); return s; }
  if (/^--[\w-]+$/.test(s)) return `var(${s})`;
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

// ------------------------------------------------------------ paint values --

/**
 * The colour spaces color-mix() takes. A misspelt one makes the whole value
 * invalid, the browser drops it, and the mark paints black.
 */
const SPACES = new Set(['srgb', 'srgb-linear', 'display-p3', 'a98-rgb', 'prophoto-rgb', 'rec2020',
  'lab', 'oklab', 'xyz', 'xyz-d50', 'xyz-d65', 'hsl', 'hwb', 'lch', 'oklch']);
const POLAR = new Set(['hsl', 'hwb', 'lch', 'oklch']);

function checkSpace(space, where) {
  const [name, ...hue] = String(space).trim().split(/\s+/);
  const ok = SPACES.has(name) && (!hue.length ||
    (POLAR.has(name) && /^(?:shorter|longer|increasing|decreasing) hue$/.test(hue.join(' '))));
  if (!ok) throw new RangeError(`${where}: "${space}" is not a colour space color-mix() accepts`);
  return String(space).trim();
}

/** `s` split at `sep` wherever it is not inside parentheses. */
function splitTop(s, sep) {
  const out = [];
  let depth = 0, start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(') depth++;
    else if (c === ')' && --depth < 0) break;
    else if (c === sep && depth === 0) { out.push(s.slice(start, i).trim()); start = i + 1; }
  }
  if (depth !== 0) throw new SyntaxError(`unbalanced parentheses in "${s}"`);
  out.push(s.slice(start).trim());
  return out;
}

const PERCENT = /^(?:\d+(?:\.\d+)?|\.\d+)%$/;
const NUMBER = '(?:\\d+(?:\\.\\d+)?|\\.\\d+)';
const RGB = new RegExp(`^\\s*${NUMBER}\\s+${NUMBER}\\s+${NUMBER}(?:\\s*/\\s*${NUMBER}%?)?\\s*$`);
/** hsl()'s numeric form, as hsl() above writes it: `hsl(h s% l%)`, any sign or exponent. */
const SIGNED = '(?:[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)(?:e[+-]?\\d+)?)';
const HSL = new RegExp(`^\\s*${SIGNED}\\s+${SIGNED}%\\s+${SIGNED}%(?:\\s*/\\s*${SIGNED}%?)?\\s*$`, 'i');

/**
 * Throw unless `s` is a colour made only of tokens: var(--name) with no
 * fallback, color-mix() and light-dark() over such colours (checked all the
 * way down), the keywords transparent and currentColor, or the numeric rgb()
 * that blendNumeric() writes. A prefix check is not enough — it would pass
 * `color-mix(in srgb, red 50%, blue)` and `var(--x, #f00)`, which are
 * literals wearing a palette function.
 */
function checkColour(s, where) {
  if (s === 'transparent' || s === 'currentColor') return;
  const m = /^([a-z-]+)\(([\s\S]*)\)$/.exec(s);
  if (!m) throw new Error(`${where}: "${s}" is not a token or a palette colour — see TOKENS in render/palette.js`);
  const [, fn, body] = m;
  if (fn === 'var') {
    if (!/^\s*--[\w-]+\s*$/.test(body))
      throw new Error(`${where}: ${s} — a var() fallback is a literal in disguise; name a token instead`);
    return;
  }
  if (fn === 'rgb') {
    if (!RGB.test(body)) throw new Error(`${where}: ${s} — only blendNumeric()'s numeric rgb() is accepted`);
    return;
  }
  if (fn === 'hsl') {
    if (!HSL.test(body)) throw new Error(`${where}: ${s} — only hsl()'s numeric form is accepted`);
    return;
  }
  // A paint server the scene defined: a hatch pattern, a marker. Not a colour
  // at all, which is why it is spelled as a reference and not as a literal.
  if (fn === 'url') {
    if (!/^\s*#[A-Za-z][\w-]*\s*$/.test(body))
      throw new Error(`${where}: ${s} — a url() paint must reference a def in this document by id`);
    return;
  }
  const parts = splitTop(body, ',');
  if (fn === 'light-dark') {
    if (parts.length !== 2) throw new Error(`${where}: ${s} — light-dark() takes two colours`);
    for (const p of parts) checkColour(p, where);
    return;
  }
  if (fn === 'color-mix') {
    if (parts.length !== 3 || !parts[0].startsWith('in '))
      throw new Error(`${where}: ${s} — expected color-mix(in <space>, <colour> [p%], <colour> [p%])`);
    checkSpace(parts[0].slice(3), where);
    for (const p of parts.slice(1)) {
      const words = splitTop(p, ' ').filter(Boolean);
      const colours = words.filter(w => !PERCENT.test(w));
      if (colours.length !== 1 || words.length > 2)
        throw new Error(`${where}: ${s} — "${p}" is not a colour and an optional percentage`);
      checkColour(colours[0], where);
    }
    return;
  }
  throw new Error(`${where}: ${fn}() is not a colour the engine writes; use a token, mix(), alpha() or blend()`);
}

/**
 * A colour value for a paint attribute. Engine names and custom properties go
 * through token(); a colour this module produced (a var(), a color-mix(), a
 * numeric blend) passes through untouched, as do the three keywords that are
 * not colours of their own. Anything else is refused, so a mark can never be
 * handed a literal by accident.
 * @param {string|null|undefined} ref
 * @returns {string|null} null for "leave this paint unset"
 */
export function paint(ref) {
  if (ref == null || ref === false) return null;
  if (typeof ref !== 'string') throw new TypeError(`paint: expected a token or a palette colour, got ${typeof ref}`);
  const s = ref.trim();
  if (s === 'none' || s === 'transparent' || s === 'currentColor') return s;
  if (/^[a-z-]+\(/.test(s)) { checkColour(s, 'paint'); return s; }
  return token(s);
}

/** Six decimals: far below one level of an 8-bit channel, and it keeps 100% out of reach. */
const pct = x => `${+(x * 100).toFixed(6)}%`;

const unit = (v, what) => {
  if (!Number.isFinite(v) || v < 0 || v > 1) throw new RangeError(`${what} must be in [0, 1], got ${v}`);
  return v;
};

/**
 * `amount` of the way from a to b: 0 is a, 1 is b.
 * @param {string} a @param {string} b @param {number} amount
 * @param {'oklab'|'srgb'|'oklch'|'lab'} [space='oklab']
 */
export function mix(a, b, amount, space = 'oklab') {
  unit(amount, 'mix: amount');
  return `color-mix(in ${checkSpace(space, 'mix')}, ${paint(a)} ${pct(1 - amount)}, ${paint(b)})`;
}

/** A token at `a` opacity, composited by the browser rather than by us. */
export function alpha(ref, a) {
  unit(a, 'alpha');
  return `color-mix(in srgb, ${paint(ref)} ${pct(a)}, transparent)`;
}

/**
 * A colour from numbers: the identity ramps.
 *
 * The homotopy explorer encodes which INPUT a mark came from as a hue — a
 * 360° wheel round the source space, saturation and lightness carrying the
 * radius — and the realization explorer sweeps a hue per marker. Those are
 * data, computed per point, so they cannot be tokens; and they are deliberately
 * the same in both schemes, because the wheel IS the space and rotating it in
 * dark mode would say something false.
 *
 * So this is the second numeric escape hatch beside blendNumeric(), and it is
 * why `hsl(` may appear in this file and nowhere else (I3). Arguments are the
 * CSS ones: hue in degrees, saturation and lightness in percent. They are
 * formatted exactly as JavaScript prints them, so a ported drawing can be
 * compared with the string the original wrote.
 *
 * @param {number} h degrees @param {number} s percent @param {number} l percent
 * @returns {string}
 */
export function hsl(h, s, l) {
  for (const [name, v] of [['h', h], ['s', s], ['l', l]])
    if (!Number.isFinite(v)) throw new RangeError(`hsl: ${name} must be a finite number, got ${v}`);
  return `hsl(${h} ${s}% ${l}%)`;
}

// --------------------------------------------------------------- the blend --

/** The blend's default inputs: one data hue per simplex vertex. */
export const DATA = Object.freeze(['data1', 'data2', 'data3', 'data4']);

/** Non-negative finite weights with a positive sum, as [weight, index] pairs above eps. */
function terms(weights, n, eps, what) {
  if (!Array.isArray(weights) && !ArrayBuffer.isView(weights))
    throw new TypeError(`${what}: weights must be an array`);
  let total = 0;
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i];
    if (!Number.isFinite(w) || w < 0) throw new RangeError(`${what}: weight ${i} is ${w}`);
    total += w;
  }
  if (!(total > 0)) throw new RangeError(`${what}: the weights sum to ${total}`);
  const out = [];
  for (let i = 0; i < weights.length; i++) {
    if (weights[i] / total <= eps) continue;
    if (i >= n) throw new RangeError(`${what}: weight ${i} has no colour (only ${n} given)`);
    out.push([weights[i], i]);
  }
  const kept = out.reduce((s, [w]) => s + w, 0);
  return out.map(([w, i]) => [w / kept, i]);
}

/**
 * The barycentric colour: sum of w_i * colour_i, as CSS.
 *
 * The site's central device — a point's colour IS its barycentric coordinate,
 * so the same weight vector drawn in two embeddings gets the same colour, which
 * is all "matching colours = matching inputs" means. Folded from the tail:
 *   c_n = colour_n,   c_k = color-mix(colour_k  p%, c_(k+1)),   p = w_k / (w_k + ... + w_n)
 * which is the convex combination exactly. A pure vertex is exactly its token.
 *
 * `space: 'srgb'` mixes the gamma-encoded channels, which is the arithmetic the
 * shipped explorers do by hand; measured in Chromium against their colours it
 * agrees on 1526 of 1530, and the four others are exact rounding ties where the
 * explorer's own floating-point sum lands a hair under .5 (see blendNumeric).
 * 'oklab', the default, blends perceptually and does not darken midpoints.
 *
 * @param {ArrayLike<number>} weights  non-negative; normalised here
 * @param {string[]} [colours=DATA]    tokens or palette colours, one per vertex
 * @param {object} [o]
 * @param {'oklab'|'srgb'} [o.space='oklab']
 * @param {number} [o.eps=1e-4]        weights at or below this share are dropped
 * @param {number} [o.maxTerms=6]      beyond this, use blendNumeric
 * @returns {string} a colour for a paint attribute
 */
export function blend(weights, colours = DATA, o = {}) {
  const { space = 'oklab', eps = 1e-4, maxTerms = 6 } = o;
  checkSpace(space, 'blend');
  const t = terms(weights, colours.length, eps, 'blend');
  if (t.length > maxTerms)
    throw new RangeError(`blend: ${t.length} colours exceed maxTerms ${maxTerms} — use blendNumeric`);
  let [tail, last] = t[t.length - 1];
  let css = paint(colours[last]);
  for (let k = t.length - 2; k >= 0; k--) {
    const [w, i] = t[k];
    tail += w;
    css = `color-mix(in ${space}, ${paint(colours[i])} ${pct(w / tail)}, ${css})`;
  }
  return css;
}

/**
 * The numeric escape hatch: a blend computed here, not by CSS.
 *
 * For what CSS cannot do: more colours than blend() nests, a raster export,
 * and reproducing a shipped drawing to the bit. The arithmetic is the
 * explorers' own — summed in index order from zero, then Math.round per
 * channel — so the same floating-point sums round the same way, ties
 * included. Weights that already sum to 1 are used untouched for that reason;
 * others are normalised first.
 *
 * The colours are numbers the caller supplies, so a numeric blend does not
 * follow the theme unless it is given both: `{light, dark}` returns a
 * light-dark() pair of the two blends.
 *
 * @param {ArrayLike<number>} weights
 * @param {number[][]|{light:number[][], dark:number[][]}} rgb  [r,g,b] per vertex, 0..255
 * @returns {string} 'rgb(r g b)', or 'light-dark(rgb(...), rgb(...))'
 */
export function blendNumeric(weights, rgb) {
  if (rgb && !Array.isArray(rgb) && rgb.light && rgb.dark)
    return `light-dark(${blendNumeric(weights, rgb.light)}, ${blendNumeric(weights, rgb.dark)})`;
  terms(weights, rgb?.length ?? 0, 0, 'blendNumeric');          // validates
  let total = 0;
  for (let i = 0; i < weights.length; i++) total += weights[i];
  const k = Math.abs(total - 1) <= 1e-12 ? 1 : 1 / total;
  const c = [0, 0, 0];
  for (let i = 0; i < weights.length; i++) {
    const v = k === 1 ? weights[i] : weights[i] * k;
    if (v === 0) continue;                                      // x + 0*c is x, exactly
    const col = rgb[i];
    for (let j = 0; j < 3; j++) c[j] = c[j] + v * col[j];
  }
  return `rgb(${c.map(Math.round).join(' ')})`;
}
