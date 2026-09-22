#!/usr/bin/env node
// The homotopy port's parity tool: the frozen original against the engine
// port, every homotopy state, pixel for pixel and mark for mark, and the
// interactions the state list cannot reach.
//
//   node tools/port-parity.mjs                  legacy vs port: every homotopy state, 3 widths, both schemes
//   node tools/port-parity.mjs --only types/    states whose id contains the string
//   node tools/port-parity.mjs --no-png         semantic + interaction only (fast)
//   node tools/port-parity.mjs --no-interact    skip the interaction scenarios
//   node tools/port-parity.mjs --sweep          add breakpoint-adjacent widths for a representative subset
//   node tools/port-parity.mjs --a <page> --b <page>
//                                               compare any two pages (default:
//                                               tests/fixtures/legacy-homotopy.html vs homotopy-explorer.html)
//   node tools/port-parity.mjs --jobs <n>       page pairs driven in parallel (default: twice the CPUs, at most 4)
//   node tools/port-parity.mjs --all            print every difference (default: the first 25 per group)
//
// Page A is "legacy" and page B is "port" in the report, whatever they are.
// Both are driven by the same steps (tools/states.mjs), each selector resolved
// against the page itself and, only when it matches nothing there, through
// tools/lib/port-map.mjs. Then, per state:
//
//  1. PIXELS. A full-page screenshot of each page at 1280×900, 820×1000 and
//     390×844, light and dark, compared with comparePNG(…, 0, {metric:'max'}):
//     any change in any channel of any pixel is a difference. Before anything
//     is compared the comparator has to see a one-level change in one channel.
//  2. SEMANTICS (desktop, light). CAPTURE (tools/lib/capture.mjs) with
//     {dp: 4}, beside EXTRA below, normalised by exactly these rules and then
//     compared field by field:
//       - ids and generated ids are not compared; drawings are named by the
//         port map (legacy id or data-explorable/data-panel), controls by
//         their legacy selector;
//       - data-k, data-layer, data-mark, data-parts, data-probe*, data-panel,
//         data-explorable, data-control, data-value and data-uf are dropped;
//       - <g> wrappers: marks are listed flat (as CAPTURE lists them); a
//         wrapper's opacity is folded into its marks' opacity, its transform
//         into theirs, and a mark a wrapper hides (display:none) is not drawn;
//       - <polygon points>, <polyline points>, <line> and a <path d> of one
//         subpath of straight segments all become one vertex list plus a
//         closed flag; any other path is parsed to absolute commands (H/V → L,
//         S/T expanded, implicit repeats made explicit); a mark that has no
//         area (at most two vertices) drops its fill, which cannot paint;
//       - numbers in geometry, paint and viewBox compare within 1e-3; text,
//         prose and control values compare exactly;
//       - <defs>/<pattern>: marks inside definitions are not in the mark list;
//         a url(#id) paint is replaced by the index of the definition it
//         names, and each drawing's referenced definitions are compared by
//         content (attributes and resolved children), wherever they live.
//     Everything else must match: per drawing the viewBox, size, bbox and the
//     ordered marks (tag, geometry, computed paint, text, data-*); the prose
//     (tag + text, in order), the <details> open state and the links; the
//     controls (type, value, disabled; visibility of every mapped control;
//     each select's options); the title. role, aria-*, tabindex, label/output
//     `for` (resolved to what they point at) and CAPTURE's a11y counts are
//     reported separately, as kind 'a11y' — its heading list compared as
//     levels, because the headings' text is in the prose. A drawing that
//     differs in more than 40 marks lists 40 and counts the rest by field:
//     what a re-cut mesh says is its count, which 'marks.length' reports.
//  3. INTERACTION (desktop; light, and both schemes for hover and focus;
//     --no-interact skips). Per configuration
//     (every example of both widgets, both sides, the four disk targets, three
//     winding pairs): the keyboard on the source drawing, a 5×5 grid of
//     presses in every drawing, a drag, the connectors toggle, play/pause and
//     the slider — the semantic capture compared after every step — then hover
//     and Tab focus over every control, compared as pixels of that control.
//     A difference already present before the scenario began is the state's,
//     reported once by channel 2; the interaction channel reports what the
//     interaction introduced.
//
// Every difference goes through tools/port-parity.allow.mjs. The run exits 0
// only when every difference is absorbed by an allowance, no exercised
// allowance absorbed nothing, and the harness had no errors; 1 otherwise; 2
// when a self-check fails and the tool refuses to report. The full report,
// every field of every difference, is written to
// baseline/diff/port-parity/report.json, with a diff PNG per pixel difference.

import { chromium } from 'playwright';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve, CHROMIUM } from './lib/serve.mjs';
import { CAPTURE } from './lib/capture.mjs';
import { comparePNG, DETERMINISTIC_ARGS } from './lib/imagediff.mjs';
import { locate, PORT_MAP_DATA, DRAWING_SELECTORS } from './lib/port-map.mjs';
import { STATES, WIDTHS, THEMES } from './states.mjs';
import ALLOWANCES from './port-parity.allow.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'baseline', 'diff', 'port-parity');
const T0 = Date.now();

// ------------------------------------------------------------------ CLI ----
const OPTIONS = { '--only': 1, '--a': 1, '--b': 1, '--jobs': 1,
                  '--no-png': 0, '--no-interact': 0, '--sweep': 0, '--all': 0, '--help': 0 };
