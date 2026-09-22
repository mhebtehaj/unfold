// The intended differences between the frozen original
// (tests/fixtures/legacy-homotopy.html) and the engine port of
// homotopy-explorer.html. tools/port-parity.mjs fails on any difference that
// no entry here absorbs, and on any entry here that absorbs nothing.
//
// The discipline:
//
//  - The rule is pixel identity in every state, in both colour schemes, at
//    every width measured. An entry is a decision to break that rule in one
//    place, so it is written down with its reason, as narrowly as the
//    difference allows. "The port renders a little differently" is not a
//    reason; "the legacy page omits a client→viewBox scale at phone width that
//    the engine applies, so connectors move by < 1 px (see …)" is.
//  - Match narrowly. Prefer the state, width, scheme, drawing and field that
//    the difference actually has, over a regex that would also swallow the
//    next regression. A broad entry is a gate nobody is watching.
//  - A stale entry is an error, exactly like a `known` test that passes: when
//    a run exercises an entry's scope (its kind ran; its state, width and
//    scheme were measured) and it absorbs nothing, the run fails until the
//    entry is deleted. An entry whose scope a partial run skipped (--only,
//    --no-png, --no-interact) is reported as "not exercised", not as stale.
//  - Pixels are the ground truth. A semantic or a11y entry never excuses a
//    pixel difference; a pixel difference needs its own 'png' entry.
//
// Each entry:
//
//   {
//     id:     'short-kebab-name',          unique; the report names it beside what it absorbed
//     kind:   'png' | 'semantic' | 'a11y' | 'interaction',
//     match:  { state?, width?, scheme?, category?, drawing?, mark?, field?,
//               scenario?, step?, legacy?, port? },
//             every key given must match the difference's field of that name:
//             a string matches as a prefix, a RegExp by test(), a number by
//             equality, an array if any member matches. A difference that
//             lacks the field does not match.
//     reason: 'why this difference is intended, and where it was decided',
//   }
//
// The report's fields, per kind:
//   png          state, width (px), scheme, field ('pixels' | 'size'), legacy, port
//   semantic     state, category ('drawing' | 'marks' | 'patterns' | 'prose' |
//                'controls' | 'title'), drawing ('homotopy/now', …), mark (index
//                on the legacy page), field ('r', 'pts', 'paint.stroke',
//                'data.data-correspondence', 'prose[3]', …), legacy, port
//   a11y         state, category 'a11y', drawing?, field ('role', 'aria-label',
//                'liveRegions', 'attrs[5]', …), legacy, port
//   interaction  state (the configuration's state id), scenario ('grid homotopy/now',
//                'keyboard homotopy/source', 'drag', 'playback', 'connections',
//                'hover', 'focus'), step, then the semantic fields above, or
//                category 'pixels' | 'focus'
//
// Run `node tools/port-parity.mjs` and read baseline/diff/port-parity/report.json
// for every field of every difference.

