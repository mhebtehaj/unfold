// page/shell.js — the SITE manifest and the chrome it generates, and the
// homepage and back-link bar built from them.
//
// The first suite is pure and runs anywhere. The second needs a document: it
// parses the real pages with DOMParser and measures fixtures in frames.

import { suite, assert } from './harness.mjs';
import { LAYER, SITE, shell, favicon, escapeHTML, BRAND_MARK } from '../engine/page/shell.js';
import * as barrel from '../engine/page/index.js';
import { HUES } from '../engine/render/palette.js';

const DOM = typeof document !== 'undefined';
const COLOUR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|light-dark)\(/;
const WITH_MARK = { ...SITE.home, mark: BRAND_MARK };

const deepFrozen = o => Object.isFrozen(o) &&
  Object.values(o).every(v => !v || typeof v !== 'object' || deepFrozen(v));

suite('shell', ({ test, known }) => {
  test('declares its layer, and the barrel re-exports it', () => {
    assert.equal(LAYER, 4);
    assert.equal(barrel.LAYER, 4);
    assert.ok(barrel.SITE === SITE && barrel.shell === shell && barrel.favicon === favicon);
  });

  test('SITE is deeply frozen', () => assert.ok(deepFrozen(SITE), 'some part of SITE is mutable'));

  test('every page is complete, unique and on a page hue', () => {
    const entries = [SITE.home, ...SITE.pages];
    const ids = entries.map(p => p.id), hrefs = entries.map(p => p.href);
    assert.equal(new Set(ids).size, ids.length, 'duplicate id');
    assert.equal(new Set(hrefs).size, hrefs.length, 'duplicate href');
    for (const p of entries) {
      assert.ok(/^[\w-]+\.html$/.test(p.href), `${p.id}: href ${p.href}`);
      assert.ok(Object.hasOwn(HUES, p.hue), `${p.id}: hue ${p.hue}`);
      assert.ok(p.title, `${p.id}: no title`);
    }
    for (const p of SITE.pages) assert.ok(p.blurb && p.art, `${p.id}: needs a blurb and an illustration`);
  });

  test('illustrations and marks paint in currentColor and nothing else', () => {
    const drawn = [...[SITE.home, ...SITE.pages].flatMap(p => [[`${p.id}.art`, p.art], [`${p.id}.mark`, p.mark]]),
                   ['BRAND_MARK', BRAND_MARK]];
    for (const [where, svg] of drawn) {
      if (!svg) continue;
      assert.ok(!COLOUR.test(svg), `${where} names a colour; the hue must drive it`);
      assert.ok(svg.includes('currentColor'), `${where} never uses currentColor`);
    }
  });

  test('escapeHTML covers text and both attribute quotes', () => {
    assert.equal(escapeHTML(`<a href="x">Tom & Jerry's</a>`),
      '&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;');
  });

  test('tiles(): one tile per page, hue as an attribute, text escaped', () => {
    const html = shell.tiles();
    assert.equal((html.match(/class="uf-tile"/g) ?? []).length, SITE.pages.length);
    for (const p of SITE.pages) assert.ok(html.includes(`href="${p.href}" data-hue="${p.hue}"`), p.id);
    assert.ok(html.includes('Realizations &amp; carriers'), 'ampersand must be escaped');
    assert.ok(!/style=/.test(html), 'a tile must not need an inline style');
    const odd = shell.tiles([{ id: 'x', href: 'a"b.html', title: '<b>', hue: 'teal', blurb: '&', art: '' }]);
    assert.ok(odd.includes('href="a&quot;b.html"') && odd.includes('<h2>&lt;b&gt;</h2>') && odd.includes('<p>&amp;</p>'));
  });

  test('tiles() refuses a hue that is not a page hue', () => {
    assert.throws(() => shell.tiles([{ id: 'x', href: 'x.html', title: 'X', hue: 'pink' }]));
    assert.throws(() => shell.tiles([{ id: 'x', href: 'x.html', title: 'X' }]));
  });

  test("the tiles' decorative arrows are hidden from the accessible name", () => {
    const arrows = shell.tiles().match(/↗/g) ?? [];
    assert.equal(arrows.length, SITE.pages.length);
    assert.equal((shell.tiles().match(/<span aria-hidden="true">↗<\/span>/g) ?? []).length, arrows.length);
  });

  known("the footer's decorative arrow is hidden from the accessible name",
        'Design-system audit finding 15 (low). Wrapping the arrow in an ' +
        'aria-hidden span splits the hover underline into two runs, and the ' +
        "arrow's run, drawn from a fallback font, sits a pixel lower. That is a " +
        'visible change and not an AA fix, so it waits for an explicit decision.',
        () => {
    assert.ok(shell.footer().includes('View on GitHub <span aria-hidden="true">↗</span>'),
      'the arrow is announced as part of the link name');
  });

  test('favicon(): a mark in the light value of the page hue, encoded as the site always has', () => {
    assert.equal(favicon(WITH_MARK),
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E" +
      "%3Cpath d='M4 8l8-4 8 8 8-4v16l-8 4-8-8-8 4z' fill='%237360b5'/%3E%3C/svg%3E");
    const teal = favicon({ ...WITH_MARK, hue: 'teal' });
    assert.ok(teal.includes(HUES.teal.light.replace('#', '%23')), 'the hue decides the paint');
  });

  test('favicon() survives the URL parser: whitespace collapses, nothing is lost', () => {
    const uri = favicon({ ...WITH_MARK, mark: '<path\n  d="M0 0h32v32H0z"\tfill="currentColor"/>' });
    assert.ok(!/[\n\t]/.test(uri), 'the URL parser would delete these, gluing attributes together');
    assert.ok(uri.includes("%3Cpath d='M0 0h32v32H0z' fill="), uri);
  });

  test('favicon() needs a mark, a page hue, and no apostrophe', () => {
    assert.throws(() => favicon(SITE.home), 'the homepage has not adopted a derived favicon');
    assert.throws(() => favicon(SITE.pages[0]), 'explorers gain a mark when they are ported');
    assert.throws(() => favicon({ ...WITH_MARK, hue: 'pink' }));
    assert.throws(() => favicon({ ...WITH_MARK, mark: `<text>it's</text>` }));
  });

  test('icon() escapes the URI for its double-quoted attribute', () => {
    const link = shell.icon({ ...WITH_MARK, mark: '<text fill="currentColor">A&amp;B</text>' });
    assert.ok(link.includes('A&amp;amp;B') && !/href="[^"]*"[^>]*"/.test(link), link);
  });

  test('title(): page first, brand last, joined by the house middle dot', () => {
    assert.equal(shell.title('Winding number'), 'Winding number · Unfold');
  });
});

