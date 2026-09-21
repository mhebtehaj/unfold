# Phase 3 — Layer 1, the 2-D path

The render layer draws. A scratch page redraws the realization explorer's "A
drawing of |Δ|" through `palette → marks → scene` with `camera: null`, and it
matches the shipped drawing pixel for pixel in every state measured: 12 states,
3 widths and 2 colour schemes, so 72 of 72, compared channel by channel. No
shipped page changed, and the baseline re-runs clean across all 319 states.

```
engine/
  render/palette.js   + paint(), mix(), alpha(), DATA, blend(), blendNumeric()
  render/marks.js     face, edge, polyline, curve, point, pointRing, arrow, region,
                      text, label, halo; check() and style()
  render/scene.js     SvgScene: the draw cycle, the Renderable contract, picking, the probe
  render/index.js     Layer 1 barrel
  core/svg.js         precision 3 → 6; attr() writes only what changed
tools/parity.mjs      the shipped renderer against the engine, pixel for pixel
tests/
  marks.test.mjs      the mark contract
  scene.test.mjs      the scene contract
  realize.test.mjs    the proof, element by element, in the suite
  fixtures/realize.html, realize-cases.mjs   the scratch page and its 12 states
```

## The proof

`tests/fixtures/realize.html` is the scratch page. It has one Renderable, and
that Renderable restates the explorer's `drawComplex`:

- the complex's soft faces and grey edges;
- the coloured face: 324 barycentric cells for a triangle, 110 segments for an
  edge, a dot for a vertex;
- the dashed outline of a face the complex does not have;
- the vertex dots and labels;
- x, with its halo and ring.

It uses the explorer's own token values and its numeric `PALETTE`. So the test
measures the rendering machinery, not the token decisions the realization port
will have to make (listed at the end).

**`tools/parity.mjs`** (`npm run parity`), for each state:

1. drives the shipped explorer into the state through its own controls;
2. measures the drawing;
3. draws the same state in the fixture, in a box of the same size and at the
   same sub-pixel offset;
4. compares the two crops.

A change in any channel of any pixel is a failure. Before it reports anything,
the tool checks that its comparator can see a one-level change in one channel.
Result: **72/72 identical.**

**`tests/realize.test.mjs`** runs on every open of `tests/run.html`, across the
same 12 states:

- It compares every drawn circle, path and text, in document order: geometry to
  within 1e-6 px, and resolved paint exactly.
- A second test changes one weight by 0.01 and checks the comparison catches it,
  so it cannot pass vacuously.

## What the proof found

Two things had to change before "identical" was true. Both were measured.

**Precision.** At the kernel's old precision of 3 decimals, the redraw shifted
the antialiasing of 115 pixels by up to 4 levels at desktop width (62 pixels at
tablet, 5 at phone). The cause: moving a cell edge by 0.0005 px changes how much
of a pixel it covers. At 6 decimals the redraw is identical at every width and in
both schemes; 10 and 14 decimals measured the same. `DEFAULT_PRECISION` is now 6.
The 1e-14 float noise that rounding exists to remove is still removed.

**The blend.** The explorer colours a point by `color(w) = Σ wᵢ·PALETTE[i]`.
Written as CSS, a nested `color-mix(in srgb)` folded from the tail, that formula
agrees with the explorer on 1526 of 1530 colours.

- **The other four** are exact .5 ties in one channel. The explorer's
  floating-point sum lands a hair under .5 and rounds down; CSS rounds the true
  tie up.
- **What that looks like.** 29 to 73 pixels, each at most 2 levels off, inside one
  box no larger than 18×15 px. It shows only in the 30 of 72 captures that draw
  the triangle's grid (`npm run parity -- --blend css` gives 42/72).
- **`blendNumeric()`** repeats the explorer's arithmetic in the explorer's order,
  and matches it to the bit (72/72).

So there are two functions:

- **`blend()`** returns `color-mix()` over tokens. The default space is `oklab`,
  as the spec chose, because it does not darken midpoints. `space: 'srgb'` is the
  shipped arithmetic.
- **`blendNumeric()`** is the escape hatch. Use it:
  - to reproduce a shipped drawing exactly;
  - for more colours than `blend()` nests;
  - for rasters.

  Given `{light, dark}` it returns a `light-dark()` pair.

The realization port will use `blendNumeric()` to stay pixel-faithful, unless a
later decision accepts the tie pixels.

## The contracts, as built

