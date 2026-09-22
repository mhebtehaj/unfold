# Phase 4 — Layer 2 geometry (2-D), Layer 4, and the homotopy port

The homotopy explorer runs on the engine. Both widgets, all 117 golden states,
three widths and two colour schemes: **618 of 702 screenshot pairs identical,
pixel for pixel**, and the other 84 are one deliberate sub-pixel correction at
one width, described below. Then the interactions the state list cannot reach:
4 697 comparisons across 317 scenarios — 3 850 pointer presses, 378 keys, 35
drags, 46 hovers, 112 focus stops, playback and the connector toggle — with ten
differences, all of them a status line that now announces itself.

The frozen original is `tests/fixtures/legacy-homotopy.html`; nothing about the
port is compared against itself. Every difference is listed, with its reason, in
`tools/port-parity.allow.mjs`. There are nine entries: seven accessibility, one
reporting shape, and one — the only one a camera can see — a third of a pixel.

```
engine/
  geom/tolerance.js  claim.js  parametric.js  map.js  region.js  index.js
                     Layer 2, the 2-D subset (landed with this phase)
  page/prose.js      escaping, the txt`` template, guarded bindings, slots
  page/references.js SOURCES and cite() — one spelling of a citation
  page/controls-ui.js  the six controls, as descriptors
  page/panels.js     the frame, stage + custom layouts, DrawContext, the overlay
  page/explorable.js state + controls + drawings + prose, as one instance
  unfold.css         + the explorer shell: 1 column, 6 controls, the stage, the
                     frame, the six classes a drawing paints with
pages/homotopy.js    the page: the mathematics, the prose, the two specs
pages/homotopy.css   the palette, the two drawing heights, the round-trip grid
homotopy-explorer.html  51 lines, no <style>, no inline style
tools/port-parity.mjs   legacy vs port: pixels, semantics, interaction
tests/prose|controls-ui|panels|explorable.test.mjs   Layer 4
```

## The four claims the phase had to prove

The plan names them. They are all true, and all three of the mechanical ones are
tests rather than prose.

| Claim | Where it is checked |
|---|---|
| Both widgets match the goldens | `node tools/port-parity.mjs` — 618/702 pixel pairs identical, 84 the one allowed sub-pixel fix |
| `assertNoDrift()` is clean | on the page, and `tests/explorable.test.mjs` |
| Two identical mounts agree, down to the probe | `tests/explorable.test.mjs` |
| Sweeping `t` redraws the live panel once per frame and the fixed panels not at all | `tests/explorable.test.mjs`; on the page, 21 slider steps give `now: 21, start: 0, end: 0, source: 0` |

The drift claim is the one worth dwelling on. The shipped page's second widget
is a near-verbatim copy of the first with eleven silently divergent constants —
the viewport floors, the padding, the radius clamp, the four ring radii, the
pick threshold, the mesh resolution, the curve width, the caption offset and the
connector opacities. The port keeps every one of them, because the fidelity rule
says so, but it now has to *declare* them:

```js
variesBy: ['pad', 'minSize', 'radius', 'ring', 'pickThreshold',
           'connector', 'mesh', 'curve', 'captionDy'],
```

and `assertNoDrift()` names anything that diverges and is not on that list. It
earned its keep immediately: `offset` was NOT on the list, and the check said so
on the first mount. Both widgets do centre five pixels above the middle — the
divergence was in the port, not in the original, and the page now shares one
`PAGE` constant between the two specs.

## What the port found in the original

Nine things, all of which the port either keeps deliberately or fixes:

1. Nine focusable drawings carry `role="img"`. `img` collapses the subtree and
   announces "image" for an element the page then made operable with the arrow
   keys. Every drawing the port builds is `role="group"`.
2. Two of the four status lines have `role="status"` and no `aria-live`; the two
   warnings have neither, so a reader who cannot see the picture is never told
   that the attempted homotopy left Y.
3. One of four play buttons keeps an `aria-label` in step with its visible
   label. The port drops the attribute, so the visible text *is* the accessible
   name and the two cannot disagree. The glyph is `aria-hidden` — U+2161
   announces as "Roman numeral two" before the word "Pause".
4. The round-trip row is a `<div aria-label>` with no role, so its label names
   nothing.
5. Eleven constants had drifted between the two widgets (above).
6. The second widget drops the client→viewBox scale factor that the first
   applies; `core/viewport.js` owns it once now.
7. `#eq-note` carries an inline `style="margin-top:12px"`.
8. Two `<style>` blocks, one of them a byte-identical copy of the nav
   stylesheet that also appears in the other two explorers.
9. No `<meta name="color-scheme">`, so the first paint can be the wrong ground.

Items 1–4 change what a screen reader hears and nothing that a camera sees; they
are seven of the nine allowances. Items 5–9 are structural and change nothing at all.
`tests/shell.test.mjs`'s audit ratchet has lost its `homotopy-explorer.html`
entry: that page is now clean.

