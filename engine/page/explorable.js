// Layer 4 — an explorable: state + controls + drawings + reactive prose, as
// one instance that a page mounts.
//
// Three ideas hold it together, and everything else is mechanical.
//
// INVALIDATION IS DERIVED. Every consumer of state declares what it reads —
// a panel through `at` and `needs`, a prose binding through `needs` — and a
// write marks keys dirty and schedules one frame for the whole page. On that
// frame exactly the panels and bindings whose keys moved are redrawn. The
// shipped explorers hand-pick a "narrowest sufficient redraw" at some twenty
// call sites; here nothing in a page calls a draw function at all, and
// "during playback redraw only the current frame" is a consequence rather
// than a decision that can rot.
//
// INSTANCES, NOT SINGLETONS. explorable(spec) is a factory that registers
// nothing global and mutates no module state, so a page with two widgets
// mounts the same machinery twice. Every tunable constant lives in one frozen
// DEFAULTS; an instance that wants a different value writes it into `options`,
// where it is one grep away — and assertNoDrift() names any option two
// instances of the same kind disagree about and neither declared in
// `variesBy`. The shipped homotopy page has two widgets and eleven such
// disagreements, none of them documented, which is the bug class this makes
// unrepresentable.
//
// ONE PAGE REGISTRY. One ResizeObserver, one colour-scheme listener, one
// animator and one frame scheduler for the whole document, routed to the
// instances that care. The shipped page has two of each, never removed, kept
// harmless by an `if (panel.hidden) return` at the top of every draw.

export const LAYER = 4;

import { createStore } from '../core/state.js';
import { bindControls } from '../core/controls.js';
import { Viewport } from '../core/viewport.js';
import { Animator } from '../core/anim.js';
import { prefersReducedMotion } from '../core/a11y.js';
import { createProbe } from '../core/probe.js';
import { on } from '../core/svg.js';
import { SvgScene } from '../render/scene.js';
import { DrawContext, drawOverlay } from './panels.js';
import { descriptorsOf } from './controls-ui.js';
import { bind as bindText, rich as bindRich, attr as bindAttr } from './prose.js';

const isDev = () => globalThis.UNFOLD_DEV !== false;

/**
 * Every engine knob, once. A page adds its own defaults with `spec.defaults`
 * (drawing resolutions, sample counts — the constants a page's own draw code
 * reads); both sets are frozen into `options` and both are compared by
 * assertNoDrift().
 */
export const DEFAULTS = Object.freeze({
  /** viewport fit */
  pad: Object.freeze({ top: 24, right: 24, bottom: 24, left: 24 }),
  offset: Object.freeze([0, 0]),
  minSize: Object.freeze([80, 80]),
  radius: Object.freeze({ min: 12, max: Infinity }),
  extent: 1,
  /** the selection ring: dot, ring radius, halo width, ink width */
  ring: Object.freeze({ r: 4, outer: 10, halo: 5, ink: 2 }),
  /** picking */
  pickThreshold: 24,
  keyStep: 0.01,
  /** the correspondence overlay */
  connector: Object.freeze({
    selected: 0.9, dimmed: 0.12, live: 0.38, quiet: 0.2,
    width: 1.25, selectedWidth: 2.5,
    horizontal: 0.45, vertical: 0.4, dash: '3 3',
  }),
  /** the transport */
  duration: 7000,
});

const PLAIN = v => v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

/** DEFAULTS ⊕ page defaults ⊕ instance options, one level deep, frozen. */
function resolveOptions(...layers) {
  const out = {};
  for (const layer of layers) {
    for (const [k, v] of Object.entries(layer ?? {})) {
      out[k] = PLAIN(v) && PLAIN(out[k]) ? Object.freeze({ ...out[k], ...v }) : (PLAIN(v) ? Object.freeze({ ...v }) : v);
    }
  }
  return Object.freeze(out);
}

// ------------------------------------------------------------- the registry --

/**
 * One of each, for the document. Instances subscribe; a hidden one is
 * unsubscribed rather than guarded.
 */