**Marks.**

- **Only what is asked for.** A mark writes exactly the attributes its style
  requests; the defaults are SVG's. The house vocabulary is available as named
  options: `dash: 'dashed'` is `5 6`, `'dotted'` is `1 3`, and a point takes
  `halo` and `ring`.
- **Updated in place.** Every mark updates an existing node when it can. An update
  removes whatever the style dropped, and the tooltip `<title>` and the `data-*`
  pick payload follow the style.
- **Colour only through `paint()`.** It accepts tokens, custom properties and
  palette expressions, and it checks them all the way down: `color-mix(in srgb,
  red 50%, blue)` and `var(--x, #f00)` are refused, and so is a colour space that
  `color-mix()` does not have.
- **A typo is an error.** A style key the mark does not read is refused rather
  than silently ignored. So is a `data` key that no attribute can hold, or one the
  engine reserves.
- **`check(kind, style)`** throws for anything the mark would throw on, and for
  any key it would ignore, so the scene finds the problem while it builds.

**The scene.** One draw does the following, in order:

1. Measure once. If the viewport is hidden, skip the frame.
2. Call each renderable's `vertices`, `primitives`, `style` and `labels` hooks
   inside that renderable's `try/catch`, and validate everything they return
   there: kinds, keys, index counts and ranges, styles, label items, raw markup.
3. Reconcile each layer by key. A raised primitive is ordered last in its layer
   before reconciliation rather than moved afterwards, so a frame in which nothing
   changed moves nothing.
4. Place every renderable's labels through one `LabelPlacer`.
5. Publish the probe: viewport, layers, marks, labels placed and dropped,
   `domain.<id>` and warnings.

What that guarantees:

- **A renderable cannot break the frame.** One that throws, or returns something
  undrawable, is skipped for that frame and named in the warnings; `draw()` does
  not throw because of it. As a last line of defence, the scene also wraps each
  mark and the placer, so an error nobody anticipated costs one mark, not the
  frame.
- **An unchanged redraw writes nothing.** `attr()` skips values that are already
  there, and the scene does not re-run a mark whose inputs did not change. Labels
  are placed afresh every frame, but writing the same placement writes nothing.
  Raised marks are not moved, so a focused raised mark keeps its focus.
- **Picking.** A pick resolves by key from the event target, or to the nearest
  point within `pickRadius`. The renderable's own `onPick` sees the pick first
  (returning `true` stops it there), then the page's handlers. The context a pick
  receives holds the frame that was drawn and the state as it is now.

## Deliberate departures from the spec

- **Mark defaults are SVG's.** The spec had width 1.25 and round caps and joins.
  A port must not grow round caps on the way.
- **`point()`.** Its halo and ring are nested options, `{width, fill}` and
  `{r, stroke, width}`, and the halo is off by default (the spec had it on).
  `pointRing()` is the explorers' 7/4/8.
- **A `text` primitive kind** for fixed labels that need no placement, such as the
  explorer's vertex labels and x's label.
- **A per-primitive `layer`.** The explorer interleaves vertex dots with their
  labels, and a layer per kind could not reproduce that paint order.
- **`opacity` on a grouped point or an arrow applies to the whole mark**, so its
  parts do not fade separately or composite twice where they overlap.
- **The scene refuses a camera or a rotor** until Phase 5, rather than drawing
  wrongly. `dim` defaults to 2.
- **Labels are measured with the DOM-free `metricText` by default.** The spec
  had `createTextMeasurer`. The default is deterministic, which the probe relies
  on. For real metrics, pass `labels: { measure: createTextMeasurer(svg).measure }`.
- **`onDrop: 'leader'` is refused**, because the scene does not draw leader lines
  yet.
- **A LabelItem gains `mark`**, which says how the placed label is drawn (class,
  halo, data). Its `style` stays what the placer measures.
- **`region()`** fills with the zone token by default and adds no stroke (the spec
  had an accent stroke).

## Deferred, and where each lands

- **`swatch`/`swatchSpec`: Phase 4, with the legend.** It will be built against
  the homotopy legend's golden, so it is pixel-faithful from the start.
- **The drawing rules (`.uf-drawing text`, `.uf-mark`, `.uf-halo`): `unfold.css`,
  with the first explorer port.** That follows the file's rule that a rule enters
  with the first page able to verify it. Until then, `marks.label()`'s default
  classes are unstyled; the fixture uses the explorer's own classes.
