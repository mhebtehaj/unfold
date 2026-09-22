// Layer 4 — reactive explanation text, with the equality guard inside.
//
// The guard is the whole module. `if (el.textContent !== msg) el.textContent = msg`
// is what lets a `role="status"` line survive a 60 fps playback: a redundant
// identical write to a live region is announced again, so the shipped homotopy
// page's status would otherwise read the same sentence sixty times a second.
// The shipped pages know this — and apply it in two places out of eleven.
// Here there is no way to write to a bound element without going through it.
//
// The second job is the two typographic conventions the site already has, and
// no others: *emphasis* inside a sentence, and $symbols$ set in the serif
// maths face. `txt` is a tagged template, so the conventions are greppable and
// its interpolations are escaped — `elem.text` in the shipped file does not
// escape, and `#example`'s option list is rebuilt from label strings with
// innerHTML, which is harmless today and stops being harmless the moment a
// label comes from data.
//
// What this module does NOT do: decide when to run. A binding declares the
// state keys it reads and the scheduler in explorable.js runs the ones whose
// keys moved. That is what makes "redraw only what changed" derived rather
// than hand-maintained.

export const LAYER = 4;

const ENTITY = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Text or attribute value, escaped for HTML. */
/**
 * Every string that reaches innerHTML passes through here. null and undefined
 * become nothing rather than the words "null" and "undefined": a value a page
 * has not got yet is an empty phrase, not a bug report in the middle of a
 * sentence.
 */
