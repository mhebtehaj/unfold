// Page chrome: the SITE manifest, and the markup every page's chrome is made of.
//
// SITE is the one place a page is declared — its address, title, hue, blurb and
// homepage illustration. The homepage tiles, the favicons, the <title>
// convention and the footer are all derived from it, so a page's accent is
// stated once and reaches its tile, its favicon and (once ported) the page
// itself.
//
// Everything here returns markup as a string and touches no DOM, so the same
// functions serve the browser tests and tools/site.mjs, which writes this
// markup into index.html. The homepage carries that markup statically rather
// than rendering it at load, for the reason the Layer 4 spec gives for the back
// link: navigation injected by JavaScript is navigation lost without it. The
// homepage is the site's navigation, so it keeps working with scripts off and
// from file://, and tests/shell.test.mjs fails the moment it drifts from SITE.
//
// What shell.js does not own is the rest of <head>: <meta name=color-scheme>
// has to be static so the browser can pick a background before CSS arrives.
// audit() checks that convention instead of generating it.

import { HUES } from '../render/palette.js';

export const LAYER = 4;

// ------------------------------------------------------------------ SITE ----
const BRAND_PATH = 'M4 8l8-4 8 8 8-4v16l-8 4-8-8-8 4z';

/**
 * The folded ribbon, as a favicon mark. Not yet in SITE.home: the homepage's
 * favicon is still the original #7968bf, and deriving it would repaint it in
 * --violet (#7360b5) — the colour of the brand mark beside it on the page, but
 * a visible change that is not an accessibility fix, so it waits for a
 * decision. Adopting it is `mark: BRAND_MARK` below plus a `favicon` region in
 * index.html (tools/site.mjs picks it up).
 */
export const BRAND_MARK = `<path d="${BRAND_PATH}" fill="currentColor"/>`;

const freeze = o => {
  for (const v of Object.values(o)) if (v && typeof v === 'object') freeze(v);
  return Object.freeze(o);
};

/**
 * @typedef {{
 *   id: string, href: string, title: string, hue: keyof HUES,
 *   blurb?: string,   // one line, the tile copy
 *   art?: string,     // 260x170 illustration, painted in currentColor only
 *   mark?: string,    // 32x32 favicon mark, painted in currentColor only
 * }} PageEntry
 */
export const SITE = freeze({
  name: 'Unfold',
  repo: 'https://github.com/mhebtehaj/unfold',
  tagline: 'Small experiments. Clearer intuition.',

  /** @type {PageEntry} */
  home: {
    id: 'home', href: 'index.html', title: 'Unfold — Interactive mathematics', hue: 'violet',
  },

  /**
   * The explorers, in homepage order. Each illustration is a static frame of
   * the explorer it opens, in the explorer's own drawing grammar: opacity for
   * depth, dashes for what is absent or behind, a ring for the selection.
   * An explorer gains a `mark` (and so a derived favicon) when it is ported.
   * @type {PageEntry[]}
   */
  pages: [
    {
      id: 'homotopy', href: 'homotopy-explorer.html', title: 'Homotopies', hue: 'violet',
      blurb: 'Follow a map as it changes. See what can deform—and what gets in the way.',
      art: '<path d="M37 116C68 22 193 22 224 116" stroke="currentColor" stroke-width="2" opacity=".2"/>' +
        '<path d="M37 116C75 47 185 67 224 116" stroke="currentColor" stroke-width="2" opacity=".45"/>' +
        '<path d="M37 116C78 99 170 47 224 116" stroke="currentColor" stroke-width="3"/>' +
        '<path d="M37 116H224" stroke="currentColor" stroke-width="2" stroke-dasharray="4 6" opacity=".22"/>' +
        '<circle cx="135" cy="82" r="7" fill="currentColor"/>' +
        '<circle cx="135" cy="82" r="13" stroke="currentColor" opacity=".3"/>' +
        '<circle cx="37" cy="116" r="4" fill="currentColor"/>' +
        '<circle cx="224" cy="116" r="4" fill="currentColor"/>',
    },
    {
      id: 'realization', href: 'realization-carrier-explorer.html', title: 'Realizations & carriers', hue: 'teal',
      blurb: 'Turn faces into spaces. Give each face a region, then build a map inside it.',
      art: '<path d="M52 125L130 35L210 125Z" fill="currentColor" opacity=".09"/>' +
        '<path d="M52 125L130 35L210 125Z" stroke="currentColor" stroke-width="2"/>' +
        '<path d="M130 35L130 97M52 125L130 97L210 125" stroke="currentColor" stroke-dasharray="4 5" opacity=".4"/>' +
        '<circle cx="130" cy="97" r="24" fill="currentColor" opacity=".12"/>' +
        '<circle cx="130" cy="97" r="7" fill="currentColor"/>' +
        '<circle cx="130" cy="97" r="12" stroke="currentColor" opacity=".5"/>' +
        '<g fill="currentColor"><circle cx="52" cy="125" r="4"/><circle cx="130" cy="35" r="4"/><circle cx="210" cy="125" r="4"/></g>',
    },
    {
      id: 'ambiguity', href: 'ambiguity-explorer.html', title: 'Ambiguity', hue: 'orange',
      blurb: 'Reveal an input one query at a time. Watch the geometry of uncertainty change.',
      art: '<path d="M130 25L54 85L130 145L206 85Z" fill="currentColor" opacity=".07"/>' +
        '<path d="M130 25L54 85L130 145L206 85ZM54 85L130 67L206 85M130 25V145" stroke="currentColor" stroke-width="1.5" opacity=".3"/>' +
        '<path d="M54 85L130 103L206 85M130 25L130 103L130 145" stroke="currentColor" stroke-width="2.5"/>' +
        '<path d="M54 85L130 25L206 85" stroke="currentColor" stroke-width="2.5"/>' +
        '<g fill="currentColor"><circle cx="130" cy="25" r="5"/><circle cx="54" cy="85" r="5"/><circle cx="130" cy="103" r="5"/><circle cx="206" cy="85" r="5"/><circle cx="130" cy="145" r="5"/></g>',
    },
  ],
});

