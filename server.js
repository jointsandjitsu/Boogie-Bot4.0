
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const { OpenAI } = require('openai');
const { runViralShortsAgent }   = require('./agents/viralShortsAgent');
const { startPipelineJob, getJob } = require('./pipeline/pipeline');
require('dotenv').config();

const app  = express();
const PORT = process.env.PORT || 3001;
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `
You are Boogie Bot, the AI assistant for Joints & Jitsu.
You're funny, creative, and high, but you deliver real answers.
Be helpful with customer service, know Jiu-Jitsu when trained, and never fake facts.
`;

// ── Boogie Bot chat ──────────────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  const userMessage = req.body.message;
  try {
    const cc = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: userMessage },
      ],
    });
    res.json({ reply: cc.choices[0].message.content });
  } catch (err) {
    console.error('OpenAI error:', err);
    res.status(500).json({ error: 'Something went wrong with Boogie Bot.' });
  }
});

// ── Viral Shorts: agent only (text production package) ───────────────────────
app.post('/api/viral-shorts', async (req, res) => {
  const { topic, platform, duration, brandFocus } = req.body;
  if (!topic || !platform || !duration)
    return res.status(400).json({ error: 'Missing required fields: topic, platform, duration' });

  const validPlatforms = ['TikTok', 'Instagram Reels', 'YouTube Shorts'];
  if (!validPlatforms.includes(platform))
    return res.status(400).json({ error: `platform must be one of: ${validPlatforms.join(', ')}` });

  const dur = Number(duration);
  if (!Number.isInteger(dur) || dur < 15 || dur > 60)
    return res.status(400).json({ error: 'duration must be an integer 15–60' });

  try {
    console.log(`[/api/viral-shorts] topic="${topic}" platform=${platform} duration=${dur}s`);
    const pkg = await runViralShortsAgent({ topic, platform, duration: dur, brandFocus: brandFocus || '' });
    res.json({ success: true, package: pkg });
  } catch (err) {
    console.error('[/api/viral-shorts] error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Pipeline: start a full render job ────────────────────────────────────────
app.post('/api/pipeline/start', (req, res) => {
  const { topic, platform, duration, brandFocus, quality, audioPath } = req.body;
  if (!topic || !platform || !duration)
    return res.status(400).json({ error: 'Missing required fields: topic, platform, duration' });

  const validPlatforms = ['TikTok', 'Instagram Reels', 'YouTube Shorts'];
  if (!validPlatforms.includes(platform))
    return res.status(400).json({ error: `platform must be one of: ${validPlatforms.join(', ')}` });

  const dur = Number(duration);
  if (!Number.isInteger(dur) || dur < 15 || dur > 60)
    return res.status(400).json({ error: 'duration must be 15–60' });

  const jobId = startPipelineJob({
    topic, platform, duration: dur,
    brandFocus: brandFocus || '',
    quality: quality || 'standard',
    audioPath: audioPath || null,
  });

  console.log(`[/api/pipeline/start] job=${jobId} topic="${topic}"`);
  res.json({ success: true, jobId });
});

// ── Pipeline: poll job status ─────────────────────────────────────────────────
app.get('/api/pipeline/status/:jobId', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const out = {
    jobId:           job.id,
    status:          job.status,
    stage:           job.stage,
    progress:        job.progress,
    error:           job.error,
    compositionPath: job.compositionPath,
    videoPath:       job.videoPath,
    startedAt:       job.startedAt,
    finishedAt:      job.finishedAt,
  };
  if (job.status === 'done') out.pkg = job.pkg;
  res.json(out);
});

// ── Pipeline: Server-Sent Events progress stream ──────────────────────────────
app.get('/api/pipeline/stream/:jobId', (req, res) => {
  const { jobId } = req.params;

  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  const timer = setInterval(() => {
    const job = getJob(jobId);
    if (!job) { send({ error: 'not found' }); clearInterval(timer); res.end(); return; }

    send({
      status:   job.status,
      stage:    job.stage,
      progress: job.progress,
      error:    job.error,
      videoPath: job.videoPath,
    });

    if (job.status === 'done' || job.status === 'error') {
      clearInterval(timer);
      setTimeout(() => res.end(), 500);
    }
  }, 1000);

  req.on('close', () => clearInterval(timer));
});

// ── Pipeline: download rendered video ────────────────────────────────────────
app.get('/api/pipeline/download/:jobId', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job)         return res.status(404).json({ error: 'Job not found' });
  if (job.status !== 'done') return res.status(409).json({ error: 'Job not complete yet' });
  if (!job.videoPath) return res.status(500).json({ error: 'No video path recorded' });

  const abs = path.join(__dirname, job.videoPath);
  if (!fs.existsSync(abs)) return res.status(404).json({ error: 'Video file not found on disk' });

  const slug = path.basename(job.videoPath, '.mp4');
  res.setHeader('Content-Disposition', `attachment; filename="${slug}.mp4"`);
  res.setHeader('Content-Type', 'video/mp4');
  fs.createReadStream(abs).pipe(res);
});

app.listen(PORT, () => {
  console.log(`Boogie Bot is online at http://localhost:${PORT}`);
});
