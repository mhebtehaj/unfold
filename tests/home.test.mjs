// The ported homepage against the original, element by element.
//
// The baseline holds index.html to its captured default state at three widths.
// This holds it to the original page itself -- tests/fixtures/legacy-home.html,
// frozen before the engine -- at the widths either side of every breakpoint,
// in both schemes, and through the hover, focus and reduced-motion rules that
// no screenshot catches. Each page loads in its own frame; every element of
// the two documents is paired by document order and every computed property
// compared, plus its box.
//
// Exactly one difference is allowed, and it is spelled out below: the --orange
// AA fix. When the homepage deliberately changes, add the change to ALLOWED
// with its reason, or retire this test.
//
// Browser-only (tools/run-tests.mjs); under node it registers nothing.

import { suite, assert } from './harness.mjs';

const DOM = typeof document !== 'undefined';

/** [ported value, original value]: the differences a reviewer has accepted. */
const ALLOWED = [
  // --orange light #b46942 -> #a35c37: 4.17:1 -> 5.07:1 on the tile (AA).
  ['rgb(163, 92, 55)', 'rgb(180, 105, 66)'],
];
const allow = v => ALLOWED.reduce((s, [now, was]) => s.replaceAll(now, was), v);

const WIDTHS = [1280, 1000, 761, 760, 601, 600, 390, 371, 370, 340];
const SCHEMES = ['light', 'dark'];
const LIMIT = 12;   // mismatches reported per failure; the first few say enough

function frame(src, width) {
  return new Promise((ok, fail) => {
    const f = document.createElement('iframe');
    f.setAttribute('aria-hidden', 'true');
    f.tabIndex = -1;
    // Tall enough that no width scrolls: a scrollbar would narrow the layout.
    f.style.cssText = `position:absolute;left:-10000px;top:0;width:${width}px;height:2600px;border:0`;
    f.onload = () => ok(f);
    f.onerror = () => fail(new Error(`${src} did not load`));
    f.src = src;
    document.body.append(f);
  });
}

const pair = width => Promise.all([frame('fixtures/legacy-home.html', width), frame('../index.html', width)]);

/** Every element of html and body, with every non-custom computed property and its box. */
function snapshot(f, scheme) {
  const doc = f.contentDocument, view = f.contentWindow;
  doc.documentElement.style.colorScheme = scheme;
  const els = [doc.documentElement, doc.body, ...doc.body.querySelectorAll('*')];
  return els.map(el => {
    const cs = view.getComputedStyle(el);
    const props = {};
    for (let i = 0; i < cs.length; i++) if (!cs[i].startsWith('--')) props[cs[i]] = cs.getPropertyValue(cs[i]);
    const r = el.getBoundingClientRect();
    return { tag: el.localName, props, box: [r.x, r.y, r.width, r.height].map(v => Math.round(v * 100) / 100) };
  });
}

function compare(was, now, where, out) {
  if (now.length !== was.length) { out.push(`${where}: ${now.length} elements, was ${was.length}`); return; }
  for (let i = 0; i < was.length && out.length < LIMIT; i++) {
    const a = was[i], b = now[i], at = `${where} <${a.tag}> #${i}`;
    if (a.tag !== b.tag) { out.push(`${at}: is <${b.tag}> now`); continue; }
    if (a.box.join() !== b.box.join()) out.push(`${at} box: ${b.box} was ${a.box}`);
    for (const p of new Set([...Object.keys(a.props), ...Object.keys(b.props)])) {
      const was_ = a.props[p], now_ = b.props[p] === undefined ? undefined : allow(b.props[p]);
      if (was_ !== now_ && out.length < LIMIT) out.push(`${at} ${p}: ${b.props[p]} was ${was_}`);
    }
  }
}

// The rules that only apply in a state. Each is resolved on the element it
// styles, by appending its declarations to that element's inline style (the
// original tiles carry their --color inline, so it must be kept, not replaced).
const STATEFUL = [
  ['.explorer:hover', '.uf-tile:hover', 'nav a', null],
  ['.explorer:focus-visible', '.uf-tile:focus-visible', 'nav a', null],
  ['.page-footer a:hover', '.uf-footer a:hover', 'footer a', null],
  ['.explorer', '.uf-tile', 'nav a', 'prefers-reduced-motion'],
  ['.explorer:hover', '.uf-tile:hover', 'nav a', 'prefers-reduced-motion'],
];
const STATE_PROPS = ['transform', 'border-top-color', 'border-right-color', 'border-bottom-color',
  'border-left-color', 'outline-color', 'outline-style', 'outline-width', 'outline-offset',
  'text-decoration-line', 'transition-property', 'transition-duration', 'transition-delay',
  'transition-timing-function'];