// ---------------------------------------------------------------- markup ----
const ENTITY = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Text or attribute value, escaped for HTML. */
export const escapeHTML = s => String(s).replace(/[&<>"']/g, c => ENTITY[c]);

/** Decorative glyphs are hidden, so a link's name is its words, not "north east arrow". */
const glyph = g => `<span aria-hidden="true">${g}</span>`;

function hueOf(entry) {
  if (!Object.hasOwn(HUES, entry?.hue))
    throw new Error(`${entry?.id ?? 'page'}: hue "${entry?.hue}" is not a page hue (${Object.keys(HUES).join(', ')})`);
  return entry.hue;
}

/** The homepage brand: the folded-ribbon mark and the name. */
function brand() {
  return '<header class="uf-brand"><svg viewBox="0 0 32 32" fill="none" aria-hidden="true">' +
    `<path d="${BRAND_PATH}" fill="currentColor" opacity=".14"/>` +
    `<path d="${BRAND_PATH}M12 4v16m8-8v16" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>` +
    `</svg>${escapeHTML(SITE.name)}</header>`;
}

/** The homepage tiles, one per SITE page, as lines indented two spaces a level. */
function tiles(pages = SITE.pages) {
  const lines = ['<nav class="uf-tiles" aria-label="Choose an explorer">'];
  for (const p of pages) {
    lines.push(
      `  <a class="uf-tile" href="${escapeHTML(p.href)}" data-hue="${hueOf(p)}">`,
      `    <div class="uf-tile__art"><svg viewBox="0 0 260 170" fill="none" aria-hidden="true">${p.art ?? ''}</svg></div>`,
      `    <div class="uf-tile__copy"><h2>${escapeHTML(p.title)}</h2><p>${escapeHTML(p.blurb ?? '')}</p>` +
        `<span class="uf-tile__cta">Explore${glyph('↗')}</span></div>`,
      '  </a>');
  }
  lines.push('</nav>');
  return lines.join('\n');
}

/**
 * The site footer. Its arrow is announced ("north east arrow"): hiding it in a
 * span splits the hover underline into two runs, and the arrow's run, drawn
 * from a fallback font, sits a pixel lower. Not an AA failure, so the fidelity
 * rule keeps the old markup; tests/shell.test.mjs tracks it as a known issue.
 */
function footer() {
  return `<footer class="uf-footer"><span>${escapeHTML(SITE.tagline)}</span>` +
    `<a href="${escapeHTML(SITE.repo)}">View on GitHub ↗</a></footer>`;
}

/**
 * A page's favicon as a data URI: its mark, painted in the light value of its
 * hue. Favicons draw on browser chrome, not on the page, so one value serves
 * both schemes, and it is the page's own hue rather than a colour of its own.
 * Encoded the way the site always has: single quotes, and only < > # %
 * escaped. Whitespace collapses to single spaces first, because the URL parser
 * deletes newlines outright and `<path\nd=` would become `<pathd=`.
 * @param {PageEntry} entry
 */
export function favicon(entry) {
  const hue = HUES[hueOf(entry)];
  if (!entry.mark) throw new Error(`${entry.id}: no favicon mark in SITE`);
  if (entry.mark.includes("'"))
    throw new Error(`${entry.id}: a mark may not contain ' — its attributes are single-quoted in the URI`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${entry.mark}</svg>`
    .replace(/\s+/g, ' ')
    .replaceAll('currentColor', hue.light)
    .replaceAll('"', "'");
  return 'data:image/svg+xml,' +
    svg.replace(/%/g, '%25').replace(/</g, '%3C').replace(/>/g, '%3E').replace(/#/g, '%23');
}

/** The <link rel="icon"> for a page; the URI is escaped for a double-quoted attribute. */
const icon = entry =>
  `<link rel="icon" href="${favicon(entry).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">`;

/** "Winding number" -> "Winding number · Unfold": page first, brand last. */
const title = page => `${page} · ${SITE.name}`;

// ----------------------------------------------------------------- audit ----
// The head convention, in order. A page may carry more than this; it may not
// carry less, and what it carries must come in this order.
const HEAD = [
  ['charset', '<meta charset>'],
  ['viewport', '<meta name="viewport">'],
  ['description', '<meta name="description">'],
  ['color-scheme', '<meta name="color-scheme">'],
  ['title', '<title>'],
  ['favicon', 'a data-URI SVG favicon'],
  ['stylesheet', '<link rel="stylesheet" href="engine/unfold.css">'],
];

function kindOf(el) {
  const tag = el.localName;
  if (tag === 'meta' && el.hasAttribute('charset')) return 'charset';
  if (tag === 'meta') {
    const name = (el.getAttribute('name') ?? '').toLowerCase();
    return ['viewport', 'description', 'color-scheme'].includes(name) ? name : null;
  }
  if (tag === 'title') return 'title';
  if (tag === 'link') {
    const rel = (el.getAttribute('rel') ?? '').toLowerCase().split(/\s+/);
    if (rel.includes('icon')) return 'favicon';
    if (rel.includes('stylesheet') && /(^|\/)engine\/unfold\.css([?#].*)?$/.test(el.getAttribute('href') ?? ''))
      return 'stylesheet';
  }
  return null;
}

/**
 * Check a document against the house conventions. Returns one line per
 * problem and never throws; an empty array is a clean page. Works on the live
 * document or on one parsed with DOMParser, which is how the tests audit pages
 * without opening them.
 * @param {Document} doc
 * @param {PageEntry} [entry]  the page's SITE entry, for the checks that need it
 * @returns {string[]}
 */
function audit(doc, entry) {
  const out = [];
  const html = doc.documentElement;
  if (!html.getAttribute('lang')) out.push('<html> has no lang');

  // No data-hue means the default accent, which is what every explorer has
  // today. A page that takes a hue must take the one SITE gives it.
  const hue = html.getAttribute('data-hue');
  if (hue !== null && !Object.hasOwn(HUES, hue)) out.push(`<html data-hue="${hue}"> is not a page hue`);
  else if (hue !== null && entry && entry.hue !== hue) out.push(`<html data-hue="${hue}"> but SITE says "${entry.hue}"`);

  const seen = [];
  for (const el of doc.head?.children ?? []) {
    const k = kindOf(el);
    if (k && !seen.includes(k)) seen.push(k);
  }
  for (const [k, label] of HEAD) if (!seen.includes(k)) out.push(`<head> is missing ${label}`);
  const expected = HEAD.map(([k]) => k).filter(k => seen.includes(k));
  if (seen.join() !== expected.join())
    out.push(`<head> order is ${seen.join(' · ')}; the convention is ${expected.join(' · ')}`);

  const scheme = doc.querySelector('meta[name="color-scheme"]')?.getAttribute('content');
  if (scheme != null && scheme.trim() !== 'light dark')
    out.push(`<meta name="color-scheme"> is "${scheme}", not "light dark"`);

  const titleEl = doc.querySelector('title');
  const docTitle = titleEl?.textContent.trim() ?? '';
  if (titleEl && !docTitle) out.push('<title> is empty');
  else if (entry?.id === 'home') {
    if (docTitle !== entry.title) out.push(`<title> is "${docTitle}", SITE says "${entry.title}"`);
  } else if (titleEl && !docTitle.endsWith(` · ${SITE.name}`)) {
    out.push(`<title> "${docTitle}" does not end " · ${SITE.name}"`);
  }

  const link = doc.querySelector('link[rel~="icon"]');
  const href = link?.getAttribute('href') ?? '';
  if (link && !href.startsWith('data:image/svg+xml,')) out.push('the favicon is not a data-URI SVG');
  else if (link && entry?.mark && href !== favicon(entry))
    out.push(`the favicon is not the one SITE derives for "${entry.id}"`);

  // Inline style stops applying under style-src 'self' — attributes and
  // <style> blocks alike. The page hue exists so that no page needs either.
  const blocks = doc.querySelectorAll('style').length;
  if (blocks) out.push(`${blocks} inline <style> block(s)`);
  const styled = doc.body?.querySelectorAll('[style]').length ?? 0;
  if (styled) out.push(`${styled} element(s) carry a style attribute`);

  return out;
}

/** The chrome, as markup. See the notes on each function. */
export const shell = Object.freeze({ brand, tiles, footer, icon, title, audit });