**One visible change, held for review.** At 390 px the round-trip diagram's
drawings are laid out 164.5 px wide and given a viewBox 165 units across, so a
point inside one sits at 0.997 of where its viewBox coordinate says. The
shipped page's second widget positions its connector overlay by adding the
viewBox coordinate to the drawing's client rect and never applies that factor —
its own first widget does — so every connector is up to 0.35 px out.
`core/viewport.js` owns the factor once and applies it in both, which is the
correction `engine-plan.md` asks for in Phase 1 by name. It moves no text, no
drawing and no control: only the antialiasing of fifty hairlines, at one width,
in the widget that had the bug. At 820 and 1280 the two agree exactly. It is
the allowance `overlay-scale-at-phone-width`, and it belongs beside the Phase 2
favicon change on the owner's list.

**The palette stays exactly as shipped.** The rule is that only a WCAG AA
failure earns a change in appearance, and the homotopy page has none: its five
divergent tokens measure 5.60, 7.90, 5.15, 8.07, 7.24 and 9.85 to 1, and the
tightest pair on the page — the accent on its own pressed fill — is 4.80:1. So
`pages/homotopy.css` re-states the five under `[data-palette=homotopy]`, scoped
to `<main>`, and the back-navigation bar above it keeps the site's unified
values. Unifying the two is a decision for the owner, and it is now a five-line
diff in one file.

## Layer 4, in one paragraph each

**`prose.js`** — everything that reaches `innerHTML` goes through `escapeHTML`,
and the `txt` template marks up `*emphasis*` and `$mathematics$` and nothing
else. The markers run over the whole assembled sentence and the interpolations
go in afterwards, so `` txt`*g∘f ≃ id${sub('X')}*` `` is one bold phrase and a
value that happens to contain a `*` is still text. A binding is a record — what
it reads, how to write it — not a subscription, and it writes only when the DOM
would actually change. That last point is the one that lets a `role="status"`
survive a 60 fps animation: a `t` sweep writes the status once per distinct
sentence, not once per frame.

**`controls-ui.js`** — six controls, once. The shipped pages spell each of them
two or three times with drifted markup; the triple "set the field, set the
input, set the readout" appears at four call sites in the homotopy widget alone
and is one call here. A builder returns a *descriptor*, so `explorable()` hands
the specs to one `bindControls()` and never touches `value`, `checked`,
`selected` or `aria-pressed` again. Options and segment buttons carry `data-k`,
which is what lets the binder adopt what the builder wrote instead of appending
a second copy of every one.

**`panels.js`** — a panel is a measurable box with a drawing in it. The
framework owns the box: the frame's markup, the viewport fit, the time the
drawing is resolved at, the redraw policy. The page owns what is drawn, through
verbs that take *model* points — and a page never transforms a point, sets a
viewBox or measures anything, which is what stopped the shipped explorers' three
copies of every transform from drifting. `stage()` builds the two-column
arrangement; `custom()` adopts markup the page wrote, which is how the
round-trip diagram's five explicitly placed cells stay CSS.

**`explorable.js`** — three ideas. *Invalidation is derived*: every consumer
declares what it reads, a write marks keys dirty and schedules one frame, and on
that frame exactly the panels and bindings whose keys moved are redrawn. Nothing
in `pages/homotopy.js` calls a draw function; the shipped page hand-picks a
"narrowest sufficient redraw" at some twenty call sites. *Instances, not
singletons*: the factory registers nothing global, so a page with two widgets
mounts the same machinery twice. *One page registry*: one ResizeObserver, one
colour-scheme listener, one animator and one frame scheduler for the document,
where the shipped page has two of each, never removed, kept harmless by an
`if (panel.hidden) return` at the top of every draw.

## Bugs the port surfaced in the layers below

Six in the engine, each found by a difference the parity tool refused to accept:

- **`hidden` on an `<svg>` is not a property.** `overlayNode.hidden = true` sets
  a plain JS field that reflects nothing, and reading it back succeeds — so the
  guard passed, the element stayed `display:none`, and the connector overlay was
  invisible with no error anywhere. Attributes are the only thing an HTML
  element and an SVG element agree on.
- **A write that was not a control write scheduled no frame.** The store
  accumulates changed keys but only renders a frame somebody requested, and only
  `bindControls` requested one. So a pick, a frame of playback and `app.set()`
  changed the state and drew nothing; what looked like working playback was the
  control binder requesting the frame on the way past. One subscription in
  `mount()` now keeps the promise the module's header makes.
- **`createPicker`'s analytic path had no way to say "not my case".** The
  homotopy explorer has a closed-form inverse for a disk and for an annulus and
  none for a segment, and which it is depends on the state — so the page's
  `analytic` hook existed always and returned `null` when there was no inverse,
  which the picker read as "nothing is there". Clicking a drawing selected
  nothing in exactly the scenarios that needed the candidate grid. `undefined`
  now means *this state has no closed form*; `null` still means *no pick*.
- **`panels.linked({ toggle })` dropped `toggle` on the floor**, so the overlay
  was never hidden and never re-drawn when the toggle moved.
- **A cascade could overrule the same batch.** "Choosing a target resets the
  time" fired after "and set the time to 1", because writes in a frame coalesce
  and the rule ran last. A cascade now fills in consequences and never overrules
  a key the same batch also set, so the result does not depend on which event
  the browser delivered first.
