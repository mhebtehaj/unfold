# Phase 2 — the stylesheet, the page chrome, and the homepage

The homepage is the first page on the engine. In every state measured it renders
exactly as it did before, except for one listed accessibility fix. The three
explorers are untouched, and the baseline re-runs clean across all 319 states.

```
engine/
  unfold.css          tokens, the two grounds, the page hue, the chrome, the homepage
  render/palette.js   token names, and static hue values for what cannot read CSS
  page/shell.js       SITE; brand, tiles, footer, favicon, title; audit()
  page/index.js       Layer 4 barrel
tools/site.mjs        keeps index.html's generated regions in step with SITE
tests/
  unfold-css.test.mjs the token-contrast gate, measured on the live stylesheet
  shell.test.mjs      SITE, the generated chrome, audit(), the back-link bar
  home.test.mjs       the port against the frozen original, element by element
  palette.test.mjs
  fixtures/           legacy-home.html, legacy-nav.html, uf-nav.html, tokens.html
```

## The one visible change

`--orange`, light: **`#b46942` → `#a35c37`**. The old value was 4.17:1 on the tile
and 3.96:1 on the page ground, and it coloured 13px/600 text ("Explore ↗"), so it
failed AA. The new value is 5.07:1 and 4.81:1. In OKLCH the hue moves 47.3° →
47.1° and chroma 0.110 → 0.106; only lightness drops (0.597 → 0.549), so it is
the same terracotta, darker.

