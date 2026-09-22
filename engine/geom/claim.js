// Claims: a value together with how much it is worth.
//
// The shipped carrier explorer prints a green ✓ beside "f(⟨σ⟩) ⊆ C(σ)" from a
// hardcoded truth table, and beside it a per-point test that really is
// computed. The two look identical, and they can drift apart silently
// (realization.md §15 item 2, §16.7). A tick from sampling would be worse: a
// sampler can only ever fail to find a counterexample, so a ✓ drawn from it is
// a lie in a teaching tool.
//
// So a verdict never travels as a bare boolean. It travels as a Claim, which
// records who stands behind it — an author, a computation, or nobody — and,
// for a computation, in which direction the result is sound:
//
//   sound: true         exact and complete; the value is proven
//   sound: 'positive'   a `true` is proven; a `false` proves nothing
//   sound: 'negative'   a `false` is proven; a `true` proves nothing (sampling)
//   sound: 'lower'      the value is a proven lower bound
//   sound: 'upper'      the value is a proven upper bound
//   sound: false        a heuristic in both directions
//
// render() turns that record into a glyph, and the one rule that does the work
// is structural: nothing sound only in the negative direction can render ✓.
//
// Claims are frozen and branded: a plain object with `kind: 'computed'` is not
// a Claim, because anything could have written it.

export const LAYER = 2;

const SOUND = [true, 'positive', 'negative', 'lower', 'upper', false];
const BRAND = new WeakSet();

function make(fields) {
  const c = Object.freeze(fields);
  BRAND.add(c);
  return c;
}

function optString(v, name, where) {
  if (v !== undefined && typeof v !== 'string')
    throw new TypeError(`${where}: ${name} must be a string, got ${typeof v}`);
}

/**
 * A human's statement, with its provenance. The engine does not check it; it
 * carries it, cites it, and renders it as a quotation rather than a result.
 *
 * @param {*} value            what is asserted (undefined is stored as null)
 * @param {object} [o]
 * @param {string} [o.note]    the reasoning, in prose
 * @param {{key:string, pdfPage?:number, printed?:number|string, label?:string}} [o.source]
 *                             an opaque citation, passed through by identity
 * @param {string} [o.by]      who asserts it, when not the page's author
 */
function authored(value, { note, source, by } = {}) {
  optString(note, 'note', 'Claim.authored');
  optString(by, 'by', 'Claim.authored');
  if (source !== undefined && (source === null || typeof source !== 'object'))
    throw new TypeError('Claim.authored: source must be a citation object such as { key, printed }');
  const c = { kind: 'authored', value: value === undefined ? null : value };
  if (note !== undefined) c.note = note;
  if (source !== undefined) c.source = source;
  if (by !== undefined) c.by = by;
  return make(c);
}

/**
 * A result the engine computed, with the direction in which it is sound.
 *
 * `method` is required: a computed claim that cannot say how it was computed
 * cannot be checked by a reader either. `sound` is required and must be one
 * of the six values above — anything else throws, including a missing one,
 * because a default soundness is exactly the convention this type exists to
 * replace. 'positive' and 'negative' are directions of a yes/no answer, so
 * they require a boolean value; 'lower' and 'upper' qualify a number.
 *
 * @param {*} value
 * @param {object} o
 * @param {string} o.method
 * @param {true|'positive'|'negative'|'lower'|'upper'|false} o.sound
 * @param {unknown[]} [o.witnesses=[]]   points, pairs, certificates — copied, frozen
 * @param {{samples?:number, ceiling?:number}} [o.budget]   what the computation spent
 * @param {string} [o.note]
 */
function computed(value, { method, sound, witnesses = [], budget, note } = {}) {
  if (typeof method !== 'string' || method === '')
    throw new TypeError('Claim.computed: method must name how the value was computed, e.g. "sampled"');
  if (!SOUND.includes(sound))
    throw new RangeError(`Claim.computed: sound must be one of true, 'positive', 'negative', ` +
                         `'lower', 'upper', false — got ${JSON.stringify(sound) ?? String(sound)}`);
  if ((sound === 'positive' || sound === 'negative') && typeof value !== 'boolean')
    throw new TypeError(`Claim.computed: sound '${sound}' is a direction of a yes/no answer, ` +
                        `so the value must be a boolean — use 'lower'/'upper' for a bound`);
  if ((sound === 'lower' || sound === 'upper') && (typeof value !== 'number' || Number.isNaN(value)))
    throw new TypeError(`Claim.computed: sound '${sound}' qualifies a number, got ${String(value)}`);
  if (!Array.isArray(witnesses)) throw new TypeError('Claim.computed: witnesses must be an array');
  if (budget !== undefined && (budget === null || typeof budget !== 'object'))
    throw new TypeError('Claim.computed: budget must be an object such as { samples: 256 }');
  optString(note, 'note', 'Claim.computed');
  const c = { kind: 'computed', value: value === undefined ? null : value, sound, method,
              witnesses: Object.freeze([...witnesses]) };
  if (budget !== undefined) c.budget = Object.freeze({ ...budget });
  if (note !== undefined) c.note = note;
  return make(c);
}

/** Nothing is claimed, and the reason says why (e.g. 'undersampled'). */
function unknown(reason) {
  if (typeof reason !== 'string' || reason === '')
    throw new TypeError('Claim.unknown: give a reason, e.g. Claim.unknown("undersampled")');
  return make({ kind: 'unknown', value: null, reason });
}

const isAuthored = c => BRAND.has(c) && c.kind === 'authored';
const isComputed = c => BRAND.has(c) && c.kind === 'computed';
const isUnknown = c => BRAND.has(c) && c.kind === 'unknown';

