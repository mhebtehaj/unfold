// Pixel comparison for the screenshot baseline.
//
// Byte-equality on PNGs is not a usable gate. Headless Chromium rasterises SVG
// antialiasing nondeterministically: with the DOM in a byte-identical state,
// successive screenshots alternate between two stable encodings that differ by
// a handful of subpixel values. Comparing bytes reports that as a regression
// and teaches everyone to ignore the gate.
//
// So compare pixels, with a tolerance, and report a number. A port that nudges
// a line by one pixel should say how much moved and where, not just "changed".
//
// The decoding happens in the browser, because it is already a dependency and
// it decodes PNG correctly. No image library is added for this.

/** Runs in page context. Returns a summary plus a diff image as a data URL. */
const DIFF = async ([aURL, bURL, threshold, metric]) => {
  const load = src => new Promise((ok, no) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => no(new Error('decode failed'));
    img.src = src;
  });

  const [a, b] = await Promise.all([load(aURL), load(bURL)]);
  if (a.width !== b.width || a.height !== b.height) {
    return { sizeMismatch: true, a: [a.width, a.height], b: [b.width, b.height] };
  }

  const w = a.width, h = a.height;
  const grab = img => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, w, h);
  };
  const A = grab(a), B = grab(b);

  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const octx = out.getContext('2d');
  const D = octx.createImageData(w, h);

  let changed = 0, maxDelta = 0;
  let minX = w, minY = h, maxX = -1, maxY = -1;

  for (let i = 0; i < A.data.length; i += 4) {
    // Perceptual-ish weighting, same coefficients as luma.
    const dr = Math.abs(A.data[i] - B.data[i]);
    const dg = Math.abs(A.data[i + 1] - B.data[i + 1]);
    const db = Math.abs(A.data[i + 2] - B.data[i + 2]);
    const da = Math.abs(A.data[i + 3] - B.data[i + 3]);
    // 'luma' weighs a change by how visible it is; 'max' counts any change in
    // any channel, which is what "identical" has to mean — a luma-weighted
    // delta of a one-level blue change rounds to 0.
    const delta = metric === 'max' ? Math.max(dr, dg, db, da)
      : Math.max(da, Math.round(0.299 * dr + 0.587 * dg + 0.114 * db));
    if (delta > maxDelta) maxDelta = delta;

    const p = i / 4, x = p % w, y = (p / w) | 0;
    if (delta > threshold) {
      changed++;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      D.data[i] = 220; D.data[i + 1] = 40; D.data[i + 2] = 90; D.data[i + 3] = 255;
    } else {
      // Faded original, so the diff reads in context.
      const g = 255 - (255 - A.data[i]) * 0.12;
      D.data[i] = D.data[i + 1] = D.data[i + 2] = g;
      D.data[i + 3] = 255;
    }
  }

  octx.putImageData(D, 0, 0);
  return {
    width: w, height: h,
    changed,
    total: w * h,
    ratio: changed / (w * h),
    maxDelta,
    box: maxX < 0 ? null : [minX, minY, maxX - minX + 1, maxY - minY + 1],
    image: changed ? out.toDataURL('image/png') : null,
  };
};

/**
 * Compare two PNG buffers.
 * @param {import('playwright').Page} page a page to borrow for decoding
 * @param {Buffer} a @param {Buffer} b
 * @param {number} threshold per-pixel delta (0-255) below which pixels match
 * @param {{metric?: 'luma'|'max'}} [o]  'max': the largest change in any channel
 */
export async function comparePNG(page, a, b, threshold = 12, { metric = 'luma' } = {}) {
  const url = buf => 'data:image/png;base64,' + buf.toString('base64');
  return page.evaluate(DIFF, [url(a), url(b), threshold, metric]);
}

/**
 * Is this difference rasteriser noise rather than a real change?
 *
 * Deliberately almost nothing qualifies. With DETERMINISTIC_ARGS the capture is
 * byte-stable across runs, so this is a safety net for other environments, not
 * a working tolerance.
 *
 * A generous threshold here is dangerous in exactly the case this project
 * cares about. A colour-token change repainted a small element: it showed as
 * 0.105% of pixels at desktop width, but the same change at phone width covered
 * fewer pixels and an earlier, laxer rule (ratio <= 0.0008) swallowed it as
 * noise. A real change that happens to be small is still a real change, and the
 * smallest viewport is where a regression is easiest to miss by eye. So the
 * bar is imperceptibility, not smallness: a few pixels differing by at most a
 * couple of levels.
 */
export function isNoise(diff, { maxRatio = 0.0001, maxDelta = 3 } = {}) {
  if (diff.sizeMismatch) return false;
  if (diff.changed === 0) return true;
  return diff.ratio <= maxRatio && diff.maxDelta <= maxDelta;
}

/** Chromium flags that make rasterisation as reproducible as it gets. */
export const DETERMINISTIC_ARGS = [
  '--disable-gpu',
  '--disable-lcd-text',
  '--disable-font-subpixel-positioning',
  '--force-color-profile=srgb',
  '--disable-partial-raster',
  '--disable-skia-runtime-opts',
  '--run-all-compositor-stages-before-draw',
  '--disable-new-content-rendering-timeout',
  '--disable-threaded-animation',
  '--disable-threaded-scrolling',
  '--disable-checker-imaging',
  '--disable-image-animation-resync',
  '--hide-scrollbars',
];