const registry = {
  instances: new Set(),
  observer: null,
  observed: new WeakMap(),
  scheme: null,
  animator: null,

  animate() {
    if (!this.animator) this.animator = new Animator();
    return this.animator;
  },

  /** The page's frame scheduler, handed to every store. */
  schedule(run) {
    if (typeof requestAnimationFrame !== 'function') { run(0); return null; }
    const id = requestAnimationFrame(run);
    return () => cancelAnimationFrame(id);
  },

  add(instance) {
    this.instances.add(instance);
    if (!this.observer && typeof ResizeObserver === 'function') {
      // Measured and redrawn inside the callback, not on the next frame: the
      // observer runs after layout and before paint, so the drawing and its
      // box change together. Deferring by a frame paints one stale, stretched
      // frame on every resize step.
      this.observer = new ResizeObserver(entries => {
        const hit = new Set();
        for (const e of entries) {
          const owner = this.observed.get(e.target);
          if (owner) hit.add(owner);
        }
        for (const inst of hit) inst.resized();
      });
    }
    if (!this.scheme && typeof matchMedia === 'function') {
      this.scheme = matchMedia('(prefers-color-scheme: dark)');
      this.onScheme = () => { for (const i of this.instances) i.invalidate('*'); };
      this.scheme.addEventListener('change', this.onScheme);
    }
  },

  watch(el, instance) {
    if (!this.observer || !el) return;
    this.observed.set(el, instance);
    this.observer.observe(el);
  },

  unwatch(el) {
    if (!this.observer || !el) return;
    this.observed.delete(el);
    this.observer.unobserve(el);
  },

  remove(instance) {
    this.instances.delete(instance);
    if (!this.instances.size) {
      this.observer?.disconnect();
      this.observer = null;
      if (this.scheme && this.onScheme) this.scheme.removeEventListener('change', this.onScheme);
      this.scheme = null;
      this.animator?.dispose();
      this.animator = null;
    }
  },
};

/** Mounted instances, in mount order: `window.__uf` in dev, and the drift check. */
export const instances = [];

// --------------------------------------------------------------- explorable --

/**
 * @param {object} spec
 * @param {string} spec.id                    unique on the page; the id prefix
 * @param {string} [spec.kind]                groups instances for the drift check
 * @param {string[]} [spec.variesBy]          options this instance may differ in
 * @param {Element|string} [spec.mount]
 * @param {object} spec.state                 the whole state, declared
 * @param {Record<string,[string[], Function]>} [spec.derive]
 * @param {Record<string,Function>} [spec.on]       key → (state, prev) => patch
 * @param {Array<{sel:string, needs?:string[], text?:Function, rich?:Function,
 *                attr?:string, value?:Function}>} [spec.bindings]
 *   bindings into markup the page wrote itself
 * @param {object} [spec.defaults]            page-level option defaults
 * @param {object} [spec.options]             this instance's overrides
 * @param {Array} [spec.body]                 blocks, in document order
 * @param {object} [spec.layout]              panels.stage(...) | panels.custom(...)
 * @param {Array} spec.panels
 * @param {object} [spec.overlay]             panels.linked(...)
 * @param {Record<string,Function>} [spec.visible]   data-part group → predicate
 * @param {string} [spec.selection='selected']       the state key a pick writes
 * @param {(reason:string, app:object) => void} [spec.onRefuse]
 * @returns {object} the handle; call mount()
 */
