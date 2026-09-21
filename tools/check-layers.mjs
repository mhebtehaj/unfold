#!/usr/bin/env node
// Enforces the Unfold Engine layering invariants.
//
//   node tools/check-layers.mjs              check engine/
//   node tools/check-layers.mjs --self-test  prove the checker catches violations
//   node tools/check-layers.mjs --list       print the declared module order
//
// This is a script, not a linter config, because the project has no build step
// and no dependency budget. It reads sources as text and applies four rules.
//
//   I1  Imports resolve downward only. An import from layer k must land on a
//       module in layer <= k; if the layer is equal, the target must come
//       strictly earlier in that layer's declared order. No cycles, by
//       construction.
//
//   I2  The pure set never touches the DOM. vec, labels, state, probe, palette,
//       camera, project, depth and occlude may not mention document, window,
//       matchMedia, requestAnimationFrame or getBoundingClientRect. This is
//       what lets the string-building explorers adopt LabelPlacer,
//       OcclusionTester, OrbitCamera and sortByDepth without adopting the DOM
//       renderer -- which is what makes the migration incremental.
//
//   I3  Colour literals live in exactly one file. No hex, rgb(, hsl( or
//       light-dark( outside render/palette.js. Colour reaches the DOM only as
//       var(--token) or color-mix().
//
//   I4  One forced layout per frame. Only core/viewport.js may call
//       getBoundingClientRect, getBBox, clientWidth or clientHeight.
//
// The y-flip rule -- only Viewport.toScreen/fromScreen negates y -- is a review
// rule, not a mechanical one; I4 is its enforceable half.

import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve, dirname, normalize } from 'node:path';

// ---------------------------------------------------------------- manifest --
// Order within a layer IS the dependency order. Adding a module means adding it
// here, deliberately, at the right position.
export const LAYERS = [
  { n: 0, dir: 'core',   order: ['vec', 'svg', 'a11y', 'viewport', 'labels', 'anim', 'state', 'controls', 'probe'] },
  { n: 1, dir: 'render', order: ['palette', 'camera', 'project', 'depth', 'occlude', 'marks', 'scene'] },
  { n: 2, dir: 'geom',   order: ['tolerance', 'claim', 'simplicial', 'cone', 'parametric', 'polytope', 'graph', 'grid', 'map', 'region'] },
  { n: 3, dir: 'domain', order: [] },   // subdirectories; order not constrained
  { n: 4, dir: 'page',   order: ['shell', 'prose', 'legend', 'references', 'controls-ui', 'panels', 'explorable', 'index'] },
];

export const PURE = new Set([
  'core/vec', 'core/labels', 'core/state', 'core/probe',
  'render/palette', 'render/camera', 'render/project', 'render/depth', 'render/occlude',
]);

const DOM_TOKENS = [
  'document', 'window', 'matchMedia', 'requestAnimationFrame',
  'cancelAnimationFrame', 'getBoundingClientRect', 'localStorage', 'navigator',
];
const LAYOUT_TOKENS = ['getBoundingClientRect', 'getBBox', 'clientWidth', 'clientHeight', 'offsetWidth', 'offsetHeight'];
const LAYOUT_ALLOWED = new Set(['core/viewport']);
const COLOUR_ALLOWED = new Set(['render/palette']);