export const escapeHTML = s => (s === null || s === undefined ? '' : String(s).replace(/[&<>"']/g, c => ENTITY[c]));

/** The brand: a string a page built through txt() or html(), so rich() can tell. */
const RICH = Symbol('uf.rich');

class Rich {
  constructor(html) { this.html = html; this[RICH] = true; Object.freeze(this); }
  toString() { return this.html; }
}

/** @returns {boolean} true for a value txt() or html() produced. */
export const isRich = v => v instanceof Rich;

/**
 * Markup the page wrote itself, taken as trusted. The escape hatch for authored
 * HTML that predates `txt` — the shipped "Why?" paragraphs are a few hundred
 * words of `<p>` with typeset symbols in them, and re-tagging them would be a
 * rewrite of content, not a port.
 * @param {string} markup
 */
export const html = markup => {
  if (typeof markup !== 'string') throw new TypeError(`prose.html: expected a string, got ${typeof markup}`);
  return new Rich(markup);
};

/** Inline markup for the two conventions; interpolations are escaped or spliced. */
/**
 * Interpolations become placeholders, the markers run over the whole
 * sentence, and then the values go in. So `*g∘f ≃ id${sub('X')}*` is one bold
 * phrase rather than two halves with a literal asterisk between them — and a
 * value that itself contains `*` is still text, because the markers ran before
 * it was there. U+0000 cannot survive escapeHTML on a literal chunk, so the
 * placeholder cannot be forged by the template.
 */
const SLOT = '\u0000';
const SLOTS = /\u0000(\d+)\u0000/g;

function format(strings, values) {
  let joined = '';
  for (let i = 0; i < strings.length; i++) {
    joined += escapeHTML(strings[i]).split(SLOT).join('');
    if (i < values.length) joined += `${SLOT}${i}${SLOT}`;
  }
  return markers(joined).replace(SLOTS, (_, i) => {
    const v = values[Number(i)];
    return isRich(v) ? v.html : escapeHTML(v);
  });
}

/**
 * `*…*` → <strong>, `$…$` → <span class="uf-math">.
 *
 * Both are non-greedy and single-line, so an unpaired marker is left alone
 * rather than swallowing the rest of the sentence. The pair is deliberately
 * small: the site emphasises inside a sentence (weight 550 in --fg, never a
 * colour or a size change) and typesets symbols in the serif face, and it does
 * nothing else in prose.
 */
function markers(s) {
  return s
    .replace(/\*([^*\n]+)\*/g, (_, body) => `<strong>${body}</strong>`)
    .replace(/\$([^$\n]+)\$/g, (_, body) => `<span class="uf-math">${body}</span>`);
}

/**
 * A tagged template for prose:
 *
 *   txt`*Same color = same input.* Click or drag on a colored shape.`
 *   txt`A loop shrinks to a point exactly when this is $0$.`
 *
 * Interpolations are escaped unless they are themselves rich.
 * @returns {Rich}
 */
export function txt(strings, ...values) {
  if (!Array.isArray(strings) || !('raw' in strings))
    throw new TypeError('prose.txt is a tagged template: write txt`…`, not txt(…)');
  return new Rich(format(strings, values));
}

/**
 * A value as its own inline box: `` txt`*X* = ${value(name)}` ``.
 *
 * Visually this is nothing — a `<span>` with no rules on it. It matters because
 * a text run's boundaries decide where the glyphs inside it land: the same
 * sentence with the same total width rasterises differently depending on
 * whether its value is a separate inline box or part of the run around it.
 * Measured on this page: one glyph of "segment [0,1]" moves, up to 42 levels,
 * at every width. Both spellings exist in the shipped homotopy file — the first
 * widget writes into a `<span>`, the second interpolates into a template — so a
 * port that must be pixel-identical says which one it is instead of finding
 * out.
 * @returns {Rich}
 */
export const value = v => new Rich(`<span>${escapeHTML(v)}</span>`);

/** Unicode subscripts where they exist, `<sub>` where they do not. */
const SUBS = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉',
  '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎', a: 'ₐ', e: 'ₑ', h: 'ₕ', i: 'ᵢ', j: 'ⱼ',
  k: 'ₖ', l: 'ₗ', m: 'ₘ', n: 'ₙ', o: 'ₒ', p: 'ₚ', r: 'ᵣ', s: 'ₛ', t: 'ₜ', u: 'ᵤ', v: 'ᵥ', x: 'ₓ' };

/**
 * `sub('0')` → '₀'; `sub('q')` → a `<sub>` element's markup, because U+2094 is
 * not a subscript q. Matches the source's practice of using `<sub>` only where
 * the codepoint does not exist.
 * @returns {Rich}
 */
export function sub(s) {
  const str = String(s);
  const mapped = [...str].map(c => SUBS[c]);
  return mapped.every(Boolean) ? new Rich(mapped.join('')) : new Rich(`<sub>${escapeHTML(str)}</sub>`);
}

// ------------------------------------------------------------------ bindings --

/** Keys a binding reads; '*' means "every frame". */
const needsOf = (needs, where) => {
  if (needs === undefined || needs === '*') return null;
  if (!Array.isArray(needs) || needs.some(k => typeof k !== 'string'))
    throw new TypeError(`${where}: needs must be an array of state keys, or '*'`);
  return new Set(needs);
};

/**
 * A binding is a small record, not a subscription: it knows what it reads and
 * how to write it, and the explorable's scheduler decides when. `writes`
 * counts the times the DOM actually changed, which is what the live-region
 * test asserts on (a t sweep must write the status once per distinct string,
 * not once per frame).
 *
 * @typedef {Object} Binding
 * @property {Element} el
 * @property {Set<string>|null} needs
 * @property {(state:object) => boolean} run   true when the DOM changed
 * @property {number} writes
 * @property {string|null} last
 */

/**
 * Plain text, guarded. `compute` returning null or undefined hides the element
 * instead of writing an empty string, so a reserved line does not leave a hole
 * when there is nothing to say.
 *
 * @param {Element} el
 * @param {(state:object) => string|null} compute
 * @param {object} [o]
 * @param {string[]|'*'} [o.needs]
 * @param {'polite'|'assertive'|null} [o.live=null]  adds aria-live + role
 * @param {boolean} [o.hide=true]  null → hidden (false: null writes '')
 * @returns {Binding}
 */
export function bind(el, compute, o = {}) {
  if (!el || typeof el.setAttribute !== 'function') throw new TypeError('prose.bind: pass an element');
  if (typeof compute !== 'function') throw new TypeError('prose.bind: compute must be a function of the state');
  const { needs, live = null, hide = true } = o;
  if (live) {
    el.setAttribute('aria-live', live);
    if (!el.hasAttribute('role')) el.setAttribute('role', live === 'assertive' ? 'alert' : 'status');
  }
  const b = {
    el, needs: needsOf(needs, 'prose.bind'), writes: 0, last: null,
    run(state) {
      const value = compute(state);
      if (isRich(value))
        throw new TypeError('prose.bind: this value is rich markup — use prose.rich for that element');
      const next = value == null ? null : String(value);
      if (hide) {
        const hidden = next === null;
        if (el.hidden !== hidden) el.hidden = hidden;
      }
      const text = next ?? '';
      // The guard. Compared against the DOM, not only against `last`, so a page
      // that wrote the element by hand is repaired rather than trusted.
      if (el.textContent === text) return false;
      el.textContent = text;
      b.last = text;
      b.writes++;
      return true;
    },
  };
  return b;
}

/**
 * Markup, guarded the same way. Defaults to `live: null` and warns if asked
 * for one: a live region holding markup announces unpredictably.
 * @param {Element} el
 * @param {(state:object) => Rich|string|null} compute
 * @param {{needs?:string[]|'*', hide?:boolean}} [o]
 * @returns {Binding}
 */
export function rich(el, compute, o = {}) {
  if (!el || typeof el.setAttribute !== 'function') throw new TypeError('prose.rich: pass an element');
  if (typeof compute !== 'function') throw new TypeError('prose.rich: compute must be a function of the state');
  const { needs, hide = true } = o;
  const b = {
    el, needs: needsOf(needs, 'prose.rich'), writes: 0, last: null,
    run(state) {
      const value = compute(state);
      const next = value == null ? null : (isRich(value) ? value.html : escapeHTML(value));
      if (hide) {
        const hidden = next === null;
        if (el.hidden !== hidden) el.hidden = hidden;
      }
      const markup = next ?? '';
      // Compared against what this binding last wrote, not against innerHTML:
      // the browser normalises markup on the way back out, so reading it would
      // rewrite the subtree on every frame.
      if (b.last === markup) return false;
      el.innerHTML = markup;
      b.last = markup;
      b.writes++;
      return true;
    },
  };
  return b;
}

/**
 * An attribute, guarded. The same discipline for the handful of places where
 * state reaches an attribute rather than a text node — `data-side` on the
 * round-trip diagram, an `aria-label` that names the current view.
 * @returns {Binding}
 */
export function attr(el, name, compute, o = {}) {
  if (!el || typeof el.setAttribute !== 'function') throw new TypeError('prose.attr: pass an element');
  const b = {
    el, needs: needsOf(o.needs, 'prose.attr'), writes: 0, last: null,
    run(state) {
      const v = compute(state);
      const next = v == null || v === false ? null : String(v);
      if (next === null) {
        if (!el.hasAttribute(name)) return false;
        el.removeAttribute(name);
      } else {
        if (el.getAttribute(name) === next) return false;
        el.setAttribute(name, next);
      }
      b.last = next;
      b.writes++;
      return true;
    },
  };
  return b;
}

// -------------------------------------------------------------------- slots --

const ns = (doc, tag, attrs = {}, text) => {
  const node = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    node.setAttribute(k, v === true ? '' : String(v));
  }
  if (text != null) node.textContent = String(text);
  return node;
};

const classList = (...list) => list.filter(Boolean).join(' ') || undefined;

/**
 * A block of prose in an explorable's body: the element, and the binding that
 * keeps it true.
 *
 *   slot({ class:'uf-note', needs:['cfg'], text: s => s.cfg.note })
 *   slot({ class:'uf-status', live:'polite', name:'status', text: s => … })
 *   slot({ summary:'Why?', class:'uf-why', needs:['cfg'], rich: s => s.cfg.why })
 *   slot({ tag:'p', class:'uf-note', content: txt`*Same color = same input.*` })
 *
 * `text` and `rich` returning null hide the element rather than emptying it,
 * so a reserved line leaves no hole. `live` makes it a live region, which is
 * the only way this framework offers to build one — a status line that
 * announces nothing was the most common accessibility failure in the pages
 * this replaces (nine of them in one file).
 *
 * `hide: false` keeps the element in flow when the value is null — the status
 * line beside a Clear button reserves its row, and a line that vanished would
 * move the button under the reader's cursor.
 *
 * `closeOn` is for a `<details>`: the keys whose change closes it again. The
 * shipped page closes "Why?" whenever the example changes, and a reader who
 * opened it for the previous example should not find it open on the next.
 *
 * @returns {{build:Function, bind:Function}}
 */
export function slot(o = {}) {
  const {
    tag = 'p', class: cls, part, live, needs, text, rich: richFn, content,
    name, classes: classFn, summary, hidden = false, closeOn, role, hide = true,
  } = o;
  if (text && richFn) throw new TypeError('prose.slot: give text or rich, not both');
  let element = null, body = null;

  return {
    prose: true,
    build({ doc }) {
      element = ns(doc, summary ? 'details' : tag, {
        class: cls, 'data-part': part, hidden: hidden || undefined, role,
      });
      if (summary) {
        element.append(ns(doc, 'summary', {}, summary));
        body = ns(doc, 'div', { 'data-uf': 'body' });
        element.append(body);
      } else {
        body = element;
      }
      if (content != null) {
        if (isRich(content)) body.innerHTML = content.html;
        else body.textContent = String(content);
      }
      return element;
    },

    bind() {
      const out = [];
      if (text) {
        const b = bind(body, text, { needs, live, hide });
        b.name = name ?? null;
        // A slot whose body is a <details>'s div hides the <details> itself:
        // hiding the body would leave a lone summary triangle behind.
        if (body !== element && hide) {
          const inner = b.run;
          b.run = state => {
            const wrote = inner.call(b, state);
            const away = text(state) == null;
            if (element.hidden !== away) element.hidden = away;
            return wrote;
          };
        }
        out.push(b);
      }
      if (richFn) {
        const b = rich(body, richFn, { needs, hide: hide && body === element });
        b.name = name ?? null;
        if (body !== element && hide) {
          const inner = b.run;
          b.run = state => {
            const wrote = inner.call(b, state);
            const away = richFn(state) == null;
            if (element.hidden !== away) element.hidden = away;
            return wrote;
          };
        }
        out.push(b);
      }
      if (classFn) {
        out.push({
          el: element, needs: needs ? new Set(needs) : null, name: null, writes: 0,
          run(state) {
            let wrote = false;
            for (const [k, want] of Object.entries(classFn(state))) {
              if (element.classList.contains(k) === !!want) continue;
              element.classList.toggle(k, !!want);
              wrote = true;
            }
            if (wrote) this.writes++;
            return wrote;
          },
        });
      }
      if (closeOn) {
        out.push({
          el: element, needs: new Set(closeOn), name: null, writes: 0, strict: true,
          run() { if (!element.open) return false; element.open = false; this.writes++; return true; },
        });
      }
      return out;
    },
  };
}

/** Static markup: a hint, a definition — text that never changes. */
export function block({ tag = 'p', class: cls, part, content, role }) {
  return {
    prose: true,
    build({ doc }) {
      const node = ns(doc, tag, { class: classList(cls), 'data-part': part, role });
      if (content != null) {
        if (isRich(content)) node.innerHTML = content.html;
        else node.textContent = String(content);
      }
      return node;
    },
  };
}
