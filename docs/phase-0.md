# Phase 0 — baseline and guardrails

Nothing about the four published pages changed in this phase. Its whole purpose is
to make the *next* phases checkable: capture what the site does today, and stand up
the three tools that will say whether a port broke it.

## What exists now

```
baseline/          what the site does today — captured before any edit
  semantic/        319 states: resolved mark geometry, paint, prose, probe attrs
  png/             196 screenshots, light and dark, three widths
  tokens/          every CSS custom property, resolved to sRGB, per page per scheme
tests/             the suite; open /tests/run.html, or `npm test`
tools/
  shots.mjs        capture and compare the baseline
  states.mjs       the enumerated state space
  probe.mjs        dump a page's live control surface
  check-layers.mjs enforce the engine layering invariants
  run-tests.mjs    run tests/run.html headlessly
  bundle.mjs       optional single-file builds
  lib/             static server, capture script
```

## Running things

ES modules do not load over `file://`, so previewing needs a server:

```
python3 -m http.server 8000      # then open http://localhost:8000
npm test                         # tests, headless
npm run layers                   # layering invariants (+ 12 self-test fixtures)
npm run baseline                 # compare against the captured baseline
npm run baseline:update          # re-capture it
npm run probe                    # dump every page's live control surface
```

`node tools/bundle.mjs page <file>` produces a standalone copy in `dist/` when a page
has to travel.

## How the baseline works

**Semantic capture is the primary golden.** A port rewrites the renderer, so attribute
order, element nesting and helper wrappers all change even when the picture is
identical — diffing SVG markup would be pure noise. The capture records *resolved*
geometry and *resolved* paint instead: what a reader actually sees, rounded to 2 dp.

Dense scenes collapse to a digest. The sampled meshes carry 1 152 polygons each, and
storing every one made the baseline 226 MB and unreviewable. Tag groups over 48
elements become a count, an FNV digest and 12 evenly spaced samples; everything
sparser is stored in full. That is 10.9 MB, and a four-circle change is still visible
because grouping is per tag.

**Screenshots are the backstop**, not the primary test — 78 states in both schemes,
plus a responsive sweep at tablet and phone widths.

**Tokens are captured resolved.** `getPropertyValue('--x')` returns the literal string
`light-dark(#a,#b)` and tells you nothing about which branch is live, so the capture
assigns each token to a real element, reads the computed colour, and paints it into a
1×1 canvas to get sRGB bytes — Chromium reports a `color-mix()` result in `oklab()`.

Capture is deterministic: re-running over all three explorers reports zero changes.
The harness waits for the drawn geometry to stop changing before capturing, which is
what makes the eased camera moves and the play loops reproducible.

## What the state space turned out to be

319 states. Several were only discoverable by driving the real DOM:

- `#example` is repopulated by `#category`, so the four categories expose different
  example lists — 8 homotopies, 7 obstructions, the winding matrix, 7 equivalences.
- `#map-variant` is hidden for every carrier case except `circle`.
- `#solid-base` offers different options per `#solid-scene`: `prism` and `fill` take
  `triangle | edge`, but `cone` takes `circle | disk | edge`. Changing the scene also
  resets `#solid-progress`, so scene must be set first.
- The extensions tab is a five-stage stepper, not a slider. `#extension-progress` is
  disabled at the first and last stage; `#extension-break` only becomes live at stage 3.
- The ambiguity widget is inside a sandboxed iframe the parent document cannot script.
  Playwright reaches it as a frame, which is how it gets driven and captured.

Conditional control visibility is a real behaviour of these pages, and the engine's
control layer has to reproduce it — it is not incidental.

## Findings

Two corrections to the inventory, both from measuring rather than reading:

**`--orange` is worse than reported.** The audit gave 4.17:1; that was computed against
pure white. Against the real page background `#faf9f6` it is **3.96:1**. The proposed
fix `#a65f39` gives 4.62:1 on the real background rather than the quoted 4.86:1 — still
AA, but tight. **`#a35c37` (4.81:1)** is the better choice: it matches the perceived
weight of `--violet` (4.90) and `--teal` (4.82), preserving the property that no page
shouts. Every other accent on the real background: violet 4.90, teal 4.82, muted 4.87,
foreground 14.53. All dark-mode pairs clear 7.8:1.

**One AA failure the audit missed.** The ambiguity widget's own `--muted-foreground` is
**3.24:1** in light mode. The audit measured the author pages' `--muted` (4.87:1) and
did not reach the generated widget's separate token set.

Both are recorded as tracked issues in `tests/tokens.test.mjs`, along with the token
vocabulary collision (`--muted`, `--card` and `--accent` mean opposite things either
side of the iframe seam — now confirmed by measurement: the widget's `--muted` resolves
to a 10 %-alpha surface tint, the author pages' to opaque body text) and the fact that
the ambiguity wrapper page has no token layer at all.

## Known issues, not ignored issues

A test marked `known` that fails is reported as a tracked defect and does not fail the
run. A test marked `known` that **passes** fails the run, because the debt is gone and
the marker has become a lie. That keeps a long-lived defect visible in every run
without training anyone to ignore a red suite.

Today: 16 passing, 0 failing, 4 tracked.

## The layer checker

`tools/check-layers.mjs` enforces four invariants — downward-only imports, a DOM-free
pure set, colour literals confined to `render/palette.js`, and a single place that
reads layout. `engine/` is still empty, so it has nothing to check yet.

That is exactly why it carries 12 self-test fixtures and runs them on every invocation,
refusing to report success if any fixture misbehaves. A checker that only passes on an
empty tree proves nothing. The fixtures earned their place immediately: they caught
four real bugs in the checker's own string handling, where blanking string literals
was destroying the import specifiers and colour literals the rules were meant to read.

`tools/bundle.mjs` carries 7 fixtures on the same principle, and each generated bundle
is evaluated as a module before the fixture passes.

## Next

Phase 1 is the Layer 0 kernel: `vec · svg · a11y · viewport · labels · anim · state ·
controls · probe`. The layer checker is live and will start enforcing on the first
module.
