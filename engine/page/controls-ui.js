// Layer 4 — the controls, as components.
//
// Every control on the site is one of six things, and each of them exists two
// or three times in the shipped pages with drifted markup: a labelled select,
// a slider with a serif glyph and a tabular readout, a play button, a pressed
// toggle, a row of pressed buttons, and a plain action button. This module is
// the better of each, once.
//
// What a builder returns is a DESCRIPTOR, not a live control: the markup it
// will build, the state key it binds to, and the spec core/controls.js needs
// to bind it. explorable.js builds them into a root, hands the specs to
// bindControls() and never touches value, checked, selected or aria-pressed
// again — that triple ("set the field, set the input, set the readout"),
// written out at four call sites in the shipped widget, is one call here and
// cannot drift.
//
// Ids are generated (`<explorable>-<key>`) and exist only to satisfy `for`,
// `aria-controls` and `aria-labelledby`. Nothing addresses a control by id:
// `[data-control="key"]` scoped to the instance root is the handle, which is
// what lets two widgets live on one page without the `eq-` prefix the shipped
// file maintains by hand.

export const LAYER = 4;

const ns = (doc, tag, attrs = {}, text) => {
  const el = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  if (text != null) el.textContent = String(text);
  return el;
};

const classes = (...list) => list.filter(Boolean).join(' ') || undefined;

/** Options given as [value, label] pairs, as objects, or as a function of state. */
function optionList(options, where) {
  if (typeof options === 'function') return options;
  if (!Array.isArray(options)) throw new TypeError(`${where}: options must be an array or a function of the state`);
  return options.map(o => (Array.isArray(o) ? { value: o[0], label: o[1] } : o));
}

/**
 * @typedef {Object} ControlDescriptor
 * @property {string} [key]        the state key, when the control binds to one
 * @property {string} [action]     'play' | 'clear' | a page action, for buttons that are not state
 * @property {object} [spec]       the core/controls.js ControlSpec for this key
 * @property {(ctx:{doc:Document, id:(name:string)=>string, state:object}) => Element|Element[]} build
 * @property {string} [part]       a data-part visibility group for the whole control
 */

/**
 * A labelled select.
 *
 *   <div class="uf-field"><label for=…>Category</label><select data-control=…></select></div>
 *
 * `wrap: 'label'` instead puts the select INSIDE its label, which is the shape
 * the winding pickers use ("Start winding [ 1 ]"): one element, no for/id pair
 * to keep in sync, and the text reads as a sentence.
 *
 * @param {object} o
 * @param {string} o.key @param {string} o.label
 * @param {Array|Function} o.options
 * @param {string} [o.class] extra class on the wrapper
 * @param {'div'|'label'} [o.wrap='div']
 * @param {string} [o.ariaLabel]
 * @param {string} [o.part]
 * @param {object} [o.spec]  merged into the ControlSpec — `{ parse: Number }`
 *   for a select whose values are numbers, which is the only thing any select
 *   on the site needs and is worth one word rather than a numeric variant.
 * @returns {ControlDescriptor}
 */
export function select({ key, label, options, class: cls, wrap = 'div', ariaLabel, part, spec: extra }) {
  const list = optionList(options, `control.select("${key}")`);
  return {
    key, part,
    spec: { type: 'select', ...(typeof list === 'function' ? { options: list } : {}), ...extra },
    build({ doc, id, state }) {
      const sel = ns(doc, 'select', { id: id(key), 'data-control': key, 'aria-label': ariaLabel });
      // Built with the current value already chosen. The binder would repair a
      // mismatch on its first pass and warn about it, which is right for a
      // hand-written page and wrong here: this markup IS the state, so saying
      // so once at build time is cheaper than a correction and a warning.
      // `data-k` is the reconciler's key, so a list the binder will later
      // rebuild ADOPTS these options rather than appending a second copy of
      // every one — the same seeding path that lets the engine take over
      // markup a string builder wrote.
      const items = typeof list === 'function' ? (list(state) ?? []) : list;
      for (const opt of items)
        sel.append(ns(doc, 'option', {
          value: opt.value, 'data-k': String(opt.value),
          selected: String(opt.value) === String(state[key]) || undefined,
        }, opt.label));
      const box = ns(doc, wrap, {
        class: classes(wrap === 'label' ? 'uf-field uf-field--inline' : 'uf-field', cls),
        for: wrap === 'label' ? id(key) : undefined,
        'data-part': part,
      });
      if (wrap === 'label') { box.append(doc.createTextNode(`${label} `)); box.append(sel); }
      else { box.append(ns(doc, 'label', { for: id(key) }, label)); box.append(sel); }
      return box;
    },
  };
}

