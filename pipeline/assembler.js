'use strict';

/**
 * Video assembler — encodes PNG frame sequences to MP4 via FFmpeg.
 * Uses the FFmpeg binary bundled alongside Playwright's Chromium.
 */

const { execFile } = require('child_process');
const path         = require('path');
const fs           = require('fs');

// Resolve FFmpeg binary once at module load time.
const FFMPEG = (() => {
  if (process.env.FFMPEG_PATH && fs.existsSync(process.env.FFMPEG_PATH)) {
    return process.env.FFMPEG_PATH;
  }
  const base    = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  const entries = fs.readdirSync(base).filter(e => /^ffmpeg/.test(e));
  if (!entries.length) throw new Error(`FFmpeg not found under ${base}`);
  const bin = path.join(base, entries[0], 'ffmpeg-linux');
  if (!fs.existsSync(bin)) throw new Error(`FFmpeg binary missing: ${bin}`);
  return bin;
})();

function runFFmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile(FFMPEG, args, { maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`FFmpeg failed:\n${stderr.slice(-2000)}`));
      else     resolve({ stdout, stderr });
    });
  });
}

/**
 * Encode frames → MP4.
 *
 * @param {object}  opts
 * @param {string}  opts.framesDir    Directory with frame_00000.png files
 * @param {string}  opts.outputPath   Destination .mp4
 * @param {number}  [opts.fps=30]
 * @param {string}  [opts.audioPath]  Optional audio track
 * @param {string}  [opts.quality]    'draft' (crf 28, fast) | 'standard' (crf 18, medium)
 * @returns {Promise<string>} Resolved output path
 */
async function assembleVideo({
  framesDir,
  outputPath,
  fps     = 30,
  audioPath,
  quality = 'standard',
}) {
  const crf    = quality === 'draft' ? '28' : '18';
  const preset = quality === 'draft' ? 'fast' : 'medium';

  const args = [
    '-y',
    '-framerate', String(fps),
    '-f',        'image2',
    '-i',        path.join(framesDir, 'frame_%05d.png'),
  ];

  if (audioPath && fs.existsSync(audioPath)) {
    args.push('-i', audioPath, '-c:a', 'aac', '-b:a', '192k', '-shortest');
  }

  args.push(
    '-c:v',      'libx264',
    '-preset',   preset,
    '-crf',      crf,
    '-pix_fmt',  'yuv420p',    // required for iOS / Android
    '-movflags', '+faststart', // progressive download
    outputPath,
  );

  console.log(`[Assembler] FFmpeg: ${FFMPEG}`);
  console.log(`[Assembler] → ${path.basename(outputPath)} (crf ${crf}, preset ${preset})`);

  await runFFmpeg(args);

  const mb = (fs.statSync(outputPath).size / (1024 * 1024)).toFixed(1);
  console.log(`[Assembler] Done — ${mb} MB`);

  return outputPath;
}

async function ffmpegVersion() {
  try {
    const { stderr } = await runFFmpeg(['-version']);
    return stderr.split('\n')[0];
  } catch {
    return 'unknown';
  }
}

module.exports = { assembleVideo, ffmpegVersion, FFMPEG };