export function explorable(spec) {
  if (!spec || typeof spec !== 'object') throw new TypeError('explorable: pass a spec object');
  const { id } = spec;
  if (typeof id !== 'string' || !/^[A-Za-z][\w-]*$/.test(id))
    throw new TypeError(`explorable: id must be a name (letters, digits, _ or -), got ${JSON.stringify(id)}`);
  if (!spec.state || typeof spec.state !== 'object')
    throw new TypeError(`explorable("${id}"): state is required — name every key, even the ones that start null`);
  if (!Array.isArray(spec.panels) || !spec.panels.length)
    throw new TypeError(`explorable("${id}"): panels is required`);

  const options = resolveOptions(DEFAULTS, spec.defaults, spec.options);
  const variesBy = new Set(spec.variesBy ?? []);
  const panelSpecs = new Map(spec.panels.map(p => [p.id, p]));
  const selectionKey = spec.selection ?? 'selected';

  // Resolved before any DOM exists, so a typo in `needs`, `on` or `at` throws
  // at the page's first line rather than on the frame that first needed it.
  const known = k => k in spec.state || (spec.derive && k in spec.derive);
  for (const [key, cascade] of Object.entries(spec.on ?? {})) {
    if (typeof cascade !== 'function')
      throw new TypeError(`explorable("${id}"): on.${key} must be (state, prev) => patch|null`);
    if (!known(key)) throw new Error(`explorable("${id}"): on.${key} names a key that is not in state`);
  }
  for (const p of spec.panels) {
    if (typeof p.draw !== 'function') throw new TypeError(`explorable("${id}"): panel "${p.id}" has no draw(d, s)`);
    if (p.needs !== undefined && !Array.isArray(p.needs))
      throw new TypeError(`explorable("${id}"): panel "${p.id}".needs must be an array of state keys`);
    for (const k of p.needs ?? [])
      if (!(k in spec.state) && !(spec.derive && k in spec.derive))
        throw new Error(`explorable("${id}"): panel "${p.id}" needs "${k}", which is not a state key`);
  }

  const handle = {
    id, kind: spec.kind ?? id, options, spec, variesBy,
    mounted: false,
    mount(target) { return mount(handle, spec, target); },
  };
  return handle;
}