- **A visually hidden list of dropped labels (spec step 8): Phase 4.** The scene
  already reports drops in `lastFrame` and the probe; the page framework owns text
  outside the SVG.
- **Phase 5:**
  - edge spans, with occlusion;
  - depth cues;
  - `desaturate`/`toward`.
- **Not yet scheduled:**
  - leader lines;
  - ramps;
  - `hitArea`;
  - `resolveToken`, which reads the DOM and so cannot live in the DOM-free
    palette.

## How it was checked

- **Suite:** 334 → **448 passed, 0 failed, 5 known**. The known set is unchanged.
- **Layer checker:** 16 modules and 1 stylesheet, 21 fixtures; I1–I3 hold.
- **Parity:** 72/72 identical under the strict metric.
- **Baseline:** 319 states; no shipped page changed.
- **Mutation testing:** 62 deliberate breaks across the palette, the marks, the
  scene and the kernel; 61 were caught. The one survivor drops a removed
  renderable's cache entry. It is equivalent to the original: every draw after
  an `add()` carries `'all'`, so the entry can never be used and only costs
  memory.
- **Bundle:** a standalone bundle of the scratch page draws markup identical to
  the module version for all 12 states.
- **An independent review** found nine defects in the general scene and marks
  code. None affected the proof, which draws a well-formed scene. All nine are
  fixed, each with a test:
  1. A label item without an anchor, two labels sharing an id, malformed raw
     markup, a `data` key no attribute can hold, and `dependsOn` given as a
     string each escaped `draw()` and froze the scene or left it half drawn.
     `attach()`/`detach()` throwing could strand a renderable or skip a teardown.
  2. A raised mark was re-inserted every frame, which blurred it and restarted
     its transitions.
  3. A pick saw the state the renderable was last built with. A removed
     renderable stayed pickable until the next draw. A renderable's own
     `onPick` needed a page handler before it would fire.
  4. A redraw rewrote attributes that had not changed.
  5. The parity comparator weighted differences by luma, so a one-level blue
     change rounded to zero.
  6. `paint()` checked only the prefix of a colour expression.
  7. `opacity` on a grouped point or an arrow was applied part by part.
  8. Smaller gaps:
     - text had no tooltip;
     - raw markup ignored its style;
     - `ctx.measure` ignored an injected measure;
     - there was no `strokeOpacity`;
     - unknown style keys were dropped silently;
     - a `draw()` right after `add()` drew twice.
  9. The bundler's module transform mishandled `import { a as b }`.

## Tooling fixed on the way

- **`bundle.mjs`:**
  - It no longer mistakes a JSDoc type import (`@param {import('…').T}`) for a
    dynamic import.
  - Aliased imports now work in both the module transform and the page inliner.
  - The page inliner was passing module source to `String.replace` as the
    replacement string, so the `$&` in `core/probe.js` expanded into the whole
    script tag. It now uses a function.
  - Three new self-test fixtures, one of which bundles a page end to end (11 in
    all).
- **`imagediff.mjs`:** a `'max'` metric that counts a change in any channel.
- **`parity.mjs`:** new; see above.

## Open decisions for the realization port (Phase 6)

The fixture avoids these by using the explorer's own values. The port cannot.

1. **Data colours are theme-invariant in the explorer.** It uses the same
   `PALETTE` on `#fff` and on `#181818`. The fidelity rule says keep them; the
   design-system inventory proposes dark pairs.
2. **`--data-3` in light mode.** The explorer's `#34ab82` is 2.88:1 on white as
   a drawn colour, which fails AA's 3:1 for graphics. The unified token's AA fix
   is `#1f9078`.
3. **The explorer's dark `--fg` is `#efeff2`;** the unified token is `#f1f1f2`.
4. **The λ weight labels are written as text in `PALETTE` colours.** `data-2`,
   `data-3` and `data-4` fail AA's 4.5:1 text contrast.

## Not verified

**Browsers.** Only Chromium was measured, as in Phases 1 and 2. The engine emits
nothing a current Firefox or Safari lacks: `color-mix()`, `light-dark()` and SVG
presentation attributes. The pixel-level agreement is Chromium's, though, and so
is the antialiasing that motivated precision 6.

## Next

Phase 4: Layer 2's 2-D geometry (`map`, `region`, `parametric`), Layer 4
(`explorable`, `panels`, `prose`, `legend`, `references`, `controls-ui`), and the
homotopy port.
