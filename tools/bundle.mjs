#!/usr/bin/env node
// Single-file builds, for when a page has to travel.
//
//   node tools/bundle.mjs engine            -> engine/unfold.js
//   node tools/bundle.mjs page foo.html     -> dist/foo.html  (fully standalone)
//   node tools/bundle.mjs --self-test
//
// The modules are the source of truth; this is a convenience, not a build step.
// Pages on GitHub Pages load the modules directly. Run this when you want one
// file to email, archive, or open from a USB stick.
//
// Each module keeps its own scope inside a tiny registry, so two modules may
// both declare a local `clamp` without colliding. That is the whole reason this
// is a registry rather than a concatenation: concatenating ES modules into one
// scope works right up until two files pick the same helper name, and then it
// fails silently, at runtime, in the wrong module.
//
// Anything the transform does not fully understand is a hard error. A bundler
// that guesses produces a file that differs from the thing you tested.

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, join, normalize, relative, basename } from 'node:path';

// ------------------------------------------------------------- transform ----
const RE = {
  importNamed: /^\s*import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]\s*;?\s*$/,
  importStar: /^\s*import\s*\*\s*as\s+(\w+)\s+from\s*['"]([^'"]+)['"]\s*;?\s*$/,
  importBare: /^\s*import\s*['"]([^'"]+)['"]\s*;?\s*$/,
  importDefault: /^\s*import\s+(\w+)\s*(?:,|from)/,
  reexport: /^\s*export\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]\s*;?\s*$/,
  exportList: /^\s*export\s*\{([^}]*)\}\s*;?\s*$/,
  exportDecl: /^\s*export\s+(const|let|var|function\*?|class|async\s+function\*?)\s+(\w+)/,
  exportStar: /^\s*export\s*\*/,
  exportDefault: /^\s*export\s+default\b/,
};

const idOf = p => p.replace(/\.m?js$/, '');
const resolveSpec = (fromId, spec) => idOf(normalize(join(dirname(fromId), spec)));

/** Parse `a, b as c` into [{local, exported}]. */
const names = s => s.split(',').map(x => x.trim()).filter(Boolean).map(x => {
  const [local, exported] = x.split(/\s+as\s+/).map(y => y.trim());
  return { local, exported: exported ?? local };
});

/**
 * Rewrite one module into a registry factory.
 * @returns {{id:string, deps:string[], body:string, exports:string[]}}
 */
