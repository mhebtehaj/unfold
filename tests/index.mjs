// The suite registry. Importing a test module registers its suite as a side
// effect, so adding a file here is the only wiring step.
//
// Engine suites are added as their modules land, in layer order.

import './harness.test.mjs';
import './tokens.test.mjs';

// Layer 0 — kernel
import './vec.test.mjs';
import './svg.test.mjs';
import './a11y.test.mjs';
import './labels.test.mjs';
import './anim.test.mjs';
import './state.test.mjs';
import './viewport.test.mjs';
import './controls.test.mjs';
import './probe.test.mjs';

// Layer 1 — render
import './palette.test.mjs';
import './marks.test.mjs';
import './scene.test.mjs';
import './realize.test.mjs';

// Layer 2 — geometry (tests/geom.test.mjs registers one suite per module)
import './geom.test.mjs';

// The stylesheet, and Layer 4 — page
import './unfold-css.test.mjs';
import './shell.test.mjs';
import './home.test.mjs';
import './prose.test.mjs';
import './controls-ui.test.mjs';
import './panels.test.mjs';
import './explorable.test.mjs';

export { runAll, format, suites } from './harness.mjs';
