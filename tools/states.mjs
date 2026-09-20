// The golden state space: every visually distinct configuration of the four
// pages, enumerated declaratively. Authored against a live DOM probe, not grep.
//
// A state is { id, page, frame?, tier, steps }.
//   frame  'iframe' drives the sandboxed widget inside ambiguity-explorer.html
//   tier   'full'     -> PNG screenshot + semantic capture
//          'semantic' -> semantic capture only (mark geometry, probe attrs, prose)
// A step is [action, selector, value]:
//   select | range | check | click | wait

const S = (id, page, tier, steps, frame) => ({ id, page, tier, steps, frame });

// ---------------------------------------------------------------- homepage --
const index = [S('index/default', 'index.html', 'full', [])];

// --------------------------------------------------------------- homotopy ---
// #example is repopulated by #category, so category always precedes example.
const HOMOTOPIES  = ['segment_circle', 'disk_any', 'interval', 'point',
                     'rotation', 'shrink', 'disk', 'triangle'];
const OBSTRUCTIONS = ['circle_unwrap', 'annulus_paths', 'annulus_straight',
                      'annulus_retract', 'winding', 'local_loop', 'blocked'];
const DISK_TARGETS = ['annulus', 'circle', 'disk', 'triangle'];
// The 5x5 winding matrix, sampled at the cases that differ in kind:
// equal (contractible), adjacent, opposite sign, zero, extremes.
const CLASS_PAIRS = [[1, 1], [1, 2], [1, -1], [0, 0], [-2, 2], [2, 2]];
const EQ_CASES = ['eq_annulus', 'eq_disk_segment', 'eq_disk_point', 'eq_tail',
                  'eq_circle_point', 'eq_annulus_disk', 'eq_wrong_maps'];
const TIMES = ['0', '0.5', '1'];

// Examples whose picture is most load-bearing: these get PNGs at every time.
const HOT = new Set(['segment_circle', 'circle_unwrap', 'shrink', 'blocked',
                     'winding', 'annulus_paths', 'map_classes']);

const homotopy = [];
for (const ex of HOMOTOPIES) {
  const targets = ex === 'disk_any' ? DISK_TARGETS : [null];
  for (const tgt of targets) for (const t of TIMES) {
    const tier = (HOT.has(ex) || (tgt && t === '0.5')) && t !== '0' ? 'full' : 'semantic';
    homotopy.push(S(`homotopy/homotopies/${ex}${tgt ? '-' + tgt : ''}/t${t}`,
      'homotopy-explorer.html', t === '0.5' ? 'full' : tier, [
        ['select', '#category', 'homotopies'],
        ['select', '#example', ex],
        ...(tgt ? [['select', '#disk-target', tgt]] : []),
        ['range', '#time', t],
      ]));
  }
}
for (const ex of OBSTRUCTIONS) for (const t of TIMES) {
  homotopy.push(S(`homotopy/obstructions/${ex}/t${t}`, 'homotopy-explorer.html',
    t === '0.5' ? 'full' : 'semantic', [
      ['select', '#category', 'obstructions'],
      ['select', '#example', ex],
      ['range', '#time', t],
    ]));
}
for (const [a, b] of CLASS_PAIRS) for (const t of TIMES) {
  homotopy.push(S(`homotopy/classes/${a}_to_${b}/t${t}`, 'homotopy-explorer.html',
    t === '0.5' ? 'full' : 'semantic', [
      ['select', '#category', 'classes'],
      ['select', '#example', 'map_classes'],
      ['select', '#class-start', String(a)],
      ['select', '#class-end', String(b)],
      ['range', '#time', t],
    ]));
}
// The second widget. Both sides of the equivalence, since side flips which
// space is the middle panel.
for (const ex of EQ_CASES) for (const side of ['x', 'y']) for (const t of ['0', '0.5', '1']) {
  homotopy.push(S(`homotopy/types/${ex}/${side}/t${t}`, 'homotopy-explorer.html',
    t === '0.5' && side === 'x' ? 'full' : 'semantic', [
      ['select', '#category', 'types'],
      ['select', '#example', ex],
      ['click', `#eq-check-${side}`],
      ['range', '#eq-time', t],
    ]));
}
// Overlay toggles, captured once each: they change every panel at once.
homotopy.push(
  S('homotopy/overlay/connections', 'homotopy-explorer.html', 'full', [
    ['select', '#category', 'homotopies'], ['select', '#example', 'rotation'],
    ['range', '#time', '0.5'], ['click', '#connect']]),
  S('homotopy/overlay/eq-connections', 'homotopy-explorer.html', 'full', [
    ['select', '#category', 'types'], ['select', '#example', 'eq_annulus'],
    ['range', '#eq-time', '0.5'], ['click', '#eq-connect']]),
);

