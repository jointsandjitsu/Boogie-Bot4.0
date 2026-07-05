'use strict';

/**
 * End-to-end pipeline orchestrator
 *
 * agent  → Claude: hooks → script → plan → titles → scaffold HTML
 * render → Playwright: HTML → PNG frames
 * assemble → FFmpeg: frames → MP4
 */

const path = require('path');
const fs   = require('fs');

const { runViralShortsAgent } = require('../agents/viralShortsAgent');
const { renderComposition }   = require('./renderer');
const { assembleVideo }       = require('./assembler');

const REPO_ROOT    = path.join(__dirname, '..');
const PROJECTS_DIR = path.join(REPO_ROOT, 'video-projects');

// ── In-memory async job store ────────────────────────────────────────────────

const jobs = new Map();

function createJob(id) {
  const job = {
    id, status: 'pending', stage: null, progress: 0,
    error: null, pkg: null, compositionPath: null, videoPath: null,
    startedAt: Date.now(), finishedAt: null,
  };
  jobs.set(id, job);
  return job;
}

function updateJob(id, patch) {
  const j = jobs.get(id);
  if (j) Object.assign(j, patch);
  return j;
}

function getJob(id) { return jobs.get(id) || null; }

// ── Pipeline runner ──────────────────────────────────────────────────────────

/**
 * @param {object}   opts
 * @param {string}   opts.topic
 * @param {string}   opts.platform     TikTok | Instagram Reels | YouTube Shorts
 * @param {number}   opts.duration
 * @param {string}   [opts.brandFocus]
 * @param {string}   [opts.quality]    draft | standard
 * @param {string}   [opts.audioPath]
 * @param {string}   [opts.jobId]
 * @param {function} [opts.onStage]    (stage, detail) => void
 * @param {function} [opts.onProgress] (pct: 0-100) => void
 * @returns {Promise<PipelineResult>}
 */
async function runPipeline({
  topic,
  platform,
  duration,
  brandFocus = '',
  quality    = 'standard',
  audioPath  = null,
  jobId      = null,
  onStage    = () => {},
  onProgress = () => {},
}) {
  function emit(stage, detail, pct) {
    if (jobId) updateJob(jobId, { stage, progress: pct ?? 0 });
    onStage(stage, detail);
    onProgress(pct ?? 0);
    console.log(`[Pipeline${jobId ? ':' + jobId.slice(-6) : ''}] [${stage}] ${detail}`);
  }

  // Stage 1 — Agent
  emit('agent', 'Starting Viral Shorts Agent…', 0);
  if (jobId) updateJob(jobId, { status: 'running' });

  const pkg = await runViralShortsAgent({ topic, platform, duration, brandFocus });

  if (!pkg.compositionPath) {
    throw new Error('Agent did not scaffold a composition. Is ANTHROPIC_API_KEY set?');
  }

  emit('agent', `Composition ready: ${pkg.compositionPath}`, 25);

  // Stage 2 — Render
  const slug       = path.basename(pkg.compositionPath);
  const projectDir = path.join(PROJECTS_DIR, slug);
  const framesDir  = path.join(projectDir, 'renders', 'frames');
  const fps        = quality === 'draft' ? 15 : 30;

  emit('render', `Rendering ${duration}s @ ${fps}fps…`, 30);

  const renderResult = await renderComposition({
    compositionPath: projectDir,
    framesDir, fps, quality,
    onProgress: (f, total) => {
      const pct = 30 + Math.round((f / total) * 40);
      if (jobId) updateJob(jobId, { progress: pct });
      onProgress(pct);
    },
  });

  emit('render', `${renderResult.totalFrames} frames rendered`, 70);

  // Stage 3 — Assemble
  emit('assemble', `Encoding MP4 (${quality})…`, 75);

  const outputPath = path.join(projectDir, 'renders', `${slug}-${quality}.mp4`);

  await assembleVideo({ framesDir, outputPath, fps: renderResult.fps, audioPath, quality });

  const relVideo = path.relative(REPO_ROOT, outputPath);
  emit('assemble', `Video ready: ${relVideo}`, 100);

  const result = {
    slug,
    compositionPath: pkg.compositionPath,
    videoPath:       relVideo,
    absoluteVideoPath: outputPath,
    quality,
    durationS:   renderResult.duration,
    totalFrames: renderResult.totalFrames,
    fps:         renderResult.fps,
    pkg,
  };

  if (jobId) {
    updateJob(jobId, {
      status: 'done', progress: 100, finishedAt: Date.now(),
      pkg, compositionPath: result.compositionPath, videoPath: result.videoPath,
    });
  }

  return result;
}

/**
 * Fire-and-forget: start a pipeline job and return its ID immediately.
 */
function startPipelineJob(opts) {
  const id  = `job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  createJob(id);

  runPipeline({ ...opts, jobId: id }).catch(err => {
    updateJob(id, { status: 'error', error: err.message, finishedAt: Date.now() });
    console.error(`[Pipeline:${id.slice(-6)}] ERROR: ${err.message}`);
  });

  return id;
}

module.exports = { runPipeline, startPipelineJob, getJob, jobs };
