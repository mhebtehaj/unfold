// Independent finite checks for the mathematical example, using the truth
// table, minimal hitting sets, and boundary ranks over F_2.
import test from 'node:test';
import assert from 'node:assert/strict';
import { exits, trees, blockers, modes, witness } from '../pages/blocker-model.js';

const inputs = [[0, 0], [0, 1], [1, 0], [1, 1]];
const popcount = n => n.toString(2).replaceAll('0', '').length;
const all = Array.from({ length: 64 }, (_, i) => i);
const sorted = values => [...values].sort((a, b) => a - b);
const key = history => JSON.stringify(history);

// Enumerate every tree that stops at the first determined residual.
function truthTableTrees(history = [], remaining = ['x', 'y']) {
  const surviving = inputs.filter(input => history.every(([q, a]) => input[q === 'x' ? 0 : 1] === a));
  if (new Set(surviving.map(([x, y]) => x | y)).size === 1) return [[history]];
  return remaining.flatMap(q => {
    const rest = remaining.filter(r => r !== q);
    return truthTableTrees([...history, [q, 0]], rest).flatMap(left =>
      truthTableTrees([...history, [q, 1]], rest).map(right => [...left, ...right]));
  });
}

test('exits and tree facets agree with first-determination truth-table enumeration', () => {
  const enumerated = truthTableTrees();
  assert.equal(enumerated.length, 2);
  const actualExits = new Set(enumerated.flat().map(key));
  assert.deepEqual(actualExits, new Set(exits.map(e => key(e.history))));
  const indexed = enumerated.map(t => t.reduce((mask, tau) => {
    const i = exits.findIndex(e => key(e.history) === key(tau));
    assert.ok(i >= 0);
    return mask | (1 << i);
  }, 0));
  assert.deepEqual(sorted(indexed), sorted(trees));
  for (const exit of exits) {
    const consistent = inputs.filter(input => exit.history.every(([q, a]) => input[q === 'x' ? 0 : 1] === a));
    assert.ok(consistent.every(([x, y]) => (x | y) === exit.output));
  }
});

test('adversaries are precisely the minimal hitting sets of the trees', () => {
  const hitsEveryTree = mask => trees.every(t => (mask & t) !== 0);
  const minimalHits = all.filter(mask => hitsEveryTree(mask) &&
    all.every(sub => sub === mask || (sub & mask) !== sub || !hitsEveryTree(sub)));
  assert.deepEqual(sorted(minimalHits), sorted(blockers));
  assert.equal(blockers.length, 9);
  for (const t of trees) for (const b of blockers) assert.equal(popcount(t & b), 1);
});

test('all 64 subsets satisfy duality, avoidance, and the distinction from deleting facets', () => {
  for (const s of all) {
    const noTree = modes.noTree.faces.includes(s);
    const noAdversary = modes.noAdversary.faces.includes(s);
    assert.equal(noTree, blockers.some(b => (b & s) === 0), `adversary avoidance ${s}`);
    assert.equal(noAdversary, trees.some(t => (t & s) === 0), `tree avoidance ${s}`);
    assert.equal(noAdversary, !modes.noTree.faces.includes(63 ^ s), `Alexander duality ${s}`);
    assert.ok(!witness('noTree', s).includes('undefined'));
    assert.ok(!witness('noAdversary', s).includes('undefined'));
  }
  assert.equal(modes.noTree.faces.length, 49);
  assert.deepEqual(sorted(modes.noTree.facets), sorted(blockers.map(b => 63 ^ b)));
  assert.deepEqual(sorted(modes.noAdversary.facets), sorted(trees.map(t => 63 ^ t)));
  assert.deepEqual(modes.noTree.counts, [6, 15, 18, 9]);
  assert.deepEqual(modes.trimmed.counts, [6, 6]);
  assert.ok(modes.noTree.faces.includes(27)); // abde is a mixed tetrahedron.
  assert.ok(!modes.trees.faces.includes(27));
  assert.ok(!modes.trimmed.faces.includes(27));
});

function rankF2(columns) {
  const pivots = new Map();
  for (let col of columns) {
    while (col) {
      const pivot = 31 - Math.clz32(col);
      if (pivots.has(pivot)) col ^= pivots.get(pivot);
      else { pivots.set(pivot, col); break; }
    }
  }
  return pivots.size;
}
function reducedBetti(faces) {
  const levels = Array.from({ length: 5 }, (_, i) => faces.filter(f => popcount(f) === i + 1));
  const ranks = [1]; // augmentation C_0 -> F_2 for these nonempty complexes
  for (let k = 1; k < levels.length; k++) {
    ranks[k] = rankF2(levels[k].map(face => levels[k - 1].reduce((col, sub, i) =>
      (face & sub) === sub ? col | (1 << i) : col, 0)));
  }
  return levels.slice(0, 4).map((level, k) => level.length - ranks[k] - ranks[k + 1]);
}

test('boundary matrices give the claimed reduced homology over F_2', () => {
  assert.deepEqual(reducedBetti(modes.trees.faces), [1, 0, 0, 0]);
  assert.deepEqual(reducedBetti(modes.adversaries.faces), [0, 4, 0, 0]);
  assert.deepEqual(reducedBetti(modes.trimmed.faces), [1, 2, 0, 0]);
  assert.deepEqual(reducedBetti(modes.noTree.faces), [0, 0, 0, 1]);
  assert.deepEqual(reducedBetti(modes.noAdversary.faces), [1, 0, 0, 0]);
});

test('the short-exit threshold is exactly D(OR_2) = 2', () => {
  for (const k of [0, 1, 2]) {
    const short = exits.reduce((mask, e, i) => e.history.length <= k ? mask | (1 << i) : mask, 0);
    assert.equal(modes.noTree.faces.includes(short), 2 > k);
  }
});
