// The states Phase 3's proof compares, shared by tools/parity.mjs (pixels) and
// tests/realize.test.mjs (every element's geometry and paint).
//
// Each case is two descriptions of one state: `steps` drive the shipped
// realization explorer's own controls, and `state` replays the same
// transitions on the fixture's state object. The transitions restate the
// explorer's arithmetic exactly (chooseComplex, the face buttons, the weight
// sliders' redistribution), so the fixture receives bit-identical weights
// rather than values read back from a rounded slider.

const MAX0 = { edge: [0, 1], vertices: [0], boundary: [0, 1], triangle: [0, 1, 2], glued: [0, 1, 2], tail: [0, 1, 2] };
const SIZE = { edge: 2, vertices: 3, boundary: 3, triangle: 3, glued: 4, tail: 4 };

const centroid = (face, n) => { const w = Array(n).fill(0); face.forEach(i => (w[i] = 1 / face.length)); return w; };

/** realWeightControls' input handler, in its own arithmetic. */
function slide(s, i, v) {
  const w = [...s.w], others = s.face.filter(j => j !== i), old = others.reduce((sum, j) => sum + w[j], 0);
  others.forEach(j => (w[j] = old > 1e-8 ? (w[j] * (1 - v)) / old : (1 - v) / others.length));
  w[i] = v;
  return { ...s, w };
}

export const INITIAL = Object.freeze({ complex: 'triangle', face: [0, 1, 2], w: [0.2, 0.3, 0.5], placement: 0 });

const complex = name => s => ({ ...s, complex: name, face: MAX0[name], w: centroid(MAX0[name], SIZE[name]) });
const face = f => s => ({ ...s, face: f, w: centroid(f, SIZE[s.complex]) });
const toggle = s => ({ ...s, placement: 1 - s.placement });

export const CASES = [
  { name: 'triangle/initial', steps: [], state: [] },
  { name: 'triangle/face-abc', steps: [['click', '[data-face="0,1,2"]']], state: [face([0, 1, 2])] },
  { name: 'triangle/face-ab', steps: [['click', '[data-face="0,1"]']], state: [face([0, 1])] },
  { name: 'triangle/vertex-c', steps: [['click', '[data-face="2"]']], state: [face([2])] },
  { name: 'triangle/slide-a-0.7', steps: [['range', '[data-weight="0"]', '0.7']], state: [s => slide(s, 0, 0.7)] },
  { name: 'triangle/slide-c-0.93', steps: [['range', '[data-weight="2"]', '0.93']], state: [s => slide(s, 2, 0.93)] },
  { name: 'triangle/placement', steps: [['click', '#placement']], state: [toggle] },
  { name: 'vertices/missing-ab', steps: [['select', '#complex', 'vertices'], ['click', '[data-face="0,1"]']],
    state: [complex('vertices'), face([0, 1])] },
  { name: 'boundary/missing-abc', steps: [['select', '#complex', 'boundary'], ['click', '[data-face="0,1,2"]']],
    state: [complex('boundary'), face([0, 1, 2])] },
  { name: 'glued/face-bcd', steps: [['select', '#complex', 'glued'], ['click', '[data-face="1,2,3"]']],
    state: [complex('glued'), face([1, 2, 3])] },
  { name: 'tail/edge-cd-placed', steps: [['select', '#complex', 'tail'], ['click', '[data-face="2,3"]'], ['click', '#placement']],
    state: [complex('tail'), face([2, 3]), toggle] },
  { name: 'edge/initial', steps: [['select', '#complex', 'edge']], state: [complex('edge')] },
];

/** The fixture state a case describes. */
export const stateOf = c => c.state.reduce((s, f) => f(s), { ...INITIAL });