- **Six decimals was not enough here.** Phase 3 measured the kernel's rounding
  against the realization explorer's 324-cell triangle and settled on six. The
  homotopy drawings carry far more edges — 1 152 mesh cells, a 144-segment
  curve — and a pixel is often covered by several at once, so the rounding error
  compounds instead of cancelling: the winding example was out by up to 28
  levels across 420 pixels. Re-measured: seven leaves 5 levels across 29 pixels,
  eight leaves nothing, at every width and in both schemes. `DEFAULT_PRECISION`
  is 8, and the tests that asserted the digits now ask the kernel what they are.

Four in CSS, all the same shape — a rule that lost a specificity race it looked
like it had won:

- A bare `.uf-caption` loses to `.uf-drawing text`.
- `.uf-controls` restated in a breakpoint outranked `.uf-status-row`'s base
  rule and put an 18 px gap back under the status row, and the breakpoint's
  `align-items` lost the other way once that was fixed.
- `[aria-pressed=true]` lost to `button:hover`, so a pressed segment that the
  pointer happened to be over painted as hovered — 18 000 pixels of the wrong
  fill in every round-trip screenshot, because the parity driver clicks the
  segment and leaves the pointer there.
- `.target-control select` lost to the breakpoint's field rule and stretched
  the target picker across the column.

Each is now spelled with both classes, or with the element named, and says in a
comment what it is outranking.

One in the page, found by the goldens rather than by the parity tool: the
toolbar revealed the round-trip widget's section and *then* told it which
example to show. A hidden drawing has no box and does not draw, so the frame
that reveals it is its first — and that frame raced the write. Whichever won
decided whether the widget drew its previous example on the way past, which in
turn decided whether a hatch pattern it no longer needs was left in its
`<defs>`. Two consecutive golden captures of the same state disagreed about
nine states. The write now settles before the reveal. (`SvgScene.defs()` caches
by id and does not collect: a page that draws a hatch and then stops needing it
keeps the definition. It paints nothing, and re-creating it every frame is the
thing the cache exists to avoid — but it is a difference from the shipped page,
which rebuilds its whole markup string each draw.)

And one that is not a bug anywhere but matters at this fidelity: **a text run's
boundaries move the glyphs inside it.** `X = <span>segment [0,1]</span>` and
`X = segment [0,1]` lay out to the same width and rasterise differently — one
glyph, up to 42 levels. The shipped file spells it both ways (the first widget
writes into a `<span>`, the second interpolates), so `prose.value()` exists to
say which one a sentence is.

## The parity tool

`tools/port-parity.mjs` is the instrument, and it checks itself before it checks
the port: 18 synthetic cases through the semantic differ, a two-pixel sanity
check on the image comparator, and a live end-to-end pass where the frozen
original is rewritten into the shapes a faithful port produces (768 `<polygon>`s
as `<path>`s, every mark inside a `<g data-layer>` with a `data-k`, the hatch
defined first under a generated id, the controls addressed the way the port
addresses them). Those four rewrites must vanish; four planted changes must be
found, and nothing else.

```
node tools/port-parity.mjs                 everything
node tools/port-parity.mjs --no-png        semantics + interaction (about a minute)
node tools/port-parity.mjs --only types/   states whose id contains the string
node tools/port-parity.mjs --sweep         + the widths either side of every breakpoint
```

An allowance whose scope ran and which absorbed nothing fails the run, exactly
like a `known` test that passes.

## Verify

    npm ci                            # playwright; browsers are preinstalled
    node tools/check-layers.mjs       # 27 modules + 1 stylesheet, 21 fixtures
    node tools/site.mjs               # homepage in step with SITE
    node tools/run-tests.mjs          # 607 passed, 0 failed, 5 known
    node tools/parity.mjs             # Phase 3: 72/72 identical
    node tools/port-parity.mjs        # Phase 4: PASS, 618/702 identical (about 11 min)
    node tools/bundle.mjs --self-test # 11 fixtures
    node tools/shots.mjs              # all 319 golden states clean (about 4 min)

The homotopy page's goldens were re-recorded with `--update`, as the homepage's
were in Phase 2: 118 semantic states (the drawings' generated ids, the rounded
coordinates, the accessibility changes above), two token files (`--halo` and
`--ink` are new), and two screenshots — the `eq_annulus/x/t0.5` phone pair, the
one visible change. The frozen original stays in `tests/fixtures/`, so nothing
about the comparison depends on the re-recorded baseline.

## Deferred, with reasons

- **`page/legend.js`** — the homotopy page has no legend. Writing one against a
  page that does not use it would be guessing; the realization explorer has four
  and it lands with that port (Phase 6).
- **Layer 2's 3-D surface** — `simplicial`, `cone`, `polytope`, `graph`, `grid`
  are Phases 5 and 6. What landed here is the 2-D subset the homotopy page
  needs: `tolerance`, `claim`, `parametric`, `map`, `region`.
- **Token unification for the homotopy palette** — measured, no AA failure,
  so out of scope by the fidelity rule. Five lines in `pages/homotopy.css`
  when the owner wants it.