const opts = {};
{
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!(a in OPTIONS)) { console.error(`port-parity: unknown option ${a} (see the header of tools/port-parity.mjs)`); process.exit(2); }
    if (OPTIONS[a]) {
      if (argv[i + 1] === undefined) { console.error(`port-parity: ${a} needs a value`); process.exit(2); }
      opts[a] = argv[++i];
    } else opts[a] = true;
  }
}
if (opts['--help']) {
  console.log((await import('node:fs')).readFileSync(fileURLToPath(import.meta.url), 'utf8')
    .split('\n').slice(1, 16).map(l => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(0);
}
const ONLY = opts['--only'] ?? null;
const NO_PNG = !!opts['--no-png'];
const NO_INTERACT = !!opts['--no-interact'];
const SWEEP = !!opts['--sweep'];
const PRINT_ALL = !!opts['--all'];
const PAGE_A = opts['--a'] ?? 'tests/fixtures/legacy-homotopy.html';
const PAGE_B = opts['--b'] ?? 'homotopy-explorer.html';
// The browser is the bottleneck — on two CPUs it is already saturated by two
// workers — but a worker also waits on animation frames and round trips, so a
// few more than there are CPUs still help a little (measured on one subset:
// 62 s with 2, 48 s with 4, 50 s with 7).
const JOBS = Math.max(1, Math.min(8, Number(opts['--jobs'] ?? Math.min(4, 2 * availableParallelism()))));
for (const p of [PAGE_A, PAGE_B]) {
  if (!existsSync(join(ROOT, p))) { console.error(`port-parity: no such page ${p} (paths are relative to the repository root)`); process.exit(2); }
}

// --------------------------------------------------------------- states ----
const HOMOTOPY_STATES = STATES.filter(s => s.id.startsWith('homotopy/'));
// Tool-defined states: combinations the state list does not reach but a reader
// does. The homotopy overlay's selection rings are drawn only when the overlay
// is on AND something is selected; overlay/connections has no selection.
const TOOL_STATES = [
  { id: 'homotopy/extra/winding-connections', page: 'homotopy-explorer.html', tier: 'full', steps: [
    ['select', '#category', 'obstructions'], ['select', '#example', 'winding'],
    ['range', '#time', '0.5'], ['click', '#connect']] },
];
const byId = new Map([...HOMOTOPY_STATES, ...TOOL_STATES].map(s => [s.id, s]));
const pick = s => !ONLY || s.id.includes(ONLY);
const STATE_LIST = [...HOMOTOPY_STATES, ...TOOL_STATES].filter(pick);
if (!STATE_LIST.length) { console.error(`port-parity: no homotopy state matches ${ONLY}`); process.exit(2); }

const SCHEMES = THEMES;                           // ['light', 'dark']
const DESKTOP = WIDTHS[0];
// Breakpoint-adjacent widths: the 1080px column (+ padding), the 1100px back
// link, and the 600px and 380px media queries. The height is the baseline's
// for the nearest named width, so the drawings' svh-based heights match it.
const SWEEP_WIDTHS = [1100, 1081, 1079, 700, 601, 600, 599, 381, 380, 379, 360]
  .map(w => ({ name: String(w), width: w, height: w > 820 ? 900 : w > 600 ? 1000 : 844 }));
// At least one state per example kind, both widgets, overlays on.
const SWEEP_IDS = [
  'homotopy/homotopies/segment_circle/t0.5',        // interval source, endpoint labels
  'homotopy/homotopies/point/t0.5',                 // point
  'homotopy/homotopies/disk_any-annulus/t0.5',      // disk source, target select shown
  'homotopy/obstructions/annulus_paths/t0.5',       // annulus, hatch, seam probes, warning
  'homotopy/obstructions/winding/t0.5',             // circle, a selection
  'homotopy/classes/1_to_2/t0.5',                   // class controls
  'homotopy/overlay/connections',                   // homotopy overlay on
  'homotopy/extra/winding-connections',             // homotopy overlay on, with a selection
  'homotopy/types/eq_annulus/x/t0.5',               // equivalence, overlay on (its default)
  'homotopy/types/eq_tail/y/t0.5',                  // the other side, tail
  'homotopy/types/eq_disk_segment/x/t0.5',          // disk / segment projection
];
for (const id of SWEEP_IDS) if (!byId.has(id)) { console.error(`port-parity: sweep state ${id} is not in the state list`); process.exit(2); }

// Interaction configurations: every example of both widgets at t = 0.5,
// both sides of every equivalence, the four disk targets, three winding pairs.
const CONFIG_IDS = [
  ...HOMOTOPY_STATES.filter(s => /^homotopy\/(homotopies|obstructions)\/[^/]+\/t0\.5$/.test(s.id)).map(s => s.id),
  ...['1_to_1', '1_to_2', '0_to_0'].map(p => `homotopy/classes/${p}/t0.5`),
  ...HOMOTOPY_STATES.filter(s => /^homotopy\/types\/[^/]+\/[xy]\/t0\.5$/.test(s.id)).map(s => s.id),
];
for (const id of CONFIG_IDS) if (!byId.has(id)) { console.error(`port-parity: configuration ${id} is not in the state list`); process.exit(2); }
// Hover and focus: the configurations that between them show every control.
const LOOK_IDS = [
  'homotopy/homotopies/segment_circle/t0.5',        // play, t, connect, Why?
  'homotopy/homotopies/disk_any-annulus/t0.5',      // + the target select
  'homotopy/classes/1_to_2/t0.5',                   // + the winding selects, clear
  'homotopy/types/eq_annulus/x/t0.5',               // the second widget's controls
];
const widgetOf = id => (id.startsWith('homotopy/types/') ? 'equivalence' : 'homotopy');

// ----------------------------------------------------------- allowances ----
const KINDS = new Set(['png', 'semantic', 'a11y', 'interaction']);
const MATCH_KEYS = new Set(['state', 'width', 'scheme', 'category', 'drawing', 'mark', 'field',
                            'scenario', 'step', 'legacy', 'port']);
{
  const problems = [];
  if (!Array.isArray(ALLOWANCES)) problems.push('the default export is not an array');
  const seen = new Set();
  for (const [i, a] of (Array.isArray(ALLOWANCES) ? ALLOWANCES : []).entries()) {
    const at = `allowance ${i}${a?.id ? ` (${a.id})` : ''}`;
    if (!a || typeof a !== 'object') { problems.push(`${at} is not an object`); continue; }
    for (const k of Object.keys(a)) if (!['id', 'kind', 'match', 'reason'].includes(k)) problems.push(`${at}: unknown key "${k}"`);
    if (typeof a.id !== 'string' || !a.id) problems.push(`${at}: needs an id`);
    else if (seen.has(a.id)) problems.push(`${at}: duplicate id`); else seen.add(a.id);
    if (!KINDS.has(a.kind)) problems.push(`${at}: kind must be one of ${[...KINDS].join(', ')}`);
    if (typeof a.reason !== 'string' || a.reason.trim().length < 10) problems.push(`${at}: needs a reason`);
    if (!a.match || typeof a.match !== 'object') problems.push(`${at}: needs a match object`);
    else if (!Object.keys(a.match).length) problems.push(`${at}: match must name at least one field — an empty match absorbs every difference of its kind`);
    else for (const [k, v] of Object.entries(a.match)) {
      if (!MATCH_KEYS.has(k)) problems.push(`${at}: unknown match key "${k}" (known: ${[...MATCH_KEYS].join(', ')})`);
      const ok = x => typeof x === 'string' || typeof x === 'number' || x instanceof RegExp;
      if (!(ok(v) || (Array.isArray(v) && v.length && v.every(ok)))) problems.push(`${at}: match.${k} must be a string, number, RegExp or a list of them`);
    }
  }
  if (problems.length) {
    console.error('port-parity: tools/port-parity.allow.mjs is malformed:\n  ' + problems.join('\n  '));
    process.exit(2);
  }
}
const testOne = (value, pat) => {
  if (value === undefined || value === null) return false;
  if (pat instanceof RegExp) { pat.lastIndex = 0; return pat.test(String(value)); }
  if (typeof pat === 'number') return Number(value) === pat;
  return String(value).startsWith(pat);
};
const matchValue = (value, pat) => (Array.isArray(pat) ? pat.some(p => testOne(value, p)) : testOne(value, pat));
const allowanceFor = d => ALLOWANCES.find(a => a.kind === d.kind &&
  Object.entries(a.match).every(([k, pat]) => matchValue(d[k], pat)));

// ------------------------------------------------------ in-page: settle ----
/**
 * Runs in the page. Resolves once the DOM has not changed for `frames`
 * animation frames and `ms` milliseconds and no animation is running. The
 * port redraws on the next animation frame and the original redraws from a
 * ResizeObserver, so a fixed wait is either too short or wasted; watching the
 * mutations is neither.
 */
const SETTLE = ({ frames = 3, ms = 70, timeout = 4000 }) => new Promise(done => {
  const t0 = performance.now();
  let last = t0, count = 0, seen = 0, quiet = 0;
  const mo = new MutationObserver(list => { count += list.length; last = performance.now(); });
  mo.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  const step = () => {
    const now = performance.now();
    const running = document.getAnimations().some(a => a.playState === 'running');
    if (running) last = now;
    if (count === seen && !running) quiet++; else { quiet = 0; seen = count; }
    const finish = ok => { mo.disconnect(); done({ ok, ms: Math.round(now - t0), mutations: count }); };
    if (quiet >= frames && now - last >= ms) return finish(true);
    if (now - t0 > timeout) return finish(false);
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
});

// ------------------------------------------------------- in-page: extra ----
/**
 * Runs in the page right after CAPTURE, on the same DOM: what CAPTURE does not
 * record and the normalisation needs. Its scenes are CAPTURE's, in the same
 * order, and its marks are CAPTURE's marks, index for index. Self-contained.
 */
const EXTRA = (map, cap) => {
  const DRAWN = 'circle,ellipse,rect,line,path,polygon,polyline,text,image,use';
  const DRAWN_TAGS = new Set(DRAWN.split(','));
  const DEFS = new Set(['defs', 'pattern', 'clipPath', 'mask', 'marker', 'symbol',
                        'linearGradient', 'radialGradient', 'filter']);
  // Kept in step with CAPTURE's GEOM, PAINT and PAINT_DEFAULT.
  const GEOM = {
    circle: ['cx', 'cy', 'r'], ellipse: ['cx', 'cy', 'rx', 'ry'], rect: ['x', 'y', 'width', 'height', 'rx', 'ry'],
    line: ['x1', 'y1', 'x2', 'y2'], path: ['d'], polygon: ['points'], polyline: ['points'],
    text: ['x', 'y', 'dx', 'dy', 'text-anchor'], image: ['x', 'y', 'width', 'height'], use: ['x', 'y', 'href'],
  };
  const PAINT = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin',
    'opacity', 'fill-opacity', 'stroke-opacity', 'font-size', 'font-weight', 'paint-order', 'visibility', 'display'];
  const PAINT_DEFAULT = { 'stroke-linecap': 'butt', 'stroke-linejoin': 'miter', 'stroke-width': '1px',
    opacity: '1', 'fill-opacity': '1', 'stroke-opacity': '1', visibility: 'visible', display: 'inline',
    'font-weight': '400', 'paint-order': 'normal', fill: 'rgb(0, 0, 0)' };
  const IGNORED = /^data-(k|layer|mark|parts|probe.*|panel|explorable|control|value|uf)$/;
  const px = s => String(s ?? '').trim().replace(/\s+/g, ' ');
  const text = el => el.textContent.replace(/\s+/g, ' ').trim();
  const visible = el => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    return el.getClientRects().length > 0;
  };
  const q1 = sel => { if (!sel) return null; try { return document.querySelector(sel); } catch { return null; } };
  const resolve = (legacy, port) => q1(legacy) ?? q1(port);

  // Logical names, the same on both pages: a control is its legacy selector,
  // a drawing its widget/panel key.
  const names = new Map(), keys = new Map();
  for (const [legacy, port] of map.controls) { const el = resolve(legacy, port); if (el && !names.has(el)) names.set(el, legacy); }
  for (const [name, legacy, port] of map.widgets) { const el = resolve(legacy, port); if (el && !names.has(el)) names.set(el, `widget:${name}`); }
  for (const d of [...map.drawings, ...map.overlays]) { const el = resolve(d.legacy, d.port); if (el && !keys.has(el)) keys.set(el, d.key); }
  const nameOf = el => names.get(el) ?? (keys.has(el) ? `drawing:${keys.get(el)}` : null);

  const paintOf = el => {
    const cs = getComputedStyle(el), out = {};
    for (const p of PAINT) {
      if (p.startsWith('font') && el.localName !== 'text') continue;
      const v = px(cs.getPropertyValue(p));
      if (!v || v === 'auto' || v === PAINT_DEFAULT[p]) continue;
      if (v === 'none' && p !== 'fill' && p !== 'stroke' && p !== 'stroke-dasharray') continue;
      out[p] = v;
    }
    return out;
  };
  const describeDrawn = el => {
    const m = { tag: el.localName };
    for (const a of GEOM[el.localName] ?? []) if (el.hasAttribute(a)) m[a] = el.getAttribute(a);
    if (el.hasAttribute('transform')) m.transform = el.getAttribute('transform');
    if (el.localName === 'text') m.text = el.textContent;
    const p = paintOf(el);
    if (Object.keys(p).length) m.paint = p;
    return m;
  };
  // A definition by content: its attributes (not its id; not defaults), and
  // its children resolved — a definition it inherits from is followed.
  const DEF_DEFAULT = { x: '0', y: '0', patternContentUnits: 'userSpaceOnUse' };
  const describeDef = (node, depth = 0) => {
    const attrs = {};
    for (const a of node.attributes) {
      if (a.name === 'id' || IGNORED.test(a.name) || DEF_DEFAULT[a.name] === a.value) continue;
      let v = a.value;
      if ((a.name === 'href' || a.name === 'xlink:href') && v.startsWith('#')) {
        const t = document.getElementById(v.slice(1));
        v = t && depth < 4 ? describeDef(t, depth + 1) : `(missing ${v})`;
      }
      attrs[a.name] = v;
    }
    const kids = [...node.children].filter(k => k.localName !== 'title' && k.localName !== 'desc')
      .map(k => (DRAWN_TAGS.has(k.localName) ? describeDrawn(k) : describeDef(k, depth + 1)));
    return { tag: node.localName, attrs, kids };
  };

  const FX = ['clip-path', 'mask', 'filter', 'marker-start', 'marker-mid', 'marker-end'];
  const LINEAR = new Set(['path', 'line', 'polyline', 'polygon']);
  const URL_RE = /url\(\s*["']?#([^"')]+)["']?\s*\)/;
  // Clipping, masks, filters and markers are 'none' unless a rule or an
  // attribute sets one, so when nothing on the page does, they are not read
  // mark by mark (a third of this pass's time on a 4 600-mark page).
  const FX_RE = /(^|[;{\s])(clip-path|mask|filter|marker|marker-start|marker-mid|marker-end)\s*:/;
  const sheetHasFx = sheet => {
    let rules;
    try { rules = sheet.cssRules; } catch { return true; }
    const walk = list => [...list].some(r => (r.cssRules && walk(r.cssRules)) || (r.style && FX_RE.test(r.style.cssText)));
    return walk(rules);
  };
  const FX_ON = [...document.styleSheets, ...(document.adoptedStyleSheets ?? [])].some(sheetHasFx) ||
    !!document.querySelector('[clip-path],[mask],[filter],[marker-start],[marker-mid],[marker-end],' +
      '[style*="clip-path"],[style*="mask"],[style*="filter"],[style*="marker"]');
  const anc = new Map();
  const ancOf = a => {
    let v = anc.get(a);
    if (!v) {
      const cs = getComputedStyle(a), fx = [];
      if (FX_ON) for (const p of ['clip-path', 'mask', 'filter']) { const x = px(cs.getPropertyValue(p)); if (x && x !== 'none') fx.push(`${p}: ${x}`); }
      v = { op: Number(cs.opacity), hide: cs.display === 'none', tf: a.getAttribute('transform'), fx, defs: DEFS.has(a.localName) };
      anc.set(a, v);
    }
    return v;
  };
  const svgs = [...document.querySelectorAll('svg')].filter(visible);
  const scenes = svgs.map((svg, si) => {
    const refs = [], index = new Map();
    const refOf = id => {
      const t = document.getElementById(id), k0 = t ?? `#${id}`;
      if (index.has(k0)) return index.get(k0);
      index.set(k0, refs.length);
      refs.push(t ? describeDef(t) : { missing: id });
      return refs.length - 1;
    };
    const capMarks = cap.scenes[si]?.marks ?? [];
    const marks = [...svg.querySelectorAll(DRAWN)].map((el, i) => {
      const m = {};
      let op = 1, hide = false;
      const tf = [], fx = [];
      for (let a = el.parentElement; a && a !== svg; a = a.parentElement) {
        const v = ancOf(a);
        if (v.defs) m.defs = 1;
        op *= v.op; if (v.hide) hide = true; if (v.tf) tf.unshift(v.tf); fx.push(...v.fx);
      }
      if (m.defs) return m;
      if (hide) m.hidden = 1;
      if (op !== 1) m.gop = op;
      if (tf.length) m.gtf = tf.join(' ');
      if (fx.length) m.gfx = fx.join('; ');
      const paint = capMarks[i]?.paint ?? {};
      for (const p of ['fill', 'stroke']) { const u = URL_RE.exec(paint[p] ?? ''); if (u) (m.ref ??= {})[p] = refOf(u[1]); }
      if (!FX_ON) return m;
      const cs = getComputedStyle(el);
      for (const p of FX) {
        if (p.startsWith('marker') && !LINEAR.has(el.localName)) continue;
        const x = px(cs.getPropertyValue(p));
        if (!x || x === 'none') continue;
        const u = URL_RE.exec(x);
        (m.fx ??= {})[p] = u ? `ref#${refOf(u[1])}` : x;
      }
      return m;
    });
    return { key: keys.get(svg) ?? null, marks, refs };
  });

  const controlNames = [...document.querySelectorAll('select,input,button[aria-pressed]')].filter(visible)
    .map(el => nameOf(el) ?? `${el.localName}${el.type ? `[${el.type}]` : ''}`);
  const controls = map.controls.map(([legacy, port]) => {
    const el = resolve(legacy, port);
    const o = { name: legacy, visible: !!el && visible(el) };
    if (o.visible && el.localName === 'select')
      o.options = [...el.options].map(op => `${op.value}: ${text(op)}${op.disabled ? ' (disabled)' : ''}${op.hidden ? ' (hidden)' : ''}`);
    if (o.visible && el.localName === 'button' && !el.hasAttribute('aria-pressed')) o.disabled = el.disabled;
    return o;
  });

  // Accessibility attributes of every rendered element, id references
  // resolved to what they point at, so a generated id is not a difference.
  const IDREFS = new Set(['aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-owns',
    'aria-activedescendant', 'aria-details', 'aria-errormessage', 'aria-flowto', 'for']);
  const refText = v => v.split(/\s+/).filter(Boolean).map(id => {
    const t = document.getElementById(id);
    return !t ? `(missing #${id})` : nameOf(t) ?? `${t.localName} "${text(t).slice(0, 60)}"`;
  }).join(' ');
  const a11y = [];
  for (const el of document.querySelectorAll('*')) {
    const attrs = {};
    for (const a of el.attributes) {
      const n = a.name;
      if (n === 'aria-pressed') continue;            // a control's value: compared with the controls
      const isFor = n === 'for' && (el.localName === 'label' || el.localName === 'output');
      if (!(n === 'role' || n === 'tabindex' || n.startsWith('aria-') || isFor)) continue;
      attrs[n] = IDREFS.has(n) ? refText(a.value) : a.value;
    }
    if (!Object.keys(attrs).length || !visible(el)) continue;
    a11y.push({ tag: el.localName, name: nameOf(el), attrs });
  }
  const details = [...document.querySelectorAll('details')].filter(visible)
    .map(d => ({ summary: text(d.querySelector('summary') ?? d).slice(0, 80), open: d.open }));
  const links = [...document.querySelectorAll('a[href]')].filter(visible)
    .map(a => ({ text: text(a), href: a.getAttribute('href'), target: a.getAttribute('target'), rel: a.getAttribute('rel') }));
  return { scenes, controlNames, controls, a11y, details, links };
};

/**
 * Runs in the page: CAPTURE and EXTRA on the same DOM, returned as one JSON
 * string (Playwright's structured result transfer costs several times what
 * the capture does). With `delta`, a drawing unchanged since this document's
 * last snapshot is sent as its hash alone.
 */
const SNAP = (capture, extra, args) => {
  const cap = capture({ dp: 4, cap: 1e9 });
  const ext = extra(args.map, cap);
  const hash = s => {
    let a = 0x811c9dc5, b = 0x01000193;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      a = Math.imul(a ^ c, 0x01000193) >>> 0;
      b = Math.imul(b ^ c, 0x811c9dc5) >>> 0;
    }
    return `${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}:${s.length}`;
  };
  const store = (window.__portParity ??= { slots: [] });
  // What can change a capture without a DOM mutation: focus, hover, :active,
  // form values, scroll. With the mutation count, CHANGED tells whether a new
  // snapshot could differ from this one.
  if (!store.mo) {
    store.count = 0;
    store.mo = new MutationObserver(list => { store.count += list.length; });
    store.mo.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    const path = n => {
      const p = [];
      for (; n && n !== document.documentElement; n = n.parentElement) {
        let i = 0;
        for (let s = n; (s = s.previousElementSibling);) i++;
        p.push(i);
      }
      return p.join('.');
    };
    store.state = () => [path(document.activeElement), path([...document.querySelectorAll(':hover')].pop()),
      document.querySelectorAll(':active').length, scrollX, scrollY,
      ...[...document.querySelectorAll('input,select,textarea')].map(i => (i.type === 'checkbox' || i.type === 'radio' ? i.checked : i.value))].join('|');
  }
  store.count += store.mo.takeRecords().length;
  store.at = store.count;
  store.stateAt = store.state();
  const scenes = cap.scenes.map((s, i) => {
    const json = JSON.stringify([s, ext.scenes[i]]), h = hash(json);
    const same = store.slots[i] === h;
    store.slots[i] = h;
    return args.delta && same ? { h } : { h, json };
  });
  store.slots.length = scenes.length;
  const rest = JSON.stringify({ prose: cap.prose, controls: cap.controls, a11y: cap.a11y, title: cap.title,
    controlNames: ext.controlNames, controlStates: ext.controls, attrs: ext.a11y,
    details: ext.details, links: ext.links });
  return JSON.stringify({ scenes, rest });
};
/** Runs in the page: could a snapshot now differ from this document's last one? */
const CHANGED = () => {
  const s = window.__portParity;
  if (!s?.mo) return true;
  s.count += s.mo.takeRecords().length;
  return s.count !== s.at || s.state() !== s.stateAt;
};
const SNAP_HEAD = `(${SNAP})(${CAPTURE}, ${EXTRA}, `;
const snapExpr = delta => `${SNAP_HEAD}${JSON.stringify({ map: PORT_MAP_DATA, delta })})`;

// -------------------------------------------------------- normalisation ----
const TOL = 1e-3;
const IGNORED_DATA = /^data-(k|layer|mark|parts|probe.*|panel|explorable|control|value|uf)$/;
const NUM_G = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
const NUM_Y = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y;
const numsOf = s => (String(s ?? '').match(NUM_G) ?? []).map(Number);
const dataOf = obj => Object.fromEntries(Object.entries(obj ?? {}).filter(([k]) => !IGNORED_DATA.test(k)));
const pairsOf = arr => { const p = []; for (let k = 0; k + 1 < arr.length; k += 2) p.push([arr[k], arr[k + 1]]); return p; };

/**
 * SVG path data → absolute subpaths [{start, closed, segs}], each segment
 * ['L',x,y] | ['C',x1,y1,x2,y2,x,y] | ['Q',x1,y1,x,y] | ['A',rx,ry,rot,large,sweep,x,y].
 * H/V become L, S/T are expanded, implicit repeats are explicit, relative
 * coordinates are resolved. Throws on data a browser would stop drawing at.
 */
function parsePath(d) {
  const s = String(d ?? ''), n = s.length;
  let i = 0;
  const skip = () => { while (i < n && (s[i] === ' ' || s[i] === ',' || s[i] === '\n' || s[i] === '\t' || s[i] === '\r')) i++; };
  const number = () => { skip(); NUM_Y.lastIndex = i; const m = NUM_Y.exec(s); if (!m) return null; i += m[0].length; return Number(m[0]); };
  const flag = () => { skip(); const c = s[i]; if (c === '0' || c === '1') { i++; return Number(c); } return null; };
  const ARITY = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7 };
  const subs = [];
  let sub = null, cx = 0, cy = 0, sx = 0, sy = 0, lastC = null, lastQ = null, prev = '';
  const begin = () => { sub = { start: [cx, cy], closed: false, segs: [] }; subs.push(sub); };
  for (;;) {
    skip();
    if (i >= n) break;
    const c = s[i];
    if (!/[MmZzLlHhVvCcSsQqTtAa]/.test(c)) throw new Error(`path data: "${s.slice(i, i + 12)}" at ${i}`);
    i++;
    const C = c.toUpperCase(), rel = c !== C;
    if (C === 'Z') { if (sub) sub.closed = true; cx = sx; cy = sy; lastC = lastQ = null; prev = 'Z'; continue; }
    if (C !== 'M' && !sub) throw new Error('path data does not begin with a moveto');
    for (let group = 0; ; group++) {
      const save = i, a = [];
      for (let k = 0; k < ARITY[C]; k++) {
        const v = C === 'A' && (k === 3 || k === 4) ? flag() : number();
        if (v === null) break;
        a.push(v);
      }
      if (a.length < ARITY[C]) {
        if (group === 0 || a.length) throw new Error(`path data: ${c} needs ${ARITY[C]} numbers at ${save}`);
        i = save;
        break;
      }
      // A closepath followed by anything but a moveto starts a subpath at the same point.
      if (prev === 'Z' && C !== 'M') begin();
      const X = v => (rel ? cx + v : v), Y = v => (rel ? cy + v : v);
      let cmd = C;
      if (C === 'M' && group > 0) cmd = 'L';                     // implicit lineto after a moveto
      if (cmd === 'M') { cx = X(a[0]); cy = Y(a[1]); sx = cx; sy = cy; begin(); lastC = lastQ = null; }
      else if (cmd === 'L') { const x = X(a[0]), y = Y(a[1]); sub.segs.push(['L', x, y]); cx = x; cy = y; lastC = lastQ = null; }
      else if (cmd === 'H') { const x = rel ? cx + a[0] : a[0]; sub.segs.push(['L', x, cy]); cx = x; lastC = lastQ = null; }
      else if (cmd === 'V') { const y = rel ? cy + a[0] : a[0]; sub.segs.push(['L', cx, y]); cy = y; lastC = lastQ = null; }
      else if (cmd === 'C' || cmd === 'S') {
        let x1, y1, k = 0;
        if (cmd === 'C') { x1 = X(a[0]); y1 = Y(a[1]); k = 2; }
        else if (lastC) { x1 = 2 * cx - lastC[0]; y1 = 2 * cy - lastC[1]; }
        else { x1 = cx; y1 = cy; }
        const x2 = X(a[k]), y2 = Y(a[k + 1]), x = X(a[k + 2]), y = Y(a[k + 3]);
        sub.segs.push(['C', x1, y1, x2, y2, x, y]);
        lastC = [x2, y2]; lastQ = null; cx = x; cy = y;
      } else if (cmd === 'Q' || cmd === 'T') {
        let x1, y1, k = 0;
        if (cmd === 'Q') { x1 = X(a[0]); y1 = Y(a[1]); k = 2; }
        else if (lastQ) { x1 = 2 * cx - lastQ[0]; y1 = 2 * cy - lastQ[1]; }
        else { x1 = cx; y1 = cy; }
        const x = X(a[k]), y = Y(a[k + 1]);
        sub.segs.push(['Q', x1, y1, x, y]);
        lastQ = [x1, y1]; lastC = null; cx = x; cy = y;
      } else if (cmd === 'A') {
        const x = X(a[5]), y = Y(a[6]);
        sub.segs.push(['A', a[0], a[1], a[2], a[3], a[4], x, y]);
        cx = x; cy = y; lastC = lastQ = null;
      }
      prev = cmd;
    }
  }
  return subs;
}

