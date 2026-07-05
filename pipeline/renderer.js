'use strict';

/**
 * Hyperframes-compatible composition renderer
 *
 * Loads a composition's index.html in headless Chromium, scrubs the GSAP
 * timeline frame-by-frame via window.__timelines[0].seek(), and saves each
 * frame as a PNG ready for FFmpeg encoding.
 *
 * Requires:
 *   Playwright — globally at /opt/node22/lib/node_modules/playwright
 *   Chromium   — at $PLAYWRIGHT_BROWSERS_PATH or /opt/pw-browsers
 */

const fs   = require('fs');
const path = require('path');

const PLAYWRIGHT_MODULE = process.env.PLAYWRIGHT_MODULE_PATH
  || '/opt/node22/lib/node_modules/playwright';

// Resolve the Chromium executable once at module load time.
const CHROMIUM_EXEC = (() => {
  const base    = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  const entries = fs.readdirSync(base).filter(e => /^chromium/.test(e));
  if (!entries.length) throw new Error(`No chromium directory under ${base}`);

  // Prefer the full browser over the headless shell
  const dir  = entries.find(e => !e.includes('headless_shell')) || entries[0];
  const exec = path.join(base, dir, 'chrome-linux', 'chrome');
  if (fs.existsSync(exec)) return exec;

  // Fallback: headless_shell binary
  const shell = path.join(base, dir, 'headless_shell');
  if (fs.existsSync(shell)) return shell;

  throw new Error(`Chromium executable not found under ${path.join(base, dir)}`);
})();

/**
 * Render a Hyperframes composition to PNG frames.
 *
 * @param {object}   opts
 * @param {string}   opts.compositionPath  Absolute path to the project folder
 * @param {string}   opts.framesDir        Output directory for frame_NNNNN.png files
 * @param {number}   [opts.fps=30]
 * @param {string}   [opts.quality]        'draft' (15fps/540p) | 'standard' (30fps/1080p)
 * @param {function} [opts.onProgress]     Called with (frameIndex, totalFrames)
 * @returns {Promise<{totalFrames, duration, fps, framesDir}>}
 */
async function renderComposition({
  compositionPath,
  framesDir,
  fps      = 30,
  quality  = 'standard',
  onProgress,
}) {
  const { chromium } = require(PLAYWRIGHT_MODULE);

  const isDraft   = quality === 'draft';
  const renderFps = isDraft ? Math.ceil(fps / 2) : fps;
  const renderW   = isDraft ? 540  : 1080;
  const renderH   = isDraft ? 960  : 1920;

  const htmlFile = path.join(compositionPath, 'index.html');
  if (!fs.existsSync(htmlFile)) throw new Error(`index.html not found: ${htmlFile}`);

  fs.mkdirSync(framesDir, { recursive: true });

  console.log(`[Renderer] Chromium: ${CHROMIUM_EXEC}`);
  const browser = await chromium.launch({
    executablePath: CHROMIUM_EXEC,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const page = await browser.newPage();
  await page.setViewportSize({ width: renderW, height: renderH });

  console.log(`[Renderer] Loading file://${htmlFile}`);
  await page.goto(`file://${htmlFile}`, { waitUntil: 'networkidle', timeout: 30_000 });

  // Wait for GSAP timeline registration
  await page.waitForFunction(
    () => Array.isArray(window.__timelines)
       && window.__timelines.length > 0
       && typeof window.__timelines[0].duration === 'function',
    { timeout: 15_000 },
  );

  const duration    = await page.evaluate(() => window.__timelines[0].duration());
  const totalFrames = Math.ceil(duration * renderFps);

  console.log(`[Renderer] ${duration}s | ${renderFps}fps | ${totalFrames} frames | ${renderW}×${renderH}`);

  for (let f = 0; f < totalFrames; f++) {
    await page.evaluate(t => window.__timelines[0].seek(t, false), f / renderFps);

    const framePath = path.join(framesDir, `frame_${String(f).padStart(5, '0')}.png`);
    await page.screenshot({ path: framePath, type: 'png' });

    if (onProgress) onProgress(f + 1, totalFrames);
    if (f % renderFps === 0) {
      console.log(`[Renderer] ${Math.round(((f + 1) / totalFrames) * 100)}% — frame ${f + 1}/${totalFrames}`);
    }
  }

  await browser.close();
  return { totalFrames, duration, fps: renderFps, framesDir };
}

module.exports = { renderComposition, CHROMIUM_EXEC };
