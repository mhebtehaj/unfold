// core/controls.js — the five hand-rolled data-* conventions, bound once.
//
// [data-control] already exists in the ambiguity explorer. What does not exist
// is a single writer. A "courtesy default" there is three statements — set the
// state field, set the input's value, set the readout's textContent — written
// out at four call sites (ambiguity.md §9.5), and the day one of the three is
// forgotten the slider reads 0% while the surface is separated. set() is that
// triple as one call, and sync() is the ONLY writer of value/checked/selected/
// aria, so the DOM cannot drift from the store.
//
// CONDITIONAL AVAILABILITY is the other half, and it is why visibility is
// declarative rather than a per-page `if`. Driving the three live pages turned
// up four shapes, all of which this module has to express:
//
//   1. #example's option list is rebuilt by #category      → spec.options()
//   2. #map-variant's whole row is gone unless the carrier
//      is a circle (its wrapper carries display:none)      → data-part + visibility()
//   3. #solid-base offers triangle|edge for the prism and
//      circle|disk|edge for the cone — a different list,
//      and the old selection is not in it                  → spec.options() + the fallback
//   4. #extension-progress is DISABLED at the first and
//      last stage, #extension-break until stage 3          → spec.disabled()
//
// Hidden and disabled are different things and the pages use both: a hidden
// control is one the reader must not think about, a disabled one is a control
// they can see is there and cannot use yet. Neither is spelled with the other.
//
// data-part goes on the labelled ROW, not the input — that is what the explorer
// hides, and hiding a bare <input> inside a <label> would leave its text behind.
// spec.hidden hides exactly the element it is declared on; the row is
// visibility()'s job.

import { on, reconcile } from './svg.js';

export const LAYER = 0;

// There is no build step, so nothing can define away a development-only check.
// Read live rather than captured at load, so a test can exercise both branches.
const isDev = () => globalThis.UNFOLD_DEV !== false;

/** Roots with a live binder — see the double-bind warning in bindControls. */
const LIVE = new WeakSet();

const TYPES = new Set(['range', 'number', 'checkbox', 'select', 'radio', 'segmented', 'button', 'text']);

// Default event per type. 'input' for range and text so the readout tracks the
// drag; everything else settles first. button/segmented are <button>s, which
// never fire change at all.
const EVENT = {
  range: 'input', text: 'input', number: 'change', checkbox: 'change',
  select: 'change', radio: 'change', button: 'click', segmented: 'click',
};

/** Attribute selector with the value quoted: keys come from page code. */
const sel = (attr, value) => `[${attr}=${JSON.stringify(String(value))}]`;

/** Decimals implied by a step attribute: "0.001" → 3. */
function decimals(step) {
  const s = String(step ?? '');
  const dot = s.indexOf('.');
  return dot < 0 ? 0 : s.length - dot - 1;
}

const roundTo = (v, d) => { const k = 10 ** d; return Math.round(v * k) / k; };

/** Object.is, but 0.28/(1/100) === 28.000000000000004 is not drift. */
const same = (a, b) =>
  Object.is(a, b) || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= 1e-9);

const memberInput = m => (m.matches('input') ? m : m.querySelector('input'));

/**
 * `hidden` is an HTMLElement IDL attribute; an SVG element has only the
 * content attribute, which unfold.css turns into display:none.
 */
function setHidden(node, hide) {
  if ('hidden' in node) { if (node.hidden !== hide) node.hidden = hide; return; }
  if (node.hasAttribute('hidden') !== hide) node.toggleAttribute('hidden', hide);
}

function setDisabled(node, off) {
  if ('disabled' in node) { if (node.disabled !== off) node.disabled = off; return; }
  // Never adds aria-disabled="false" to an element that never had it.
  if ((node.getAttribute('aria-disabled') === 'true') !== off)
    node.setAttribute('aria-disabled', String(off));
}

function setAria(node, name, value) {
  const v = String(value);
  if (node.getAttribute(name) !== v) node.setAttribute(name, v);
}

/**
 * Where a member's label text goes. C's checkbox markup is
 * `<label class="check"><input …>Show nesting</label>` (design-system.md §6.12:
 * the input lives inside the label so there is no for/id pair to keep in sync),
 * so writing textContent on the wrapper would delete the input. Write the
 * <span> when there is one, otherwise the wrapper's own text node, in place.
 */
