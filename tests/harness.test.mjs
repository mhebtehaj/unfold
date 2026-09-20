// Meta-tests. A harness whose assertions silently pass is worse than none, so
// each assertion is checked to actually fail when it should.

import { suite, assert, Fail } from './harness.mjs';

const fails = fn => {
  try { fn(); } catch (e) { if (e instanceof Fail) return true; throw e; }
  return false;
};

suite('harness', ({ test }) => {
  test('assert.ok rejects falsy', () => {
    assert.ok(fails(() => assert.ok(false)));
    assert.ok(fails(() => assert.ok(0)));
    assert.ok(!fails(() => assert.ok(1)));
  });

  test('assert.equal distinguishes 0 from -0', () => {
    assert.ok(fails(() => assert.equal(-0, 0)),
      'a sign flip on a rounded coordinate must not pass silently');
  });

  test('assert.equal compares structurally', () => {
    assert.ok(!fails(() => assert.equal({ a: [1, 2] }, { a: [1, 2] })));
    assert.ok(fails(() => assert.equal({ a: [1, 2] }, { a: [2, 1] })));
  });

  test('assert.close respects tolerance', () => {
    assert.ok(!fails(() => assert.close(1.0000001, 1, 1e-6)));
    assert.ok(fails(() => assert.close(1.1, 1, 1e-6)));
    assert.ok(fails(() => assert.close(NaN, 1, 1e-6)), 'NaN must not pass');
  });

  test('assert.all names the first failure', () => {
    try { assert.all([2, 4, 5, 6], n => n % 2 === 0); }
    catch (e) { assert.ok(/item 2/.test(e.message), e.message); return; }
    throw new Fail('expected a throw');
  });

  test('assert.totalOrder accepts a real comparator', () => {
    assert.totalOrder([3, 1, 2, 1], (a, b) => a - b);
  });

  test('assert.totalOrder rejects an inconsistent comparator', () => {
    // The shape of the bug this exists to catch: sorting by a key that is
    // recomputed differently for the two operands. A depth sort spelled three
    // ways, as the inventory found, can land here.
    let flip = 0;
    assert.ok(fails(() => assert.totalOrder([1, 2, 3], () => (flip++ % 2 ? 1 : -1))));
  });

  test('assert.totalOrder rejects a non-transitive comparator', () => {
    // Rock-paper-scissors: pairwise consistent, globally impossible.
    const beats = { r: 's', s: 'p', p: 'r' };
    const cmp = (a, b) => a === b ? 0 : beats[a] === b ? -1 : 1;
    assert.ok(fails(() => assert.totalOrder(['r', 'p', 's'], cmp)));
  });

  test('assert.throws requires a throw', () => {
    assert.ok(fails(() => assert.throws(() => 1)));
    assert.ok(!fails(() => assert.throws(() => { throw new Error('x'); })));
  });
});
