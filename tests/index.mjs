// The suite registry. Importing a test module registers its suite as a side
// effect, so adding a file here is the only wiring step.
//
// Engine suites get added as their modules land:
//   import './vec.test.mjs';
//   import './viewport.test.mjs';
//   import './simplicial.test.mjs';

import './harness.test.mjs';
import './tokens.test.mjs';

export { runAll, format, suites } from './harness.mjs';