const GEOM_KEYS = {
  circle: ['cx', 'cy', 'r'], ellipse: ['cx', 'cy', 'rx', 'ry'], rect: ['x', 'y', 'width', 'height', 'rx', 'ry'],
  text: ['x', 'y', 'dx', 'dy', 'text-anchor'], image: ['x', 'y', 'width', 'height'], use: ['x', 'y', 'href'],
};
const numeric = v => {
  if (typeof v !== 'string' || !/^[-+\d.eE\s,]+$/.test(v)) return v;
  const list = numsOf(v);
  return list.length === 1 ? list[0] : list;
};

/**
 * One drawn mark, as a reader sees it: CAPTURE's record `m` and EXTRA's `e`
 * (its wrappers and the definitions it paints with). Null when it is not drawn.
 */
function normaliseMark(m, e = {}) {
  if (e.defs || e.hidden) return null;
  const paint = { ...(m.paint ?? {}) };
  if (paint.display === 'none' || paint.visibility === 'hidden' || paint.visibility === 'collapse') return null;
  const out = {};
  const tag = m.tag;
  if (tag === 'polygon' || tag === 'polyline') Object.assign(out, { tag: 'poly', closed: tag === 'polygon', pts: pairsOf(numsOf(m.points)) });
  else if (tag === 'line') {
    const v = k => (m[k] === undefined ? 0 : Number(numsOf(m[k])[0] ?? 0));
    Object.assign(out, { tag: 'poly', closed: false, pts: [[v('x1'), v('y1')], [v('x2'), v('y2')]] });
  } else if (tag === 'path') {
    let subs = null;
    try { subs = parsePath(m.d); } catch { subs = null; }
    if (!subs) Object.assign(out, { tag: 'path', d: String(m.d ?? '') });     // unparseable: compared as written
    else if (subs.length === 1 && subs[0].segs.every(g => g[0] === 'L'))
      Object.assign(out, { tag: 'poly', closed: subs[0].closed, pts: [subs[0].start, ...subs[0].segs.map(g => [g[1], g[2]])] });
    else Object.assign(out, { tag: 'path', subs });
  } else {
    out.tag = tag;
    for (const k of GEOM_KEYS[tag] ?? []) if (m[k] !== undefined) out[k] = k === 'text-anchor' || k === 'href' ? m[k] : numeric(m[k]);
  }
  if (tag === 'text') out.text = m.text;
  const tf = [e.gtf, m.transform].filter(Boolean).join(' ');
  if (tf) out.transform = tf;
  // Opacity through the wrappers: a <g opacity> around one mark is that mark's opacity.
  const eff = (paint.opacity === undefined ? 1 : Number(paint.opacity)) * (e.gop ?? 1);
  delete paint.opacity;
  if (Math.abs(eff - 1) > 1e-9) paint.opacity = Number(eff.toFixed(6));
  // A url(#id) paint names the definition by its index in this drawing, not by id.
  for (const [p, k] of Object.entries(e.ref ?? {})) paint[p] = `ref#${k}`;
  for (const [p, v] of Object.entries(e.fx ?? {})) paint[p] = v;
  if (e.gfx) paint['wrapper-effects'] = e.gfx;
  // No area, so a fill cannot paint: <line> has none and <path d="MaLb"> paints none.
  if (out.tag === 'poly' && out.pts.length <= 2) delete paint.fill;
  if (Object.keys(paint).length) out.paint = paint;
  const data = dataOf(m.data);
  if (Object.keys(data).length) out.data = data;
  return out;
}

/** A definition (a hatch pattern, a gradient, a clip path), by content. */
function normaliseDef(d) {
  if (!d || d.missing !== undefined) return d ?? null;
  const attrs = {};
  for (const [k, v] of Object.entries(d.attrs ?? {})) attrs[k] = v && typeof v === 'object' ? normaliseDef(v) : numeric(v);
  const kids = (d.kids ?? []).map(k => ('kids' in k ? normaliseDef(k) : normaliseMark(k))).filter(Boolean);
  return { tag: d.tag, attrs, kids };
}

function normaliseScene(cs, es) {
  if (!cs.marks) throw new Error('port-parity: CAPTURE collapsed a drawing into groups; it must be called with a large cap');
  const marks = [];
  cs.marks.forEach((m, i) => { const n = normaliseMark(m, es?.marks?.[i] ?? {}); if (n) marks.push(n); });
  return {
    key: es?.key ?? null,
    viewBox: numeric(cs.viewBox ?? ''),
    size: cs.size, bbox: cs.bbox,
    probe: dataOf(cs.probe), role: cs.role, ariaLabel: cs.ariaLabel,
    marks, refs: (es?.refs ?? []).map(normaliseDef),
  };
}

function normaliseRest(r) {
  return {
    // A <select> is not prose. CAPTURE collects it because the port marks it
    // `data-control`, which the shipped page does not, so its option list
    // would read as inserted prose on one page and absent on the other. What a
    // select holds IS compared — by name, value and option count, under
    // `controls` — so dropping it here loses nothing and removes a difference
    // that is about an attribute convention rather than about the page.
    prose: r.prose.filter(p => p.tag !== 'select').map(p => ({ tag: p.tag, text: p.text })),
    controls: r.controls.map((c, i) => ({ name: r.controlNames[i] ?? null, type: c.type, v: c.v, disabled: !!c.disabled })),
    controlStates: r.controlStates,
    a11y: r.a11y, attrs: r.attrs, details: r.details, links: r.links, title: r.title,
  };
}