// ------------------------------------------------------- realization tabs ---
const FACES = {
  triangle: ['0', '1', '2', '0,1', '0,2', '1,2', '0,1,2'],
  edge: ['0', '1', '0,1'],
  vertices: ['0', '1', '2', '0,1'],
  boundary: ['0', '1', '2', '0,1', '0,2', '1,2', '0,1,2'],
  glued: ['0', '1', '2', '3', '0,1', '0,2', '1,2', '1,3', '2,3', '0,1,2', '1,2,3'],
  tail: ['0', '1', '2', '3', '0,1', '0,2', '1,2', '2,3', '0,1,2'],
};
const CARRIER_CASES = ['strip', 'escape', 'triangle', 'interior', 'shared',
                       'curved', 'nesting', 'homotopy', 'circle'];

const realization = [];
for (const [cx, faces] of Object.entries(FACES)) for (const f of faces) {
  realization.push(S(`realization/realize/${cx}/${f.replace(/,/g, '')}`,
    'realization-carrier-explorer.html',
    f === faces.at(-1) ? 'full' : 'semantic', [
      ['click', '#tab-realization'],
      ['select', '#complex', cx],
      ['click', `[data-face="${f}"]`],
    ]));
}
realization.push(S('realization/realize/triangle/placement',
  'realization-carrier-explorer.html', 'full', [
    ['click', '#tab-realization'], ['select', '#complex', 'triangle'],
    ['click', '[data-face="0,1,2"]'], ['click', '#placement']]));

for (const ex of CARRIER_CASES) for (const t of TIMES) {
  realization.push(S(`realization/carrier/${ex}/t${t}`,
    'realization-carrier-explorer.html', t === '0.5' ? 'full' : 'semantic', [
      ['click', '#tab-carriers'],
      ['select', '#carrier-example', ex],
      ['range', '#time', t],
    ]));
}
// #map-variant is shown only for the 'circle' case — every other carrier
// example hides its parent control. Probed, not assumed.
realization.push(
  S('realization/carrier/circle/constant', 'realization-carrier-explorer.html', 'full', [
    ['click', '#tab-carriers'], ['select', '#carrier-example', 'circle'],
    ['select', '#map-variant', 'constant'], ['range', '#time', '0.5']]),
  S('realization/carrier/nesting/on', 'realization-carrier-explorer.html', 'full', [
    ['click', '#tab-carriers'], ['select', '#carrier-example', 'nesting'],
    ['check', '#nesting', true], ['range', '#time', '0.5']]),
);

// The extension tab is a five-stage stepper, not a free slider:
//   1 Vertices · 2 Edges · 3 Fill abc · 4 Fill bcd · 5 Complete
// #extension-progress is disabled at the first and last stage; #extension-break
// only becomes live from stage 3. Stages are reached by clicking Next.
const EXT_STAGES = ['vertices', 'edges', 'fill-abc', 'fill-bcd', 'complete'];
EXT_STAGES.forEach((name, stage) => {
  const next = Array.from({ length: stage }, () => ['click', '#extension-next']);
  const mid = stage > 0 && stage < 4;
  for (const p of mid ? ['0', '0.5', '1'] : [null]) {
    realization.push(S(
      `realization/extension/${stage + 1}-${name}${p ? `/p${p}` : ''}`,
      'realization-carrier-explorer.html',
      (!p || p === '0.5') ? 'full' : 'semantic', [
        ['click', '#tab-extensions'], ...next,
        ...(p ? [['range', '#extension-progress', p]] : []),
      ]));
  }
  if (stage >= 3) {
    realization.push(S(`realization/extension/${stage + 1}-${name}/broken`,
      'realization-carrier-explorer.html', 'full', [
        ['click', '#tab-extensions'], ...next,
        ['check', '#extension-break', true],
      ]));
  }
});

// #solid-base options depend on #solid-scene, and #solid-cutaway is only
// shown for 'fill'. Changing the scene also resets #solid-progress, so scene
// must be selected before progress.
const SOLID_BASES = { prism: ['triangle', 'edge'], cone: ['circle', 'disk', 'edge'],
                      fill: ['triangle', 'edge'] };
for (const [scene, bases] of Object.entries(SOLID_BASES)) for (const base of bases)
  for (const p of ['0', '0.4', '1']) {
    const cuts = scene === 'fill' ? [true, false] : [null];
    for (const cut of cuts) {
      realization.push(S(
        `realization/solid/${scene}-${base}/p${p}${cut === null ? '' : cut ? '-cut' : '-nocut'}`,
        'realization-carrier-explorer.html',
        p === '0.4' && cut !== false ? 'full' : 'semantic', [
          ['click', '#tab-solids'],
          ['select', '#solid-scene', scene],
          ['select', '#solid-base', base],
          ...(cut === null ? [] : [['check', '#solid-cutaway', cut]]),
          ['range', '#solid-progress', p],
        ]));
    }
  }

