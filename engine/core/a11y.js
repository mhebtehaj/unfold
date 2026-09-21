// Layer 0 — the accessibility primitives the three explorers each half-built.
//
// Three concrete failures motivate everything here. Nine status strings in the
// realization explorer change on interaction and the file contains zero
// `aria-live`, so a screen-reader user is told nothing. One of the two live
// regions in the ambiguity widget writes its text unguarded, so an identical
// update is re-announced — which is what makes `role="status"` unusable during
// a 60 fps playback. And 17 SVGs across the site are `role="img" tabindex="0"`
// with drag handlers: a role that collapses the subtree, on an element the
// author then made focusable and keyboard-operable.
//
// Nothing here runs at import time. `tools/` scripts and the layer checker load
// this module under node, where `document` and `matchMedia` do not exist, so
// every DOM and media-query touch is deferred to a call.

export const LAYER = 0;

const SVG_NS = 'http://www.w3.org/2000/svg';

// U+200B. `force()` toggles one of these onto the end of the text: it is the
// only way to make a live region repeat a string it already holds, and screen
// readers do not speak it.
const ZWSP = '​';
const strip = s => (s.endsWith(ZWSP) ? s.slice(0, -1) : s);

let uid = 0;
const nextId = kind => `uf-${kind}-${++uid}`;

// The design system ships `.uf-sr`, but this module has to work on a page whose
// stylesheet has not loaded — a dropped link must not turn hidden prose into
// visible clutter above the drawing. So the declarations go on through CSSOM as
// well as the class. CSSOM, not a `style` attribute, because the site's CSP is
// `style-src 'self'` with no `unsafe-inline`.
const SR_STYLE = [
  ['position', 'absolute'], ['width', '1px'], ['height', '1px'],
  ['margin', '-1px'], ['padding', '0'], ['overflow', 'hidden'],
  ['clip', 'rect(0, 0, 0, 0)'], ['clip-path', 'inset(50%)'],
  ['white-space', 'nowrap'], ['border', '0'],
];

/** A node that is in the accessibility tree and out of the picture. */
function srNode(doc, tag, text) {
  const n = doc.createElement(tag);
  n.className = 'uf-sr';
  n.textContent = text;
  for (const [prop, value] of SR_STYLE) n.style.setProperty(prop, value);
  return n;
}

// ------------------------------------------------------------ live regions --

/**
 * @param {Element} el
 * @param {object} [o]
 * @param {'polite'|'assertive'} [o.politeness='polite']
 * @param {boolean} [o.atomic=true]
 * @param {number} [o.debounce=150]
 * @returns {{ announce(text:string): boolean, force(text:string): void,
 *             clear(): void, text: string, dispose(): void }}
 */
export function liveRegion(el, o = {}) {
  const { politeness = 'polite', atomic = true, debounce = 150 } = o;

  el.setAttribute('aria-live', politeness);
  el.setAttribute('aria-atomic', String(atomic));
  // Only when the author has not already chosen one: a page that wrote
  // `role="log"` meant it. Otherwise the role that matches the politeness.
  if (!el.hasAttribute('role'))
    el.setAttribute('role', politeness === 'assertive' ? 'alert' : 'status');

  let timer = null;
  let pending = null;
  let lastAt = -Infinity;
  let flip = false;
  let dead = false;

  /**
   * The equality guard, which is the whole feature (homotopy.md §13 #23): a
   * redundant identical write to a live region is announced again, so a status
   * line driven from a rAF loop reads the same sentence sixty times a second.
   * Compared against the stripped text so a previous `force()` marker does not
   * count as a difference and trigger a spurious re-announcement.
   */
  const write = text => {
    if (strip(el.textContent) === text) return false;
    el.textContent = text;
    lastAt = Date.now();
    return true;
  };

  const flush = () => {
    timer = null;
    if (dead || pending === null) return;
    const text = pending;
    pending = null;
    write(text);
  };

  const cancelPending = () => {
    pending = null;
    if (timer !== null) { clearTimeout(timer); timer = null; }
  };

  return {
    /** @returns {boolean} whether the DOM was written *now*. */
    announce(text) {
      if (dead) return false;
      const s = String(text);
      if (s === (pending ?? strip(el.textContent))) return false;
      // Leading edge, then trailing: a single status change is immediate, and a
      // burst collapses to its last value one debounce later. Waiting on the
      // leading edge would delay every ordinary update for no reason.
      const wait = debounce - (Date.now() - lastAt);
      if (wait <= 0) { cancelPending(); return write(s); }
      pending = s;
      if (timer === null) timer = setTimeout(flush, wait);
      return false;
    },

    /** "The value did not change, and that IS the news." Bypasses the debounce. */
    force(text) {
      if (dead) return;
      cancelPending();
      flip = !flip;
      el.textContent = flip ? String(text) + ZWSP : String(text);
      lastAt = Date.now();
    },

    clear() {
      if (dead) return;
      cancelPending();
      write('');
    },

    /** What a screen reader currently holds, without the `force()` marker. */
    get text() { return strip(el.textContent); },

    dispose() {
      dead = true;
      cancelPending();
    },
  };
}