const COLOUR_RE = [
  { name: 'hex colour', re: /#[0-9a-fA-F]{3,8}\b/g },
  { name: 'rgb()', re: /\brgba?\s*\(/g },
  { name: 'hsl()', re: /\bhsla?\s*\(/g },
  { name: 'light-dark()', re: /\blight-dark\s*\(/g },
];

// ------------------------------------------------------------------ helpers --
const IMPORT_RE =
  /(?:^|[\s;])(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|(?:^|[\s;])import\s*\(\s*['"]([^'"]+)['"]\s*\)|(?:^|[\s;])import\s*['"]([^'"]+)['"]/g;

/**
 * Blank out comments, and optionally string bodies, WITHOUT changing length or
 * line structure — every removed character becomes a space and newlines are
 * kept. That way an offset into the result is still a valid offset into the
 * original, so reported line numbers point at real lines.
 *
 * Two variants are needed. Import specifiers and colour literals live inside
 * strings, so those rules must keep strings. Identifier rules (DOM access,
 * layout reads) must drop strings, or the word "document" in a doc comment
 * would trip them.
 */
function blank(src, { strings }) {
  const out = src.split('');
  const erase = (from, to) => {
    for (let k = from; k < to && k < out.length; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') {
      const end = src.indexOf('\n', i); const to = end < 0 ? src.length : end;
      erase(i, to); i = to; continue;
    }
    if (c === '/' && d === '*') {
      const end = src.indexOf('*/', i + 2); const to = end < 0 ? src.length : end + 2;
      erase(i, to); i = to; continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) { if (src[j] === '\\') j++; j++; }
      if (strings) erase(i + 1, j);
      i = j + 1; continue;
    }
    i++;
  }
  return out.join('');
}

/** engine-relative "core/vec" from a path like "engine/core/vec.js". */
const idOf = p => p.replace(/^engine\//, '').replace(/\.m?js$/, '').replace(/\/index$/, '');

function layerOf(id) {
  const dir = id.split('/')[0];
  const l = LAYERS.find(x => x.dir === dir);
  return l ? l.n : null;
}
function orderOf(id) {
  const [dir, ...rest] = id.split('/');
  const l = LAYERS.find(x => x.dir === dir);
  if (!l || !l.order.length) return null;
  const i = l.order.indexOf(rest.join('/'));
  return i < 0 ? null : i;
}

/** Line number of the first match, for readable output. */
const lineOf = (src, index) => src.slice(0, index).split('\n').length;

// ------------------------------------------------------------------- rules --
/**
 * @param {{path:string, src:string}[]} files
 * @returns {{rule:string, file:string, line:number, msg:string}[]}
 */
export function check(files) {
  const problems = [];
  const known = new Set(files.map(f => idOf(f.path)));
  const add = (rule, file, line, msg) => problems.push({ rule, file, line, msg });

  for (const { path, src } of files) {
    const id = idOf(path);
    const layer = layerOf(id);
    const text = blank(src, { strings: false });   // strings kept: imports, colours
    const code = blank(src, { strings: true });    // strings dropped: identifiers

    if (layer === null) { add('layout', path, 1, `not under a known layer directory`); continue; }

    // Declared layer must match the directory it lives in.
    const declared = /export\s+const\s+LAYER\s*=\s*(\d+)/.exec(code);
    if (!declared) add('LAYER', path, 1, `missing \`export const LAYER = ${layer}\``);
    else if (Number(declared[1]) !== layer)
      add('LAYER', path, lineOf(src, declared.index),
          `declares LAYER = ${declared[1]} but lives in ${id.split('/')[0]}/ (layer ${layer})`);

    // A module in an ordered layer must be named in that layer's order list.
    const l = LAYERS.find(x => x.n === layer);
    if (l.order.length && orderOf(id) === null)
      add('manifest', path, 1, `not listed in LAYERS[${layer}].order — add it deliberately, in dependency position`);

    // -- I1: downward imports only ------------------------------------------
    IMPORT_RE.lastIndex = 0;
    for (let m; (m = IMPORT_RE.exec(text));) {
      const spec = m[1] ?? m[2] ?? m[3];
      if (!spec || !spec.startsWith('.')) {
        if (spec && !spec.startsWith('node:'))
          add('I1', path, lineOf(src, m.index), `bare import "${spec}" — the engine has no dependencies`);
        continue;
      }
      const target = idOf(normalize(join(dirname(path), spec)));
      const tl = layerOf(target);
      if (tl === null) {
        add('I1', path, lineOf(src, m.index), `import "${spec}" leaves the engine`);
        continue;
      }
      if (tl > layer) {
        add('I1', path, lineOf(src, m.index),
            `layer ${layer} imports layer ${tl} (${target}) — imports flow downward only`);
      } else if (tl === layer) {
        const a = orderOf(id), b = orderOf(target);
        if (a !== null && b !== null && b >= a)
          add('I1', path, lineOf(src, m.index),
              `${id} imports ${target}, which is not strictly earlier in layer ${layer}`);
      }
      if (known.size && !known.has(target) && !known.has(`${target}/index`))
        add('I1', path, lineOf(src, m.index), `import "${spec}" resolves to ${target}, which does not exist`);
    }

    // -- I2: the pure set is DOM-free ---------------------------------------
    if (PURE.has(id)) {
      for (const tok of DOM_TOKENS) {
        const re = new RegExp(`\\b${tok}\\b`, 'g');
        for (let m; (m = re.exec(code));) {
          add('I2', path, lineOf(src, m.index),
              `pure module touches \`${tok}\` — keep it DOM-free so string renderers can reuse it`);
          break;
        }
      }
    }

    // -- I3: colour literals live only in palette.js ------------------------
    if (!COLOUR_ALLOWED.has(id)) {
      for (const { name, re } of COLOUR_RE) {
        re.lastIndex = 0;
        // Hex is also how JS spells some bit masks; require 3/6/8 digits and a
        // non-word boundary to keep 0x1f from matching.
        for (let m; (m = re.exec(text));) {
          if (name === 'hex colour' && !/^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(m[0])) continue;
          add('I3', path, lineOf(src, m.index),
              `${name} literal ${m[0]} — colour belongs in render/palette.js, referenced as var(--token)`);
          break;
        }
      }
    }

    // -- I4: one forced layout per frame ------------------------------------
    if (!LAYOUT_ALLOWED.has(id)) {
      for (const tok of LAYOUT_TOKENS) {
        const re = new RegExp(`\\b${tok}\\b`, 'g');
        const m = re.exec(code);
        if (m) add('I4', path, lineOf(src, m.index),
                   `reads layout via \`${tok}\` — only core/viewport.js measures, once per frame`);
      }
    }
  }
  return problems;
}

// ------------------------------------------------------------------- files --
async function walk(dir, out = []) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else if (/\.m?js$/.test(e.name)) out.push(p);
  }
  return out;
}

// --------------------------------------------------------------- self-test --
const FIXTURES = [
  { name: 'clean tree passes', expect: [],
    files: [
      { path: 'engine/core/vec.js', src: 'export const LAYER = 0;\nexport const add = (a,b) => a.map((x,i)=>x+b[i]);' },
      { path: 'engine/core/viewport.js', src: "export const LAYER = 0;\nimport {add} from './vec.js';\nexport const measure = el => el.getBoundingClientRect();" },
      { path: 'engine/render/palette.js', src: "export const LAYER = 1;\nexport const FALLBACK = '#7360b5';" },
      { path: 'engine/render/scene.js', src: "export const LAYER = 1;\nimport {measure} from '../core/viewport.js';\nimport {FALLBACK} from './palette.js';" },
    ] },
  { name: 'I1 upward import', expect: ['I1'],
    files: [
      { path: 'engine/core/vec.js', src: "export const LAYER = 0;\nimport {x} from '../render/palette.js';" },
      { path: 'engine/render/palette.js', src: 'export const LAYER = 1;\nexport const x = 1;' },
    ] },
  { name: 'I1 same-layer backward import', expect: ['I1'],
    files: [
      { path: 'engine/core/vec.js', src: "export const LAYER = 0;\nimport {a} from './svg.js';" },
      { path: 'engine/core/svg.js', src: 'export const LAYER = 0;\nexport const a = 1;' },
    ] },
  { name: 'I1 bare dependency', expect: ['I1'],
    files: [{ path: 'engine/core/vec.js', src: "export const LAYER = 0;\nimport three from 'three';" }] },
  { name: 'I2 DOM in a pure module', expect: ['I2'],
    files: [{ path: 'engine/render/camera.js', src: 'export const LAYER = 1;\nconst w = window.innerWidth;' }] },
  { name: 'I2 allows DOM outside the pure set', expect: [],
    files: [{ path: 'engine/render/marks.js', src: 'export const LAYER = 1;\nconst el = document.createElement("i");' }] },
  { name: 'I3 hex outside palette', expect: ['I3'],
    files: [{ path: 'engine/render/marks.js', src: "export const LAYER = 1;\nconst c = '#ff0000';" }] },
  { name: 'I3 ignores hex inside strings only when stripped', expect: [],
    files: [{ path: 'engine/render/marks.js', src: 'export const LAYER = 1;\n// swatch is #ff0000 in the docs\nconst c = 1;' }] },
  { name: 'I4 layout read outside viewport', expect: ['I4'],
    files: [{ path: 'engine/render/scene.js', src: 'export const LAYER = 1;\nconst w = node.clientWidth;' }] },
  { name: 'missing LAYER export', expect: ['LAYER'],
    files: [{ path: 'engine/core/vec.js', src: 'export const add = 1;' }] },
  { name: 'wrong LAYER export', expect: ['LAYER'],
    files: [{ path: 'engine/core/vec.js', src: 'export const LAYER = 2;' }] },
  { name: 'unlisted module', expect: ['manifest'],
    files: [{ path: 'engine/core/mystery.js', src: 'export const LAYER = 0;' }] },
];

function selfTest() {
  let failed = 0;
  for (const f of FIXTURES) {
    const got = [...new Set(check(f.files).map(p => p.rule))].sort();
    const want = [...new Set(f.expect)].sort();
    const ok = got.join(',') === want.join(',');
    if (!ok) {
      failed++;
      console.log(`  FAIL  ${f.name}\n        expected [${want}] got [${got}]`);
      for (const p of check(f.files)) console.log(`          ${p.rule} ${p.file}:${p.line} ${p.msg}`);
    } else {
      console.log(`  ok    ${f.name}`);
    }
  }
  return failed;
}

// -------------------------------------------------------------------- main --
const args = process.argv.slice(2);

if (args.includes('--list')) {
  for (const l of LAYERS) {
    console.log(`layer ${l.n}  ${l.dir}/`);
    console.log(`  order: ${l.order.length ? l.order.join(' -> ') : '(unconstrained)'}`);
  }
  console.log(`\npure (DOM-free): ${[...PURE].join(', ')}`);
  process.exit(0);
}

if (args.includes('--self-test')) {
  console.log('check-layers self-test');
  const failed = selfTest();
  console.log(failed ? `\n${failed} fixture(s) failed` : `\nall ${FIXTURES.length} fixtures pass`);
  process.exit(failed ? 1 : 0);
}

const paths = await walk('engine');
const files = await Promise.all(paths.map(async p => ({ path: p, src: await readFile(p, 'utf8') })));
const problems = check(files);

// Always self-test: a checker that passes on an empty tree proves nothing.
const selfFailed = (() => {
  const quiet = [];
  for (const f of FIXTURES) {
    const got = [...new Set(check(f.files).map(p => p.rule))].sort().join(',');
    const want = [...new Set(f.expect)].sort().join(',');
    if (got !== want) quiet.push(f.name);
  }
  return quiet;
})();

if (selfFailed.length) {
  console.error(`check-layers is itself broken; failing fixtures: ${selfFailed.join(', ')}`);
  process.exit(2);
}

if (!files.length) {
  console.log(`engine/ has no modules yet — ${FIXTURES.length} self-test fixtures pass, checker is live`);
  process.exit(0);
}

if (!problems.length) {
  console.log(`${files.length} modules, all invariants hold (${FIXTURES.length} self-test fixtures pass)`);
  process.exit(0);
}

const byRule = {};
for (const p of problems) (byRule[p.rule] ??= []).push(p);
for (const [rule, list] of Object.entries(byRule)) {
  console.log(`\n${rule}  (${list.length})`);
  for (const p of list) console.log(`  ${p.file}:${p.line}  ${p.msg}`);
}
console.log(`\n${problems.length} problem(s) across ${files.length} modules`);
process.exit(1);
