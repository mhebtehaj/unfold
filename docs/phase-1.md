# Phase 1 — Layer 0, the kernel

Nine modules plus a barrel. No page changed; the baseline re-runs clean across all
319 states. The suite went from 16 tests to 289.

```
engine/core/
  vec.js        n-dimensional vectors and matrices, allocation-conscious
  svg.js        element creation, keyed reconciliation, raise(), raw()
  a11y.js       live regions, focus, keyboard operability, coarse pointers
  viewport.js   the ONE y-flip; the ONE layout read; viewBox sizing; resize
  labels.js     LabelPlacer — DOM-free, returns placement data
  anim.js       Animator, Playback, motion policy, easings
  state.js      reactive store, batched, derived values, no Proxy magic
  controls.js   data-control binding, conditional availability, two-way sync
  probe.js      the headless assertion surface
  index.js      barrel — namespaces plus the principal entry points
```

Written by six agents in two dependency waves against
`specs/api-layer01.md` §2, with the layering invariants enforced mechanically
throughout.

## What the kernel fixes

Each of these is a defect the inventory found in the shipped pages, now fixed once.

**The camera cancellation pattern is formalised.** `token = ++moving; if (token !== moving) return;`
with `t*t*(3-2*t)` smoothstep and **absolute** interpolation from captured start
values. A dropped or delayed frame cannot accumulate error. Pinned by a test that
drives an animation with a clock stepping 7/3/41/2/19/96 ms and asserts every frame's
`t` is `Object.is`-equal to `(clock − start) / duration`.

**Five rAF loops became one Animator**, and `prefers-reduced-motion` — previously
honoured in one loop out of five — is now a policy with `jump`, `freeze`, `animate`
and `manual`, read **live** so a preference change mid-session takes effect. The
reduced-motion path still applies the end state; skipping it would leave a camera
half-turned.

**The y-flip and the layout read have one home each.** `check-layers.mjs` exempts
exactly `core/viewport` from reading layout and fails every other file. The
regression tests name the bugs they replace: the client→viewBox scale factor the
second homotopy widget silently dropped (a test measures at 400×300, halves the CSS
box without re-measuring, and asserts 50 client px → 100 viewBox px — the
dropped-scale answer, 50, is called out in the comment), and the `g.r *= .81`
cache mutation that made a radius depend on how many times it had been read.

**The label placer stops lying.** The shipped version exists in two copies with
divergent constants (17 vs 16), measures nothing (`length * 3.5 + 3`), takes the
first passing candidate, and **silently drops** what it cannot place. The kernel's
version scores candidates, honours an explicit priority, uses a class-aware text
metric, and **returns** the unplaced labels with a reason. It is in the pure set, so
it returns placement data and no DOM — which is what lets the two string-building
explorers adopt it during migration without adopting the renderer.

**Conditional control availability is a first-class feature**, because Phase 0
established it is real behaviour and not incidental: option lists repopulated by
another control, a control hidden for every case but one, an option set that changes
entirely with its parent, and a stepper whose slider is disabled at both ends. All
four are covered, and `hidden` and `disabled` are kept strictly distinct — a disabled
control is one the reader can see is there and not usable yet.

**The probe is wired up.** The shipped ambiguity explorer already writes
`data-yaw`, `data-ambiguous-edges` and full `JSON.stringify` scene dumps that nothing
reads. This replaces that free-for-all with one `data-probe` attribute holding one
JSON object: engine keys at the top level, everything a domain module contributes
namespaced under `domain`. Serialisation is deterministic — declared key order at the
top, sorted keys below, arrays left alone because a pass plan *is* its order, numbers
through `vec.round` so `-0` cannot survive, and non-finites spelled `"NaN"` /
`"Infinity"` rather than JSON's `null`, which would read as "the scene had nothing to
say" — the opposite of the truth.

## Decisions taken during the phase

**The probe is on by default.** §2.8's production policy and the spec's Q1 both
settle this; the implementation initially shipped opt-in and was corrected. A probe
that has to be switched on is off in exactly the situation you wanted it — a reader
reporting that a published page looks wrong. The three triggers are opt-*out* plus an
explicit force-on.

**`core/probe` left the pure set.** §1.3 lists it as pure "(its computation half)",
which is not implementable as stated: `createProbe(host, …)` takes an Element, writes
an attribute, and `probeEnabled()` reads `documentElement` and `location`. A
whole-file rule cannot express half a file, and splitting it to satisfy the checker
would add a module the manifest does not name. Purity is enforced where it buys
something concrete — letting the string builders reuse `LabelPlacer`,
`OcclusionTester`, `OrbitCamera` and `sortByDepth` — and the probe is not on that
list.

**Two checker bugs fixed.** `idOf` collapsed `core/index` to `core`, leaving every
barrel permanently unnamed in the manifest and therefore permanently in violation;
the index fallback belongs only where import *targets* are resolved. And `index` was
added last in both layer orders, since a barrel imports everything in its layer.

**The barrel exports namespaces and a short flat list.** A kernel containing `add`,
`sub`, `text`, `on`, `el`, `attr`, `group`, `round` and `clamp` should not colonise a
page's identifier space, so `vec.add` and `svg.el` are the way in; only the principal
constructors are flat, because `new viewport.Viewport(el)` helps nobody.

## Carried forward

**A markup collision to fix during the Layer 4 port.**
`realization-carrier-explorer.html` spells segmented-control member values as
`data-part="all|bottom|top|sides"`. Under the kernel's convention `data-part` names a
*visibility group*, and an undeclared group throws in dev. That markup becomes
`value=` when the page is ported; the dev error a porter hits names exactly this.

**One spec example does not run.** §2.5's own snippet derives on a key absent from
the same snippet's `initial` object, which throws under the store's strict default.
Naming the key in `initial` is the fix.

**Not verified.** Chromium only — `tools/run-tests.mjs` launches one browser, so
cross-engine behaviour is argued rather than measured. Real `prefers-reduced-motion`
and `pointer: coarse` report false in headless, so their *policy* behaviour is tested
through injected matchers while the matchers themselves are only type-checked.
Nothing downstream consumes a `Frame`, a `Probe` or an `Animator` yet, so those
contracts are self-consistent rather than integration-proven; `render/scene.js` in
Phase 3 is the first real consumer.

## Next

Phase 2 is `engine/unfold.css` and the page chrome, then the homepage port — the
first page to move, and the one with all chrome and no mathematics.