// ------------------------------------------------------------ with a DOM ----
const parser = () => new DOMParser();
const page = async href => {
  const res = await fetch(`../${href}`);
  if (!res.ok) throw new Error(`${href}: HTTP ${res.status}`);
  return parser().parseFromString(await res.text(), 'text/html');
};
const fragment = markup => parser().parseFromString(`<body>${markup}</body>`, 'text/html').body.firstElementChild;

/** Whitespace between elements is formatting, not content. */
function strip(node) {
  for (const child of [...node.childNodes]) {
    if (child.nodeType === 3 && !child.nodeValue.trim()) child.remove();
    else if (child.nodeType === 1) strip(child);
  }
  return node;
}

function frame(src, width, height = 200) {
  return new Promise((ok, fail) => {
    const f = document.createElement('iframe');
    f.setAttribute('aria-hidden', 'true');
    f.tabIndex = -1;
    f.style.cssText = `position:absolute;left:-10000px;top:0;width:${width}px;height:${height}px;border:0`;
    f.onload = () => ok(f);
    f.onerror = () => fail(new Error(`${src} did not load`));
    f.src = src;
    document.body.append(f);
  });
}

const EXPLORERS = SITE.pages.map(p => p.href);

// What audit() says about each explorer today, exactly. A ratchet: a port
// that clears an item must delete its line here, and a change that adds one
// fails. The known test below keeps the total visible in every run.
const EXPLORER_AUDIT = {
  // homotopy-explorer.html cleared every item in Phase 4. Its line is gone
  // rather than emptied: a page that is clean has nothing to say here.
  'realization-carrier-explorer.html': [
    '<head> is missing <meta name="description">',
    '<head> is missing <meta name="color-scheme">',
    '<head> is missing <link rel="stylesheet" href="engine/unfold.css">',
    '2 inline <style> block(s)',
    '3 element(s) carry a style attribute',
  ],
  'ambiguity-explorer.html': [
    '<head> is missing <meta name="description">',
    '<head> is missing <meta name="color-scheme">',
    '<head> is missing a data-URI SVG favicon',
    '<head> is missing <link rel="stylesheet" href="engine/unfold.css">',
    '3 inline <style> block(s)',
  ],
};

const BOX = ['max-width', 'margin-left', 'margin-right', 'padding-top', 'padding-right',
             'padding-bottom', 'padding-left', 'font-family', 'font-size', 'line-height',
             'font-weight', 'box-sizing'];