// ----------------------------------------------------------- operable scene --

// One binding per element. A second `makeOperable` on the same node retires the
// first, so `instructions` is appended once however many times a redraw runs.
const BOUND = new WeakMap();

/**
 * @param {Element} el
 * @param {object} o
 * @param {string} o.label
 * @param {string} [o.description]
 * @param {'group'|'application'|'img'} [o.role='group']
 * @param {boolean} [o.focusable=true]
 * @param {Record<string,(ev:KeyboardEvent)=>void>|((ev:KeyboardEvent)=>boolean)} [o.keys]
 * @param {string} [o.instructions]
 * @returns {{ dispose(): void, setLabel(s:string): void }}
 */
export function makeOperable(el, o = {}) {
  const { label, description, role = 'group', focusable = true, keys, instructions } = o;

  BOUND.get(el)?.();

  const doc = el.ownerDocument;
  const prior = new Map();
  const setAttr = (name, value) => {
    if (!prior.has(name)) prior.set(name, el.getAttribute(name));
    if (value == null) el.removeAttribute(name); else el.setAttribute(name, value);
  };

  setAttr('role', role);
  if (label != null) setAttr('aria-label', label);
  // `focusable: false` actively removes tabindex. The bug being fixed is an
  // element that is `role="img"` *and* focusable; leaving a stale tabindex in
  // place would reproduce it.
  setAttr('tabindex', focusable ? '0' : null);

  // A `<p>` cannot live inside an `<svg>`, so the hidden prose goes next to the
  // element and is linked by id. `insertBefore` against a fixed anchor keeps the
  // two nodes in the order they were declared.
  const parent = el.parentNode;
  const host = parent ?? el;
  const anchor = parent ? el.nextSibling : null;
  const made = [];
  const ids = [];
  for (const text of [description, instructions]) {
    if (text == null) continue;
    const p = srNode(doc, 'p', text);
    p.id = nextId('desc');
    host.insertBefore(p, anchor);
    made.push(p);
    ids.push(p.id);
  }
  if (ids.length) {
    const existing = el.getAttribute('aria-describedby');
    setAttr('aria-describedby', existing ? `${existing} ${ids.join(' ')}` : ids.join(' '));
  }

  let onKey = null;
  if (keys) {
    onKey = ev => {
      let handled = false;
      if (typeof keys === 'function') handled = keys(ev) === true;
      else {
        const fn = keys[ev.key];
        if (fn) { fn(ev); handled = true; }
      }
      // Only for keys we actually took. Calling it unconditionally is how a
      // scene swallows Tab and traps the keyboard user inside the drawing.
      if (handled) ev.preventDefault();
    };
    el.addEventListener('keydown', onKey);
  }

  const dispose = () => {
    if (BOUND.get(el) === dispose) BOUND.delete(el);
    if (onKey) { el.removeEventListener('keydown', onKey); onKey = null; }
    for (const p of made.splice(0)) p.remove();
    for (const [name, value] of prior) {
      if (value == null) el.removeAttribute(name); else el.setAttribute(name, value);
    }
    prior.clear();
  };
  BOUND.set(el, dispose);

  return {
    dispose,
    setLabel(s) { setAttr('aria-label', s); },
  };
}

/**
 * Creates or UPDATES `<title>`/`<desc>` as the first children of the `<svg>`,
 * never removing them. An omitted field leaves what is there alone.
 * @param {Element} svgEl
 * @param {{title?:string, desc?:string}} [o]
 */