// Normalised drawings by content hash: both pages of a faithful pair, and a
// drawing an interaction did not touch, are normalised once.
const normCache = new Map();
const lru = (map, key, make, max) => {
  if (map.has(key)) { const v = map.get(key); map.delete(key); map.set(key, v); return v; }
  const v = make();
  map.set(key, v);
  if (map.size > max) map.delete(map.keys().next().value);
  return v;
};
const slotCache = new WeakMap();      // page → [{h, norm}], this document's drawings as last received

/** CAPTURE + EXTRA on one page, normalised. `delta`: unchanged drawings come back as a hash. */
async function snap(page, { delta = false } = {}) {
  const raw = JSON.parse(await page.evaluate(snapExpr(delta)));
  let slots = slotCache.get(page);
  if (!slots) slotCache.set(page, slots = []);
  const scenes = raw.scenes.map((s, i) => {
    if (s.json !== undefined) {
      slots[i] = { h: s.h, norm: lru(normCache, s.h, () => { const [cs, es] = JSON.parse(s.json); return normaliseScene(cs, es); }, 48) };
    } else if (slots[i]?.h !== s.h) {
      throw new Error('port-parity: the page reported an unchanged drawing this tool never received');
    }
    return slots[i];
  });
  slots.length = scenes.length;
  return { scenes, rest: normaliseRest(JSON.parse(raw.rest)), sig: raw.scenes.map(s => s.h).join('|') + raw.rest };
}

// ---------------------------------------------------------------- differ ----
const NUM_SPLIT = /([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/;
const sameNum = (a, b) => Math.abs(a - b) <= TOL;
/** Geometry and paint: numbers (bare, in lists, or inside strings) within TOL, the rest exactly. */
function sameLoose(a, b) {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return sameNum(a, b);
  if (typeof a === 'string' && typeof b === 'string') {
    const x = a.split(NUM_SPLIT), y = b.split(NUM_SPLIT);
    if (x.length !== y.length) return false;
    return x.every((t, k) => (k % 2 ? sameNum(Number(t), Number(y[k])) : t === y[k]));
  }
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, k) => sameLoose(v, b[k]));
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) if (!sameLoose(a[k], b[k])) return false;
    return true;
  }
  return false;
}
const fmt = v => (typeof v === 'number' ? String(Number(v.toFixed(4))) : String(v));
const pt = p => `(${fmt(p[0])}, ${fmt(p[1])})`;
const show = v => (v === undefined || v === null ? '(absent)' : typeof v === 'object' ? JSON.stringify(v) : fmt(v));
const segText = g => `${g[0]} ${g.slice(1).map(fmt).join(' ')}`;

/** A mark in one line, for a removed or added mark or a changed tag. */
function summary(m) {
  if (!m) return '(absent)';
  let s = m.tag;
  if (m.tag === 'poly') s += `(${m.pts.length} vertices${m.closed ? ', closed' : ''}: ${m.pts.slice(0, 3).map(pt).join(' ')}${m.pts.length > 3 ? ' …' : ''})`;
  else if (m.tag === 'path') s += m.subs ? `(${m.subs.length} subpaths, ${m.subs.reduce((k, x) => k + x.segs.length, 0)} segments, from ${m.subs[0] ? pt(m.subs[0].start) : '-'})` : `(d="${String(m.d).slice(0, 48)}")`;
  else s += ' ' + Object.entries(m).filter(([k]) => !['tag', 'paint', 'data', 'text'].includes(k)).map(([k, v]) => `${k}=${show(v)}`).join(' ');
  if (m.text !== undefined) s += ` "${m.text}"`;
  if (m.paint) s += ' {' + Object.entries(m.paint).map(([k, v]) => `${k}: ${v}`).join('; ') + '}';
  if (m.data) s += ' ' + JSON.stringify(m.data);
  return s;
}

function diffSubs(A, B) {
  if (A.length !== B.length) return { legacy: `${A.length} subpaths`, port: `${B.length} subpaths` };
  for (let s = 0; s < A.length; s++) {
    const a = A[s], b = B[s];
    if (a.closed !== b.closed) return { legacy: `subpath ${s} ${a.closed ? 'closed' : 'open'}`, port: `subpath ${s} ${b.closed ? 'closed' : 'open'}` };
    if (!sameNum(a.start[0], b.start[0]) || !sameNum(a.start[1], b.start[1])) return { legacy: `subpath ${s} M ${pt(a.start)}`, port: `subpath ${s} M ${pt(b.start)}` };
    if (a.segs.length !== b.segs.length) return { legacy: `subpath ${s}: ${a.segs.length} segments`, port: `subpath ${s}: ${b.segs.length} segments` };
    for (let k = 0; k < a.segs.length; k++) {
      const x = a.segs[k], y = b.segs[k];
      if (x[0] !== y[0] || x.length !== y.length || x.some((v, j) => j > 0 && !sameNum(v, y[j])))
        return { legacy: `subpath ${s} segment ${k}: ${segText(x)}`, port: `subpath ${s} segment ${k}: ${segText(y)}` };
    }
  }
  return null;
}

/** Field-level differences between two marks paired by the alignment. */
function diffMark(a, b) {
  if (a.tag !== b.tag) return [{ field: 'tag', legacy: summary(a), port: summary(b) }];
  const out = [];
  if (a.tag === 'poly') {
    if (a.closed !== b.closed) out.push({ field: 'closed', legacy: String(a.closed), port: String(b.closed) });
    if (a.pts.length !== b.pts.length) out.push({ field: 'pts.length', legacy: String(a.pts.length), port: String(b.pts.length) });
    else {
      let first = -1, count = 0;
      a.pts.forEach((p, k) => { if (!sameNum(p[0], b.pts[k][0]) || !sameNum(p[1], b.pts[k][1])) { count++; if (first < 0) first = k; } });
      if (count) out.push({ field: 'pts', legacy: `vertex ${first} ${pt(a.pts[first])}`, port: `vertex ${first} ${pt(b.pts[first])}`, note: `${count} of ${a.pts.length} vertices differ` });
    }
  } else if (a.tag === 'path') {
    const d = a.subs && b.subs ? diffSubs(a.subs, b.subs)
      : sameLoose(a.d ?? JSON.stringify(a.subs), b.d ?? JSON.stringify(b.subs)) ? null
        : { legacy: a.d ?? summary(a), port: b.d ?? summary(b) };
    if (d) out.push({ field: 'd', ...d });
  }
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (['tag', 'closed', 'pts', 'subs', 'd', 'paint', 'data', 'text'].includes(k)) continue;
    if (!sameLoose(a[k], b[k])) out.push({ field: k, legacy: show(a[k]), port: show(b[k]) });
  }
  if (a.text !== b.text) out.push({ field: 'text', legacy: show(a.text), port: show(b.text) });
  const pa = a.paint ?? {}, pb = b.paint ?? {};
  for (const k of new Set([...Object.keys(pa), ...Object.keys(pb)]))
    if (!sameLoose(pa[k], pb[k])) out.push({ field: `paint.${k}`, legacy: show(pa[k]), port: show(pb[k]) });
  const da = a.data ?? {}, db = b.data ?? {};
  for (const k of new Set([...Object.keys(da), ...Object.keys(db)]))
    if (da[k] !== db[k]) out.push({ field: `data.${k}`, legacy: show(da[k]), port: show(db[k]) });
  return out;
}

/**
 * Align two sequences by key (longest common subsequence, common ends
 * trimmed first). Unmatched runs between two matches are paired in order:
 * those are changes, not a removal and an addition. → [[i|null, j|null, how]]
 */
function align(A, B) {
  const n = A.length, m = B.length;
  let pre = 0;
  while (pre < n && pre < m && A[pre] === B[pre]) pre++;
  let suf = 0;
  while (suf < n - pre && suf < m - pre && A[n - 1 - suf] === B[m - 1 - suf]) suf++;
  const N = n - pre - suf, M = m - pre - suf, raw = [];
  for (let k = 0; k < pre; k++) raw.push([k, k]);
  if (N && M && N * M <= 4e7) {
    const W = M + 1, L = new Uint32Array((N + 1) * W);
    for (let i = N - 1; i >= 0; i--) for (let j = M - 1; j >= 0; j--)
      L[i * W + j] = A[pre + i] === B[pre + j] ? L[(i + 1) * W + j + 1] + 1 : Math.max(L[(i + 1) * W + j], L[i * W + j + 1]);
    let i = 0, j = 0;
    while (i < N && j < M) {
      if (A[pre + i] === B[pre + j]) raw.push([pre + i++, pre + j++]);
      else if (L[(i + 1) * W + j] >= L[i * W + j + 1]) raw.push([pre + i++, null]);
      else raw.push([null, pre + j++]);
    }
    while (i < N) raw.push([pre + i++, null]);
    while (j < M) raw.push([null, pre + j++]);
  } else {
    for (let k = 0; k < Math.max(N, M); k++) raw.push([k < N ? pre + k : null, k < M ? pre + k : null]);
  }
  for (let k = 0; k < suf; k++) raw.push([n - suf + k, m - suf + k]);
  const out = [];
  let ra = [], rb = [];
  const flush = () => {
    const k = Math.min(ra.length, rb.length);
    for (let x = 0; x < k; x++) out.push([ra[x], rb[x], 'changed']);
    for (let x = k; x < ra.length; x++) out.push([ra[x], null, 'removed']);
    for (let x = k; x < rb.length; x++) out.push([null, rb[x], 'added']);
    ra = []; rb = [];
  };
  for (const [i, j] of raw) {
    if (i !== null && j !== null) { flush(); out.push([i, j, 'same']); }
    else if (i !== null) ra.push(i); else rb.push(j);
  }
  flush();
  return out;
}
const alignKey = v => JSON.stringify(v, (k, x) => (typeof x === 'number' ? Math.round(x * 100) / 100 : x));
/** Mark differences listed per drawing before the rest are counted instead. */
const MARK_CAP = 40;

/** Generic leaf-by-leaf difference, loose (geometry/paint) or exact (text). */
function deepDiff(a, b, path, out, loose = true) {
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    if (Array.isArray(a)) {
      if (a.length !== b.length) { out.push({ field: `${path}.length`, legacy: String(a.length), port: String(b.length) }); return out; }
      a.forEach((x, k) => deepDiff(x, b[k], `${path}[${k}]`, out, loose));
      return out;
    }
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) deepDiff(a[k], b[k], path ? `${path}.${k}` : k, out, loose);
    return out;
  }
  if (loose ? !sameLoose(a, b) : a !== b) out.push({ field: path, legacy: show(a), port: show(b) });
  return out;
}

/** One drawing against its partner: drawing fields, marks, definitions. */
function diffScene(A, B) {
  const canon = S => (S.canon ??= JSON.stringify([S.viewBox, S.size, S.bbox, S.probe, S.role, S.ariaLabel, S.marks, S.refs]));
  if (canon(A) === canon(B)) return [];
  const out = [];
  for (const k of ['viewBox', 'size', 'bbox'])
    if (!sameLoose(A[k], B[k])) out.push({ category: 'drawing', field: k, legacy: show(A[k]), port: show(B[k]) });
  for (const k of new Set([...Object.keys(A.probe), ...Object.keys(B.probe)]))
    if (A.probe[k] !== B.probe[k]) out.push({ category: 'drawing', field: `probe.${k}`, legacy: show(A.probe[k]), port: show(B.probe[k]) });
  if (A.role !== B.role) out.push({ category: 'a11y', field: 'role', legacy: show(A.role), port: show(B.role) });
  if (A.ariaLabel !== B.ariaLabel) out.push({ category: 'a11y', field: 'aria-label', legacy: show(A.ariaLabel), port: show(B.ariaLabel) });
  if (A.marks.length !== B.marks.length)
    out.push({ category: 'drawing', field: 'marks.length', legacy: String(A.marks.length), port: String(B.marks.length) });
  A.keys ??= A.marks.map(alignKey); B.keys ??= B.marks.map(alignKey);
  A.exact ??= A.marks.map(m => JSON.stringify(m)); B.exact ??= B.marks.map(m => JSON.stringify(m));
  // A drawing whose every mark moved — a mesh cut into a different number of
  // cells, say — says that once, with a sample. What matters there is the
  // count, which 'marks.length' above reports, not 1 152 vertex lists.
  const marks = [];
  for (const [i, j, how] of align(A.keys, B.keys)) {
    if (how === 'removed') marks.push({ category: 'marks', mark: i, field: 'mark', legacy: summary(A.marks[i]), port: '(absent)' });
    else if (how === 'added') marks.push({ category: 'marks', markPort: j, field: 'mark', legacy: '(absent)', port: summary(B.marks[j]) });
    else if (A.exact[i] !== B.exact[j]) for (const d of diffMark(A.marks[i], B.marks[j])) marks.push({ category: 'marks', mark: i, markPort: j, ...d });
  }
  if (marks.length <= MARK_CAP) out.push(...marks);
  else {
    const rest = marks.slice(MARK_CAP), by = {};
    for (const r of rest) by[r.field] = (by[r.field] ?? 0) + 1;
    out.push(...marks.slice(0, MARK_CAP), { category: 'marks', field: 'marks.more',
      legacy: `${MARK_CAP} of ${marks.length} mark differences are listed`,
      port: `${rest.length} more: ${Object.entries(by).sort((a, b) => b[1] - a[1]).map(([f, n]) => `${f} ×${n}`).join(', ')}` });
  }
  for (const d of deepDiff(A.refs, B.refs, 'ref', [])) out.push({ category: 'patterns', ...d });
  return out;
}
const sceneDiffCache = new Map();

