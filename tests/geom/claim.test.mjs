// Properties of geom/claim.js.
//
// The rendering table is the contract: every row of the specification's §6.3
// is pinned here, and the row that does the work — sound only in the negative
// direction, value true — is checked by a property as well as by example,
// because it is the one a well-meaning edit would "fix" into a tick.

import { suite, assert } from '../harness.mjs';
import * as C from '../../engine/geom/claim.js';

const { Claim } = C;
const SOUNDS = [true, 'positive', 'negative', 'lower', 'upper', false];

suite('geom/claim', ({ test }) => {

  test('the exported surface is exactly what the brief names', () => {
    assert.equal(Object.keys(C).sort(), ['Claim', 'LAYER']);
    assert.equal(C.LAYER, 2);
    assert.equal(Object.keys(Claim).sort(),
      ['authored', 'computed', 'isAuthored', 'isComputed', 'isUnknown', 'render', 'unknown']);
    assert.ok(Object.isFrozen(Claim), 'the namespace is not frozen');
  });

  test('claims are frozen records with the fields they were given', () => {
    const src = { key: 'bjorner', printed: 89 };
    const a = Claim.authored(false, { note: 'the bulge leaves', source: src, by: 'Björner' });
    assert.equal(a.kind, 'authored');
    assert.equal(a.value, false);
    assert.ok(a.source === src, 'the citation is passed through by identity');
    assert.equal(a.note, 'the bulge leaves');
    assert.equal(a.by, 'Björner');
    assert.ok(Object.isFrozen(a));
    assert.equal(Claim.authored(undefined).value, null, 'undefined is stored as null');

    const w = [[0.1, 0.2]];
    const c = Claim.computed(true, { method: 'sampled', sound: 'positive', witnesses: w, budget: { samples: 8 } });
    assert.equal([c.kind, c.value, c.sound, c.method], ['computed', true, 'positive', 'sampled']);
    assert.ok(Object.isFrozen(c) && Object.isFrozen(c.witnesses) && Object.isFrozen(c.budget));
    w.push([9, 9]);
    assert.equal(c.witnesses.length, 1, 'the witnesses were not copied');
    assert.equal(Claim.computed(1, { method: 'm', sound: true }).witnesses, [], 'witnesses default to []');

    const u = Claim.unknown('undersampled');
    assert.equal([u.kind, u.value, u.reason], ['unknown', null, 'undersampled']);
    assert.ok(Object.isFrozen(u));
  });

  test('sound must be one of the six values; anything else throws, including nothing', () => {
    for (const s of SOUNDS) {
      const v = s === 'lower' || s === 'upper' ? 3 : true;
      assert.ok(Claim.isComputed(Claim.computed(v, { method: 'm', sound: s })), `sound ${String(s)} refused`);
    }
    for (const s of [undefined, null, 'true', 1, 0, 'exact', 'Positive'])
      assert.throws(() => Claim.computed(true, { method: 'm', sound: s }), `sound ${JSON.stringify(s)} accepted`);
  });

  test('computed claims must say how, and directions must fit their values', () => {
    assert.throws(() => Claim.computed(true, { sound: true }), 'no method');
    assert.throws(() => Claim.computed(true, { method: '', sound: true }), 'empty method');
    assert.throws(() => Claim.computed(2, { method: 'm', sound: 'negative' }), 'negative needs a boolean');
    assert.throws(() => Claim.computed('x', { method: 'm', sound: 'positive' }), 'positive needs a boolean');
    assert.throws(() => Claim.computed(true, { method: 'm', sound: 'lower' }), 'lower needs a number');
    assert.throws(() => Claim.computed(NaN, { method: 'm', sound: 'upper' }), 'upper refuses NaN');
    assert.throws(() => Claim.computed(true, { method: 'm', sound: true, witnesses: 'w' }), 'witnesses not an array');
    assert.throws(() => Claim.computed(true, { method: 'm', sound: true, budget: 5 }), 'budget not an object');
    assert.throws(() => Claim.unknown(''), 'an unknown needs a reason');
    assert.throws(() => Claim.authored(true, { note: 5 }), 'note must be a string');
    assert.throws(() => Claim.authored(true, { source: 'Hatcher' }), 'source must be an object');
  });

  test('only claims built here are claims', () => {
    const forged = Object.freeze({ kind: 'computed', value: true, sound: true, method: 'm', witnesses: [] });
    assert.ok(!Claim.isComputed(forged) && !Claim.isAuthored(forged) && !Claim.isUnknown(forged));
    assert.throws(() => Claim.render(forged), 'render accepted a forged claim');
    const a = Claim.authored(1), c = Claim.computed(1, { method: 'm', sound: true }), u = Claim.unknown('r');
    assert.equal([a, c, u].map(Claim.isAuthored), [true, false, false]);
    assert.equal([a, c, u].map(Claim.isComputed), [false, true, false]);
    assert.equal([a, c, u].map(Claim.isUnknown), [false, false, true]);
    assert.ok(!Claim.isComputed(null) && !Claim.isComputed(undefined));
  });

  test('render follows every row of the §6.3 table', () => {
    const r = (value, o) => Claim.render(Claim.computed(value, { method: 'exact-check', ...o }));
    const row = (got, glyph, tone, title, text) => {
      assert.equal(got.glyph, glyph, `glyph for "${title}"`);
      assert.equal(got.tone, tone, `tone for "${title}"`);
      assert.equal(got.title, title);
      if (text !== undefined) assert.equal(got.text, text);
      assert.ok(Object.isFrozen(got), 'render result is not frozen');
    };
    row(r(true, { sound: true }), '✓', 'good', 'verified by exact-check', 'verified');
    row(r(false, { sound: true }), '✗', 'bad', 'disproved by exact-check', 'disproved');
    row(r(false, { sound: 'negative', witnesses: [[-0.8, 0.68]] }), '✗', 'bad',
        'counterexample found: (−0.80, 0.68)', 'counterexample found');
    row(r(true, { sound: 'negative', budget: { samples: 512 } }), '—', 'neutral',
        'no counterexample found in 512 samples — not a proof', 'no counterexample found');
    row(r(true, { sound: 'negative' }), '—', 'neutral', 'no counterexample found — not a proof');
    row(r(true, { sound: 'positive', witnesses: [[0.02, 0.91]] }), '✓', 'good', 'certificate found: (0.02, 0.91)',
        'certificate found');
    row(r(false, { sound: 'positive' }), '—', 'neutral', 'no certificate found — not a proof', 'no certificate found');
    row(r(3, { sound: 'lower' }), '≥', 'neutral', 'a bound, not the exact value', '3');
    row(r(7, { sound: 'upper' }), '≤', 'neutral', 'a bound, not the exact value', '7');
    row(Claim.render(Claim.authored(true, { source: { key: 'bjorner', label: 'Björner', printed: 89 } })),
        '“ ”', 'authored', 'asserted by the author — Björner, p. 89', 'stated:');
    row(Claim.render(Claim.authored(true)), '“ ”', 'authored', 'asserted by the author', 'stated:');
    row(Claim.render(Claim.authored(true, { source: { key: 'hatcher', pdfPage: 38 } })),
        '“ ”', 'authored', 'asserted by the author — hatcher, PDF p. 38');
    row(Claim.render(Claim.unknown('undersampled')), '—', 'neutral', 'undersampled', 'unknown');
  });

  test('the two rows the table lacks: exact non-boolean values and heuristics', () => {
    const exact = Claim.render(Claim.computed(2, { method: 'signed-angle sum', sound: true }));
    assert.equal([exact.glyph, exact.tone, exact.text, exact.title],
      ['=', 'good', '2', 'computed exactly by signed-angle sum']);
    const guess = Claim.render(Claim.computed({ rank: 1 }, { method: 'sampled-differential', sound: false }));
    assert.equal([guess.glyph, guess.tone, guess.text, guess.title],
      ['≈', 'neutral', 'estimated', 'estimated by sampled-differential — a heuristic, not a proof']);
    assert.equal(Claim.render(Claim.computed(true, { method: 'm', sound: false })).glyph, '≈',
      'a heuristic true is not a tick');
  });

  test('no claim renders ✓ unless its true is proven', () => {
    // THE rule of the section: sampling cannot produce a tick. Exhaustive over
    // every sound value and every boolean value it admits.
    for (const sound of SOUNDS) {
      for (const value of sound === 'lower' || sound === 'upper' ? [0, 1, 5] : [true, false]) {
        const g = Claim.render(Claim.computed(value, { method: 'm', sound, witnesses: [[1, 2]] })).glyph;
        const proven = value === true && (sound === true || sound === 'positive');
        assert.equal(g === '✓', proven, `sound ${String(sound)}, value ${value} rendered ${g}`);
      }
    }
    assert.ok(Claim.render(Claim.authored(true)).glyph !== '✓', 'an authored true is a quotation, not a tick');
    assert.ok(Claim.render(Claim.unknown('x')).glyph !== '✓');
  });

  test('witnesses are written plainly: two decimals, a real minus, never −0.00', () => {
    const t = w => Claim.render(Claim.computed(false, { method: 'm', sound: 'negative', witnesses: [w] })).title;
    assert.equal(t([-0.001, 0.004]), 'counterexample found: (0.00, 0.00)');
    assert.equal(t([1.234, -5.678]), 'counterexample found: (1.23, −5.68)');
    assert.equal(t({ input: { u: 0.1 }, point: [0.5, -0.25] }), 'counterexample found: (0.50, −0.25)');
    assert.equal(t({ distance: 1.5 }), 'counterexample found: a jump of 1.50');
    assert.equal(t('the seam'), 'counterexample found: the seam');
  });

  test('render refuses an unknown style', () => {
    const c = Claim.unknown('r');
    assert.equal(Claim.render(c, { style: 'inline' }).glyph, '—');
    assert.throws(() => Claim.render(c, { style: 'block' }), 'an unknown style was accepted');
  });
});