export function describeSvg(svgEl, o = {}) {
  const { title, desc } = o;
  const doc = svgEl.ownerDocument;
  const find = tag => {
    for (const n of svgEl.children) if (n.localName === tag) return n;
    return null;
  };
  const set = (tag, text) => {
    let node = find(tag);
    if (text == null) return node;
    if (!node) node = doc.createElementNS(SVG_NS, tag);
    // Same guard as liveRegion: `<title>` is the accessible name, and rewriting
    // it identically on every redraw re-announces the scene.
    if (node.textContent !== text) node.textContent = text;
    return node;
  };

  const t = set('title', title);
  const d = set('desc', desc);
  // Position is load-bearing — a `<title>` that is not the first child is not
  // reliably the accessible name — but re-seating an already-correct node costs
  // a removal and an insertion in every MutationObserver watching the scene, so
  // move only when it is actually out of place. A node this call just created is
  // unparented, which counts as out of place.
  const misplaced = (node, prevEl) =>
    node.parentNode !== svgEl || node.previousElementSibling !== prevEl;
  if (t && misplaced(t, null)) svgEl.insertBefore(t, svgEl.firstChild);
  if (d && misplaced(d, t)) svgEl.insertBefore(d, t ? t.nextSibling : svgEl.firstChild);
}

/**
 * Records which reconciled node (by `data-k`) held focus, runs `fn`, and
 * restores focus to the node with the same key if it still exists. Without
 * this, a redraw during keyboard interaction drops focus to `<body>` and the
 * next arrow key scrolls the page instead of moving the selection.
 * @param {Element} parent
 * @param {() => void} fn
 */
export function preserveFocus(parent, fn) {
  const doc = parent.ownerDocument;
  const active = doc.activeElement;
  // `closest`, not `getAttribute`: focus may sit on a child of the keyed node.
  const held = active && parent.contains(active) ? active.closest('[data-k]') : null;
  const key = held ? held.getAttribute('data-k') : null;
  try {
    return fn();
  } finally {
    // Nothing to do when reconcile reused the node — focus never left it.
    if (key !== null && doc.activeElement !== held) {
      for (const n of parent.querySelectorAll('[data-k]')) {
        // Compared as a string rather than built into a selector: keys look like
        // `face:110` and a selector would need escaping rules per key shape.
        if (n.getAttribute('data-k') === key) { n.focus?.({ preventScroll: true }); break; }
      }
    }
  }
}

// --------------------------------------------------- preferences & pointers --

const REDUCE = '(prefers-reduced-motion: reduce)';
const COARSE = '(pointer: coarse)';

// One MediaQueryList per query for the whole engine. `matchMedia()` is the
// expensive call; `.matches` on a list you already hold is a live, free read,
// which is why nothing here re-queries per click (ambiguity.md §8.3).
const MATCHERS = new Map();
const matcher = q => {
  if (!MATCHERS.has(q))
    MATCHERS.set(q, typeof matchMedia === 'function' ? matchMedia(q) : null);
  return MATCHERS.get(q);
};

/** @returns {boolean} live. */
export function prefersReducedMotion() {
  return matcher(REDUCE)?.matches === true;
}

const motionFns = new Set();
let motionBound = null;

/**
 * @param {(reduced:boolean) => void} fn
 * @returns {() => void} unsubscribe
 */
export function onMotionPreferenceChange(fn) {
  const q = matcher(REDUCE);
  if (!q) return () => {};
  motionFns.add(fn);
  if (!motionBound) {
    // One 'change' listener, fanned out. Every caller — anim.js, the page
    // transport, marks — reads the same live value from the same matcher.
    motionBound = () => { for (const f of [...motionFns]) f(q.matches === true); };
    q.addEventListener('change', motionBound);
  }
  return () => {
    motionFns.delete(fn);
    if (!motionFns.size && motionBound) {
      q.removeEventListener('change', motionBound);
      motionBound = null;
    }
  };
}

/** @returns {boolean} live. */
export function coarsePointer() {
  return matcher(COARSE)?.matches === true;
}

/**
 * Extra hit radius for a coarse pointer, in px. The SVG half of the 44 px
 * policy the stylesheet applies to controls: CSS cannot inflate the hit area of
 * an `r="3"` circle, so `render/marks.js` sizes an invisible sibling with this.
 * Half of `min`, because a radius of 22 guarantees a 44 px target on its own
 * without knowing what the mark's own radius is.
 * @returns {number}
 */
export function hitInflation({ min = 44 } = {}) {
  return coarsePointer() ? min / 2 : 0;
}
