// Semantic capture. Runs in page context and reduces a rendered page to a
// canonical description of what is actually drawn.
//
// Why not diff the SVG markup directly: a port rewrites the renderer, so
// attribute order, element nesting and helper wrappers all change even when
// the picture is identical. Syntactic diffs would be 100% noise. This captures
// resolved geometry and resolved paint instead, which is what the reader sees.

/** Serialized in full and injected via page.evaluate. Must be self-contained. */
export const CAPTURE = (opts) => {
  const DP = opts?.dp ?? 2;

  // ---- normalisation ------------------------------------------------------
  const num = n => {
    const v = Number(n);
    if (!Number.isFinite(v)) return String(n);
    const r = Number(v.toFixed(DP));
    return Object.is(r, -0) ? 0 : r;            // -0 and 0 must not differ
  };
  const nums = s => String(s ?? '').replace(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi, m => num(m));
  const px = s => String(s ?? '').trim().replace(/\s+/g, ' ');

  // Geometry attributes that matter, per tag.
  const GEOM = {
    circle: ['cx', 'cy', 'r'],
    ellipse: ['cx', 'cy', 'rx', 'ry'],
    rect: ['x', 'y', 'width', 'height', 'rx', 'ry'],
    line: ['x1', 'y1', 'x2', 'y2'],
    path: ['d'],
    polygon: ['points'],
    polyline: ['points'],
    text: ['x', 'y', 'dx', 'dy', 'text-anchor'],
    image: ['x', 'y', 'width', 'height'],
    use: ['x', 'y', 'href'],
  };
  // Paint that changes the picture. Read computed, because most of these are
  // authored as var(--token) and the point is to catch a token regression.
  const PAINT = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray',
                 'stroke-linecap', 'stroke-linejoin', 'opacity', 'fill-opacity',
                 'stroke-opacity', 'font-size', 'font-weight', 'paint-order',
                 'visibility', 'display'];
  // CSS initial values, recorded on every element and therefore pure noise.
  const PAINT_DEFAULT = {
    'stroke-linecap': 'butt', 'stroke-linejoin': 'miter', 'stroke-width': '1px',
    'opacity': '1', 'fill-opacity': '1', 'stroke-opacity': '1',
    'visibility': 'visible', 'display': 'inline', 'font-weight': '400',
    'paint-order': 'normal', 'fill': 'rgb(0, 0, 0)',
  };
  // font-size only matters where glyphs are drawn.
  const PAINT_FOR = (tag, p) => p.startsWith('font') ? tag === 'text' : true;

  const markOf = (el, i) => {
    const tag = el.tagName.toLowerCase();
    const m = { i, tag };
    for (const a of GEOM[tag] ?? []) {
      if (!el.hasAttribute(a)) continue;
      const v = el.getAttribute(a);
      m[a] = /^[-\d.\s,eE+]+$/.test(v) ? nums(v) : v;
    }
    if (el.hasAttribute('transform')) m.transform = nums(el.getAttribute('transform'));
    if (tag === 'text') m.text = el.textContent;
    const cs = getComputedStyle(el);
    const paint = {};
    for (const p of PAINT) {
      if (!PAINT_FOR(tag, p)) continue;
      const v = px(cs.getPropertyValue(p));
      if (!v || v === 'auto' || v === PAINT_DEFAULT[p]) continue;
      // 'fill: none' and 'stroke: none' are meaningful; other 'none' is not.
      if (v === 'none' && p !== 'fill' && p !== 'stroke' && p !== 'stroke-dasharray') continue;
      paint[p] = p === 'stroke-dasharray' ? nums(v) : v;
    }
    if (Object.keys(paint).length) m.paint = paint;
    // Anything the page publishes about itself.
    const data = {};
    for (const a of el.attributes) if (a.name.startsWith('data-')) data[a.name] = a.value;
    if (Object.keys(data).length) m.data = data;
    return m;
  };

  // A scene can carry a thousand-plus polygons (the sampled meshes). Storing
  // every one would make the baseline hundreds of megabytes and unreviewable,
  // so dense tag groups collapse to a digest plus evenly spaced samples: the
  // digest detects any change at all, the samples show what kind of change.
  const CAP = opts?.cap ?? 180;

  // FNV-1a, two offsets, concatenated. Not cryptographic — this only has to
  // notice that a list of numbers changed.
  const digest = str => {
    let a = 0x811c9dc5, b = 0x01000193;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      a = Math.imul(a ^ c, 0x01000193) >>> 0;
      b = Math.imul(b ^ c, 0x811c9dc5) >>> 0;
    }
    return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
  };

  const spread = (arr, n) => {
    if (arr.length <= n) return arr;
    const out = [];
    for (let i = 0; i < n; i++) out.push(arr[Math.round(i * (arr.length - 1) / (n - 1))]);
    return out;
  };

  const sceneOf = svg => {
    const drawn = [...svg.querySelectorAll(
      'circle,ellipse,rect,line,path,polygon,polyline,text,image,use')];
    const counts = {};
    for (const el of drawn) {
      const t = el.tagName.toLowerCase();
      counts[t] = (counts[t] ?? 0) + 1;
    }
    const probe = {};
    for (const a of svg.attributes) if (a.name.startsWith('data-')) probe[a.name] = a.value;

    let marks = null, groups = null;
    if (drawn.length <= CAP) {
      marks = drawn.map(markOf);
    } else {
      // Per tag, so a change in 4 circles is never hidden by 1 200 polygons.
      groups = {};
      const byTag = {};
      drawn.forEach((el, i) => {
        const t = el.tagName.toLowerCase();
        (byTag[t] ??= []).push([el, i]);
      });
      for (const [tag, list] of Object.entries(byTag)) {
        const all = list.map(([el, i]) => markOf(el, i));
        groups[tag] = list.length <= 48
          ? { n: list.length, marks: all }
          : { n: list.length,
              digest: digest(JSON.stringify(all)),
              samples: spread(all, 12) };
      }
    }

    let bbox = null;
    try { const b = svg.getBBox();
          bbox = [num(b.x), num(b.y), num(b.width), num(b.height)]; } catch {}

    return {
      id: svg.id || svg.getAttribute('class') || null,
      viewBox: svg.getAttribute('viewBox'),
      role: svg.getAttribute('role'),
      ariaLabel: svg.getAttribute('aria-label'),
      size: (() => { const r = svg.getBoundingClientRect();
                     return [num(r.width), num(r.height)]; })(),
      bbox,
      counts,
      probe,
      ...(marks ? { marks } : { groups }),
    };
  };

  // ---- prose and controls -------------------------------------------------
  const visible = el => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    return el.getClientRects().length > 0;
  };
  const textNodes = [];
  for (const el of document.querySelectorAll(
    'p,h1,h2,h3,h4,li,figcaption,label,output,span[aria-live],div[aria-live],' +
    '[role="status"],[data-control],.hint,.lede,summary,strong,em,button,a')) {
    if (el.closest('svg')) continue;
    if (!visible(el)) continue;
    const t = el.textContent.replace(/\s+/g, ' ').trim();
    if (t) textNodes.push({ tag: el.tagName.toLowerCase(), id: el.id || null, text: t });
  }
  // Deduplicate ancestors whose text is fully carried by a descendant.
  const prose = textNodes.filter((n, i) =>
    !textNodes.some((o, j) => j !== i && o.text !== n.text && o.text.includes(n.text)));

  const controls = [...document.querySelectorAll('select,input,button[aria-pressed]')]
    .filter(visible).map(el => ({
      k: el.id || el.dataset.control || el.dataset.face || el.getAttribute('aria-label'),
      type: el.type ?? 'button',
      v: el.type === 'checkbox' ? el.checked
        : el.hasAttribute('aria-pressed') ? el.getAttribute('aria-pressed')
        : el.value,
      disabled: el.disabled || undefined,
      hidden: undefined,
    }));

  const a11y = {
    liveRegions: document.querySelectorAll('[aria-live],[role="status"]').length,
    tablists: document.querySelectorAll('[role="tablist"]').length,
    tabs: document.querySelectorAll('[role="tab"]').length,
    focusable: document.querySelectorAll(
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])').length,
    headings: [...document.querySelectorAll('h1,h2,h3')].map(h => h.tagName + ':' + h.textContent.trim().slice(0, 40)),
    imgRoleOnInteractive: [...document.querySelectorAll('svg[role="img"]')]
      .filter(s => s.matches('[tabindex],[onclick]') || getComputedStyle(s).cursor === 'grab').length,
  };

  return {
    scenes: [...document.querySelectorAll('svg')].filter(visible).map(sceneOf),
    prose,
    controls,
    a11y,
    title: document.title,
  };
};

