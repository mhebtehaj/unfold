// The Layer 2 barrel: namespaces plus a short flat list, and nothing else.
//
// The flat names must be the very objects the modules export — a barrel that
// wrapped or copied them would give a page two `defineFamily`s, and
// `defineHomotopy === defineFamily` (spec Q2) would quietly stop holding.

import { suite, assert } from '../harness.mjs';
import * as G from '../../engine/geom/index.js';
import * as tolerance from '../../engine/geom/tolerance.js';
import * as claim from '../../engine/geom/claim.js';
import * as parametric from '../../engine/geom/parametric.js';
import * as map from '../../engine/geom/map.js';
import * as region from '../../engine/geom/region.js';

suite('geom/index', ({ test }) => {

  test('the exported surface is exactly the namespaces and the principal names', () => {
    assert.equal(Object.keys(G).sort(), [
      'Annulus', 'Circle', 'Claim', 'Disk', 'Interval', 'LAYER', 'PointDomain', 'Region', 'Segment', 'TAU', 'TOL', 'Wedge',
      'claim', 'createPicker', 'defineCurve', 'defineDomain', 'defineFamily', 'defineHomotopy', 'map', 'parametric',
      'polar', 'region', 'tolerance',
    ].sort());
    assert.equal(G.LAYER, 2);
  });

  test('each namespace is its module, whole', () => {
    for (const [name, mod] of Object.entries({ tolerance, claim, parametric, map, region })) {
      assert.equal(Object.keys(G[name]).sort(), Object.keys(mod).sort(), `namespace ${name}`);
      for (const k of Object.keys(mod)) assert.ok(G[name][k] === mod[k], `${name}.${k} is not the module's own export`);
    }
  });

  test('the flat names are the modules\' own objects, not copies', () => {
    const want = {
      TOL: tolerance.TOL, Claim: claim.Claim, polar: parametric.polar, defineCurve: parametric.defineCurve,
      defineDomain: map.defineDomain, defineFamily: map.defineFamily, defineHomotopy: map.defineHomotopy,
      createPicker: map.createPicker, Interval: map.Interval, Segment: map.Segment, Circle: map.Circle,
      Disk: map.Disk, Annulus: map.Annulus, PointDomain: map.PointDomain, Wedge: map.Wedge, Region: region.Region,
    };
    for (const [k, v] of Object.entries(want)) assert.ok(G[k] === v, `${k} is not the module's export`);
    assert.ok(G.defineHomotopy === G.defineFamily, 'defineHomotopy must be defineFamily itself');
    assert.ok(G.Circle !== G.parametric.circle, 'the flat Circle is the domain; the curve stays namespaced');
  });
});