function mount(handle, spec, target) {
  if (handle.mounted) throw new Error(`explorable("${handle.id}"): already mounted`);
  const root = typeof (target ?? spec.mount) === 'string'
    ? document.querySelector(target ?? spec.mount)
    : (target ?? spec.mount);
  if (!root) throw new Error(`explorable("${handle.id}"): nothing to mount into (${String(target ?? spec.mount)})`);

  const doc = root.ownerDocument;
  const options = handle.options;
  const selectionKey = spec.selection ?? 'selected';
  const id = handle.id;
  const genId = name => `${id}-${name}`;

  root.setAttribute('data-explorable', id);

  // -- state ---------------------------------------------------------------
  const store = createStore(spec.state, { name: id, schedule: run => registry.schedule(run) });
  for (const [key, entry] of Object.entries(spec.derive ?? {})) {
    const [deps, fn] = entry;
    store.derive(key, deps, fn);
  }

  const bindings = [];        // prose bindings, in document order
  const controlSpecs = {};
  const actions = new Map();
  const panels = new Map();
  let overlayNode = null, stageNode = null;
  let timeline = null, playButton = null, playLabels = null;

  const ctx = { doc, id: genId, state: store.get(), options, root, panels: new Map(spec.panels.map(p => [p.id, p])) };

  // -- DOM -----------------------------------------------------------------
  // Built into a list first and appended once, because a `custom` layout
  // ADOPTS markup the page already wrote: appending the rest around it would
  // put every block after it whatever the body says. Appending a node that is
  // already a child moves it, so one append puts the whole body in spec order
  // and leaves anything the shell wrote outside the body (the section heading)
  // where it was.
  const blocks = spec.body ?? [spec.layout];
  const ordered = [];
  for (const block of blocks) {
    if (!block) continue;
    if (block.kind === 'stage' || block.kind === 'custom') {
      const built = block.build(ctx);
      stageNode = built.stage;
      overlayNode = built.overlay;
      if (built.root.parentElement === root || !built.adopted) ordered.push(built.root);
      for (const [pid, mountPoint] of built.mounts) panels.set(pid, { id: pid, spec: ctx.panels.get(pid), ...mountPoint });
      for (const [cid, node] of built.labels ?? []) {
        const label = block.labelFor?.(cid);
        if (label?.compute) bindings.push(bindingFor(node, label.compute, label.needs, 'rich'));
      }
      continue;
    }
    const node = block.build(ctx);
    for (const n of Array.isArray(node) ? node : [node]) ordered.push(n);
    if (block.bind) bindings.push(...block.bind(Array.isArray(node) ? node[0] : node, ctx));
  }
  root.append(...ordered);
  if (!panels.size) throw new Error(`explorable("${id}"): the layout mounted no panels`);

  // Bindings into markup the page wrote itself — the round-trip diagram's
  // `data-side` and its four arrow glyphs. Resolved here, so a selector that
  // matches nothing throws at mount rather than writing into the void.
  for (const b of spec.bindings ?? []) {
    const node = root.querySelector(b.sel) ?? doc.querySelector(b.sel);
    if (!node) throw new Error(`explorable("${id}"): binding selector "${b.sel}" matches nothing`);
    if (b.attr) bindings.push(bindAttr(node, b.attr, b.value ?? b.text, { needs: b.needs }));
    else if (b.rich) bindings.push(bindRich(node, b.rich, { needs: b.needs, hide: b.hide ?? false }));
    else if (b.text) bindings.push(bindText(node, b.text, { needs: b.needs, hide: b.hide ?? false }));
    else throw new TypeError(`explorable("${id}"): binding "${b.sel}" needs text, rich or attr`);
  }

  // Control specs for the one binder, and the actions the page asked for.
  for (const d of descriptorsOf(blocks.filter(b => b && b.build && b.kind !== 'stage' && b.kind !== 'custom'))) {
    if (d.key && d.spec) controlSpecs[d.key] = d.spec;
    if (d.action) actions.set(d.action, d);
  }

  // -- panels --------------------------------------------------------------
  for (const [pid, panel] of panels) {
    const p = panel.spec;
    const viewport = new Viewport(panel.drawing, {
      pad: options.pad, offset: options.offset, minSize: options.minSize,
      radius: options.radius, extent: options.extent, observe: false,
    });
    const defs = (name, factory) => scene.defs(`${id}-${pid}-${name}`, () => factory(doc));
    const draw = new DrawContext({ panel: p, options, defs });
    const scene = new SvgScene(panel.drawing, {
      viewport, store, layers: ['marks'],
      kindToLayer: { face: 'marks', edge: 'marks', polyline: 'marks', curve: 'marks', arrow: 'marks',
        point: 'marks', region: 'marks', text: 'marks', raw: 'marks' },
    });
    const timeOf = state => (p.at === 'live' ? state[spec.time ?? 't']
      : typeof p.at === 'function' ? p.at(state) : (p.at ?? 0));
    scene.add({
      id: 'panel',
      vertices(sceneCtx) {
        draw.begin(sceneCtx, timeOf(sceneCtx.state));
        p.draw(draw, sceneCtx.state);
        return draw.vertices;
      },
      primitives() { return draw.primitives; },
      style(prim) { return prim.style ?? {}; },
      probe() { return draw.probeData ?? undefined; },
    });
    Object.assign(panel, {
      viewport, scene, draw, timeOf,
      needs: needsOf(p, spec),
      redraws: 0, lastMs: 0, picker: null, title: panel.title,
    });
    if (typeof p.title === 'function' && panel.title)
      bindings.push(bindingFor(panel.title, p.title, p.titleNeeds ?? p.needs, 'text'));
    else if (typeof p.title === 'string' && panel.title && panel.title.textContent !== p.title)
      panel.title.textContent = p.title;
  }

  // -- the frame -----------------------------------------------------------
  const app = {
    id, kind: handle.kind, options, root, store,
    get state() { return store.get(); },
    get(key) { return store.get(key); },
    set(key, value) { return store.set(key, value); },
    patch(obj) { return store.set(obj); },
    on(evt, fn) { return evt === 'change' ? store.subscribe((s, changed) => fn(s, changed)) : () => {}; },
    invalidate(...levels) { for (const l of levels.length ? levels : ['all']) frame.request(l === '*' ? 'all' : l); },
    panel(pid) { return panels.get(pid); },
    panels,
    flush() { store.flush(); },
    probe() { return probe.snapshot(); },
    destroy,
    get timeline() { return timeline; },
    get bindings() { return bindings; },
  };

  const probe = createProbe(root, { id });

  const frame = store.frame(info => render(info), { levels: ['all', 'geometry', 'chrome'] });

  // The promise at the top of this file, in three lines: ANY write schedules
  // one frame for this instance, at the narrowest level, and the render pass
  // decides from `keys` which panels and which bindings move. A control write,
  // a pick, a frame of playback, a cascade and a page calling app.set() are all
  // just writes — so none of them names a draw function, and none of them can
  // forget to. `movedTogether` is this batch's changed set, which the cascades
  // below read; this subscription is registered first, so they all see it.
  let movedTogether = null;
  const subscriptions = [store.subscribe((_state, changed) => {
    movedTogether = changed;
    frame.request('chrome');
  })];

  function render({ levels, keys }) {
    const everything = levels.has('all') || levels.has('geometry');
    let moved = false;
    for (const panel of panels.values()) {
      if (!(everything || hits(panel.needs, keys))) continue;
      const stats = panel.scene.draw({ levels: new Set(['all']) });
      if (stats.skipped) continue;
      panel.redraws++;
      panel.lastMs = stats.ms;
      panel.marks = stats.marks;
      panel.picker?.invalidate();
      moved = true;
    }
    // `strict` bindings run only when one of their keys actually moved: a
    // <details> that closes when the example changes must not close because
    // the window was resized or the colour scheme flipped.
    for (const b of bindings) if (b.strict ? hits(b.needs, keys) : (everything || hits(b.needs, keys))) b.run(store.get());
    if (overlayNode && spec.overlay) drawTheOverlay(moved || everything || hits(overlayNeeds, keys));
    publish();
  }

  const overlayNeeds = spec.overlay
    ? new Set([selectionKey, ...(spec.overlay.needs ?? []), ...(spec.overlay.toggle ? [spec.overlay.toggle] : [])])
    : null;

  function drawTheOverlay(dirty) {
    const state = store.get();
    const shown = spec.overlay.toggle ? !!state[spec.overlay.toggle] : true;
    // toggleAttribute, not `.hidden`: the overlay is an <svg>, and `hidden` is
    // an HTML IDL attribute. Assigning it on an SVGElement sets a plain JS
    // property that reflects nothing — so the read-back guard passes, the
    // element stays display:none, and the drawing is invisible with no error
    // anywhere. Attributes are the only thing both element types agree on.
    if (overlayNode.hasAttribute('hidden') === shown) overlayNode.toggleAttribute('hidden', !shown);
    if (!shown) { overlayNode.replaceChildren(); return; }
    if (!dirty) return;
    drawOverlay({
      spec: spec.overlay, node: overlayNode, stage: stageNode, state, panels, options,
      selected: state[selectionKey],
      evaluate: (input, pid) => {
        const panel = panels.get(pid);
        if (!panel) return null;
        return panel.spec.place
          ? panel.spec.place(input, state, panel.timeOf(state))
          : null;
      },
    });
  }

  function publish() {
    if (!probe.enabled) return;
    probe.reset();
    probe.set('state', () => store.snapshot());
    probe.set('panels', () => {
      const out = {};
      for (const [pid, panel] of panels) {
        const f = panel.viewport.frame;
        out[pid] = {
          at: typeof panel.spec.at === 'function' ? 'derived' : (panel.spec.at ?? 0),
          live: panel.viewport.live,
          w: f.w, h: f.h, r: f.r, cx: f.cx, cy: f.cy,
          marks: panel.marks ?? {}, redraws: panel.redraws,
          ...(panel.scene.lastFrame?.warnings?.length ? { warnings: panel.scene.lastFrame.warnings } : {}),
        };
      }
      return out;
    });
    probe.set('prose', () => {
      const out = {};
      for (const b of bindings) if (b.name) out[b.name] = b.el.hidden ? null : b.el.textContent;
      return out;
    });
    probe.commit();
  }

  // -- controls ------------------------------------------------------------
  const controls = bindControls(root, store, controlSpecs, {
    frame,
    onChange(key, value, prev) {
      if (timeline && key === (spec.time ?? 't') && !applyingFrame) {
        // Scrubbing pauses first, always: the parameter the user is dragging
        // and the one the loop is advancing cannot both be in charge. This
        // belongs to the INPUT, not to the state change — a `t` the loop
        // wrote must not pause the loop — which is why it is here and the
        // cascades below are not.
        timeline.pause();
        timeline.seek(value);
      }
      spec.onChange?.(key, value, prev, app);
    },
  });
  if (spec.visible) controls.visibility(spec.visible);

  // -- cascades ------------------------------------------------------------
  // "Choosing a target resets the time and the selection"; "anything the
  // reader does clears the refusal notice". Subscribed to the STORE, not to
  // the control binder: `selected` is written by a pick and `t` by the
  // animation loop, neither of which is a control, and a rule that fired for
  // one writer and not the others is the shape of every stale-notice bug in
  // the page this replaces. The store settles the cascade before the frame
  // renders, and shouts rather than looping if a rule feeds itself.
  for (const [key, cascade] of Object.entries(spec.on ?? {})) {
    subscriptions.push(store.on(key, (_value, prev) => {
      const patch = cascade(store.get(), prev);
      if (!patch) return;
      // A cascade fills in CONSEQUENCES; it does not overrule something the
      // same batch also said. "Choosing a target resets the time" must not
      // undo a time the reader set in the same breath — and since writes in a
      // frame coalesce, the rule cannot be "last one wins" without making the
      // result depend on which event the browser delivered first.
      const out = {};
      for (const [k, v] of Object.entries(patch)) if (k === key || !movedTogether?.has(k)) out[k] = v;
      if (Object.keys(out).length) store.set(out);
    }));
  }

  // Action buttons: play, clear, and whatever else the page named.
  let applyingFrame = false;
  const offs = [];
  for (const [action, descriptor] of actions) {
    const node = root.querySelector(`[data-action="${action}"]`);
    if (!node) continue;
    if (action === 'play') {
      playButton = node;
      playLabels = { play: '▶ Play', pause: 'Ⅱ Pause', replay: '↻ Replay', ...(descriptor.labels ?? {}) };
      const key = descriptor.key ?? spec.time ?? 't';
      timeline = registry.animate().loop({
        duration: descriptor.duration ?? options.duration,
        reducedMotion: 'manual',
        onFrame: t => { applyingFrame = true; try { store.set(key, t); } finally { applyingFrame = false; } },
      });
      timeline.pause();
      timeline.seek(store.get(key));
      offs.push(timeline.on('play', writePlayLabel), timeline.on('pause', writePlayLabel), timeline.on('done', writePlayLabel));
      offs.push(on(node, 'click', () => {
        if (timeline.playing) { timeline.pause(); return; }
        if (store.get(key) >= 1) timeline.seek(0);
        // The reduced-motion policy, applied where the user asked for motion
        // rather than at construction: the end state is still the news, so it
        // is applied — leaving the homotopy half-run would be worse than not
        // animating it.
        if (prefersReducedMotion()) { timeline.seek(1); writePlayLabel(); return; }
        timeline.play();
      }));
      bindings.push({
        el: node, needs: new Set([key]), name: null, writes: 0,
        run: () => writePlayLabel(),
      });
    } else if (action === 'clear') {
      offs.push(on(node, 'click', () => store.set(selectionKey, null)));
      bindings.push({
        el: node, needs: new Set([selectionKey]), name: null, writes: 0,
        run(state) { const hidden = !state[selectionKey]; if (node.hidden !== hidden) node.hidden = hidden; return true; },
      });
    } else if (spec.actions?.[action]) {
      offs.push(on(node, 'click', ev => spec.actions[action](app, ev)));
    }
  }

  function writePlayLabel() {
    if (!playButton) return false;
    const key = spec.time ?? 't';
    const label = timeline.playing ? playLabels.pause
      : (store.get(key) >= 1 ? playLabels.replay : playLabels.play);
    const glyph = label.slice(0, label.indexOf(' '));
    const rest = label.slice(label.indexOf(' '));
    const span = playButton.firstElementChild;
    let wrote = false;
    if (span && span.textContent !== glyph) { span.textContent = glyph; wrote = true; }
    const text = [...playButton.childNodes].find(n => n.nodeType === 3);
    if (text && text.data !== rest) { text.data = rest; wrote = true; }
    return wrote;
  }

  // -- picking and the keyboard --------------------------------------------
  for (const [pid, panel] of panels) {
    const p = panel.spec;
    if (p.pick) {
      panel.picker = makePicker(panel, p, store, options, spec);
      let drag = null;
      offs.push(on(panel.drawing, 'pointerdown', ev => {
        if (ev.button !== 0) return;
        const point = panel.viewport.screenFromEvent(ev);
        if (!point) return;
        panel.picker.setContext({ state: store.get(), panel: pid, t: panel.timeOf(store.get()) });
        const hit = panel.picker.pick(point, { dragging: false });
        if (!hit) return;
        if (hit.refused) { spec.onRefuse?.(hit.reason, app); return; }
        store.set(selectionKey, hit.input);
        drag = ev.pointerId;
        panel.drawing.setPointerCapture(ev.pointerId);
        ev.preventDefault();
      }));
      offs.push(on(panel.drawing, 'pointermove', ev => {
        if (drag !== ev.pointerId) return;
        const point = panel.viewport.screenFromEvent(ev);
        if (!point) return;
        panel.picker.setContext({ state: store.get(), panel: pid, t: panel.timeOf(store.get()) });
        const hit = panel.picker.pick(point, { dragging: true });
        if (hit && !hit.refused) store.set(selectionKey, hit.input);
      }));
      for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'])
        offs.push(on(panel.drawing, name, () => { drag = null; }));
    }
    if (p.keyboard) {
      offs.push(on(panel.drawing, 'keydown', ev => {
        if (ev.key === 'Escape') { store.set(selectionKey, null); return; }
        const move = ARROWS[ev.key];
        if (!move) return;
        ev.preventDefault();
        const state = store.get();
        const domain = p.keyboard.domain(state, pid);
        if (!domain) return;
        const current = state[selectionKey] ?? (typeof p.keyboard.start === 'function' ? p.keyboard.start(state) : p.keyboard.start);
        if (!current) return;
        const [axisWanted, sign] = move;
        const axis = axisWanted === 1 && domain.dim >= 2 ? 1 : 0;
        if (!domain.axes.length) { store.set(selectionKey, { ...current }); return; }
        store.set(selectionKey, domain.step(current, axis, sign * options.keyStep));
      }));
    }
  }

  // -- resize --------------------------------------------------------------
  const instance = {
    app,
    resized() {
      // Inside the observer's callback: measure and draw now, in the frame
      // whose layout just changed.
      for (const panel of panels.values()) panel.picker?.invalidate();
      frame.request('geometry');
      store.flush();
    },
    invalidate(level) { frame.request(level === '*' ? 'all' : level); },
    handle,
  };
  registry.add(instance);
  for (const panel of panels.values()) registry.watch(panel.drawing, instance);
  if (stageNode) registry.watch(stageNode, instance);

  // -- first draw ----------------------------------------------------------
  frame.request('all');
  store.flush();

  function destroy() {
    for (const off of offs) off();
    for (const off of subscriptions) off();
    offs.length = 0;
    subscriptions.length = 0;
    for (const panel of panels.values()) {
      registry.unwatch(panel.drawing);
      panel.scene.dispose();
      panel.viewport.dispose();
    }
    if (stageNode) registry.unwatch(stageNode);
    timeline?.dispose();
    controls.dispose();
    probe.dispose();
    store.dispose();
    registry.remove(instance);
    const i = instances.indexOf(app);
    if (i >= 0) instances.splice(i, 1);
    handle.mounted = false;
    root.removeAttribute('data-explorable');
  }

  handle.mounted = true;
  handle.app = app;
  app.handle = handle;
  instances.push(app);
  return app;
}