/** The drawings of two pages, paired: by name where both have one, the rest in document order. */
function pairScenes(SA, SB) {
  const byKey = new Map();
  SB.forEach((s, j) => { const k = s.norm.key; if (k && !byKey.has(k)) byKey.set(k, j); });
  const pairs = [], usedA = new Set(), usedB = new Set();
  SA.forEach((s, i) => {
    const j = s.norm.key ? byKey.get(s.norm.key) : undefined;
    if (j !== undefined && !usedB.has(j)) { pairs.push([i, j]); usedA.add(i); usedB.add(j); }
  });
  const restA = SA.map((_, i) => i).filter(i => !usedA.has(i)), restB = SB.map((_, j) => j).filter(j => !usedB.has(j));
  for (let k = 0; k < Math.max(restA.length, restB.length); k++) pairs.push([restA[k] ?? null, restB[k] ?? null]);
  return pairs.sort((x, y) => (x[0] ?? 1e9) - (y[0] ?? 1e9) || (x[1] ?? 1e9) - (y[1] ?? 1e9));
}

const CATEGORIES = new Set(['drawing', 'marks', 'patterns', 'prose', 'controls', 'title', 'a11y']);
/**
 * Every difference between two normalised snapshots, as report records.
 * base: {kind: 'semantic'|'interaction', state, scenario?, step?}.
 * only: a set of categories to compare; mask: the playback's time-dependent
 * values (the readouts and the sliders) are not compared.
 */
function diffCaptures(A, B, base, { only = null, mask = false } = {}) {
  const out = [];
  const want = c => !only || only.has(c);
  const emit = r => {
    if (!want(r.category)) return;
    const kind = base.kind === 'interaction' ? 'interaction' : r.category === 'a11y' ? 'a11y' : 'semantic';
    out.push({ ...base, kind, ...r });
  };
  // Drawings.
  if (['drawing', 'marks', 'patterns', 'a11y'].some(want)) {
    const pairs = pairScenes(A.scenes, B.scenes);
    const name = (i, j) => A.scenes[i]?.norm.key ?? B.scenes[j]?.norm.key ?? `svg ${i ?? '?'}/${j ?? '?'}`;
    const both = pairs.filter(([i, j]) => i !== null && j !== null);
    if (both.some(([, j], k) => k && j < both[k - 1][1]))
      emit({ category: 'drawing', field: 'order', legacy: both.map(([i, j]) => name(i, j)).join(', '),
             port: [...both].sort((x, y) => x[1] - y[1]).map(([i, j]) => name(i, j)).join(', ') });
    for (const [i, j] of pairs) {
      const drawing = name(i, j);
      if (i === null || j === null) {
        emit({ category: 'drawing', drawing, field: 'present', legacy: i === null ? '(absent)' : 'drawn', port: j === null ? '(absent)' : 'drawn' });
        continue;
      }
      const a = A.scenes[i], b = B.scenes[j];
      // The same capture normalises the same: nothing to compare.
      const list = a.h === b.h ? [] : lru(sceneDiffCache, `${a.h}|${b.h}`, () => diffScene(a.norm, b.norm), 256);
      for (const r of list) emit({ drawing, ...r });
    }
  }
  // Prose: tag + text, in order, exactly — plus the details' open state and the links.
  if (want('prose')) {
    // Masked, the readouts leave the comparison on both pages rather than being
    // blanked: CAPTURE drops a text that another text contains, so whether a
    // readout is listed at all depends on the time it shows.
    const keep = (p, k) => (mask && p.tag === 'output' ? null : { k, text: `${p.tag}: ${p.text}` });
    const pa = A.rest.prose.map(keep).filter(Boolean), pb = B.rest.prose.map(keep).filter(Boolean);
    for (const [i, j, how] of align(pa.map(p => p.text), pb.map(p => p.text))) if (how !== 'same')
      emit({ category: 'prose', field: `prose[${i === null ? `+${pb[j].k}` : pa[i].k}]`,
             legacy: i === null ? '(absent)' : pa[i].text, port: j === null ? '(absent)' : pb[j].text });
    for (const d of deepDiff(A.rest.details, B.rest.details, 'details', [], false)) emit({ category: 'prose', ...d });
    for (const d of deepDiff(A.rest.links, B.rest.links, 'links', [], false)) emit({ category: 'prose', ...d });
  }
  // Controls: type, value, disabled, in order; every mapped control's visibility; options.
  if (want('controls')) {
    const ca = A.rest.controls, cb = B.rest.controls;
    const val = c => (mask && c.type === 'range' ? '<t>' : String(c.v));
    const states = { a: new Map(A.rest.controlStates.map(s => [s.name, s])), b: new Map(B.rest.controlStates.map(s => [s.name, s])) };
    const mapped = new Set([...states.a.keys(), ...states.b.keys()]);
    // Every mapped control: shown or not; a shown select's options; a shown action button's disabled.
    for (const name of mapped) {
      const s = states.a.get(name) ?? { visible: false }, t = states.b.get(name) ?? { visible: false };
      if (s.visible !== t.visible) { emit({ category: 'controls', field: `${name}.visible`, legacy: String(s.visible), port: String(t.visible) }); continue; }
      if (!s.visible) continue;
      for (const d of deepDiff(s.options, t.options, `${name}.options`, [], false)) emit({ category: 'controls', ...d });
      if (s.disabled !== t.disabled) emit({ category: 'controls', field: `${name}.disabled`, legacy: show(s.disabled), port: show(t.disabled) });
    }
    // The controls CAPTURE lists (shown select, input, aria-pressed button): type, value, disabled.
    const na = new Map(ca.map(c => [c.name, c])), nb = new Map(cb.map(c => [c.name, c]));
    for (const name of mapped) {
      const c = na.get(name), d = nb.get(name);
      if (!c && !d) continue;
      if (!c || !d) {
        // Shown on both pages but listed on one: a control that is not a form control or lost aria-pressed.
        if (states.a.get(name)?.visible && states.b.get(name)?.visible)
          emit({ category: 'controls', field: `${name}.listed`, legacy: c ? `${c.type}=${val(c)}` : '(not a listed control)', port: d ? `${d.type}=${val(d)}` : '(not a listed control)' });
        continue;
      }
      if (c.type !== d.type) emit({ category: 'controls', field: `${name}.type`, legacy: c.type, port: d.type });
      if (val(c) !== val(d)) emit({ category: 'controls', field: `${name}.value`, legacy: val(c), port: val(d) });
      if (c.disabled !== d.disabled) emit({ category: 'controls', field: `${name}.disabled`, legacy: String(c.disabled), port: String(d.disabled) });
    }
    const oa = ca.map(c => c.name).filter(n => mapped.has(n) && nb.has(n)), ob = cb.map(c => c.name).filter(n => mapped.has(n) && na.has(n));
    if (oa.join() !== ob.join()) emit({ category: 'controls', field: 'order', legacy: oa.join(', '), port: ob.join(', ') });
    // Controls the port map does not name, in order.
    const label = c => `${c.name} ${c.type}=${val(c)}${c.disabled ? ' disabled' : ''}`;
    const ua = ca.filter(c => !mapped.has(c.name)).map(label), ub = cb.filter(c => !mapped.has(c.name)).map(label);
    for (const [i, j, how] of align(ua, ub)) if (how !== 'same')
      emit({ category: 'controls', field: 'unmapped', legacy: i === null ? '(absent)' : ua[i], port: j === null ? '(absent)' : ub[j] });
  }
  if (want('title') && A.rest.title !== B.rest.title) emit({ category: 'title', field: 'title', legacy: A.rest.title, port: B.rest.title });
  // Accessibility: CAPTURE's counts and headings, and every rendered element's role/aria-*/tabindex/for.
  if (want('a11y')) {
    // CAPTURE's headings carry their text, which the prose list already
    // compares; here they are levels, so a heading demoted to h3 shows as one
    // a11y difference and not as a second copy of every heading's words.
    const levels = x => ({ ...x, headings: (x.headings ?? []).map(h => String(h).split(':')[0]) });
    for (const d of deepDiff(levels(A.rest.a11y), levels(B.rest.a11y), '', [], false)) emit({ category: 'a11y', ...d });
    const line = x => `${x.tag}${x.name ? ` ${x.name}` : ''} ${JSON.stringify(x.attrs)}`;
    const la = A.rest.attrs.map(line), lb = B.rest.attrs.map(line);
    for (const [i, j, how] of align(la, lb)) if (how !== 'same')
      emit({ category: 'a11y', field: `attrs[${i ?? `+${j}`}]`, legacy: i === null ? '(absent)' : la[i], port: j === null ? '(absent)' : lb[j] });
  }
  return out;
}

// ---------------------------------------------------------------- pixels ----
let differ = null;                    // a page borrowed to decode and diff PNGs
const comparePixels = async (a, b) => (a.equals(b) ? { changed: 0 } : comparePNG(differ, a, b, 0, { metric: 'max' }));
const safe = s => String(s).replace(/[^A-Za-z0-9_.@=,+-]+/g, '_');
async function writeDiff(rel, diff) {
  if (!diff.image) return null;
  const at = join(OUT, rel);
  await mkdir(dirname(at), { recursive: true });
  await writeFile(at, Buffer.from(diff.image.split(',')[1], 'base64'));
  return at.slice(ROOT.length);
}
const pixelRecord = async (base, d, rel) => {
  if (d.sizeMismatch) return { ...base, field: 'size', legacy: `${d.a[0]}x${d.a[1]}`, port: `${d.b[0]}x${d.b[1]}` };
  if (!d.changed) return null;
  return { ...base, field: 'pixels', changed: d.changed, ratio: d.ratio, maxDelta: d.maxDelta, box: d.box,
           file: await writeDiff(rel, d) };
};

// ----------------------------------------------------------- self-checks ----
const selfChecks = [];
function refuse(what, detail) {
  console.error(`port-parity: ${what}; refusing to report.\n  ${detail}`);
  process.exit(2);
}

/** "Identical" means nothing unless the comparison can fail: one level of blue in 4 of 4 pixels. */
async function checkComparator() {
  const [one, two] = (await differ.evaluate(() => [30, 31].map(blue => {
    const c = document.createElement('canvas');
    c.width = c.height = 2;
    const x = c.getContext('2d'), img = x.createImageData(2, 2);
    for (let i = 0; i < 16; i += 4) img.data.set([10, 20, blue, 255], i);
    x.putImageData(img, 0, 0);
    return c.toDataURL('image/png');
  }))).map(u => Buffer.from(u.slice(u.indexOf(',') + 1), 'base64'));
  const seen = await comparePNG(differ, one, two, 0, { metric: 'max' });
  const same = await comparePNG(differ, one, Buffer.from(one), 0, { metric: 'max' });
  if (seen.changed !== 4 || same.changed !== 0)
    refuse('the pixel comparator is blind', `a one-level blue change showed in ${seen.changed} of 4 pixels; identical images differed in ${same.changed}`);
  selfChecks.push('pixel comparator: a one-level change in one channel is seen in 4 of 4 pixels; identical images differ in 0');
}