export const ALLOWANCES = [
  // ---- the round-trip row: two buttons with ids, one component ------------
  {
    id: 'roundtrip-row-is-one-control',
    kind: 'semantic',
    match: { state: ['homotopy/types/', 'homotopy/overlay/eq-connections'],
             category: 'prose', field: /^prose\[[56]\]$/,
             legacy: /^button: On [XY] · [✓✕] /  },
    reason:
      'The shipped page spells the round-trip row as two <button id="eq-check-x|y"> ' +
      'inside a plain <div>; the port builds it with control.segmented(), whose ' +
      'container carries role="group" and the data-control handle. CAPTURE collects ' +
      'a [data-control] element as prose and then drops any entry another entry\'s ' +
      'text contains, so the port reports one entry holding both labels where the ' +
      'legacy page reports two. Every character is still compared — a label change ' +
      'still shows here — and each button\'s pressed state is compared under ' +
      'controls. Nothing about the rendering differs: pixel parity for these states ' +
      'is unchanged, which is what this allowance may not excuse. Decided in ' +
      'design-system.md §6 (one component per control, not one per page).',
  },

  // ---- the one visible change: the dropped client -> viewBox scale --------
  {
    id: 'overlay-scale-at-phone-width',
    kind: 'png',
    match: { state: 'homotopy/types/', width: 390, field: 'pixels' },
    reason:
      'The ONE intended change a camera can see, and it is a third of a pixel. ' +
      'At 390 px the round-trip diagram\'s drawings are laid out 164.5 px wide and ' +
      'given a viewBox 165 units across, so a point inside one sits at 0.997 of ' +
      'where its viewBox coordinate says. The shipped page\'s second widget ' +
      'positions the connector overlay by adding the viewBox coordinate to the ' +
      'drawing\'s client rect and never applies that factor — its first widget does ' +
      '— so every connector is up to 0.35 px out. core/viewport.js owns the factor ' +
      'once and applies it in both, which is the correction engine-plan.md asks ' +
      'for in Phase 1 by name. It moves no text, no drawing and no control: only ' +
      'the antialiasing of 50 hairlines, at one width, in the widget that had the ' +
      'bug. At 820 and 1280 the two agree exactly, because there the rect and the ' +
      'viewBox are equal and the factor is 1. Held for the owner\'s review beside ' +
      'the Phase 2 favicon change (docs/phase-4.md).',
  },

  // ---- drawings that answer to the keyboard are not images ----------------
  {
    id: 'drawing-role-group',
    kind: 'a11y',
    match: { field: ['role', /^attrs\[\d+\]$/],
             legacy: [/"role":"img"/, /^img$/], port: [/"role":"group"/, /^group$/] },
    reason:
      'design-system.md §8, finding 9: role="img" on a focusable element that ' +
      'answers to the arrow keys is a contradiction — it collapses the subtree and ' +
      'announces "image" for something the page then made operable. Every drawing ' +
      'the port builds is role="group", which is why imgRoleOnInteractive falls from ' +
      '9 to 0. Appearance is unaffected.',
  },
  {
    id: 'no-img-role-on-an-operable-drawing',
    kind: 'a11y',
    match: { field: 'imgRoleOnInteractive', legacy: 9, port: 0 },
    reason:
      'The count of the finding above, reported once per state: nine focusable ' +
      'drawings carry role="img" on the shipped page and none does on the port. ' +
      'Narrow on purpose — if the port ever grows one back, this entry stops ' +
      'matching and the run fails.',
  },
  {
    id: 'segmented-row-is-a-group',
    kind: 'a11y',
    match: { field: /^attrs\[\d+\]$/,
             legacy: /^div \{"aria-label":"Choose a round trip"\}$/,
             port: /^div \{"role":"group","aria-label":"Choose a round trip"\}$/ },
    reason:
      'The shipped row is a <div aria-label> with no role, so its label is ignored: ' +
      'aria-label on a generic element names nothing. control.segmented() gives the ' +
      'container role="group", which is what makes "Choose a round trip" reach the ' +
      'reader. Appearance is unaffected.',
  },
  {
    id: 'play-button-name-is-its-label',
    kind: 'a11y',
    match: { field: /^attrs(\[\d+\]|\[\+\d+\])$/,
             legacy: [/#play \{"aria-label":"(Play|Pause|Replay) the homotopy"\}/, /^\(absent\)$/],
             port: [/^span \{"aria-hidden":"true"\}$/, /^span \{"aria-hidden":"true"\}$/] },
    reason:
      'The shipped page keeps a separate aria-label in step with the visible label ' +
      'on one of its four play buttons and not on the other three. The port drops ' +
      'the attribute, so the button\'s visible text IS its accessible name and the ' +
      'two cannot disagree. The glyph is aria-hidden, because U+2161 announces as ' +
      '"Roman numeral two" before the word "Pause".',
  },
  {
    id: 'status-lines-announce',
    kind: 'a11y',
    match: { field: ['liveRegions', /^attrs\[(\+?)\d+\]$/],
             legacy: [/^\d+$/, /\{"role":"status"\}/, /^\(absent\)$/],
             port: [/^\d+$/, /^(span|p) \{"aria-live":"polite","role":"status"\}$/] },
    reason:
      'Two of the shipped page\'s four status lines carry role="status" with no ' +
      'aria-live, and the two warnings announce nothing at all. Every slot the port ' +
      'declares live gets both, so a change is announced once, politely — the most ' +
      'common accessibility failure in the pages this replaces (nine in one file). ' +
      'The warnings are the <p> half of this: on the shipped page they carry nothing ' +
      'at all, so a reader who cannot see the picture is never told that the ' +
      'attempted homotopy left Y.',
  },
  {
    id: 'status-lines-announce-during-an-interaction',
    kind: 'interaction',
    match: { category: 'a11y', field: /^attrs\[\+\d+\]$/,
             legacy: /^\(absent\)$/,
             port: /^(span|p) \{"aria-live":"polite","role":"status"\}$/ },
    reason:
      'The same live regions as `status-lines-announce`, reported again when a ' +
      'status line appears during an interaction rather than in the state itself. ' +
      'Same change, same reason; a separate entry because the record is of a ' +
      'different kind and an allowance may not span kinds.',
  },
  {
    id: 'both-widgets-render-at-mount',
    kind: 'a11y',
    match: { field: 'focusable' },
    reason:
      'The port mounts both widgets at load, so the second widget\'s "Why?" text — ' +
      'including its one source link — exists while its section is hidden; the ' +
      'shipped page fills that text only when the reader first opens the Homotopy ' +
      'types category. One more focusable element, never visible in the states where ' +
      'the count differs, and identical once the widget is shown. The port\'s two ' +
      'other focusable differences (role="group" above) are counted here too.',
  },
];

export default ALLOWANCES;