function ruleIn(doc, selector, media) {
  const find = (rules, inMedia) => {
    for (const r of rules) {
      if (r.media && r.cssRules) {
        const hit = find(r.cssRules, r.media.mediaText.includes(media ?? '\u0000'));
        if (hit) return hit;
      } else if (r.selectorText === selector && inMedia === Boolean(media)) return r;
    }
    return null;
  };
  for (const sheet of doc.styleSheets) { const r = find(sheet.cssRules, false); if (r) return r; }
  throw new Error(`no rule ${selector}${media ? ` in @media ${media}` : ''}`);
}

function applied(f, selector, media, target, scheme) {
  const doc = f.contentDocument, view = f.contentWindow;
  doc.documentElement.style.colorScheme = scheme;
  const rule = ruleIn(doc, selector, media);
  return [...doc.querySelectorAll(target)].map(el => {
    const inline = el.getAttribute('style');
    el.style.cssText = `${inline ?? ''};${rule.style.cssText}`;
    // The tile transitions transform and border-color, so a read now would
    // see each at its starting value -- in both pages, so a comparison would
    // pass whatever the rule said. Flush the style change, then finish the
    // transitions it started, and read the values the rule lands on.
    view.getComputedStyle(el).transform;
    for (const anim of el.getAnimations()) anim.finish();
    const cs = view.getComputedStyle(el);
    const got = STATE_PROPS.map(p => `${p}: ${cs.getPropertyValue(p)}`);
    if (inline === null) el.removeAttribute('style'); else el.setAttribute('style', inline);
    return got;
  });
}

if (DOM) suite('homepage fidelity', ({ test }) => {
  test('every element computes as it did before the port, at every breakpoint edge', async () => {
    const out = [];
    for (const width of WIDTHS) {
      const [a, b] = await pair(width);
      try {
        for (const scheme of SCHEMES) compare(snapshot(a, scheme), snapshot(b, scheme), `${width}px ${scheme}`, out);
      } finally { a.remove(); b.remove(); }
      if (out.length >= LIMIT) break;
    }
    assert.equal(out, [], `the homepage moved:\n        ${out.join('\n        ')}`);
  });

  test('hover, focus and reduced-motion rules resolve as they did before the port', async () => {
    const [a, b] = await pair(1280);
    const out = [];
    try {
      for (const [was, now, target, media] of STATEFUL) for (const scheme of SCHEMES) {
        const x = applied(a, was, media, target, scheme), y = applied(b, now, media, target, scheme);
        assert.equal(y.length, x.length, `${now}: element count`);
        x.forEach((props, i) => {
          const moved = props.filter((p, k) => p !== allow(y[i][k]));
          if (moved.length) out.push(`${now}${media ? ` (${media})` : ''} ${scheme} #${i}: ` +
            moved.map((p, k) => `${y[i][props.indexOf(p)]} was ${p}`).join('; '));
        });
      }
    } finally { a.remove(); b.remove(); }
    assert.equal(out, [], out.join('\n        '));
  });

  test('the state probe sees the state: hover really lifts and recolours the tile', async () => {
    const [a, b] = await pair(1280);
    try {
      for (const f of [a, b]) {
        const [rest] = applied(f, f === a ? '.explorer' : '.uf-tile', null, 'nav a', 'light');
        const [hover] = applied(f, f === a ? '.explorer:hover' : '.uf-tile:hover', null, 'nav a', 'light');
        assert.ok(hover[0] === 'transform: matrix(1, 0, 0, 1, 0, -4)', `${f === a ? 'original' : 'port'}: ${hover[0]}`);
        assert.ok(hover[1] !== rest[1], 'hover leaves the border colour where it was');
      }
    } finally { a.remove(); b.remove(); }
  });

  test('the allowed difference is real: the original orange is gone from the port', async () => {
    const [a, b] = await pair(1280);
    try {
      const seen = f => JSON.stringify(snapshot(f, 'light'));
      assert.ok(seen(a).includes(ALLOWED[0][1]), 'the original never used #b46942?');
      assert.ok(!seen(b).includes(ALLOWED[0][1]), 'the port still paints #b46942 somewhere');
      assert.ok(seen(b).includes(ALLOWED[0][0]), 'the port never paints the fixed orange');
    } finally { a.remove(); b.remove(); }
  });
});
