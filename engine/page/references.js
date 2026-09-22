// Layer 4 — citations, as one component.
//
// The site links three PDFs and deep-links into them by physical page:
// `…AT.pdf#page=38`. That precision is part of its voice, and it is also the
// part that rots — so every citation a page makes is registered here, and
// `cite.all()` hands the list to a link checker.
//
// The convention the shipped pages follow without naming it, kept exactly:
//
//   with a printed locator   Background: Winding number (Hatcher, §1.1).
//   without one              Background: Hatcher, homotopy equivalence.
//
// `pdfPage` is the page of the FILE and goes in the href fragment; `printed`
// is the page or section of the WORK and goes in the text. The two numbers
// differ on purpose — Hatcher's §1.1 starts on the file's 38th page — and a
// component that conflated them would quietly break every link.

export const LAYER = 4;

import { escapeHTML, html } from './prose.js';

/** The works the site cites. `url` is the file; a citation adds its own #page. */
export const SOURCES = Object.freeze({
  hatcher: Object.freeze({
    author: 'Hatcher', title: 'Algebraic Topology',
    url: 'https://pi.math.cornell.edu/~hatcher/AT/AT.pdf',
  }),
  bjorner: Object.freeze({
    author: 'Björner', title: 'Nerves, fibers and homotopy groups',
    url: 'https://webhomes.maths.ed.ac.uk/~v1ranick/papers/bjorner1.pdf',
  }),
  nanda: Object.freeze({
    author: 'Nanda', title: 'Computational Algebraic Topology, Lecture 2',
    url: 'https://people.maths.ox.ac.uk/~nanda/cat/Lecture%2002%20Homotopy.pdf',
  }),
});

/** Every citation made since load, for tools/links.mjs and for tests. */
const MADE = [];

/**
 * @typedef {Object} Citation
 * @property {string} key       a SOURCES key
 * @property {string} href      the deep link, with its #page fragment
 * @property {string} text      the sentence, ending in a full stop
 * @property {(o?:{class?:string}) => import('./prose.js').Rich} block   a <p> wrapping the link
 * @property {(o?:{class?:string}) => import('./prose.js').Rich} link    just the <a>
 */

/**
 * @param {keyof SOURCES} key
 * @param {object} [o]
 * @param {number} [o.pdfPage]   physical page of the file → `#page=`
 * @param {string} [o.printed]   printed page or section of the work → the text
 * @param {string} [o.label]     what is being cited, in the page's own words
 * @param {string} [o.lead='Background']  the opening word
 * @param {string} [o.text]      the whole sentence, when a page needs its own
 * @returns {Citation}
 */
export function cite(key, o = {}) {
  const source = SOURCES[key];
  if (!source) throw new Error(`cite: unknown source "${key}" — see SOURCES in page/references.js`);
  const { pdfPage, printed, label, lead = 'Background', text } = o;
  if (pdfPage !== undefined && (!Number.isInteger(pdfPage) || pdfPage < 1))
    throw new RangeError(`cite("${key}"): pdfPage is the file's page number, got ${pdfPage}`);

  const href = pdfPage === undefined ? source.url : `${source.url}#page=${pdfPage}`;
  const sentence = text ?? (printed
    ? `${lead}: ${label ?? source.title} (${source.author}, ${printed}).`
    : `${lead}: ${source.author}, ${label ?? source.title}.`);

  const anchor = () =>
    `<a href="${escapeHTML(href)}" target="_blank" rel="noopener">${escapeHTML(sentence)}</a>`;

  const citation = Object.freeze({
    key, source, href, text: sentence, pdfPage, printed, label,
    link: () => html(anchor()),
    // `uf-source` by default: a reference looks the same wherever it appears,
    // and a page that wants it to look different says so once.
    block: ({ class: cls = 'uf-source' } = {}) => html(`<p${cls ? ` class="${escapeHTML(cls)}"` : ''}>${anchor()}</p>`),
    toString: () => sentence,
  });
  MADE.push(citation);
  return citation;
}

/** Several citations on one line, joined by the house middle dot. */
cite.row = (...citations) => html(citations.map(c => c.link().html).join(' · '));

/** Every citation made on this page, for a link checker. */
cite.all = () => MADE.slice();

/** Test seam: forget what has been made. */
cite.reset = () => { MADE.length = 0; };