// --------------------------------------------------------------- ambiguity --
const FUNCTIONS = ['majority', 'exactlytwo', 'only110', 'selector',
                   'dictator', 'or', 'parity', 'zero', 'one'];
const AMB = 'ambiguity-explorer.html';
const ambiguity = [];

for (const fn of FUNCTIONS) for (const view of ['all', 'zero', 'one', 'seam']) {
  ambiguity.push(S(`ambiguity/three/${fn}/${view}`, AMB,
    view === 'all' ? 'full' : 'semantic', [
      ['select', '[data-control="space"]', 'three'],
      ['select', '[data-control="example"]', fn],
      ['select', '[data-control="view"]', view],
    ], 'iframe'));
}
for (const split of ['output', 'query0', 'query1', 'query2']) {
  ambiguity.push(S(`ambiguity/three/selector/split-${split}`, AMB,
    split === 'query0' ? 'full' : 'semantic', [
      ['select', '[data-control="space"]', 'three'],
      ['select', '[data-control="example"]', 'selector'],
      ['select', '[data-control="split"]', split],
    ], 'iframe'));
}
for (const qv of ['disks', 'stars', 'links']) for (const fn of ['majority', 'selector', 'parity']) {
  ambiguity.push(S(`ambiguity/query/${fn}/${qv}`, AMB,
    fn === 'selector' ? 'full' : 'semantic', [
      ['select', '[data-control="space"]', 'three'],
      ['select', '[data-control="example"]', fn],
      ['select', '[data-control="split"]', 'query0'],
      ['select', '[data-control="queryView"]', qv],
    ], 'iframe'));
}
ambiguity.push(S('ambiguity/tetra/shape', AMB, 'full',
  [['select', '[data-control="space"]', 'tetra']], 'iframe'));
for (const fn of FUNCTIONS) for (const v4 of ['all', 'seam', 'ambient']) {
  ambiguity.push(S(`ambiguity/four/${fn}/${v4}`, AMB,
    v4 === 'all' && fn === 'selector' ? 'full' : 'semantic', [
      ['select', '[data-control="space"]', 'four'],
      ['select', '[data-control="example"]', fn],
      ['select', '[data-control="view4"]', v4],
    ], 'iframe'));
}
for (const cell of ['0', '5', '11', '15']) {
  ambiguity.push(S(`ambiguity/four/cell-${cell}`, AMB, 'semantic', [
    ['select', '[data-control="space"]', 'four'],
    ['select', '[data-control="example"]', 'selector'],
    ['select', '[data-control="view4"]', 'cell'],
    ['select', '[data-control="cell"]', cell],
  ], 'iframe'));
}
// Continuous parameters: the rotation angles, translucency and the exploded view.
for (const [k, v] of [['angle14', '0'], ['angle14', '90'], ['angle24', '90'],
                      ['opacity', '0'], ['opacity', '100'], ['separation', '60']]) {
  ambiguity.push(S(`ambiguity/param/${k}-${v}`, AMB,
    k === 'separation' ? 'full' : 'semantic', [
      ['select', '[data-control="space"]', k.startsWith('angle') ? 'four' : 'three'],
      ['select', '[data-control="example"]', 'selector'],
      ['range', `[data-control="${k}"]`, v],
    ], 'iframe'));
}
// Display toggles.
for (const k of ['labels', 'showGraph', 'highlight', 'graphLabels']) {
  ambiguity.push(S(`ambiguity/toggle/${k}-off`, AMB, 'semantic', [
    ['select', '[data-control="space"]', 'three'],
    ['select', '[data-control="example"]', 'selector'],
    ['check', `[data-control="${k}"]`, false],
  ], 'iframe'));
}

export const STATES = [...index, ...homotopy, ...realization, ...ambiguity];

/** Viewport widths captured for every 'full' state's page, once per page. */
export const WIDTHS = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'tablet', width: 820, height: 1000 },
  { name: 'phone', width: 390, height: 844 },
];

export const THEMES = ['light', 'dark'];

/** One representative state per page, captured at every width and theme. */
export const RESPONSIVE = [
  'index/default',
  'homotopy/homotopies/shrink/t0.5',
  'homotopy/types/eq_annulus/x/t0.5',
  'realization/realize/triangle/012',
  'realization/solid/prism-triangle/p0.4',
  'ambiguity/three/selector/all',
  'ambiguity/query/selector/disks',
];