function setLabel(node, text) {
  const span = node.querySelector ? node.querySelector('span') : null;
  if (span) { if (span.textContent !== text) span.textContent = text; return; }
  const t = [...node.childNodes].find(n => n.nodeType === 3);   // Node.TEXT_NODE
  if (!t) node.append(node.ownerDocument.createTextNode(text));
  else if (t.data !== text) t.data = text;
}

/**
 * @param {Element} root
 * @param {Store} store
 * @param {Record<string, ControlSpec>} specs
 * @param {object} [o]
 * @param {'store'|'dom'} [o.defaults='store']
 *        'store' → on init the binder WRITES state into the DOM (the HTML
 *                  attributes stay as a no-JS fallback only)
 *        'dom'   → on init the binder READS the DOM into state
 * @param {boolean} [o.warnOnDrift=true]  dev: console.warn when HTML and store disagree
 * @param {(key:string, value:any, prev:any) => void} [o.onChange]
 * @param {{request:(level:string)=>void}|((level:string)=>void)} [o.frame]
 *        where spec.invalidates goes — the handle store.frame() returns. Not in
 *        §2.6's option list, but `invalidates` names frame.request() and there
 *        is otherwise no frame in scope; without it invalidates is inert and
 *        says so once, in dev.
 * @returns {Controls}
 */