// ---- rendering -----------------------------------------------------------

const MINUS = '−';

/** Two decimals, a real minus sign, and never "-0.00". */
function num(x) {
  if (!Number.isFinite(x)) return String(x);
  const r = Math.round(x * 100) / 100;
  const s = (r === 0 ? 0 : r).toFixed(2);
  return s[0] === '-' ? MINUS + s.slice(1) : s;
}

const isPoint = w => Array.isArray(w) && w.length > 0 && w.every(v => typeof v === 'number');

function formatWitness(w) {
  if (isPoint(w)) return `(${w.map(num).join(', ')})`;
  if (typeof w === 'number') return num(w);
  if (typeof w === 'string') return w;
  if (w && typeof w === 'object') {
    if (isPoint(w.point)) return `(${w.point.map(num).join(', ')})`;
    if (typeof w.distance === 'number') return `a jump of ${num(w.distance)}`;
  }
  try { return String(JSON.stringify(w)).slice(0, 60); } catch { return String(w); }
}

function formatValue(v) {
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return String(v);
  return 'computed';
}

function citation(source) {
  if (!source) return '';
  const name = source.label ?? source.key ?? '';
  const page = source.printed !== undefined ? `p. ${source.printed}`
             : source.pdfPage !== undefined ? `PDF p. ${source.pdfPage}` : '';
  return [name, page].filter(Boolean).join(', ');
}

/**
 * The glyph, text, tone and hover title for a Claim, following the
 * specification's §6.3 table:
 *
 *   computed, sound true,        true     ✓  good     "verified by ⟨method⟩"
 *   computed, sound true,        false    ✗  bad      "disproved by ⟨method⟩"
 *   computed, sound 'negative',  false    ✗  bad      "counterexample found: ⟨witness⟩"
 *   computed, sound 'negative',  true     —  neutral  "no counterexample found in N samples — not a proof"
 *   computed, sound 'positive',  true     ✓  good     "certificate found: ⟨witness⟩"
 *   computed, sound 'positive',  false    —  neutral  "no certificate found — not a proof"
 *   computed, sound 'lower'/'upper'       ≥ / ≤  neutral  "a bound, not the exact value"
 *   authored                              “ ” + "stated:"  authored  "asserted by the author" + citation
 *   unknown                               —  neutral  the reason
 *
 * Two rows the table does not have, because it lists only yes/no values:
 *
 *   computed, sound true, a non-boolean value   =  good     "computed exactly by ⟨method⟩"
 *   computed, sound false (a heuristic)         ≈  neutral  "estimated by ⟨method⟩ — a heuristic, not a proof"
 *
 * `text` is the plain-words verdict shown beside the glyph ("verified",
 * "counterexample found", "stated:" …) or, for the = ≥ ≤ ≈ rows, the value.
 * The page supplies the statement itself; for an authored claim it reads
 * “ stated: <statement> ” with the title citing the source. N in the
 * no-counterexample title is `budget.samples`, and the phrase "in N samples"
 * is left out when the claim does not record it. ⟨witness⟩ is the first
 * witness; a point is written (x, y) to two decimals with a real minus sign.
 *
 * @param {object} c                 a Claim
 * @param {{style?:'inline'}} [o]    'inline' is the only style there is
 * @returns {Readonly<{glyph:string, text:string, tone:'good'|'bad'|'neutral'|'authored', title:string}>}
 */
function render(c, { style = 'inline' } = {}) {
  if (!BRAND.has(c))
    throw new TypeError('Claim.render: not a Claim — build one with Claim.authored, Claim.computed or Claim.unknown');
  if (style !== 'inline') throw new RangeError(`Claim.render: unknown style "${style}" — the one style is 'inline'`);
  const out = (glyph, text, tone, title) => Object.freeze({ glyph, text, tone, title });

  if (c.kind === 'unknown') return out('—', 'unknown', 'neutral', c.reason);
  if (c.kind === 'authored') {
    const cite = citation(c.source);
    const who = c.by ? `asserted by the author (${c.by})` : 'asserted by the author';
    return out('“ ”', 'stated:', 'authored', cite ? `${who} — ${cite}` : who);
  }

  const { sound, value, method, witnesses } = c;
  const w = witnesses.length ? formatWitness(witnesses[0]) : '';
  if (sound === true) {
    if (value === true) return out('✓', 'verified', 'good', `verified by ${method}`);
    if (value === false) return out('✗', 'disproved', 'bad', `disproved by ${method}`);
    return out('=', formatValue(value), 'good', `computed exactly by ${method}`);
  }
  if (sound === 'negative') {
    if (value === false) return out('✗', 'counterexample found', 'bad',
      w ? `counterexample found: ${w}` : 'counterexample found');
    const n = c.budget?.samples;
    return out('—', 'no counterexample found', 'neutral',
      n !== undefined ? `no counterexample found in ${n} samples — not a proof`
                      : 'no counterexample found — not a proof');
  }
  if (sound === 'positive') {
    if (value === true) return out('✓', 'certificate found', 'good', w ? `certificate found: ${w}` : 'certificate found');
    return out('—', 'no certificate found', 'neutral', 'no certificate found — not a proof');
  }
  if (sound === 'lower') return out('≥', formatValue(value), 'neutral', 'a bound, not the exact value');
  if (sound === 'upper') return out('≤', formatValue(value), 'neutral', 'a bound, not the exact value');
  return out('≈', typeof value === 'number' ? String(value) : 'estimated', 'neutral',
    `estimated by ${method} — a heuristic, not a proof`);
}

/** The honesty primitive. See the header for the soundness vocabulary. */
export const Claim = Object.freeze({
  authored, computed, unknown, isAuthored, isComputed, isUnknown, render,
});