/**
 * The slider: a serif single-glyph label, a native range with `accent-color`,
 * and an `<output for>` that is `tabular-nums` with a reserved width. The three
 * together are why the shipped sliders feel solid — the row cannot jitter as
 * the digits change — so they are one component and not three.
 *
 * @param {object} o
 * @param {string} o.key
 * @param {string} o.math      the glyph beside the track ('t', 'λ', 'u')
 * @param {number} [o.min=0] @param {number} [o.max=1] @param {number} [o.step=0.001]
 * @param {(v:number)=>string} [o.format]  default: two decimals
 * @param {string} [o.ariaLabel]
 * @param {string} [o.class]
 * @returns {ControlDescriptor}
 */
export function slider({ key, math, min = 0, max = 1, step = 0.001, format = v => v.toFixed(2), ariaLabel, class: cls, spec: extra }) {
  return {
    key,
    spec: { type: 'range', format, ...extra },
    build({ doc, id, state }) {
      const input = ns(doc, 'input', {
        id: id(key), type: 'range', min, max, step,
        value: state[key], 'data-control': key, 'aria-label': ariaLabel,
      });
      const out = ns(doc, 'output', { for: id(key), 'data-value': key }, format(state[key]));
      const box = ns(doc, 'div', { class: classes('uf-slider', cls) });
      box.append(ns(doc, 'label', { for: id(key) }, math), input, out);
      return box;
    },
  };
}

/**
 * Play / Pause / Replay in one button, whose visible text IS its accessible
 * name. The shipped page keeps a separate `aria-label` in step with the label
 * on one of its four play buttons and not on the other three; dropping it
 * removes the thing that can drift. The glyphs are `aria-hidden`, because
 * U+2161 announces as "Roman numeral two" before the word "Pause".
 *
 * The label is written by the explorable's timeline, which is the only thing
 * that knows whether it is playing.
 * @returns {ControlDescriptor}
 */
export function play({ class: cls, labels } = {}) {
  return {
    action: 'play', labels,
    build({ doc }) {
      const button = ns(doc, 'button', { type: 'button', class: classes('uf-play', cls), 'data-action': 'play' });
      button.append(ns(doc, 'span', { 'aria-hidden': 'true' }, '▶'), doc.createTextNode(' Play'));
      return button;
    },
  };
}

/**
 * The play button and the scrub slider, which is what a transport is: one
 * timeline, two ways to move it. Scrubbing pauses first, always.
 * @returns {ControlDescriptor[]}
 */
export function transport({ key = 't', math = 't', duration = 7000, labels, ariaLabel, min, max, step, format, class: cls } = {}) {
  const p = play({ labels });
  p.duration = duration;
  p.key = key;
  return [p, slider({ key, math, ariaLabel, min, max, step, format, class: cls })];
}

/**
 * A toggle: a button whose `aria-pressed` IS the bound boolean. The pressed
 * look comes from the global `[aria-pressed=true]` rule, so every toggle on
 * the site gets it without a class of its own.
 * @returns {ControlDescriptor}
 */
export function toggle({ key, label, class: cls, part }) {
  return {
    key, part,
    spec: { type: 'button' },
    build({ doc, id, state }) {
      return ns(doc, 'button', {
        type: 'button', id: id(key), class: classes('uf-toggle', cls), 'data-control': key,
        'aria-pressed': String(!!state[key]), 'data-part': part,
      }, label);
    },
  };
}