const ARROWS = {
  ArrowLeft: [0, -1], ArrowRight: [0, 1],
  ArrowDown: [1, -1], ArrowUp: [1, 1],
};

const hits = (needs, keys) => {
  if (!needs) return true;
  if (!keys) return false;
  for (const k of needs) if (keys.has(k)) return true;
  return false;
};

function needsOf(panel, spec) {
  if (!panel.needs && panel.at !== 'live') return null;      // undeclared: every frame
  const set = new Set(panel.needs ?? []);
  if (panel.at === 'live') set.add(spec.time ?? 't');
  return set;
}

/** A prose binding built from a page's `label`/`title` function. */
function bindingFor(el, compute, needs, kind) {
  const set = needs ? new Set(needs) : null;
  let last = null;
  return {
    el, needs: set, name: null, writes: 0,
    run(state) {
      const value = compute(state);
      const next = value == null ? '' : (typeof value === 'object' && 'html' in value ? value.html : String(value));
      if (last === next) return false;
      last = next;
      if (kind === 'rich') el.innerHTML = next;
      else if (el.textContent !== next) el.textContent = next;
      this.writes++;
      return true;
    },
  };
}

function makePicker(panel, p, store, options, spec) {
  // Imported lazily through the spec so Layer 4 does not depend on Layer 2's
  // module graph when a page picks by hand.
  const { createPicker } = p.pick;
  if (typeof createPicker !== 'function')
    throw new TypeError(`panel "${p.id}": pick needs { createPicker } (from geom/map.js) plus its own hooks`);
  const frameOf = () => panel.viewport.frame;
  return createPicker({
    toScreen: point => frameOf().toScreen(point),
    fromScreen: point => frameOf().fromScreen(point),
    evaluate: (input, context) => p.pick.evaluate(input, context.state, context.t),
    candidates: context => p.pick.candidates(context.state, context.t),
    analytic: p.pick.analytic ? (point, context) => p.pick.analytic(point, context.state, context.t) : undefined,
    policy: p.pick.policy ? context => p.pick.policy(context.state, context.t) : undefined,
    threshold: p.pick.threshold ?? options.pickThreshold,
  });
}

