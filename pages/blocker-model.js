// The six ordered first-determination exits of OR on two bits.
// Vertex labels agree with the research note TREE_ADVERSARY.md.
export const exits = [
  { id: 'a', history: [['x', 0], ['y', 0]], output: 0 },
  { id: 'b', history: [['x', 0], ['y', 1]], output: 1 },
  { id: 'c', history: [['x', 1]], output: 1 },
  { id: 'd', history: [['y', 0], ['x', 0]], output: 0 },
  { id: 'e', history: [['y', 0], ['x', 1]], output: 1 },
  { id: 'f', history: [['y', 1]], output: 1 },
];
export const FULL = (1 << exits.length) - 1;
export const masks = Array.from({ length: FULL + 1 }, (_, i) => i);
export const vertices = mask => exits.map((_, i) => i).filter(i => mask & (1 << i));
export const size = mask => vertices(mask).length;
export const label = mask => '{' + vertices(mask).map(i => exits[i].id).join(', ') + '}';
export const contains = (outer, inner) => (outer & inner) === inner;
export const maximal = faces => faces.filter(a => !faces.some(b => a !== b && contains(b, a)));
export function compatible(a, b) {
  const x = exits[a].history, y = exits[b].history;
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (x[i][0] !== y[i][0]) return false;
    if (x[i][1] !== y[i][1]) return true;
  }
  return false;
}
const pairwise = (mask, relation) => {
  const v = vertices(mask);
  return v.every((a, i) => v.slice(i + 1).every(b => relation(a, b)));
};
export const treeFaces = masks.filter(m => pairwise(m, compatible));
export const adversaryFaces = masks.filter(m => pairwise(m, (a, b) => !compatible(a, b)));
export const trees = maximal(treeFaces);
export const blockers = maximal(adversaryFaces);
const independence = clutter => masks.filter(m => !clutter.some(t => contains(m, t)));
export const modes = {
  trees: {
    title: '𝒯_f · partial trees', short: '𝒯_f', faces: treeFaces,
    meaning: 'A face consists of executions that can all occur in one algorithm. A maximal face is one complete tree.',
    geometry: 'Two filled triangles. Each triangle contains all executions of one tree.',
    topology: 'Two contractible components (homotopy type S⁰).',
  },
  adversaries: {
    title: '𝒜_f · partial adversary strategies', short: '𝒜_f', faces: adversaryFaces,
    meaning: 'A face consists of executions that can belong to one adaptive response strategy. A maximal face is one complete adversary.',
    geometry: 'The graph K₃,₃: choose one exit from each tree triangle. Every tree and adversary meet in exactly one exit.',
    topology: 'A connected graph with four independent cycles.',
  },
  trimmed: {
    title: '𝒯_f with only its facets removed', short: 'Trimmed 𝒯_f',
    faces: treeFaces.filter(m => !trees.includes(m)),
    meaning: 'This keeps only the proper faces of the two tree triangles. It does not add any mixed face.',
    geometry: 'Two triangle boundaries. This is what removing only the top faces of 𝒯_f actually does.',
    topology: 'Two disjoint circles; dimension 1.',
  },
  noTree: {
    title: 'I(𝒯_f^max) · no complete tree', short: 'I(𝒯_f^max)', faces: independence(trees),
    meaning: 'A face is any exit set containing neither whole tree. Equivalently, one complete adversary avoids every exit in this set.',
    geometry: 'Nine tetrahedra: choose two of a,b,c and two of d,e,f. Each tetrahedron is the complement of an adversary edge.',
    topology: '∂Δ{a,b,c} * ∂Δ{d,e,f} ≅ S³. Nine tetrahedra glued along shared faces.',
  },
  noAdversary: {
    title: 'I(𝒜_f^max) · no complete adversary', short: 'I(𝒜_f^max)', faces: independence(blockers),
    meaning: 'A face contains no complete adversary. Equivalently, one complete tree avoids every exit in this set.',
    geometry: 'No cross-pair is allowed, so every face stays inside one tree triangle. Here I(𝒜_f^max) happens to equal 𝒯_f.',
    topology: 'Two filled triangles (homotopy type S⁰). The equality with 𝒯_f is specific to this example.',
  },
};
for (const mode of Object.values(modes)) {
  mode.facets = maximal(mode.faces);
  mode.dimension = Math.max(...mode.faces.map(size)) - 1;
  mode.counts = Array.from({ length: mode.dimension + 1 }, (_, i) => mode.faces.filter(m => size(m) === i + 1).length);
}
export function witness(key, selected) {
  if (key === 'noTree') {
    const forbidden = trees.find(t => contains(selected, t));
    if (forbidden !== undefined) return `It contains the whole tree ${label(forbidden)}. Every set containing that triple is excluded.`;
    const avoiding = blockers.find(b => !(b & selected));
    return `Adversary ${label(avoiding)} is disjoint from this set: it avoids all these exits against every algorithm.`;
  }
  if (key === 'noAdversary') {
    const forbidden = blockers.find(b => contains(selected, b));
    if (forbidden !== undefined) return `It contains the complete adversary ${label(forbidden)}.`;
    const avoiding = trees.find(t => !(t & selected));
    return `Tree ${label(avoiding)} is disjoint from this set: this algorithm avoids all these exits.`;
  }
  if (modes[key].faces.includes(selected)) return selected === 0 ? 'The empty set is a face of every complex shown here.' : 'Every subset of this face is also a face.';
  if (key === 'trimmed') return trees.some(t => contains(selected, t)) ? 'A whole tree triangle was removed.' : 'A mixed set was never a face of 𝒯_f in the first place.';
  return key === 'trees' ? 'Some exits disagree about which query to ask next, so they cannot coexist in one tree.' : 'Some exits require opposite answers to the same query at their first divergence, so they cannot coexist in one response policy.';
}