/**
 * A row of pressed buttons — one choice, several options. Three spellings of
 * this exist in the shipped pages with no shared class; this is the one.
 * Labels may be a function of the state (the round-trip row relabels itself
 * with each case's two verdicts).
 * @returns {ControlDescriptor}
 */
export function segmented({ key, options, ariaLabel, class: cls, part, spec: extra }) {
  const list = optionList(options, `control.segmented("${key}")`);
  return {
    key, part,
    spec: { type: 'segmented', ...(typeof list === 'function' ? { options: list } : {}), ...extra },
    build({ doc, id, state }) {
      const box = ns(doc, 'div', {
        id: id(key), class: classes('uf-segmented', cls), 'data-control': key,
        role: 'group', 'aria-label': ariaLabel, 'data-part': part,
      });
      const items = typeof list === 'function' ? (list(state) ?? []) : list;
      for (const opt of items) {
        // data-k for the same reason as select's options: the binder rebuilds
        // this list, and an unkeyed member is a second copy rather than the
        // same one.
        box.append(ns(doc, 'button', {
          type: 'button', value: opt.value, 'data-k': String(opt.value),
          'aria-pressed': String(String(opt.value) === String(state[key])),
        }, opt.label));
      }
      return box;
    },
  };
}

/**
 * A checkbox. The input goes INSIDE the label, so there is no for/id pair to
 * keep in sync, and the box is the native one with `accent-color`.
 * @returns {ControlDescriptor}
 */
export function check({ key, label, class: cls, part }) {
  return {
    key, part,
    spec: { type: 'checkbox' },
    build({ doc, id, state }) {
      const box = ns(doc, 'label', { class: classes('uf-check', cls), 'data-part': part });
      box.append(ns(doc, 'input', { type: 'checkbox', id: id(key), 'data-control': key, checked: !!state[key] }),
        ns(doc, 'span', {}, label));
      return box;
    },
  };
}

/**
 * A button that runs an action rather than holding state — "Clear circle".
 * `hidden` takes a predicate, since most of them are only there when there is
 * something to undo.
 * @returns {ControlDescriptor}
 */
export function button({ label, action, class: cls, hidden }) {
  return {
    action, hidden,
    build({ doc }) {
      return ns(doc, 'button', {
        type: 'button', class: classes('uf-button', cls), 'data-action': action,
        hidden: hidden ? true : undefined,
      }, label);
    },
  };
}

/**
 * A control row: the flex line that wraps. `group({class, part}, …children)`,
 * or `group(…children)` when it needs neither.
 *
 * A group builds its children and remembers their nodes, so `bind` reaches
 * them: a row may hold a prose slot (the status line beside its Clear button)
 * as easily as a control.
 */
export function group(...args) {
  const opts = args.length && args[0] && !args[0].build && !Array.isArray(args[0]) ? args.shift() : {};
  const items = args.flat().filter(Boolean);
  const nodes = new Map();
  return {
    children: items,
    part: opts.part,
    build(ctx) {
      const box = ns(ctx.doc, 'div', { class: classes('uf-controls', opts.class), 'data-part': opts.part });
      for (const child of items) {
        const node = child.build(ctx);
        nodes.set(child, Array.isArray(node) ? node[0] : node);
        box.append(...(Array.isArray(node) ? node : [node]));
      }
      return box;
    },
    bind(_node, ctx) {
      const out = [];
      for (const child of items) if (child.bind) out.push(...child.bind(nodes.get(child), ctx));
      return out;
    },
  };
}

/** Everything a group or a bare descriptor holds, flattened, in document order. */
export function descriptorsOf(list) {
  const out = [];
  const walk = item => {
    if (!item) return;
    if (Array.isArray(item)) { item.forEach(walk); return; }
    if (item.children) { item.children.forEach(walk); return; }
    out.push(item);
  };
  list.forEach(walk);
  return out;
}