The plan proposed `#a65f39`. That clears AA too, but at 4.86:1 on white it sits
just outside the band every other accent occupies (violet 5.16, teal 5.08, the
explorers' blue 5.08), and the design brief's point is that no page shouts or
whispers. `#a35c37`, the value Phase 0 recommended after measuring, lands at 5.07.

What moved on the page: the Ambiguity tile's drawing and its "Explore ↗", in
light mode. Dark orange is unchanged and dark mode is pixel-identical everywhere.

## How fidelity was established

- **Semantic capture:** the only change is nine paint values, `rgb(180, 105, 66)`
  → `rgb(163, 92, 55)`. Geometry, prose, headings and focus order are identical.
- **Screenshots:** light desktop, tablet and phone differ only inside the Ambiguity
  tile's bounding box; all three dark captures are byte-identical.
- **Tokens:** every token the page had resolves exactly as before except
  `--orange`; `--card` is now `--surface`, at the same value.
- **`tests/home.test.mjs`**, a new permanent gate. It pairs every element of the
  port with the frozen original and compares every computed property and every
  box, at ten widths either side of each breakpoint (1280 … 761/760 … 371/370 …
  340) in both schemes. It then resolves the hover, focus and reduced-motion rules
  on the elements they style. The single allowed difference is written into the
  test, with its reason.
- **24 deliberate breaks**, each caught by at least one test: token values, a
  nav gap, a breakpoint moved by 10px, the hover lift, a focus offset, the
  reduced-motion rule, transition timing, a hand-edited tile, a dropped meta tag,
  an unnamed colour token, palette drift. This caught one vacuous check before it
  shipped: hover was being read mid-transition, at its starting value, in both
  pages, so it could never fail. `getAnimations().finish()` fixed that, and a new
  test asserts that the probe sees the lift.
- **An independent review** measured every computed property in forced-colours,
  print and `prefers-contrast` modes, and found nothing beyond the orange change.
  Its other findings are fixed below or recorded as decisions.

## Decisions

**Two grounds.** The design-system inventory proposed moving the homepage onto
the explorers' neutrals (`#25282d` text, `#626873` muted, and so on). That shift
would be imperceptible, but it would still be a change, and the fidelity rule
forbids it. The deeper reason is that paper brings its own ink: the homepage's
greys were tuned against `#faf9f6`. So `[data-ground=paper]` swaps the neutral
set as a unit (`--bg --fg --muted --line`) and opens the line from 1.5 to 1.55.
A test holds it to exactly those four tokens. A ground also sets its own type and
paint, so it works at any depth.

**`data-hue` replaces `style="--color:…"`.** It is an unscoped attribute, so the
same attribute sets a whole page on `<html>` or one tile. The homepage now has
no inline style, which a `style-src 'self'` policy would require. The page hues
are violet, teal and orange. Pink stays a data colour: at 4.58:1 it is outside
the band.

**The chrome is static markup, generated from SITE.** `shell.js` returns strings;
`tools/site.mjs --write` writes them between `<!-- uf:… -->` markers in
`index.html`. Both `site.mjs` and a browser test fail if the page drifts from
SITE. The spec had `shell.tiles()` render at load. That was reversed for the
reason the spec itself gives for keeping the back link static: navigation that
JavaScript injects is navigation lost without JavaScript. The homepage is the
site's navigation, so it still works with scripts off and from `file://`.

**The homepage keeps its original favicon.** `favicon()` derives a page's icon
from its mark and hue, and it is tested. Applied to the homepage, it would repaint
`#7968bf` as `#7360b5`, the `--violet` of the brand mark beside it on the page.
That is a visible change, not an accessibility fix, so it waits for a yes. A test
asserts that adoption would change the fill and nothing else. Adopting it takes
`mark: BRAND_MARK` in SITE and a `favicon` region in `index.html`.

**The footer's arrow is still announced.** Hiding it in an `aria-hidden` span
(audit finding 15, low) splits the hover underline into two runs. The arrow's
run is drawn from a fallback font and sits a pixel lower, which the old-vs-new
comparison caught. It is tracked as a known issue until someone accepts the
change.

**A rule enters `unfold.css` with the first page that can verify it.** This
covers the homepage's components, and the back-link bar, which a fixture test
holds to the three copies it replaces. The explorers' own components wait for
their ports, including their column: homotopy's is 1080px with 22px/24px
padding and realization's is 1100px with 21px/24px, and deciding between them is
Phase 4's job. Unused type, radius and spacing steps were removed. The colour
tokens are the exception: the full palette from the design-system inventory is
defined and measured now, and each explorer port confirms or amends it against
its own baseline.

**`.uf-nav` follows `--accent`.** On the default accent it is identical to the
copies (box, type, colours, hover and focus, at three widths, in both schemes).
Under a `data-hue`, the back link hovers in the page's hue, and a test says so.
Giving an explorer its homepage hue is therefore one visible decision, taken at
that port, not something that happens by accident. `audit()` treats a missing
`data-hue` as the default accent, which is what every explorer has today.

**`render/palette.js` arrives early, and small.** It holds the token names (a
test checks that every colour token in the stylesheet is named there), `token()`,
and the three hue values a favicon needs. I3 allows colour literals in this file
alone. Phase 3 adds the derivations and the barycentric blend.

## Tooling fixed on the way

- **`check-layers`** gains the CSS form of I3. In `engine/*.css` a colour literal
  (hex, a colour function, or any of the 148 named colours) may appear only as a
  custom property in a token block (`:root`, `[data-*]`) or as an `@property`
  initial value. Strings, `url()`, relative colours and `color-mix()` are allowed.
  It now has 21 self-test fixtures and skips the generated `engine/unfold.js`.
- **`bundle.mjs`**:
  - `npm run bundle` crashed on main, because `core/index.js` uses `export * as`; that form is now supported.
  - The entry's re-exports are surfaced.
  - An engine bundle holds only what its entry reaches: 3 modules, 17.5 KB, with the left-out modules listed.
  - Page mode resolves stylesheets relative to the page and fails loudly instead of leaving a `<link>` in a "standalone" file.
- **`site.mjs`** works with a space or `#` in the path. It used to exit 0 without
  checking. It also handles CRLF checkouts and refuses a duplicated region.

## Counts

Tests: 289 → **334 passed, 0 failed, 5 known**.

- **Retired:** the `--orange` debt, which is now a passing test.
- **New known issues:** the explorers' head conventions and the footer arrow. The
  explorers' issue has a ratchet: a test holds the exact `audit()` output for each
  explorer, so a port that fixes an item must delete its line, and a regression
  fails the run.

Layer checker: 13 modules and 1 stylesheet, 21 fixtures.

## Not verified

**Browsers.** Only Chromium was measured, as in Phase 1. For Firefox and Safari
the argument is that the stylesheet uses nothing the original page did not
already need: `light-dark()` was already the floor, and `var()` inside `font`
and `transition` is substituted at computed-value time everywhere.

**Caching.** The homepage now loads a separate stylesheet, and GitHub Pages
caches for 10 minutes. After a deploy that changes both the page and the
stylesheet, a visitor could briefly pair one version with the other. A
content-hash query string would close that gap (`audit()` already accepts
`unfold.css?v=…`); it has not been needed yet.

## Carried forward

- **Per explorer port:**
  - swap the back link for `.uf-nav`;
  - decide the column;
  - decide whether the page takes its homepage hue, which also recolours its back-link hover;
  - clear its `audit()` lines.
- **Ambiguity page:** it also needs the full-bleed back-link variant.
- **Open decisions:** the derived homepage favicon, the footer arrow, and Q2
  (whether `--zone`/`--accent-soft` derive from the page hue).
- **The engine bundle** exposes Layer 4 only, because that is what pages import.
  If pages ever need lower layers through the bundle, the entry must say so.

## Next

Phase 3 is Layer 1's 2-D path: `palette` (the barycentric blend), then `marks`,
then `scene` with `camera: null`.