export function transform(id, src) {
  const deps = new Set();
  const exported = [];      // {local, exported}
  const reexports = [];     // {from, local, exported}
  const out = [];

  const lines = src.split('\n');
  lines.forEach((line, i) => {
    const where = `${id}.js:${i + 1}`;

    if (RE.exportDefault.test(line))
      throw new Error(`${where}: default export — the engine uses named exports only`);
    if (RE.exportStar.test(line) && !RE.reexport.test(line))
      throw new Error(`${where}: \`export *\` hides what a module provides; name the exports`);

    let m;
    if ((m = RE.reexport.exec(line))) {
      const dep = resolveSpec(id, m[2]);
      deps.add(dep);
      for (const n of names(m[1])) reexports.push({ from: dep, ...n });
      out.push('');
      return;
    }
    if ((m = RE.importNamed.exec(line))) {
      const dep = resolveSpec(id, m[2]);
      deps.add(dep);
      out.push(`const { ${m[1].trim()} } = __req(${JSON.stringify(dep)});`);
      return;
    }
    if ((m = RE.importStar.exec(line))) {
      const dep = resolveSpec(id, m[2]);
      deps.add(dep);
      out.push(`const ${m[1]} = __req(${JSON.stringify(dep)});`);
      return;
    }
    if ((m = RE.importBare.exec(line))) {
      const dep = resolveSpec(id, m[1]);
      deps.add(dep);
      out.push(`__req(${JSON.stringify(dep)});`);
      return;
    }
    if (RE.importDefault.test(line) && /\bfrom\b/.test(line))
      throw new Error(`${where}: default import — the engine uses named exports only`);
    // Anywhere in the line, not just at its start: `const x = import('./y.js')`
    // is the common shape. The lookbehind keeps `foo.import(` from matching.
    if (/(?<![\w.$])import\s*\(/.test(line))
      throw new Error(`${where}: dynamic import cannot be bundled into one file`);

    if ((m = RE.exportList.exec(line))) {
      for (const n of names(m[1])) exported.push(n);
      out.push('');
      return;
    }
    if ((m = RE.exportDecl.exec(line))) {
      exported.push({ local: m[2], exported: m[2] });
      out.push(line.replace(/^(\s*)export\s+/, '$1'));
      return;
    }
    if (/^\s*export\b/.test(line))
      throw new Error(`${where}: unrecognised export form: ${line.trim()}`);

    out.push(line);
  });

  const fields = [
    ...exported.map(n => `${JSON.stringify(n.exported)}: ${n.local}`),
    ...reexports.map(n => `${JSON.stringify(n.exported)}: __req(${JSON.stringify(n.from)}).${n.local}`),
  ];

  const body =
    `__def(${JSON.stringify(id)}, (__req) => {\n` +
    out.join('\n').replace(/\n+$/, '') + '\n' +
    `return { ${fields.join(', ')} };\n});`;

  return { id, deps: [...deps], body, exports: exported.map(n => n.exported) };
}

/** Kahn topological sort; names the cycle if there is one. */
export function order(modules) {
  const byId = new Map(modules.map(m => [m.id, m]));
  const indeg = new Map(modules.map(m => [m.id, 0]));
  for (const m of modules) for (const d of m.deps) {
    if (!byId.has(d)) throw new Error(`${m.id} imports ${d}, which was not collected`);
    indeg.set(m.id, indeg.get(m.id) + 1);
  }
  const ready = modules.filter(m => indeg.get(m.id) === 0).map(m => m.id).sort();
  const out = [];
  while (ready.length) {
    const id = ready.shift();
    out.push(byId.get(id));
    for (const m of modules) {
      if (!m.deps.includes(id)) continue;
      indeg.set(m.id, indeg.get(m.id) - 1);
      if (indeg.get(m.id) === 0) { ready.push(m.id); ready.sort(); }
    }
  }
  if (out.length !== modules.length) {
    const stuck = modules.filter(m => !out.includes(m)).map(m => m.id);
    throw new Error(`import cycle among: ${stuck.join(', ')}`);
  }
  return out;
}

const PRELUDE = `// Generated by tools/bundle.mjs — do not edit.
// The modules under engine/ are the source of truth.
const __mods = new Map();
const __cache = new Map();
const __def = (id, factory) => __mods.set(id, factory);
const __req = (id) => {
  if (__cache.has(id)) return __cache.get(id);
  const factory = __mods.get(id);
  if (!factory) throw new Error('unfold: missing module ' + id);
  const ns = {};
  __cache.set(id, ns);                 // set first, so a cycle sees a live object
  Object.assign(ns, factory(__req));
  return ns;
};
`;

export function link(modules, entry) {
  const sorted = order(modules);
  const body = sorted.map(m => m.body).join('\n\n');
  const ns = modules.find(m => m.id === entry);
  if (!ns) throw new Error(`entry ${entry} not found`);
  const exports = ns.exports.length
    ? `const __entry = __req(${JSON.stringify(entry)});\n` +
      `export const { ${ns.exports.join(', ')} } = __entry;\nexport default __entry;\n`
    : `export default __req(${JSON.stringify(entry)});\n`;
  return `${PRELUDE}\n${body}\n\n${exports}`;
}

// ----------------------------------------------------------------- files ----
async function walk(dir, out = []) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else if (/\.m?js$/.test(e.name) && e.name !== 'unfold.js') out.push(p);
  }
  return out;
}

// ------------------------------------------------------------- self-test ----
const FIXTURES = [
  {
    name: 'named imports and exports round-trip',
    files: {
      'a': `export const LAYER = 0;\nexport const one = () => 1;`,
      'b': `export const LAYER = 0;\nimport { one } from './a.js';\nexport const two = () => one() + 1;`,
    },
    entry: 'b',
    expect: src => src.includes('__def("a"') && src.includes('__def("b"') &&
                   src.indexOf('__def("a"') < src.indexOf('__def("b"'),
  },
  {
    name: 'local names may collide between modules',
    files: {
      'a': `export const LAYER = 0;\nconst clamp = x => x;\nexport const f = () => clamp(1);`,
      'b': `export const LAYER = 0;\nimport { f } from './a.js';\nconst clamp = x => -x;\nexport const g = () => clamp(f());`,
    },
    entry: 'b',
    // Both survive because each lives in its own factory scope.
    expect: src => (src.match(/const clamp/g) ?? []).length === 2,
  },
  {
    name: 're-export is resolved',
    files: {
      'a': `export const LAYER = 0;\nexport const one = 1;`,
      'i': `export const LAYER = 0;\nexport { one } from './a.js';`,
    },
    entry: 'i',
    expect: src => src.includes('__req("a").one'),
  },
  { name: 'default export is refused', files: { 'a': `export default 1;` }, entry: 'a', throws: /default export/ },
  { name: 'export * is refused', files: { 'a': `export * from './b.js';` }, entry: 'a', throws: /export \*/ },
  { name: 'dynamic import is refused', files: { 'a': `const x = import('./b.js');` }, entry: 'a', throws: /dynamic import/ },
  {
    name: 'import cycle is named',
    files: {
      'a': `export const LAYER = 0;\nimport { b } from './b.js';\nexport const a = 1;`,
      'b': `export const LAYER = 0;\nimport { a } from './a.js';\nexport const b = 2;`,
    },
    entry: 'a', throws: /cycle/,
  },
];