// ------------------------------------------------------------------ mounting --

/**
 * Mount several instances in order, then check them against each other.
 * @param {object[]} handles  explorable(spec) handles, or [handle, target] pairs
 */
export function mountAll(list) {
  const mounted = list.map(entry => (Array.isArray(entry) ? entry[0].mount(entry[1]) : entry.mount()));
  if (isDev()) {
    for (const line of assertNoDrift()) console.warn(`unfold: ${line}`);
    if (typeof globalThis !== 'undefined') globalThis.__uf = new Map(instances.map(a => [a.id, a]));
  }
  return mounted;
}

/**
 * Every option two instances of the same kind disagree about, that neither
 * declared in `variesBy`.
 *
 * This is the drift detector. Run against the shipped homotopy page's two
 * widgets it names every constant that diverged — the viewport floors, the
 * padding, the radius clamp, the ring radii, the pick threshold, the mesh
 * resolution, the connector opacities and widths — none of which is documented
 * or obviously intentional. After a port they are either equal or declared,
 * and a new divergence shows up the moment it is introduced.
 *
 * @returns {string[]} one line per divergence; empty when clean
 */
export function assertNoDrift() {
  const out = [];
  const byKind = new Map();
  for (const app of instances) {
    if (!byKind.has(app.kind)) byKind.set(app.kind, []);
    byKind.get(app.kind).push(app);
  }
  for (const [kind, group] of byKind) {
    if (group.length < 2) continue;
    const [first, ...rest] = group;
    for (const other of rest) {
      const keys = new Set([...Object.keys(first.options), ...Object.keys(other.options)]);
      for (const key of keys) {
        const a = first.options[key], b = other.options[key];
        if (same(a, b)) continue;
        if (first.handle.variesBy.has(key) || other.handle.variesBy.has(key)) continue;
        out.push(`${kind}: "${first.id}" and "${other.id}" disagree about options.${key} ` +
          `(${JSON.stringify(a)} vs ${JSON.stringify(b)}) — make them equal, or name it in variesBy`);
      }
    }
  }
  return out;
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