const LINK = ['color', 'text-decoration-line', 'display', 'align-items', 'column-gap',
              'padding-top', 'padding-bottom', 'font-size', 'line-height'];
const STATE = ['color', 'outline-color', 'outline-style', 'outline-width', 'outline-offset',
               'border-top-left-radius'];

/** Resolve one rule's declarations on a stand-in element, in a frame's scheme. */
function resolveRule(f, selector, scheme, hue = null) {
  const doc = f.contentDocument;
  let rule = null;
  for (const sheet of doc.styleSheets) for (const r of sheet.cssRules) if (r.selectorText === selector) rule = r;
  if (!rule) throw new Error(`no rule ${selector}`);
  doc.documentElement.style.colorScheme = scheme;
  if (hue) doc.documentElement.dataset.hue = hue; else delete doc.documentElement.dataset.hue;
  const el = doc.createElement('a');
  doc.querySelector('nav').append(el);
  el.style.cssText = rule.style.cssText;
  const cs = f.contentWindow.getComputedStyle(el);
  const out = STATE.map(p => `${p}: ${cs.getPropertyValue(p)}`);
  el.remove();
  return out;
}

if (DOM) suite('shell/pages', ({ test, known }) => {
  test('index.html carries exactly the chrome SITE generates, once each', async () => {
    const doc = await page('index.html');
    const pairs = [
      ['header.uf-brand', shell.brand()],
      ['nav.uf-tiles', shell.tiles()],
      ['footer.uf-footer', shell.footer()],
    ];
    for (const [sel, markup] of pairs) {
      const found = doc.querySelectorAll(sel);
      assert.equal(found.length, 1, `index.html has ${found.length} ${sel}`);
      assert.ok(strip(found[0].cloneNode(true)).isEqualNode(strip(fragment(markup))),
        `${sel} differs from SITE — run \`node tools/site.mjs --write\``);
    }
  });

  test('the homepage keeps its original favicon until a derived one is adopted', async () => {
    const [now, before] = await Promise.all([page('index.html'), page('tests/fixtures/legacy-home.html')]);
    const href = d => d.querySelector('link[rel~="icon"]')?.getAttribute('href');
    if (SITE.home.mark) assert.equal(href(now), favicon(SITE.home), 'derived favicon');
    else assert.equal(href(now), href(before), 'the favicon changed without SITE.home.mark');
  });

  test('adopting the derived favicon would change its fill and nothing else', async () => {
    const before = (await page('tests/fixtures/legacy-home.html')).querySelector('link[rel~="icon"]').getAttribute('href');
    const svg = uri => parser().parseFromString(decodeURIComponent(uri.slice('data:image/svg+xml,'.length)), 'image/svg+xml');
    const [a, b] = [svg(before), svg(favicon(WITH_MARK))];
    assert.ok(!b.querySelector('parsererror'), 'the derived favicon does not parse');
    assert.equal(b.querySelector('path').getAttribute('fill'), HUES.violet.light);
    b.querySelector('path').setAttribute('fill', a.querySelector('path').getAttribute('fill'));
    assert.ok(a.documentElement.isEqualNode(b.documentElement), 'shape or structure differs');
  });

  test('index.html passes the head and page audit', async () => {
    assert.equal(shell.audit(await page('index.html'), SITE.home), []);
  });

  test('every page SITE lists exists', async () => {
    for (const p of [SITE.home, ...SITE.pages]) {
      const res = await fetch(`../${p.href}`, { method: 'HEAD' });
      assert.ok(res.ok, `${p.href}: HTTP ${res.status}`);
    }
  });

  test('audit() reports each broken convention, and never throws', () => {
    const bare = parser().parseFromString(
      '<!doctype html><html data-hue="pink"><head><title> </title><meta charset="utf-8">' +
      '<style>p{}</style><link rel="stylesheet" href="engine/unfold.css?v=3"></head>' +
      '<body><p style="color:red">x</p></body></html>', 'text/html');
    const out = shell.audit(bare);
    for (const want of ['no lang', 'data-hue="pink"> is not a page hue', 'missing <meta name="viewport">',
                        'missing <meta name="description">', 'missing a data-URI SVG favicon',
                        'order is title · charset', '<title> is empty', '1 inline <style> block',
                        'style attribute'])
      assert.ok(out.some(line => line.includes(want)), `audit did not report: ${want}\n        got ${JSON.stringify(out)}`);
    assert.ok(!out.some(line => line.includes('unfold.css')), 'a cache-busting query is still the stylesheet');
    assert.equal(shell.audit(parser().parseFromString('', 'text/html')).length > 0, true);
  });

  test("audit() still says exactly what it said about each explorer (a ratchet)", async () => {
    for (const href of EXPLORERS) {
      const entry = SITE.pages.find(p => p.href === href);
      assert.equal(shell.audit(await page(href), entry), EXPLORER_AUDIT[href] ?? [], href);
    }
  });

  known('the explorers follow the head convention',
        'The homotopy explorer cleared in Phase 4. The other two still do not link ' +
        'engine/unfold.css or carry <meta name="color-scheme">, both style themselves ' +
        'inline, neither has a description, and the ambiguity page has no favicon. ' +
        'Each clears as its page is ported (Phases 5–6); the ratchet above holds ' +
        'the list exact until then.',
        async () => {
    const problems = Object.values(EXPLORER_AUDIT).flat();
    assert.equal(problems, [], `${problems.length} problem(s)`);
  });

  test('each explorer carries the frozen back-link bar, or the engine one', async () => {
    const fixture = await page('tests/fixtures/legacy-nav.html');
    const want = fixture.querySelector('#unfold-navigation-style').textContent;
    const wantNav = strip(fixture.querySelector('nav')).outerHTML;
    for (const href of EXPLORERS) {
      const doc = await page(href);
      const style = doc.querySelector('#unfold-navigation-style');
      if (!style) {
        // Ported: the copy is gone, and the back link must now be the engine's.
        assert.ok(doc.querySelector('nav.uf-nav a[href="index.html"]'), `${href} lost its back link`);
        continue;
      }
      assert.equal(style.textContent, want, `${href} <style id="unfold-navigation-style">`);
      assert.equal(strip(doc.querySelector('nav.unfold-navigation')).outerHTML, wantNav, `${href} <nav>`);
    }
  });

  test('.uf-nav is a drop-in for the back-link bar on the default accent: box, type, colour', async () => {
    for (const width of [1280, 800, 500]) {
      const [a, b] = await Promise.all([frame('fixtures/legacy-nav.html', width), frame('fixtures/uf-nav.html', width)]);
      try {
        for (const scheme of ['light', 'dark']) {
          const probe = f => {
            const doc = f.contentDocument, view = f.contentWindow;
            doc.documentElement.style.colorScheme = scheme;
            const nav = doc.querySelector('nav'), link = nav.querySelector('a'), glyph = link.querySelector('span');
            const rect = el => { const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(v => Math.round(v * 100) / 100); };
            const css = (el, props) => { const cs = view.getComputedStyle(el); return props.map(p => `${p}: ${cs.getPropertyValue(p)}`); };
            return { nav: css(nav, BOX), link: css(link, LINK), rects: [rect(nav), rect(link), rect(glyph)] };
          };
          const legacy = probe(a), engine = probe(b), at = `${width}px ${scheme}`;
          assert.equal(engine.nav, legacy.nav, `nav at ${at}`);
          assert.equal(engine.link, legacy.link, `link at ${at}`);
          assert.equal(engine.rects, legacy.rects, `geometry at ${at}`);
        }
      } finally { a.remove(); b.remove(); }
    }
  });

  test('.uf-nav hover and focus resolve to the colours the copies hardcode, on the default accent', async () => {
    const [a, b] = await Promise.all([frame('fixtures/legacy-nav.html', 1280), frame('fixtures/uf-nav.html', 1280)]);
    try {
      for (const scheme of ['light', 'dark']) for (const state of ['hover', 'focus-visible'])
        assert.equal(resolveRule(b, `.uf-nav a:${state}`, scheme), resolveRule(a, `.unfold-navigation a:${state}`, scheme),
          `${state} ${scheme}`);
    } finally { a.remove(); b.remove(); }
  });

  test('under a page hue, the back link hovers and focuses in that hue', async () => {
    const b = await frame('fixtures/uf-nav.html', 1280);
    try {
      for (const hue of Object.keys(HUES)) for (const scheme of ['light', 'dark']) {
        const want = HUES[hue][scheme].match(/\w\w/g).map(h => parseInt(h, 16)).join(', ');
        for (const state of ['hover', 'focus-visible']) {
          const got = resolveRule(b, `.uf-nav a:${state}`, scheme, hue);
          const prop = state === 'hover' ? 'color' : 'outline-color';
          assert.ok(got.includes(`${prop}: rgb(${want})`), `${hue} ${scheme} ${state}: ${got}`);
        }
      }
    } finally { b.remove(); }
  });
});
