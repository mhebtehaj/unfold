// A test harness with no dependencies and no runner to install.
//
// Suites are plain ES modules. They run unchanged in a browser (open
// /tests/run.html) and under node (tools/run-tests.mjs), because nothing here
// touches the DOM.
//
// Known issues are declared, not ignored. A test marked `known` that fails is
// reported as a tracked defect and does not fail the run; a test marked `known`
// that PASSES fails the run, because the debt is gone and the marker is now a
// lie. That is what keeps a long-lived defect visible without training everyone
// to ignore a red suite.

export const LAYER = -1;   // tests are outside the engine layering

export class Fail extends Error {}

const show = v => {
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number') return Object.is(v, -0) ? '-0' : String(v);
  if (v instanceof Set) return `Set{${[...v].map(show).join(', ')}}`;
  if (v instanceof Map) return `Map{${[...v].map(([k, x]) => `${show(k)}=>${show(x)}`).join(', ')}}`;
  try { return JSON.stringify(v); } catch { return String(v); }
};

export const assert = {
  ok(cond, msg = 'expected truthy') { if (!cond) throw new Fail(msg); },

  equal(got, want, msg = '') {
    const same = Object.is(got, want) ||
      (typeof got === 'object' && typeof want === 'object' &&
       JSON.stringify(got) === JSON.stringify(want));
    if (!same) throw new Fail(`${msg && msg + ': '}expected ${show(want)}, got ${show(got)}`);
  },

  close(got, want, tol = 1e-9, msg = '') {
    if (!(Math.abs(got - want) <= tol))
      throw new Fail(`${msg && msg + ': '}expected ${want} +/- ${tol}, got ${got}`);
  },

  /** Every element of `list` satisfies `pred`; names the first that does not. */
  all(list, pred, msg = '') {
    const arr = [...list];
    for (let i = 0; i < arr.length; i++) {
      if (!pred(arr[i], i)) throw new Fail(`${msg && msg + ': '}item ${i} = ${show(arr[i])} failed`);
    }
  },

  throws(fn, msg = 'expected a throw') {
    try { fn(); } catch { return; }
    throw new Fail(msg);
  },

  /** A comparator defines a total order over `items`: irreflexive, antisymmetric, transitive. */
  totalOrder(items, cmp, msg = 'sort comparator') {
    const a = [...items];
    for (let i = 0; i < a.length; i++) {
      if (cmp(a[i], a[i]) !== 0) throw new Fail(`${msg}: not reflexive at ${i}`);
      for (let j = 0; j < a.length; j++) {
        const ij = Math.sign(cmp(a[i], a[j])), ji = Math.sign(cmp(a[j], a[i]));
        if (ij !== -ji) throw new Fail(`${msg}: not antisymmetric at (${i},${j})`);
        for (let k = 0; k < a.length; k++) {
          const jk = Math.sign(cmp(a[j], a[k])), ik = Math.sign(cmp(a[i], a[k]));
          if (ij < 0 && jk < 0 && !(ik < 0))
            throw new Fail(`${msg}: not transitive at (${i},${j},${k})`);
        }
      }
    }
  },
};

const SUITES = [];

/**
 * @param {string} name
 * @param {(t: {test: Function, known: Function}) => void} body
 */
export function suite(name, body) {
  const tests = [];
  body({
    test: (label, run) => tests.push({ label, run, known: null }),
    /** A failure we have chosen to carry. `why` is shown in the report. */
    known: (label, why, run) => tests.push({ label, run, known: why }),
  });
  SUITES.push({ name, tests });
  return SUITES;
}

export async function runAll(filter = null) {
  const report = { pass: 0, fail: 0, tracked: 0, fixed: 0, suites: [] };
  for (const s of SUITES) {
    if (filter && !s.name.includes(filter)) continue;
    const out = { name: s.name, results: [] };
    for (const t of s.tests) {
      let error = null;
      try { await t.run(); } catch (e) { error = e; }
      let status;
      if (t.known) status = error ? 'tracked' : 'fixed';
      else status = error ? 'fail' : 'pass';
      report[status]++;
      out.results.push({
        label: t.label, status, known: t.known,
        message: error ? (error.message || String(error)) : null,
        stack: error && !(error instanceof Fail) ? String(error.stack ?? '') : null,
      });
    }
    report.suites.push(out);
  }
  report.ok = report.fail === 0 && report.fixed === 0;
  return report;
}

export function format(report) {
  const L = [];
  for (const s of report.suites) {
    L.push(s.name);
    for (const r of s.results) {
      const mark = { pass: '  ok  ', fail: ' FAIL ', tracked: ' known', fixed: ' FIXED' }[r.status];
      L.push(`${mark} ${r.label}`);
      if (r.status === 'fail') L.push(`        ${r.message}`);
      if (r.status === 'tracked') L.push(`        ${r.known}`);
      if (r.status === 'fixed') L.push(`        marked known but now passes — remove the marker`);
    }
  }
  L.push('');
  L.push(`${report.pass} passed, ${report.fail} failed, ` +
         `${report.tracked} known issue(s), ${report.fixed} newly fixed`);
  return L.join('\n');
}

export const suites = SUITES;