/** The normalisation and the differ on synthetic captures: what must vanish vanishes, what must show shows. */
function checkDiffer() {
  let n = 0;
  const cap = (marks, o = {}) => {
    const scene = normaliseScene(
      { viewBox: '0 0 100 100', size: [100, 100], bbox: [0, 0, 100, 100], probe: o.probe ?? {}, role: 'img', ariaLabel: 'x',
        marks: marks.map(([m], i) => ({ i, ...m })) },
      { key: 'homotopy/now', marks: marks.map(([, e]) => e ?? {}), refs: o.refs ?? [] });
    return { scenes: [{ h: `synthetic${n++}`, norm: scene }],
             rest: normaliseRest({ prose: o.prose ?? [], controls: [], controlNames: [], controlStates: [],
                                   a11y: {}, attrs: [], details: [], links: [], title: 't' }) };
  };
  const P = 'rgb(1, 2, 3)';
  const poly = pts => [{ tag: 'polygon', points: pts, paint: { fill: P } }];
  const circle = (r, paint = { fill: P }, data) => [{ tag: 'circle', cx: '5', cy: '5', r, paint, ...(data && { data }) }];
  const pattern = w => ({ tag: 'pattern', attrs: { width: '6', height: '6', patternUnits: 'userSpaceOnUse' },
    kids: [{ tag: 'path', d: 'M0,6L6,0', paint: { stroke: 'rgb(174, 182, 193)', 'stroke-width': w, opacity: '0.5' } }] });
  const hatch = [{ tag: 'path', d: 'M0,6L6,0', paint: { stroke: 'rgb(174, 182, 193)', 'stroke-width': '0.6px', opacity: '0.5' } }, { defs: 1 }];
  const hole = id => [{ tag: 'circle', cx: '5', cy: '5', r: '2', paint: { fill: `url("#${id}")` } }, { ref: { fill: 0 } }];
  const cases = [
    ['<polygon> = <path d="M…L…Z"> with the same vertices', 0, cap([poly('0,0 10,0 10,10')]), cap([[{ tag: 'path', d: 'M0,0L10,0L10,10Z', paint: { fill: P } }]])],
    ['H/V/relative commands = the same vertex list', 0, cap([poly('0,0 10,0 10,10')]), cap([[{ tag: 'path', d: 'M0 0h10v10z', paint: { fill: P } }]])],
    ['a relative arc = its absolute form', 0, cap([[{ tag: 'path', d: 'M10,50a40,40 0 1,0 80,0a40,40 0 1,0 -80,0' }]]), cap([[{ tag: 'path', d: 'M10 50A40 40 0 1 0 90 50A40 40 0 1 0 10 50' }]])],
    ['a vertex 0.0005 away is the same', 0, cap([poly('0,0 10,0 10,10')]), cap([poly('0,0 10.0005,0 10,10')])],
    ['a vertex 0.002 away is a difference', 1, cap([poly('0,0 10,0 10,10')]), cap([poly('0,0 10.002,0 10,10')])],
    ['a radius 10 → 10.5 is a difference', 1, cap([circle('10')]), cap([circle('10.5')])],
    ['engine data-* attributes are not compared', 0, cap([circle('4')]), cap([circle('4', { fill: P }, { 'data-k': 'a/b', 'data-mark': 'point', 'data-parts': 'dot', 'data-layer': 'points' })])],
    ['a page data-* attribute is compared', 1, cap([circle('4', { fill: P }, { 'data-correspondence': 'now' })]), cap([circle('4', { fill: P }, { 'data-correspondence': 'start' })])],
    ['a wrapper\'s opacity is its mark\'s opacity', 0, cap([circle('4', { fill: P, opacity: '0.5' })]), cap([[circle('4')[0], { gop: 0.5 }]])],
    ['a wrapper\'s transform is its mark\'s', 1, cap([circle('4')]), cap([[circle('4')[0], { gtf: 'translate(1,0)' }]])],
    ['a mark with no area drops its fill', 0, cap([[{ tag: 'path', d: 'M0,0L10,0', paint: { stroke: P } }]]), cap([[{ tag: 'path', d: 'M0,0L10,0', paint: { fill: 'none', stroke: P } }]])],
    ['a hatch defined elsewhere under another id is the same hatch', 0,
      cap([hatch, hole('hole-now')], { refs: [pattern('0.6px')] }), cap([hole('uf-3-hatch'), hatch], { refs: [pattern('0.6px')] })],
    ['a hatch with another stroke is a difference', 1,
      cap([hatch, hole('hole-now')], { refs: [pattern('0.6px')] }), cap([hole('uf-3-hatch')], { refs: [pattern('0.7px')] })],
    ['one inserted mark is one difference, plus the count', 2,
      cap([circle('1'), circle('2'), circle('3')]), cap([circle('9'), circle('1'), circle('2'), circle('3')])],
    ['prose compares exactly: "0.50" ≠ "0.500"', 1, cap([], { prose: [{ tag: 'output', text: '0.50' }] }), cap([], { prose: [{ tag: 'output', text: '0.500' }] })],
    ['a <select>\'s options are not prose (controls compares them)', 0,
      cap([], { prose: [{ tag: 'output', text: '0.50' }] }),
      cap([], { prose: [{ tag: 'select', text: 'OneTwoThree' }, { tag: 'output', text: '0.50' }] })],
    ['a real prose insertion beside a <select> is still a difference', 1,
      cap([], { prose: [{ tag: 'output', text: '0.50' }] }),
      cap([], { prose: [{ tag: 'select', text: 'OneTwoThree' }, { tag: 'span', text: 'new' }, { tag: 'output', text: '0.50' }] })],
    ['svg text compares exactly', 1, cap([[{ tag: 'text', x: '1', y: '2', 'text-anchor': 'middle', text: '0, 1' }]]), cap([[{ tag: 'text', x: '1', y: '2', 'text-anchor': 'middle', text: '0,1' }]])],
  ];
  const failed = [];
  for (const [what, want, A, B] of cases) {
    const got = diffCaptures(A, B, { kind: 'semantic', state: 'self-check' });
    if (got.length !== want) failed.push(`${what}: expected ${want} difference(s), got ${got.length}${got.length ? `: ${got.map(r => `${r.field} ${r.legacy} → ${r.port}`).join('; ')}` : ''}`);
  }
  if (failed.length) refuse('the semantic differ failed its self-check', failed.join('\n  '));
  selfChecks.push(`semantic differ: ${cases.length} synthetic cases (${cases.filter(c => !c[1]).length} rewrites absorbed, ${cases.filter(c => c[1]).length} changes found)`);
}
checkDiffer();

// -------------------------------------------------------------- browser ----
const srv = await serve(ROOT);
const browser = await chromium.launch({ executablePath: CHROMIUM, args: DETERMINISTIC_ARGS });
differ = await (await browser.newContext()).newPage();
await checkComparator();

const urlOf = file => `${srv.url}/${file.split('/').map(encodeURIComponent).join('/')}`;
const records = [];                         // every difference found
const problems = [];                        // harness failures: the run cannot vouch for what it compared
const pageErrors = new Map(), consoleNotes = new Map();
const tally = (map, msg, where) => { const e = map.get(msg); if (e) e.n++; else map.set(msg, { n: 1, where }); };
const stats = { shots: 0, identical: 0, semantic: 0, configs: 0, scenarios: 0, compares: 0, unchanged: 0, presses: 0,
                keys: 0, drags: 0, dragsSelecting: 0, hovers: 0, focusStops: 0, inherited: 0 };
const phase = {};

// One context per side. Two pages in one context do not both get full-rate
// animation frames: after a selectOption, the first page of a context drops to
// about one frame a second (measured), and every settle and screenshot of it
// waits for those frames.
async function openPair(vp, scheme, { listen = true } = {}) {
  const contexts = [], pages = [];
  for (const side of ['legacy', 'port']) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, colorScheme: scheme,
      deviceScaleFactor: 1, reducedMotion: 'no-preference' });
    contexts.push(context);
    const page = await context.newPage();
    page.side = side;
    page.file = side === 'legacy' ? PAGE_A : PAGE_B;
    if (listen) {
      page.on('pageerror', e => tally(pageErrors, `${side}: ${String(e).split('\n')[0]}`, page.where));
      page.on('console', m => {
        if (m.type() === 'error' || m.type() === 'warning')
          tally(consoleNotes, `${side} console.${m.type()}: ${m.text().split('\n')[0].slice(0, 160)}`, page.where);
      });
    }
    pages.push(page);
  }
  return { a: pages[0], b: pages[1], vp, scheme, close: () => Promise.all(contexts.map(c => c.close())) };
}
const both = (pair, f) => Promise.all([f(pair.a), f(pair.b)]);

const STATE_SETTLE = { frames: 3, ms: 70, timeout: 4000 };
const STEP_SETTLE = { frames: 2, ms: 0, timeout: 3000 };
async function settle(page, o = STATE_SETTLE) {
  const r = await page.evaluate(SETTLE, o);
  if (!r.ok) problems.push(`${page.where}: the ${page.side} page did not settle within ${o.timeout} ms (${r.mutations} mutations)`);
  return r;
}

