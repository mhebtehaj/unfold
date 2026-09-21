#!/usr/bin/env node
// Keeps index.html in step with SITE.
//
//   node tools/site.mjs           check: exit 1 and name what differs
//   node tools/site.mjs --write   rewrite the generated regions in place
//
// The homepage's chrome is static markup (see engine/page/shell.js for why),
// generated from SITE. Each generated region sits between a pair of markers:
//
//     <!-- uf:tiles -->
//     ...whatever shell.tiles() returns...
//     <!-- /uf:tiles -->
//
// Everything outside the markers is the page's own and is never touched. To
// add a page to the homepage, add it to SITE and run this with --write.

import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { SITE, shell } from '../engine/page/shell.js';

const FILE = 'index.html';

/** Region name -> the markup it must hold. */
export const REGIONS = {
  // Only once the homepage derives its favicon; see BRAND_MARK in shell.js.
  ...(SITE.home.mark ? { favicon: () => shell.icon(SITE.home) } : {}),
  brand: () => shell.brand(),
  tiles: () => shell.tiles(),
  footer: () => shell.footer(),
};

const open = name => `<!-- uf:${name} -->`;
const MARKER = name =>
  new RegExp(`^([ \\t]*)<!-- uf:${name} -->\\n([\\s\\S]*?)^[ \\t]*<!-- /uf:${name} -->$`, 'm');

/**
 * Regenerate every region in `html`. Line endings are normalised on the way in
 * and restored on the way out, so a CRLF checkout behaves like any other.
 * @returns {{html: string, stale: string[], missing: string[], duplicated: string[]}}
 */
export function regenerate(source) {
  const crlf = source.includes('\r\n');
  let html = source.replace(/\r\n/g, '\n');
  const stale = [], missing = [], duplicated = [];
  for (const [name, make] of Object.entries(REGIONS)) {
    const count = html.split(open(name)).length - 1;
    if (count > 1) { duplicated.push(name); continue; }
    const re = MARKER(name);
    const m = re.exec(html);
    if (!m) { missing.push(name); continue; }
    const indent = m[1];
    const body = make().split('\n').map(line => indent + line).join('\n') + '\n';
    if (m[2] !== body) stale.push(name);
    html = html.replace(re, () => `${indent}${open(name)}\n${body}${indent}<!-- /uf:${name} -->`);
  }
  return { html: crlf ? html.replace(/\n/g, '\r\n') : html, stale, missing, duplicated };
}

// ------------------------------------------------------------------ main ----
// pathToFileURL, not string concatenation: a space or a # in the path is
// percent-encoded in import.meta.url, and a mismatch here would skip the check
// and exit 0 — a gate that silently passes.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const write = process.argv.includes('--write');
  const before = await readFile(FILE, 'utf8');
  const { html, stale, missing, duplicated } = regenerate(before);

  if (missing.length || duplicated.length) {
    if (missing.length) console.error(`${FILE} has no marker pair for: ${missing.join(', ')}`);
    if (duplicated.length) console.error(`${FILE} has more than one region for: ${duplicated.join(', ')}`);
    process.exit(2);
  }
  if (!stale.length) {
    console.log(`${FILE} is in step with SITE (${Object.keys(REGIONS).length} regions)`);
    process.exit(0);
  }
  if (write) {
    await writeFile(FILE, html);
    console.log(`${FILE}: rewrote ${stale.join(', ')}`);
    process.exit(0);
  }
  console.log(`${FILE} is out of step with SITE in: ${stale.join(', ')}`);
  console.log('run `node tools/site.mjs --write` to regenerate those regions');
  process.exit(1);
}