/**
 * Every CSS custom property in the document, both as authored and as RESOLVED
 * in the current colour scheme.
 *
 * getComputedStyle().getPropertyValue('--x') returns the *substitution value*,
 * so a token defined as light-dark(#a,#b) reads back as the literal string
 * "light-dark(#a,#b)" and tells you nothing about which branch is live. To get
 * the real colour the token has to be used: assign it to a real property on a
 * real element and read the resolved value back.
 */
export const TOKENS = () => {
  const root = getComputedStyle(document.documentElement);
  const names = new Set();
  for (const sheet of document.styleSheets) {
    let rules; try { rules = sheet.cssRules; } catch { continue; }
    const walk = list => {
      for (const rule of list ?? []) {
        if (rule.style) for (const p of rule.style) if (p.startsWith('--')) names.add(p);
        if (rule.cssRules) walk(rule.cssRules);   // @media, @supports
      }
    };
    walk(rules);
  }

  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;left:-9999px;top:0;width:0;height:0';
  document.body.appendChild(probe);

  // Chromium reports a colour computed through color-mix() in oklab(), and a
  // relative-colour syntax result in whatever space it was authored in. Parsing
  // every CSS colour space by hand is not the job here, so the browser does the
  // conversion: paint the colour into a 1x1 canvas and read the sRGB bytes back.
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const toSRGB = css => {
    try {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = '#000';
      ctx.fillStyle = css;              // ignored if css is not a valid colour
      if (ctx.fillStyle === '#000' && !/^(#000000|black|rgb\(0, 0, 0\))$/i.test(css.trim()))
        return null;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return [r, g, b, Number((a / 255).toFixed(4))];
    } catch { return null; }
  };

  const out = {};
  for (const name of [...names].sort()) {
    const authored = root.getPropertyValue(name).trim();
    probe.style.color = '';
    probe.style.color = `var(${name})`;
    // A token that is not a colour leaves `color` unset; record it as
    // authored-only rather than pretending it resolved.
    const isColour = probe.style.color !== '';
    const resolved = isColour ? getComputedStyle(probe).color : null;
    out[name] = {
      authored,
      resolved,
      srgb: resolved ? toSRGB(resolved) : null,
    };
  }
  probe.remove();
  canvas.remove();

  const scheme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  return { scheme, tokens: out };
};
