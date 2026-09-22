// How to address the engine port of homotopy-explorer.html — the ONE place
// that says so. The port's author may amend this table; nothing else in the
// tooling hard-codes a port selector.
//
// The shipped page addresses everything by hand-written id. The port keeps the
// same controls, but they are engine-generated: ids are generated
// (`${explorableId}-${key}`, layer-4 spec §1.0.3) and exist only for for/aria
// references, so the stable handles are data-* attributes:
//
//   data-explorable="homotopy|equivalence"   the widget's root
//   data-control="key"                        a control bound to state key `key`
//   data-action="name"                        a command button (no state key)
//   svg[data-panel="name"]                    a drawing
//
// Resolution rule, used by tools/port-parity.mjs and tools/shots.mjs alike:
// resolve the legacy selector against the page, and only if it matches nothing
// there use the mapped one. So the same step list drives the frozen original
// and the port, whichever page answers to which selector.

/** [legacy selector, port selector] for every control the state list and the parity tool drive. */
export const CONTROLS = [
  ['#category', '[data-control="category"]'],
  ['#example', '[data-control="example"]'],
  ['#disk-target', '[data-explorable="homotopy"] [data-control="diskTarget"]'],
  ['#class-start', '[data-explorable="homotopy"] [data-control="startDegree"]'],
  ['#class-end', '[data-explorable="homotopy"] [data-control="endDegree"]'],
  ['#time', '[data-explorable="homotopy"] [data-control="t"]'],
  ['#play', '[data-explorable="homotopy"] [data-action="play"]'],
  ['#connect', '[data-explorable="homotopy"] [data-control="connections"]'],
  ['#clear', '[data-explorable="homotopy"] [data-action="clear"]'],
  ['#eq-check-x', '[data-explorable="equivalence"] [data-control="side"] [value="x"]'],
  ['#eq-check-y', '[data-explorable="equivalence"] [data-control="side"] [value="y"]'],
  ['#eq-time', '[data-explorable="equivalence"] [data-control="t"]'],
  ['#eq-play', '[data-explorable="equivalence"] [data-action="play"]'],
  ['#eq-connect', '[data-explorable="equivalence"] [data-control="connections"]'],
  ['#eq-clear', '[data-explorable="equivalence"] [data-action="clear"]'],
];

/** The widgets: [name, legacy root, port root]. */
export const WIDGETS = [
  ['homotopy', '#homotopy-panel', '[data-explorable="homotopy"]'],
  ['equivalence', '#equivalence-panel', '[data-explorable="equivalence"]'],
];

/** The logical drawings of each widget, in the legacy page's document order. */
export const DRAWINGS = {
  homotopy: ['source', 'start', 'now', 'end'],
  equivalence: ['source', 'middle', 'now', 'compose', 'copy'],
};

const LEGACY_DRAWING = { homotopy: name => `#${name}`, equivalence: name => `#eq-${name}` };

/**
 * Every drawing as { key, widget, name, legacy, port }. `key` ("homotopy/now")
 * is how the parity report names a drawing on either page.
 */
export const DRAWING_SELECTORS = Object.entries(DRAWINGS).flatMap(([widget, names]) =>
  names.map(name => ({
    key: `${widget}/${name}`, widget, name,
    legacy: LEGACY_DRAWING[widget](name),
    port: `[data-explorable="${widget}"] svg[data-panel="${name}"]`,
  })));

/**
 * The connectors overlays. NOT part of the Phase 4 brief's table: the port
 * selector is an assumption taken from the layer-4 spec's structural roles
 * (`data-uf="panel|overlay|status|legend|reference"`, §1.0.3). It is used only
 * to name and pair the overlay drawing in reports; when it matches nothing the
 * parity tool pairs the unnamed drawings in document order instead. Amend it
 * once the port exists.
 */
export const OVERLAYS = [
  { key: 'homotopy/connections', widget: 'homotopy', legacy: '#connections',
    port: '[data-explorable="homotopy"] svg[data-uf="overlay"]' },
  { key: 'equivalence/connections', widget: 'equivalence', legacy: '#eq-connections',
    port: '[data-explorable="equivalence"] svg[data-uf="overlay"]' },
];

const MAP = new Map([
  ...CONTROLS,
  ...WIDGETS.map(([, legacy, port]) => [legacy, port]),
  ...DRAWING_SELECTORS.map(d => [d.legacy, d.port]),
  ...OVERLAYS.map(o => [o.legacy, o.port]),
]);

/** The port's selector for a legacy selector, or null when the table has none. */
export function portSelector(legacySelector) {
  return MAP.get(legacySelector) ?? null;
}

/**
 * A Playwright locator for `selector` on this page or frame: the selector
 * itself when it matches anything, otherwise its mapped port selector — and
 * only then. When neither is in the DOM yet (a page that builds its controls
 * late) it waits for either; when neither ever appears it returns the raw
 * selector's locator, so the action that follows fails with the legacy name.
 *
 * @param {import('playwright').Page|import('playwright').Frame} ctx
 * @param {string} selector
 * @param {{timeout?: number}} [o]
 * @returns {Promise<{locator: import('playwright').Locator, selector: string, mapped: boolean}>}
 */
export async function locate(ctx, selector, { timeout = 5000 } = {}) {
  const raw = ctx.locator(selector);
  if (await raw.count()) return { locator: raw.first(), selector, mapped: false };
  const alt = portSelector(selector);
  if (!alt) return { locator: raw.first(), selector, mapped: false };
  const mapped = ctx.locator(alt);
  if (await mapped.count()) return { locator: mapped.first(), selector: alt, mapped: true };
  try {
    await raw.or(mapped).first().waitFor({ state: 'attached', timeout });
  } catch {
    return { locator: raw.first(), selector, mapped: false };
  }
  return (await raw.count())
    ? { locator: raw.first(), selector, mapped: false }
    : { locator: mapped.first(), selector: alt, mapped: true };
}

/** The table as plain data, for code that runs inside a page. */
export const PORT_MAP_DATA = {
  controls: CONTROLS,
  widgets: WIDGETS,
  drawings: DRAWING_SELECTORS,
  overlays: OVERLAYS,
};
