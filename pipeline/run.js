#!/usr/bin/env node
'use strict';

/**
 * CLI runner — Viral Shorts end-to-end pipeline
 *
 * Full run (agent + render + encode):
 *   node pipeline/run.js --topic "BJJ saved my anxiety" --platform TikTok --duration 30
 *
 * Render-only (composition already scaffolded):
 *   node pipeline/run.js --slug jj-bjj-anxiety-2026 --quality draft
 *
 * Options:
 *   --topic     Video idea / topic              (required for full run)
 *   --platform  TikTok | "Instagram Reels" | "YouTube Shorts"  (default: TikTok)
 *   --duration  15 | 30 | 45 | 60              (default: 30)
 *   --brand     Extra brand-focus context       (optional)
 *   --quality   draft | standard                (default: standard)
 *   --audio     Path to audio file              (optional)
 *   --slug      Render an existing composition  (skips agent)
 *   --help
 *
 * Env:
 *   ANTHROPIC_API_KEY  required for the agent stage
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const path = require('path');
const fs   = require('fs');

const REPO_ROOT    = path.join(__dirname, '..');
const PROJECTS_DIR = path.join(REPO_ROOT, 'video-projects');

function parseArgs(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    a[key] = val;
  }
  return a;
}

function bar(pct, w = 28) {
  const n = Math.round((pct / 100) * w);
  return '[' + '█'.repeat(n) + '░'.repeat(w - n) + `] ${String(pct).padStart(3)}%`;
}

async function renderOnly({ slug, quality, audioPath }) {
  const { renderComposition } = require('./renderer');
  const { assembleVideo }     = require('./assembler');
  const fps = quality === 'draft' ? 15 : 30;

  const projectDir = path.join(PROJECTS_DIR, slug);
  if (!fs.existsSync(path.join(projectDir, 'index.html'))) {
    console.error(`✗ Composition not found: ${projectDir}/index.html`);
    process.exit(1);
  }

  const framesDir  = path.join(projectDir, 'renders', 'frames');
  const outputPath = path.join(projectDir, 'renders', `${slug}-${quality}.mp4`);

  console.log(`\n🎞  Render-only: ${slug}  [${quality} / ${fps}fps]`);

  const result = await renderComposition({
    compositionPath: projectDir, framesDir, fps, quality,
    onProgress: (f, total) => {
      process.stdout.write(`\r   ${bar(Math.round((f / total) * 100))}`);
    },
  });
  console.log(`\n   ✓ ${result.totalFrames} frames`);

  await assembleVideo({ framesDir, outputPath, fps: result.fps, audioPath, quality });
  console.log(`\n✅ ${path.relative(REPO_ROOT, outputPath)}\n`);
}

async function fullRun({ topic, platform, duration, brandFocus, quality, audioPath }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('✗ ANTHROPIC_API_KEY not set'); process.exit(1);
  }

  const { runPipeline } = require('./pipeline');

  console.log('\n⚡ Viral Shorts Pipeline');
  console.log(`   Topic:    ${topic}`);
  console.log(`   Platform: ${platform}`);
  console.log(`   Duration: ${duration}s | Quality: ${quality}\n`);

  let prevStage = '';

  const result = await runPipeline({
    topic, platform, duration, brandFocus, quality, audioPath,
    onStage: (stage, detail) => {
      if (stage !== prevStage) {
        if (prevStage) console.log('');
        const icon = { agent: '🤖', render: '🎞 ', assemble: '🎬' }[stage] || '•';
        process.stdout.write(`${icon} ${detail}`);
        prevStage = stage;
      }
    },
    onProgress: (pct) => {
      if (prevStage === 'render') process.stdout.write(`\r   ${bar(pct)}`);
    },
  });

  console.log('\n\n' + '═'.repeat(52));
  console.log('✅ Pipeline complete!');
  console.log(`   Composition: ${result.compositionPath}/index.html`);
  console.log(`   Video:       ${result.videoPath}`);
  console.log(`   Frames:      ${result.totalFrames} @ ${result.fps}fps`);
  console.log('═'.repeat(52));

  if (result.pkg?.directorNote) {
    console.log("\n🎯 Director's Note:");
    console.log(result.pkg.directorNote.split('\n').map(l => '   ' + l).join('\n'));
  }
  console.log('');
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(`
Usage:
  node pipeline/run.js --topic "..." [--platform TikTok] [--duration 30] [--quality standard]
  node pipeline/run.js --slug jj-my-video-2026 [--quality draft]
    `);
    process.exit(0);
  }

  const quality   = args.quality   || 'standard';
  const audioPath = args.audio     || null;
  const platform  = args.platform  || 'TikTok';
  const duration  = Number(args.duration) || 30;
  const brandFocus = args.brand    || '';

  if (args.slug) {
    await renderOnly({ slug: args.slug, quality, audioPath });
  } else {
    if (!args.topic) {
      console.error('✗ --topic is required (or use --slug for render-only)');
      process.exit(1);
    }
    await fullRun({ topic: args.topic, platform, duration, brandFocus, quality, audioPath });
  }
}

main().catch(err => {
  console.error('\n✗ Pipeline error:', err.message);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