/** One step of tools/states.mjs, as tools/shots.mjs applies it, the selector resolved through the port map. */
async function applyStep(ctx, [action, sel, value]) {
  if (action === 'wait') { await ctx.waitForTimeout(Number(value)); return; }
  const { locator: el } = await locate(ctx, sel);
  switch (action) {
    case 'select': await el.selectOption(String(value), { timeout: 5000 }); break;
    case 'range':
      await el.evaluate((node, v) => {
        node.value = v;
        node.dispatchEvent(new Event('input', { bubbles: true }));
        node.dispatchEvent(new Event('change', { bubbles: true }));
      }, String(value), { timeout: 5000 });
      break;
    case 'check':
      await el.evaluate((node, v) => {
        if (node.checked !== v) {
          node.checked = v;
          node.dispatchEvent(new Event('change', { bubbles: true }));
          node.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }, Boolean(value), { timeout: 5000 });
      break;
    case 'click': await el.click({ timeout: 4000 }); break;
    default: throw new Error(`unknown step ${action}`);
  }
}

async function drive(page, steps, where, file = page.file) {
  page.where = where;
  await page.mouse.move(0, 0);             // no hover carried over from the last state
  await page.goto(urlOf(file), { waitUntil: 'load' });
  await settle(page);
  for (const step of steps) {
    try { await applyStep(page, step); }
    catch (e) { throw new Error(`${page.side} page, step ${JSON.stringify(step)}: ${String(e?.message ?? e).split('\n')[0]}`); }
  }
  await settle(page);
}
const drivePair = (pair, steps, where) => both(pair, p => drive(p, steps, where));

// The pipeline end to end, on the frozen original: rewrites a faithful port
// makes must vanish, and two planted changes must be exactly what is found.
const REWRITE = map => {
  const NS = 'http://www.w3.org/2000/svg';
  const drawing = key => document.querySelector(map.drawings.find(d => d.key === key).legacy);
  const done = [];
  const now = drawing('homotopy/now'), start = drawing('homotopy/start'), source = drawing('homotopy/source');
  let k = 0;
  for (const p of [...now.querySelectorAll('polygon')]) {
    const path = document.createElementNS(NS, 'path');
    for (const a of p.attributes) if (a.name !== 'points') path.setAttribute(a.name, a.value);
    path.setAttribute('d', `M${p.getAttribute('points').trim().split(/\s+/).join('L')}Z`);
    p.replaceWith(path);
    k++;
  }
  done.push(`${k} <polygon>s of homotopy/now as <path>s`);
  const g = document.createElementNS(NS, 'g');
  g.setAttribute('class', 'uf-layer'); g.setAttribute('data-layer', 'faces');
  const kids = [...start.children];
  start.prepend(g);
  kids.forEach((c, i) => { g.appendChild(c); c.setAttribute('data-k', `mesh/${i}`); });
  done.push(`${kids.length} marks of homotopy/start inside a <g data-layer>, each with a data-k`);
  const defs = now.querySelector('defs'), pat = defs.querySelector('pattern'), old = pat.id;
  pat.id = 'uf-7-hatch';
  for (const el of now.querySelectorAll('[fill]')) if (el.getAttribute('fill') === `url(#${old})`) el.setAttribute('fill', 'url(#uf-7-hatch)');
  now.prepend(defs);
  done.push('the hatch of homotopy/now defined first, under a generated id');
  document.querySelector('#homotopy-panel').setAttribute('data-explorable', 'homotopy');
  source.id = 'homotopy-3-source'; source.setAttribute('data-panel', 'source');
  const t = document.querySelector('#time');
  t.id = 'homotopy-3-t'; t.setAttribute('data-control', 't');
  for (const el of document.querySelectorAll('[for="time"]')) el.setAttribute('for', 'homotopy-3-t');
  done.push('the source drawing and the t slider addressed as the port addresses them');
  return done;
};
const PLANT = () => {
  const [first, second] = document.querySelectorAll('[data-panel="source"] circle.seam-probe');
  first.setAttribute('r', '3.6');
  second.setAttribute('filter', 'blur(1px)');
  const note = document.querySelector('#example-note');
  note.textContent = note.textContent.replace('stays', 'remains');
  // Inside the CLOSED <details>: CAPTURE sees it only because Chromium gives a
  // closed details' content client rects. If that ever changes, this refuses.
  const why = document.querySelector('#why');
  if (why.open) throw new Error('the Why? details should be closed here');
  const p = why.querySelector('#why-text p');
  p.textContent = p.textContent.replace('travel', 'move');
  return ['a seam probe of homotopy/source r 3.5 → 3.6', 'a filter on the other probe', 'one word of the example note',
          'one word of the closed Why? text'];
};
async function checkPipeline() {
  const pair = await openPair(DESKTOP, 'light', { listen: false });
  try {
    const page = pair.a;
    page.file = 'tests/fixtures/legacy-homotopy.html';
    await drive(page, byId.get('homotopy/obstructions/annulus_paths/t0.5').steps, 'pipeline self-check');
    const S0 = await snap(page);
    const rewrites = await page.evaluate(REWRITE, PORT_MAP_DATA);
    const S1 = await snap(page);
    const absorbed = diffCaptures(S0, S1, { kind: 'semantic', state: 'self-check' });
    const planted = await page.evaluate(PLANT);
    const S2 = await snap(page);
    const found = diffCaptures(S1, S2, { kind: 'semantic', state: 'self-check' });
    const want = ['marks homotopy/source r 3.5 → 3.6', 'marks homotopy/source paint.filter (absent) → blur(1px)',
                  'prose p: Every point remains in Y', 'prose p: Each point can move around'];
    const got = found.map(r => (r.category === 'marks' ? `marks ${r.drawing} ${r.field} ${r.legacy} → ${r.port}` : `${r.category} ${r.port}`));
    if (absorbed.length || got.length !== want.length || !want.every((w, k) => got[k].startsWith(w)))
      refuse('the capture pipeline failed its self-check',
        `rewrites (${rewrites.join('; ')}) left ${absorbed.length} difference(s)${absorbed.length ? `: ${absorbed.slice(0, 5).map(r => `${r.drawing ?? ''} ${r.field}: ${r.legacy} → ${r.port}`).join('; ')}` : ''}\n  ` +
        `planted (${planted.join('; ')}) gave: ${got.join('; ') || 'nothing'}`);
    selfChecks.push(`pipeline, live: ${rewrites.length} faithful rewrites absorbed (${rewrites.join('; ')}); ` +
      `${want.length} planted changes found and nothing else (${planted.join('; ')})`);
  } finally {
    await pair.close();
  }
}
await checkPipeline();

/** Run jobs on JOBS workers, each holding one context (a page per side) per viewport × scheme. */
async function pool(jobs, fn, label) {
  let next = 0, done = 0;
  const step = Math.max(1, Math.round(jobs.length / 10));
  const worker = async () => {
    let pair = null;
    try {
      while (next < jobs.length) {
        const job = jobs[next++];
        if (!pair || pair.combo !== job.combo) {
          if (pair) await pair.close();
          pair = await openPair(job.vp, job.scheme);
          pair.combo = job.combo;
        }
        try { await fn(job, pair); }
        catch (e) {
          problems.push(`${job.label}: ${String(e?.message ?? e).split('\n')[0]}`);
          await pair.close().catch(() => {});
          pair = null;
        }
        if (++done % step === 0 || done === jobs.length) console.log(`  ${label} ${done}/${jobs.length}  (${((Date.now() - T0) / 1000).toFixed(0)} s)`);
      }
    } finally {
      if (pair) await pair.close().catch(() => {});
    }
  };
  await Promise.all(Array.from({ length: Math.min(JOBS, jobs.length) }, worker));
}

// ---------------------------------------------------- per-state channels ----
const stateJobs = [];
{
  const add = (state, vp, scheme, sem, png) => stateJobs.push({ state, vp, scheme, sem, png,
    combo: `${vp.width}x${vp.height}/${scheme}`, label: `${state.id} @${vp.name} ${scheme}` });
  for (const scheme of SCHEMES) for (const vp of WIDTHS) {
    const sem = vp === DESKTOP && scheme === 'light';
    if (NO_PNG && !sem) continue;
    for (const s of STATE_LIST) add(s, vp, scheme, sem, !NO_PNG);
  }
  if (SWEEP && !NO_PNG) for (const scheme of SCHEMES) for (const vp of SWEEP_WIDTHS)
    for (const id of SWEEP_IDS) if (pick(byId.get(id))) add(byId.get(id), vp, scheme, false, true);
}
async function stateJob(job, pair) {
  const { state, vp, scheme } = job;
  await drivePair(pair, state.steps, job.label);
  if (job.png) {
    const [ia, ib] = await both(pair, p => p.screenshot({ fullPage: true, animations: 'disabled' }));
    stats.shots++;
    const r = await pixelRecord({ kind: 'png', state: state.id, width: vp.width, scheme },
      await comparePixels(ia, ib), `${scheme}/${safe(state.id)}@${vp.name}.png`);
    if (r) records.push(r); else stats.identical++;
  }
  if (job.sem) {
    const [A, B] = await both(pair, p => snap(p));
    records.push(...diffCaptures(A, B, { kind: 'semantic', state: state.id }));
    stats.semantic++;
  }
}

await rm(OUT, { recursive: true, force: true });
console.log(`port-parity: legacy = ${PAGE_A}, port = ${PAGE_B}`);
for (const c of selfChecks) console.log(`  self-check ok — ${c}`);
console.log(`  ${STATE_LIST.length} states (${STATE_LIST.filter(s => !TOOL_STATES.includes(s)).length} from tools/states.mjs` +
  `${STATE_LIST.some(s => TOOL_STATES.includes(s)) ? ` + ${STATE_LIST.filter(s => TOOL_STATES.includes(s)).length} tool-defined` : ''})` +
  `${NO_PNG ? ', semantics only' : `, ${WIDTHS.map(w => w.width).join('/')} px × ${SCHEMES.join('/')}`}` +
  `${SWEEP && !NO_PNG ? ` + sweep ${SWEEP_WIDTHS.map(w => w.width).join('/')} px` : ''}; ${JOBS} worker(s)`);
{
  const t = Date.now();
  await pool(stateJobs, stateJob, NO_PNG ? 'semantics' : 'states');
  phase.states = (Date.now() - t) / 1000;
}

// ----------------------------------------------------------- interaction ----
const F = [0.1, 0.3, 0.5, 0.7, 0.9];
const GRID = F.flatMap(fy => F.map(fx => [fx, fy]));
const KEYS = ['ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowUp', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowDown', 'Escape'];
const WIDGET_CONTROLS = {
  homotopy: { connect: '#connect', play: '#play', time: '#time' },
  equivalence: { connect: '#eq-connect', play: '#eq-play', time: '#eq-time' },
};
/**
 * What makes an interaction difference the same difference. No list position
 * is in it: a difference already there before the scenario began must stay
 * recognised when a mark or a paragraph appears before it — a key press that
 * shows the Clear button moves every later paragraph's index, and that is not
 * a new difference.
 */
const sigOf = r => JSON.stringify([r.category, r.drawing, String(r.field).replace(/\[\d+\]/g, '[]'), r.legacy, r.port]);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function configJob(job, pair) {
  const id = job.id, widget = widgetOf(id), ctl = WIDGET_CONTROLS[widget];
  const drawings = DRAWING_SELECTORS.filter(d => d.widget === widget);
  await drivePair(pair, byId.get(id).steps, `${id} (interaction)`);
  stats.configs++;
  const found = new Map();
  let baseline = null, lastA = null, lastRecs = null;
  /** Compare now; true when the legacy page changed since the last comparison. */
  const compare = async (scenario, step, o = {}) => {
    if (o.settle !== false) await both(pair, p => settle(p, STEP_SETTLE));
    let recs, changed = false;
    // Neither page mutated, and focus, hover, :active, values and scroll are as
    // they were: the capture cannot differ from the last one, so neither can the result.
    if (lastRecs && !o.only && !(await both(pair, p => p.evaluate(CHANGED))).some(Boolean)) {
      recs = lastRecs;
      stats.unchanged++;
    } else {
      const [A, B] = await both(pair, p => snap(p, { delta: true }));
      changed = lastA !== null && A.sig !== lastA;
      lastA = A.sig;
      recs = diffCaptures(A, B, { kind: 'interaction', state: id, scenario, step }, o);
      if (!o.only) lastRecs = recs;
    }
    if (!baseline) { baseline = new Set(recs.map(sigOf)); return changed; }
    stats.compares++;
    for (const r of recs) {
      const s = sigOf(r);
      if (baseline.has(s)) { stats.inherited++; continue; }
      const f = found.get(s);
      if (f) f.seen++; else found.set(s, { ...r, seen: 1 });
    }
    return changed;
  };
  const loc = sel => both(pair, p => locate(p, sel).then(r => r.locator));
  /** Scroll the legacy page's element into view, the port page to the same offset; the legacy box. */
  const inView = async ([la]) => {
    await la.scrollIntoViewIfNeeded();
    const s = await pair.a.evaluate(() => [scrollX, scrollY]);
    await pair.b.evaluate(([x, y]) => scrollTo(x, y), s);
    return la.boundingBox();
  };
  const clickBoth = async sel => { const [la, lb] = await loc(sel); await Promise.all([la.click({ timeout: 4000 }), lb.click({ timeout: 4000 })]); };

  // What already differs before any interaction is the state's: channel 2 reports it.
  await compare('setup', 'setup', { settle: false });

  // The keyboard, from the configuration's own selection (or none).
  for (const d of job.allKeys ? drawings : drawings.slice(0, 1)) {
    const [la, lb] = await loc(d.legacy);
    await Promise.all([la.focus(), lb.focus()]);
    stats.scenarios++;
    for (const [k, key] of KEYS.entries()) {
      await both(pair, p => p.keyboard.press(key));
      stats.keys++;
      await compare(`keyboard ${d.key}`, `${k + 1} ${key}`);
    }
  }
  // A 5×5 grid of presses in every drawing: the same client point on both pages.
  const sourceHits = [];
  for (const d of drawings) {
    const box = await inView(await loc(d.legacy));
    if (!box) { problems.push(`${id}: ${d.key} has no box on the legacy page`); continue; }
    stats.scenarios++;
    for (const [fx, fy] of GRID) {
      const x = box.x + fx * box.width, y = box.y + fy * box.height;
      await both(pair, p => p.mouse.move(x, y));
      await both(pair, p => p.mouse.down());
      stats.presses++;
      if (await compare(`grid ${d.key}`, `press ${fx},${fy}`) && d === drawings[0]) sourceHits.push([fx, fy]);
      await both(pair, p => p.mouse.up());
    }
    await compare(`grid ${d.key}`, 'release');
  }
  // A drag in the source drawing: from the first grid point that selected there, through the next three.
  {
    const box = await inView(await loc(drawings[0].legacy));
    const from = sourceHits[0] ?? [0.5, 0.5];
    const k0 = GRID.findIndex(([fx, fy]) => fx === from[0] && fy === from[1]);
    const at = ([fx, fy]) => [box.x + fx * box.width, box.y + fy * box.height];
    stats.scenarios++; stats.drags++;
    await both(pair, p => p.mouse.move(...at(from)));
    await both(pair, p => p.mouse.down());
    if (await compare('drag', `press ${from}`)) stats.dragsSelecting++;
    for (const k of [1, 2, 3]) {
      const q = GRID[(k0 + k) % GRID.length];
      await both(pair, p => p.mouse.move(...at(q), { steps: 4 }));
      await compare('drag', `move ${k} to ${q}`);
    }
    await both(pair, p => p.mouse.up());
    await compare('drag', 'release');
  }
  // The connectors, toggled and toggled back, with whatever is selected now.
  stats.scenarios++;
  for (const k of [1, 2]) { await clickBoth(ctl.connect); await compare('connections', `toggle ${k}`); }
  // Playback. The time reached depends on timing, so after the pause only the
  // prose and the controls are compared, readouts and sliders masked; then t is
  // set through the slider and everything is compared.
  stats.scenarios++;
  await clickBoth(ctl.play);
  await sleep(300);
  await clickBoth(ctl.play);
  await compare('playback', 'play, 300 ms, pause', { only: new Set(['prose', 'controls']), mask: true });
  await both(pair, p => applyStep(p, ['range', ctl.time, '0.25']));
  await compare('playback', 't = 0.25 through the slider');
  records.push(...found.values());
}

const TARGETS = map => {
  const vis = el => { const cs = getComputedStyle(el); return cs.display !== 'none' && cs.visibility !== 'hidden' && el.getClientRects().length > 0; };
  const q1 = s => { try { return s ? document.querySelector(s) : null; } catch { return null; } };
  const names = new Map();
  for (const [legacy, port] of map.controls) { const el = q1(legacy) ?? q1(port); if (el && !names.has(el)) names.set(el, legacy); }
  const doc = [document.documentElement.scrollWidth, document.documentElement.scrollHeight];
  return [...document.querySelectorAll('button, select')].filter(vis).map(el => {
    const r = el.getBoundingClientRect();
    return { name: names.get(el) ?? `${el.localName} "${el.textContent.replace(/\s+/g, ' ').trim().slice(0, 24)}"`,
             x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height, doc };
  });
};
const FOCUSED = map => {
  const el = document.activeElement;
  const doc = [document.documentElement.scrollWidth, document.documentElement.scrollHeight];
  if (!el || el === document.body || el === document.documentElement) return { name: '(the page)', box: null, doc };
  const q1 = s => { try { return s ? document.querySelector(s) : null; } catch { return null; } };
  let name = null;
  for (const [legacy, port] of map.controls) if ((q1(legacy) ?? q1(port)) === el) { name = legacy; break; }
  if (!name) for (const d of [...map.drawings, ...map.overlays]) if ((q1(d.legacy) ?? q1(d.port)) === el) { name = d.key; break; }
  const r = el.getBoundingClientRect();
  return { name: name ?? `${el.localName} "${el.textContent.replace(/\s+/g, ' ').trim().slice(0, 30)}"`,
           box: { x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height }, doc };
};
const clipOf = (b, m, doc) => {
  const x = Math.max(0, Math.floor(b.x - m)), y = Math.max(0, Math.floor(b.y - m));
  return { x, y, width: Math.min(doc[0], Math.ceil(b.x + b.w + m)) - x, height: Math.min(doc[1], Math.ceil(b.y + b.h + m)) - y };
};

/** Hover every shown button and select; walk Tab from the top. Compared as pixels of that control. */
async function lookJob(job, pair) {
  const id = job.id;
  await drivePair(pair, byId.get(id).steps, `${id} (hover/focus, ${pair.scheme})`);
  const base = { kind: 'interaction', state: id, scheme: pair.scheme, category: 'pixels' };
  const rel = (sc, step) => `interaction/${pair.scheme}/${safe(id)}/${sc}-${safe(step)}.png`;
  stats.scenarios++;
  for (const t of await pair.a.evaluate(TARGETS, PORT_MAP_DATA)) {
    await both(pair, p => p.evaluate(y => scrollTo(0, y), Math.max(0, Math.round(t.y - 150))));
    const sy = await pair.a.evaluate(() => scrollY);
    await pair.b.evaluate(y => scrollTo(0, y), sy);
    await both(pair, p => p.mouse.move(t.x + t.w / 2, t.y + t.h / 2 - sy));
    await both(pair, p => settle(p, STEP_SETTLE));
    const clip = clipOf(t, 2, t.doc);
    const [ia, ib] = await both(pair, p => p.screenshot({ fullPage: true, clip, animations: 'disabled' }));
    stats.hovers++;
    const r = await pixelRecord({ ...base, scenario: 'hover', step: t.name }, await comparePixels(ia, ib), rel('hover', t.name));
    if (r) records.push(r);
  }
  await both(pair, p => p.mouse.move(0, 0));
  // Start the sequential focus navigation at the top of the page: a zero-size,
  // out-of-flow element before everything, focused, then Tab.
  await both(pair, p => p.evaluate(() => {
    scrollTo(0, 0);
    const s = document.createElement('span');
    s.tabIndex = -1;
    s.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;overflow:hidden';
    document.body.prepend(s);
    s.focus({ preventScroll: true });
    window.__portParityStart = s;
  }));
  stats.scenarios++;
  for (let k = 1; k <= 60; k++) {
    await both(pair, p => p.keyboard.press('Tab'));
    if (k === 1) await both(pair, p => p.evaluate(() => window.__portParityStart?.remove()));
    await both(pair, p => settle(p, STEP_SETTLE));
    const [fa, fb] = await both(pair, p => p.evaluate(FOCUSED, PORT_MAP_DATA));
    stats.focusStops++;
    if (fa.name !== fb.name)
      records.push({ kind: 'interaction', state: id, scheme: pair.scheme, scenario: 'focus', step: `tab ${k}`,
                     category: 'focus', field: 'focused', legacy: fa.name, port: fb.name });
    if (!fa.box) break;                     // back to the page itself: the walk is complete
    const [ia, ib] = await both(pair, p => p.screenshot({ fullPage: true, clip: clipOf(fa.box, 10, fa.doc), animations: 'disabled' }));
    const r = await pixelRecord({ ...base, scenario: 'focus', step: `tab ${k} ${fa.name}` }, await comparePixels(ia, ib), rel('focus', `tab${k}`));
    if (r) records.push(r);
  }
}

if (!NO_INTERACT) {
  const t = Date.now();
  const jobs = [], firstOf = new Set();
  for (const id of CONFIG_IDS) {
    if (!pick(byId.get(id))) continue;
    const w = widgetOf(id);
    jobs.push({ id, kind: 'config', allKeys: !firstOf.has(w), vp: DESKTOP, scheme: 'light',
                combo: `${DESKTOP.width}x${DESKTOP.height}/light`, label: `${id} (interaction)` });
    firstOf.add(w);
  }
  for (const scheme of SCHEMES) for (const id of LOOK_IDS) if (pick(byId.get(id)))
    jobs.push({ id, kind: 'look', vp: DESKTOP, scheme, combo: `${DESKTOP.width}x${DESKTOP.height}/${scheme}`,
                label: `${id} (hover/focus, ${scheme})` });
  // The heavy configurations first, so the workers finish together.
  jobs.sort((x, y) => (x.kind === y.kind ? 0 : x.kind === 'config' ? -1 : 1));
  if (jobs.length) await pool(jobs, (job, pair) => (job.kind === 'config' ? configJob(job, pair) : lookJob(job, pair)), 'interaction');
  phase.interaction = (Date.now() - t) / 1000;
}

// ---------------------------------------------------------------- report ----
await browser.close();
await srv.close();

for (const d of records) { const a = allowanceFor(d); if (a) d.allowedBy = a.id; }
const measured = {
  png: NO_PNG ? null : {
    states: [...STATE_LIST.map(s => s.id), ...(SWEEP ? SWEEP_IDS.filter(id => pick(byId.get(id))) : [])],
    widths: [...WIDTHS.map(w => w.width), ...(SWEEP ? SWEEP_WIDTHS.map(w => w.width) : [])], schemes: SCHEMES },
  semantic: { states: STATE_LIST.map(s => s.id), widths: [DESKTOP.width], schemes: ['light'] },
  interaction: NO_INTERACT ? null : {
    states: [...CONFIG_IDS, ...LOOK_IDS].filter(id => pick(byId.get(id))), widths: [DESKTOP.width], schemes: SCHEMES },
};
measured.a11y = measured.semantic;
/** Did this run measure the allowance's scope? Only then is absorbing nothing an error. */
const exercised = a => {
  const m = measured[a.kind];
  if (!m) return false;
  const { state, width, scheme } = a.match;
  return (state === undefined || m.states.some(s => matchValue(s, state)))
      && (width === undefined || m.widths.some(w => matchValue(w, width)))
      && (scheme === undefined || m.schemes.some(s => matchValue(s, scheme)));
};
const absorbed = new Map(ALLOWANCES.map(a => [a.id, 0]));
for (const d of records) if (d.allowedBy) absorbed.set(d.allowedBy, absorbed.get(d.allowedBy) + 1);
const stale = ALLOWANCES.filter(a => !absorbed.get(a.id) && exercised(a));

const stateOrder = new Map([...HOMOTOPY_STATES, ...TOOL_STATES].map((s, i) => [s.id, i]));
const KIND_ORDER = { png: 0, semantic: 1, a11y: 2, interaction: 3 };
records.sort((x, y) => KIND_ORDER[x.kind] - KIND_ORDER[y.kind]
  || (stateOrder.get(x.state) ?? 0) - (stateOrder.get(y.state) ?? 0)
  || (y.width ?? 0) - (x.width ?? 0)
  || String(x.scheme ?? '').localeCompare(String(y.scheme ?? '')));

/** Two texts cut to the neighbourhood of their first difference. */
function contrast(a, b, n = 72) {
  a = String(a); b = String(b);
  if (a.length <= n && b.length <= n) return [a, b];
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const from = Math.max(0, i - 24);
  const cut = s => (from ? '…' : '') + s.slice(from, from + n) + (s.length > from + n ? '…' : '');
  return [cut(a), cut(b)];
}
function describe(d) {
  if (d.kind === 'png' || d.category === 'pixels') {
    const where = d.kind === 'png' ? `${d.state} @${d.width} ${d.scheme}` : `${d.state} · ${d.scenario} · ${d.step} (${d.scheme})`;
    if (d.field === 'size') return `${where}: page size ${d.legacy} → ${d.port}`;
    return `${where}: ${(d.ratio * 100).toFixed(3)}% (${d.changed} px), max delta ${d.maxDelta}, box ${d.box.join(',')}${d.file ? `  → ${d.file}` : ''}`;
  }
  const [l, p] = contrast(d.legacy ?? '', d.port ?? '');
  const parts = [d.state];
  if (d.kind === 'interaction') parts.push(d.scenario, d.step, ...(d.scheme ? [d.scheme] : []));
  if (d.drawing) parts.push(d.drawing);
  if (d.mark !== undefined) parts.push(`mark ${d.mark}${d.markPort !== undefined && d.markPort !== d.mark ? `→${d.markPort}` : ''}`);
  else if (d.markPort !== undefined) parts.push(`port mark ${d.markPort}`);
  parts.push(`${d.field}: ${l} → ${p}${d.note ? ` (${d.note})` : ''}${d.seen > 1 ? ` (in ${d.seen} steps)` : ''}`);
  return parts.join(' · ');
}
const groupBy = (list, f) => { const m = new Map(); for (const x of list) { const k = f(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return m; };
const LINES = PRINT_ALL ? Infinity : 25, PER_STATE = PRINT_ALL ? Infinity : 4;
for (const [title, kind] of [['PIXEL DIFFERENCES', 'png'], ['SEMANTIC DIFFERENCES', 'semantic'],
                             ['A11Y DIFFERENCES', 'a11y'], ['INTERACTION DIFFERENCES', 'interaction']]) {
  const list = records.filter(d => d.kind === kind);
  const allowed = list.filter(d => d.allowedBy).length;
  console.log(`\n${title}: ${list.length}${allowed ? ` (${allowed} allowed)` : ''}`);
  for (const [cat, items] of groupBy(list, d => (kind === 'png' ? 'pixels' : d.category))) {
    const byState = groupBy(items, d => d.state);
    console.log(`  ${cat}: ${items.length} in ${byState.size} state(s)`);
    let lines = 0, shown = 0;
    for (const its of byState.values()) {
      for (const d of its.slice(0, PER_STATE)) {
        if (lines >= LINES) break;
        console.log(`    ${describe(d)}${d.allowedBy ? `   [allowed: ${d.allowedBy}]` : ''}`);
        lines++; shown++;
      }
      if (lines >= LINES) break;
    }
    if (shown < items.length) console.log(`    … ${items.length - shown} more (every one is in report.json; --all prints them)`);
  }
}

console.log(`\nALLOWANCES: ${ALLOWANCES.length}${ALLOWANCES.length ? '' : ' (tools/port-parity.allow.mjs is empty)'}`);
for (const a of ALLOWANCES) {
  const n = absorbed.get(a.id);
  console.log(`  ${a.id} [${a.kind}]: ${n ? `absorbed ${n}` : exercised(a) ? 'STALE — its scope was measured and it absorbed nothing; delete it' : 'not exercised by this run'}`);
}
const uniq = [...new Set(problems)];
if (uniq.length) { console.log(`\nHARNESS PROBLEMS: ${uniq.length}`); for (const p of uniq.slice(0, 30)) console.log(`  ${p}`); }
if (pageErrors.size) { console.log(`\nPAGE ERRORS: ${pageErrors.size}`); for (const [m, e] of pageErrors) console.log(`  ${m}  (×${e.n}, first in ${e.where})`); }
if (consoleNotes.size) {
  console.log(`\nconsole messages (reported, not failures): ${consoleNotes.size}`);
  for (const [m, e] of [...consoleNotes].slice(0, 10)) console.log(`  ${m}  (×${e.n}, first in ${e.where})`);
}

const count = kind => { const l = records.filter(d => d.kind === kind), a = l.filter(d => d.allowedBy).length; return `${l.length}${a ? ` (${a} allowed)` : ''}`; };
const unallowed = records.filter(d => !d.allowedBy).length;
const secs = s => `${Math.round(s)} s`;
console.log(`\nTOTALS: png ${count('png')} · semantic ${count('semantic')} · a11y ${count('a11y')} · interaction ${count('interaction')}`);
console.log(`  compared: ${stats.shots} screenshot pairs (${stats.identical} identical), ${stats.semantic} states' semantics` +
  (NO_INTERACT ? '' : `; interaction: ${stats.configs} configurations, ${stats.scenarios} scenarios, ${stats.compares} comparisons ` +
    `(${stats.unchanged} with neither page changed since the one before; ` +
    `${stats.presses} presses, ${stats.keys} keys, ${stats.drags} drags — ${stats.dragsSelecting} selected on the press —, ` +
    `${stats.hovers} hovers, ${stats.focusStops} focus stops); ${stats.inherited} differences were already present before an ` +
    `interaction began and are left to the state's own report`));
console.log(`  time: ${secs((Date.now() - T0) / 1000)} (states ${secs(phase.states)}${phase.interaction !== undefined ? `, interaction ${secs(phase.interaction)}` : ''})`);
const failed = unallowed || stale.length || uniq.length || pageErrors.size;
console.log(failed
  ? `\nFAIL: ${[unallowed && `${unallowed} difference(s) not allowed`, stale.length && `${stale.length} stale allowance(s)`,
               uniq.length && `${uniq.length} harness problem(s)`, pageErrors.size && `${pageErrors.size} page error(s)`].filter(Boolean).join(', ')}`
  : records.length ? `\nPASS: all ${records.length} differences are allowed` : '\nPASS: no differences');

await mkdir(OUT, { recursive: true });
const plain = v => (v instanceof RegExp ? String(v) : Array.isArray(v) ? v.map(plain) : v);
await writeFile(join(OUT, 'report.json'), JSON.stringify({
  legacy: PAGE_A, port: PAGE_B,
  options: { only: ONLY, png: !NO_PNG, interact: !NO_INTERACT, sweep: SWEEP, jobs: JOBS },
  selfChecks, stats, seconds: { total: (Date.now() - T0) / 1000, ...phase },
  allowances: ALLOWANCES.map(a => ({ id: a.id, kind: a.kind, reason: a.reason,
    match: Object.fromEntries(Object.entries(a.match).map(([k, v]) => [k, plain(v)])),
    absorbed: absorbed.get(a.id), stale: stale.includes(a), exercised: exercised(a) })),
  problems: uniq, pageErrors: [...pageErrors].map(([m, e]) => ({ message: m, ...e })),
  console: [...consoleNotes].map(([m, e]) => ({ message: m, ...e })),
  differences: records,
}, null, 1));
console.log(`  report: ${join(OUT, 'report.json').slice(ROOT.length)}`);
process.exit(failed ? 1 : 0);