export function bindControls(root, store, specs, o = {}) {
  const fromDom = o.defaults === 'dom';
  const warnOnDrift = o.warnOnDrift !== false;
  const onChange = o.onChange ?? null;
  const frame = o.frame ?? null;

  const bound = new Map();      // key -> record
  const indexes = new Map();    // data-attribute name -> indexed record
  const parts = new Map();      // data-part group -> predicate
  const cmds = new Map();       // data-attribute name -> unsubscribe
  const offs = new Set();       // every listener this binder installed

  let disposed = false;
  let syncing = false;          // a write of ours must not be read back as a user action
  let again = false;            // something re-entered sync(); it needs another pass
  let dragging = null;          // the range whose pointer is down
  let warnedFrame = false;

  if (isDev() && LIVE.has(root))
    console.warn('bindControls: this root already has a live binder —' +
      ' dispose() it first, or every user event is handled twice');
  LIVE.add(root);

  const track = (rec, off) => { offs.add(off); if (rec) rec.offs.push(off); return off; };

  const invalidate = spec => {
    if (!spec.invalidates || !spec.invalidates.length) return;
    if (!frame) {
      if (isDev() && !warnedFrame) {
        warnedFrame = true;
        console.warn('bindControls: a spec declares invalidates but no { frame } was passed —' +
          ' pass the handle store.frame() returned, or drop invalidates');
      }
      return;
    }
    const request = typeof frame === 'function' ? frame : frame.request.bind(frame);
    for (const level of spec.invalidates) request(level);
  };

  // -- reading the DOM ------------------------------------------------------
  const memberValue = (rec, m) => {
    const carrier = rec.type === 'radio' ? memberInput(m) ?? m : m;
    const v = carrier.value ?? '';
    if (isDev() && v === '' && rec.type === 'segmented')
      throw new Error(`controls: a segmented member of '${rec.key}' has no value attribute` +
        ` — data-part on a member is a visibility group under this spec, not its value`);
    return v;
  };

  function membersOf(rec) {
    const { el, type } = rec;
    if (type === 'radio') {
      if (rec.flat) return [...root.querySelectorAll(sel('data-control', rec.key))];
      return [...el.querySelectorAll('input[type="radio"]')].map(i => {
        const w = i.closest('label');
        return w && el.contains(w) ? w : i;
      });
    }
    if (type === 'segmented') return [...el.querySelectorAll('button, [role="radio"], [role="tab"]')];
    return [];
  }

  /** Elements that carry disabled for this control: the members, or the input. */
  function targetsOf(rec) {
    if (rec.type === 'radio') return membersOf(rec).map(m => memberInput(m) ?? m);
    if (rec.type === 'segmented') return membersOf(rec);
    return [rec.el];
  }

  const toRaw = (rec, v) => roundTo(Number(v) / rec.scale, rec.dp);

  function readValue(rec) {
    const { spec, el, type } = rec;
    // Member types first: the container has no value of its own, so parse()
    // must be handed the member's, not ''.
    if (type === 'radio' || type === 'segmented') {
      const hit = type === 'radio'
        ? membersOf(rec).find(m => memberInput(m)?.checked)
        : membersOf(rec).find(m => m.getAttribute('aria-pressed') === 'true');
      const raw = hit ? memberValue(rec, hit) : '';
      return spec.parse ? spec.parse(raw, hit ?? el) : raw;
    }
    const raw = 'value' in el ? String(el.value ?? '') : String(el.textContent ?? '');
    if (spec.parse) return spec.parse(raw, el);
    switch (type) {
      case 'range': case 'number': return Number(raw) * rec.scale;
      case 'checkbox': return el.checked;
      case 'button': return el.getAttribute('aria-pressed') === 'true';
      default: return raw;
    }
  }

  // -- writing the store ----------------------------------------------------
  /**
   * The atomic write: store, then DOM, then the page's side effects. sync() is
   * called unconditionally because the store refuses a no-op write and the DOM
   * may still have drifted — a range that clamped its own value, say.
   */
  function commit(key, value) {
    if (disposed) return;
    const prev = store.get(key);
    const changed = store.set(key, value);
    sync();
    if (!changed) return;
    const rec = bound.get(key);
    if (rec) invalidate(rec.spec);
    if (onChange) onChange(key, store.get(key), prev);
  }

  // -- events ---------------------------------------------------------------
  function handle(rec, ev) {
    // Our own write provoked this. Nothing else can tell a synthetic change
    // from a user's: repopulating a <select> moves its value underneath us.
    if (disposed || syncing) return;
    const { spec, type } = rec;
    let value;
    if (type === 'segmented' || type === 'radio') {
      const m = membersOf(rec).find(x => x === ev.target || x.contains(ev.target));
      if (!m) return;
      const raw = memberValue(rec, m);
      value = spec.parse ? spec.parse(raw, m) : raw;
    } else if (type === 'button') {
      value = !store.get(rec.key);     // a toggle button flips the bound boolean
    } else {
      value = readValue(rec);
    }
    commit(rec.key, value);
  }

  // -- definition -----------------------------------------------------------
  function define(key, spec) {
    if (disposed) return;
    if (!spec || !TYPES.has(spec.type))
      throw new Error(`controls.define('${key}'): unknown type ${JSON.stringify(spec && spec.type)}`);

    undefine(key);                     // a redefine replaces; it never stacks a second listener

    const el = root.querySelector(sel('data-control', key));
    if (!el) {
      if (isDev()) throw new Error(`controls.define('${key}'): no [data-control="${key}"] inside root`);
      return;                          // a published page loses one control, not the whole widget
    }
    if (isDev() && !(key in store.get()))
      throw new Error(`controls.define('${key}'): '${key}' is not a key of the store` +
        ` — name it in createStore's initial object`);

    const rec = {
      key, spec, el, type: spec.type, offs: [],
      scale: spec.scale ?? 1,
      options: null,
      flat: false,
      dp: 0,
      readout: null,
      labelSink: root.querySelector(sel('data-control', `${key}-label`)),
    };
    // Several elements carrying the same data-control is the flat radio group.
    // It has no container to own, so an options() list has nowhere to go.
    if (rec.type === 'radio')
      rec.flat = el.matches('input') || root.querySelectorAll(sel('data-control', key)).length > 1;
    if (spec.options && rec.flat)
      throw new Error(`controls.define('${key}'): options() needs one container element to own` +
        ` — put data-control="${key}" on the group, not on each radio`);

    // HTML attributes the spec supplies only if the markup did not. They are in
    // the element's units, not the state's: min/max/step belong to the control.
    for (const name of ['min', 'max', 'step'])
      if (spec[name] != null && !el.hasAttribute(name)) el.setAttribute(name, String(spec[name]));
    // Float noise out of the unscale would otherwise reach both the element and
    // its <output>; the step says how many digits are real. No step on a range
    // means the browser snaps to integers anyway, so 6 is only ever generous.
    rec.dp = el.hasAttribute('step') ? decimals(el.getAttribute('step')) : 6;
    rec.readout = resolveReadout(rec);

    bound.set(key, rec);
    listen(rec);

    if (fromDom) store.set(key, readValue(rec));
    else if (isDev() && warnOnDrift) {
      const inDom = readValue(rec), inStore = store.get(key);
      if (!same(inDom, inStore))
        console.warn(`controls: [data-control="${key}"] holds ${JSON.stringify(inDom)}` +
          ` but the store says ${JSON.stringify(inStore)} — the HTML value is the no-JS` +
          ` fallback and the store wins; pass { defaults: 'dom' } if it should not`);
    }
    sync(key);
  }

  function listen(rec) {
    const type = rec.spec.event ?? EVENT[rec.type];
    // One delegated listener on the container, because an options() pass
    // replaces the member elements underneath it.
    const hosts = (rec.type === 'segmented' || (rec.type === 'radio' && !rec.flat))
      ? [rec.el]
      : (rec.type === 'radio' ? membersOf(rec) : [rec.el]);
    for (const host of hosts) track(rec, on(host, type, ev => handle(rec, ev)));

    if (rec.type !== 'range') return;
    // A store write mid-drag must not snap the thumb back to the last settled
    // value. The release listener is on the document: a pointer let go outside
    // the track never reaches the input.
    const doc = rec.el.ownerDocument;
    const release = () => { if (dragging === rec.el) { dragging = null; sync(rec.key); } };
    track(rec, on(rec.el, 'pointerdown', () => { dragging = rec.el; }));
    track(rec, on(doc, 'pointerup', release));
    track(rec, on(doc, 'pointercancel', release));
  }

  function undefine(key) {
    const rec = bound.get(key);
    if (!rec) return;
    for (const off of rec.offs) { off(); offs.delete(off); }
    bound.delete(key);
  }

  /** <output for="id"> first, then [data-value="key"]. */
  function resolveReadout(rec) {
    const { spec, el, key } = rec;
    if (spec.readout === false) return null;
    if (typeof spec.readout === 'string') return root.querySelector(spec.readout);
    if (el.id) for (const out of root.querySelectorAll('output[for]'))
      if (out.htmlFor.contains(el.id)) return out;
    return root.querySelector(sel('data-value', key));
  }

  // -- the one write pass ---------------------------------------------------
  function format(rec, v) {
    const { spec } = rec;
    if (spec.format) return String(spec.format(v));
    const suffix = spec.suffix ?? '';
    if (typeof v === 'number') return String(toRaw(rec, v)) + suffix;
    return String(v ?? '') + suffix;
  }

  function writeReadout(rec, v) {
    const node = rec.readout;
    if (!node) return;
    const text = format(rec, v);
    // <output> has an implicit role="status", so an unconditional write
    // re-announces the same number on every frame of a drag (ambiguity.md
    // §16.40 is the same bug on [data-control="detail"]).
    if (node.tagName === 'OUTPUT') { if (node.value !== text) node.value = text; }
    else if (node.textContent !== text) node.textContent = text;
  }

  /** The binder repairs only a selection it owns — that is, one options() built. */
  function fallback(rec, wanted) {
    if (!rec.spec.options) return;
    const list = rec.options ?? [];
    const pick = list.find(x => !x.disabled && !x.hidden) ?? list[0];
    if (!pick || String(pick.value) === String(wanted)) return;
    commit(rec.key, rec.spec.parse ? rec.spec.parse(String(pick.value), rec.el) : pick.value);
  }

  function makeMember(rec, opt) {
    const doc = rec.el.ownerDocument;
    if (rec.type === 'select') return doc.createElement('option');
    if (rec.type === 'segmented') {
      // Cloned shallowly from a member the page already styles, so a generated
      // button is not the one unstyled item in the row.
      const proto = rec.el.querySelector('button');
      const node = proto ? proto.cloneNode(false) : doc.createElement('button');
      node.type = 'button';
      return node;
    }
    const proto = rec.el.querySelector('label');
    if (proto) {
      const node = proto.cloneNode(true);
      const input = node.querySelector('input');
      if (input) { input.checked = false; input.removeAttribute('data-k'); }
      return node;
    }
    const node = doc.createElement('label');
    const input = doc.createElement('input');
    input.type = 'radio';
    node.append(input, doc.createElement('span'));
    return node;
  }

  function paintMember(rec, node, opt) {
    const carrier = rec.type === 'radio' ? memberInput(node) ?? node : node;
    const value = String(opt.value);
    if (carrier.value !== value) carrier.value = value;
    if (rec.type === 'radio' && !carrier.name) carrier.name = rec.key;
    setLabel(node, opt.label ?? value);
    if ('disabled' in carrier) { const d = !!opt.disabled; if (carrier.disabled !== d) carrier.disabled = d; }
    setHidden(node, !!opt.hidden);
    return node;
  }

  /**
   * Declaring options() hands the container's members to the binder, which is
   * what lets the keyed reconciler keep the elements whose value survived a
   * rebuild (prism → fill keeps triangle and edge; prism → cone keeps neither).
   */
  function applyOptions(rec) {
    const list = rec.spec.options(store.get()) ?? [];
    rec.options = list;
    reconcile(rec.el, list, {
      key: opt => String(opt.value),
      create: opt => paintMember(rec, makeMember(rec, opt), opt),
      update: (node, opt) => paintMember(rec, node, opt),
    });
  }

  function writeValue(rec, v) {
    const { el, type } = rec;
    switch (type) {
      case 'range': case 'number': {
        const raw = String(toRaw(rec, v));
        if (el !== dragging && el.value !== raw) el.value = raw;
        break;
      }
      case 'checkbox': { const c = !!v; if (el.checked !== c) el.checked = c; break; }
      case 'text': {
        const s = v == null ? '' : String(v);
        // §2.6's table: a [data-control] may be an input, a readout or a chrome
        // label. [data-control="detail"] in the ambiguity explorer is a <div>.
        if ('value' in el) { if (el.value !== s) el.value = s; }
        else if (el.textContent !== s) el.textContent = s;
        break;
      }
      case 'select': {
        const s = v == null ? '' : String(v);
        if (el.value !== s) el.value = s;
        // A <select> refuses a value it has no option for and reports '' back.
        if (el.value !== s) fallback(rec, s);
        break;
      }
      case 'radio': {
        const s = String(v ?? '');
        let hit = false;
        for (const m of membersOf(rec)) {
          const input = memberInput(m);
          if (!input) continue;
          const want = input.value === s;
          hit = hit || want;
          if (input.checked !== want) input.checked = want;
        }
        if (!hit) fallback(rec, s);
        break;
      }
      case 'segmented': {
        const s = String(v ?? '');
        if (!membersOf(rec).some(m => memberValue(rec, m) === s)) fallback(rec, s);
        break;
      }
      default: break;                  // button: aria-pressed carries the value
    }
  }

  function writeAria(rec, v) {
    const { spec, type } = rec;
    const mode = spec.aria !== undefined ? spec.aria
      : (type === 'segmented' || type === 'button') ? 'pressed' : null;
    if (!mode) return;                 // a <select> mode picker exposes selection natively
    const name = mode === 'checked' ? 'aria-checked' : 'aria-pressed';
    if (type === 'segmented' || type === 'radio') {
      const s = String(v ?? '');
      for (const m of membersOf(rec)) setAria(m, name, memberValue(rec, m) === s);
    } else {
      setAria(rec.el, name, !!v);
    }
  }

  function syncOne(rec) {
    const state = store.get();
    const v = state[rec.key];
    if (rec.spec.options) applyOptions(rec);
    writeValue(rec, v);
    writeAria(rec, v);
    // Only a declared predicate writes: otherwise sync() would clobber a
    // disabled or hidden the page set by hand.
    if (rec.spec.disabled) { const d = !!rec.spec.disabled(state); for (const n of targetsOf(rec)) setDisabled(n, d); }
    if (rec.spec.hidden) setHidden(rec.el, !!rec.spec.hidden(state));
    writeReadout(rec, v);
    if (rec.spec.label != null && rec.labelSink) {
      const text = typeof rec.spec.label === 'function' ? rec.spec.label(state) : rec.spec.label;
      if (rec.labelSink.textContent !== text) rec.labelSink.textContent = text;
    }
  }

  function syncIndexed(ix) {
    const state = store.get();
    const list = state[ix.key] ?? [];
    for (const node of root.querySelectorAll(`[${ix.attr}]`)) {
      const i = Number(node.getAttribute(ix.attr));
      const v = list[i];
      if (ix.spec.type === 'checkbox') { const c = !!v; if (node.checked !== c) node.checked = c; }
      else if (ix.spec.type === 'range' || ix.spec.type === 'number') {
        const raw = String(roundTo(Number(v) / (ix.spec.scale ?? 1), 6));
        if (node !== dragging && node.value !== raw) node.value = raw;
      } else { const s = v == null ? '' : String(v); if (node.value !== s) node.value = s; }
      if (ix.spec.disabled) setDisabled(node, !!ix.spec.disabled(state, i));
      if (ix.spec.hidden) setHidden(node, !!ix.spec.hidden(state, i));
    }
  }

  /**
   * Fail-open: a missing predicate must never hide content. In dev it is a typo
   * in the visibility spec or a stale data-part, and silence there costs an
   * afternoon. An empty registry touches nothing — a page that has not called
   * visibility() yet keeps the markup's own hidden attributes.
   */
  function applyVisibility() {
    if (!parts.size) return;
    const state = store.get();
    for (const node of root.querySelectorAll('[data-part]')) {
      let show = true;
      for (const group of String(node.getAttribute('data-part')).split(/\s+/)) {
        if (!group) continue;
        const pred = parts.get(group);
        if (!pred) {
          if (isDev())
            throw new Error(`controls.visibility: no predicate for data-part="${group}"` +
              ` — declare it, or the group is a typo`);
          continue;
        }
        if (!pred(state)) { show = false; break; }
      }
      setHidden(node, !show);
    }
  }

  function sync(key) {
    if (disposed) return;
    // A fallback write re-entered us through the store. Let the pass that is
    // running finish rather than interleaving two of them, then go round again.
    if (syncing) { again = true; return; }
    syncing = true;
    try {
      let pass = 0, scope = key;
      do {
        again = false;
        if (scope === undefined) {
          for (const rec of [...bound.values()]) syncOne(rec);
          for (const ix of [...indexes.values()]) syncIndexed(ix);
        } else {
          const rec = bound.get(scope);
          if (rec) syncOne(rec);
          for (const ix of [...indexes.values()]) if (ix.key === scope) syncIndexed(ix);
        }
        applyVisibility();
        scope = undefined;             // whatever re-entered may touch any control
        if (again && ++pass > 8)
          throw new Error('controls.sync: did not settle after 8 passes' +
            ' — an options() list and its selection are chasing each other');
      } while (again);
    } finally {
      syncing = false;
    }
  }

  // -- the other three conventions -----------------------------------------
  function visibility(spec) {
    for (const group of Object.keys(spec)) parts.set(group, spec[group]);
    sync();
  }

  function indexed(attrName, stateKey, spec) {
    if (disposed) return;
    const attr = `data-${attrName}`;
    const old = indexes.get(attr);
    if (old) for (const off of old.offs) { off(); offs.delete(off); }
    const ix = { attr, key: stateKey, spec, offs: [] };
    indexes.set(attr, ix);

    // Delegated, so a bit added later is bound too, and teardown is one call.
    const type = spec.event ?? EVENT[spec.type] ?? 'change';
    track(ix, on(root, type, ev => {
      if (disposed || syncing) return;
      const node = ev.target.closest ? ev.target.closest(`[${attr}]`) : null;
      if (!node || !root.contains(node)) return;
      const i = Number(node.getAttribute(attr));
      const raw = String(node.value ?? '');
      const v = spec.parse ? spec.parse(raw, node)
        : spec.type === 'checkbox' ? node.checked
        : (spec.type === 'range' || spec.type === 'number') ? Number(raw) * (spec.scale ?? 1)
        : raw;
      // A fresh array: the store compares with Object.is, so a mutated one in
      // place would change nothing as far as any subscriber is concerned.
      const next = Array.isArray(store.get(stateKey)) ? store.get(stateKey).slice() : [];
      next[i] = v;
      commit(stateKey, next);
    }));
    sync(stateKey);
  }

  function commands(map) {
    if (disposed) return;
    for (const name of Object.keys(map)) {
      const attr = `data-${name}`;
      const fn = map[name];
      const old = cmds.get(attr);
      if (old) { old(); offs.delete(old); }
      const off = on(root, 'click', ev => {
        if (disposed) return;
        const node = ev.target.closest ? ev.target.closest(`[${attr}]`) : null;
        if (!node || !root.contains(node)) return;
        fn(node.getAttribute(attr), node, ev);
      });
      cmds.set(attr, off);
      offs.add(off);
    }
  }

  function element(key) {
    const rec = bound.get(key);
    if (rec) return rec.el;
    return root.querySelector(sel('data-control', key));
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const off of offs) off();
    offs.clear();
    bound.clear();
    indexes.clear();
    parts.clear();
    cmds.clear();
    dragging = null;
    LIVE.delete(root);
  }

  // An external write reaches the DOM through the same one pass as a user's:
  // a predicate may read any key, so a full pass is the only correct scope, and
  // every write in it is equality-guarded, so a pass that changes nothing
  // touches nothing.
  offs.add(store.subscribe(() => { if (!disposed) sync(); }));

  for (const key of Object.keys(specs ?? {})) define(key, specs[key]);

  return {
    define, undefine,
    set: commit,
    sync, visibility, indexed, commands, element, dispose,
  };
}