async function selfTest() {
  let failed = 0;
  for (const f of FIXTURES) {
    let src = null, err = null;
    try {
      const mods = Object.entries(f.files).map(([id, code]) => transform(id, code));
      src = link(mods, f.entry);
    } catch (e) { err = e; }

    let ok;
    if (f.throws) ok = err != null && f.throws.test(err.message);
    else if (err) ok = false;
    else ok = f.expect(src);

    // A produced bundle must also actually evaluate.
    if (ok && src && !f.throws) {
      try {
        await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
      } catch (e) { ok = false; err = e; }
    }

    console.log(`  ${ok ? 'ok   ' : 'FAIL '} ${f.name}`);
    if (!ok) { failed++; if (err) console.log(`        ${err.message}`); }
  }
  return failed;
}

// ---------------------------------------------------------------- main ------
const [cmd, arg] = process.argv.slice(2);

if (cmd === '--self-test' || process.argv.includes('--self-test')) {
  console.log('bundle self-test');
  const failed = await selfTest();
  console.log(failed ? `\n${failed} fixture(s) failed` : `\nall ${FIXTURES.length} fixtures pass`);
  process.exit(failed ? 1 : 0);
}

if (cmd === 'engine') {
  const paths = await walk('engine');
  if (!paths.length) {
    console.log('engine/ has no modules yet — nothing to bundle');
    process.exit(0);
  }
  const mods = [];
  for (const p of paths) {
    const id = idOf(relative('engine', p));
    mods.push(transform(id, await readFile(p, 'utf8')));
  }
  const entry = mods.find(m => m.id === 'index') ?? mods.find(m => m.id === 'page/index');
  if (!entry) { console.error('no engine/index.js entry point'); process.exit(1); }
  const src = link(mods, entry.id);
  await writeFile('engine/unfold.js', src);
  console.log(`engine/unfold.js — ${mods.length} modules, ${(src.length / 1024).toFixed(1)} KB`);
  process.exit(0);
}

if (cmd === 'page') {
  if (!arg) { console.error('usage: node tools/bundle.mjs page <file.html>'); process.exit(1); }
  let html = await readFile(arg, 'utf8');
  const seen = new Set();

  // Inline every local stylesheet and module the page references.
  html = await inline(html);
  await mkdir('dist', { recursive: true });
  const out = join('dist', basename(arg));
  await writeFile(out, html);
  console.log(`${out} — ${(html.length / 1024).toFixed(1)} KB, standalone`);
  process.exit(0);

  async function inline(doc) {
    const links = [...doc.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]*>/g)];
    for (const [tag] of links) {
      const href = /href=["']([^"']+)["']/.exec(tag)?.[1];
      if (!href || /^https?:/.test(href)) continue;
      const css = await readFile(href, 'utf8').catch(() => null);
      if (css != null) doc = doc.replace(tag, `<style>\n${css}\n</style>`);
    }
    const scripts = [...doc.matchAll(/<script[^>]*type=["']module["'][^>]*>([\s\S]*?)<\/script>/g)];
    for (const [tag, body] of scripts) {
      const specs = [...body.matchAll(/from\s*['"](\.[^'"]+)['"]/g)].map(m => m[1]);
      if (!specs.length) continue;
      const mods = [];
      for (const spec of specs) await collect(normalize(join(dirname(arg), spec)), mods);
      if (!mods.length) continue;
      const shim = mods.map(m => m.body).join('\n\n');
      let inlined = body;
      for (const spec of specs) {
        const id = idOf(normalize(join(dirname(arg), spec)));
        inlined = inlined.replace(
          new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*['"]${spec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]\\s*;?`),
          (_, n) => `const { ${n.trim()} } = __req(${JSON.stringify(id)});`);
      }
      doc = doc.replace(tag, `<script type="module">\n${PRELUDE}\n${shim}\n${inlined}\n</script>`);
    }
    return doc;
  }

  async function collect(path, acc) {
    const id = idOf(path);
    if (seen.has(id)) return;
    seen.add(id);
    const src = await readFile(path, 'utf8').catch(() => null);
    if (src == null) throw new Error(`cannot read ${path}`);
    const m = transform(id, src);
    for (const d of m.deps) await collect(d + '.js', acc);
    acc.push(m);
  }
}

console.log(`usage:
  node tools/bundle.mjs engine         build engine/unfold.js
  node tools/bundle.mjs page <f.html>  build dist/<f.html>, standalone
  node tools/bundle.mjs --self-test    verify the transform`);
process.exit(cmd ? 1 : 0);
