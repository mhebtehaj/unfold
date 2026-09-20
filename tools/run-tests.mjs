#!/usr/bin/env node
// Runs tests/run.html in a real browser and reports to the terminal.
//
//   node tools/run-tests.mjs
//   node tools/run-tests.mjs --filter tokens
//   node tools/run-tests.mjs --open        print the URL and keep the server up
//
// The suite lives in the browser, not here: the pages under test are static
// HTML whose behaviour only exists in a document, and some suites read the
// captured baseline over fetch. This wrapper exists so the same suite can gate
// a commit without anyone opening a tab.

import { chromium } from 'playwright';
import { serve, CHROMIUM } from './lib/serve.mjs';

const argv = process.argv.slice(2);
const filter = (() => { const i = argv.indexOf('--filter'); return i < 0 ? null : argv[i + 1]; })();

const srv = await serve('.');
const url = `${srv.url}/tests/run.html`;

if (argv.includes('--open')) {
  console.log(`serving ${url}\npress ctrl-c to stop`);
  await new Promise(() => {});
}

const browser = await chromium.launch({ executablePath: CHROMIUM });
const page = await browser.newPage();
const consoleErrors = [];
page.on('pageerror', e => consoleErrors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });

await page.goto(url, { waitUntil: 'load' });
try {
  await page.waitForFunction(() => document.documentElement.dataset.testsDone === 'true',
    null, { timeout: 30000 });
} catch {
  console.error('tests did not finish within 30s');
  if (consoleErrors.length) console.error(consoleErrors.join('\n'));
  await browser.close(); await srv.close();
  process.exit(2);
}

const report = await page.evaluate(() => globalThis.__unfoldReport);
await browser.close();
await srv.close();

const MARK = { pass: '  ok  ', fail: ' FAIL ', tracked: ' known', fixed: ' FIXED' };
for (const s of report.suites) {
  if (filter && !s.name.includes(filter)) continue;
  console.log(`\n${s.name}`);
  for (const r of s.results) {
    console.log(`${MARK[r.status]} ${r.label}`);
    if (r.status === 'fail') console.log(`        ${r.message}`);
    if (r.status === 'tracked') console.log(`        ${r.known}`);
    if (r.status === 'fixed') console.log(`        marked known but now passes — remove the marker`);
  }
}

console.log(`\n${report.pass} passed, ${report.fail} failed, ` +
            `${report.tracked} known issue(s), ${report.fixed} newly fixed`);
if (consoleErrors.length) {
  console.log(`\npage errors (${consoleErrors.length}):`);
  for (const e of [...new Set(consoleErrors)].slice(0, 10)) console.log(`  ${e}`);
}
console.log(`\nopen ${url.replace(/:\d+/, ':8000')} after \`python3 -m http.server 8000\` to see it in a browser`);

process.exit(report.ok ? 0 : 1);
