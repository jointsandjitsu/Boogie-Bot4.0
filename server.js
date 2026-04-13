
const express = require('express');
const cors = require('cors');
const path = require('path');
const { OpenAI } = require('openai');
require('dotenv').config();

const { scrapeLinkedInJobs, loadJobs } = require('./src/scrapers/linkedin-scraper');
const { filterAndRankJobs, getJobStats } = require('./src/filters/job-filter');
const { buildTailoredResume, loadBaseResume } = require('./src/resume/resume-builder');

const app = express();
const PORT = process.env.PORT || 3001;
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
// Serve root-level HTML files directly
app.use(express.static(__dirname));

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const SYSTEM_PROMPT = `
You are Boogie Bot, the AI assistant for Joints & Jitsu.
You're funny, creative, and high, but you deliver real answers.
Be helpful with customer service, know Jiu-Jitsu when trained, and never fake facts.
`;

// ── Boogie Bot Chat ───────────────────────────────────────────────────────────

app.post('/api/chat', async (req, res) => {
  const userMessage = req.body.message;

  try {
    const chatCompletion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage }
      ]
    });

    const responseText = chatCompletion.choices[0].message.content;
    res.json({ reply: responseText });
  } catch (error) {
    console.error('OpenAI API error:', error);
    res.status(500).json({ error: 'Something went wrong with Boogie Bot.' });
  }
});

// ── LinkedIn Job Scraper ──────────────────────────────────────────────────────

let scrapeInProgress = false;

/**
 * POST /api/jobs/scrape
 * Trigger a fresh LinkedIn scrape.
 * Body: { location: string, extraQueries: string[], fetchDescriptions: boolean }
 */
app.post('/api/jobs/scrape', async (req, res) => {
  if (scrapeInProgress) {
    return res.status(409).json({ error: 'Scrape already in progress. Please wait.' });
  }

  const { location = '', extraQueries = [], fetchDescriptions = true } = req.body;

  scrapeInProgress = true;
  res.json({ message: 'Scrape started. Poll /api/jobs to see results as they come in.' });

  try {
    await scrapeLinkedInJobs(location, extraQueries, fetchDescriptions);
    console.log('[Server] Scrape complete');
  } catch (err) {
    console.error('[Server] Scrape error:', err.message);
  } finally {
    scrapeInProgress = false;
  }
});

/**
 * GET /api/jobs/status
 * Check whether a scrape is currently running.
 */
app.get('/api/jobs/status', (req, res) => {
  res.json({ scraping: scrapeInProgress });
});

/**
 * GET /api/jobs
 * Return filtered & ranked jobs from the cache.
 * Query params:
 *   category       - all | videography | combat-sports | events
 *   relevanceLevel - all | high | medium | low
 *   minScore       - number
 *   location       - string (substring match)
 */
app.get('/api/jobs', (req, res) => {
  const rawJobs = loadJobs();

  const filtered = filterAndRankJobs(rawJobs, {
    category: req.query.category || 'all',
    relevanceLevel: req.query.relevanceLevel || 'all',
    minScore: parseInt(req.query.minScore, 10) || 1,
    locationFilter: req.query.location || ''
  });

  const stats = getJobStats(rawJobs);

  res.json({ jobs: filtered, stats, total: filtered.length });
});

/**
 * GET /api/jobs/:id
 * Return a single job by its LinkedIn ID.
 */
app.get('/api/jobs/:id', (req, res) => {
  const jobs = loadJobs();
  const job = jobs.find((j) => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

// ── Resume Builder ────────────────────────────────────────────────────────────

/**
 * POST /api/resume/build
 * Build a tailored resume for a job.
 * Body: { jobId: string }  OR  { job: { title, company, description, location } }
 */
app.post('/api/resume/build', async (req, res) => {
  let job = req.body.job;

  if (!job && req.body.jobId) {
    const jobs = loadJobs();
    job = jobs.find((j) => j.id === req.body.jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });
  }

  if (!job) {
    return res.status(400).json({ error: 'Provide either jobId or job object' });
  }

  try {
    const result = await buildTailoredResume(job);
    res.json(result);
  } catch (err) {
    console.error('[Server] Resume build error:', err.message);
    res.status(500).json({ error: 'Resume generation failed: ' + err.message });
  }
});

/**
 * GET /api/resume/base
 * Return the current base resume so the UI can display/edit it.
 */
app.get('/api/resume/base', (req, res) => {
  try {
    const resume = loadBaseResume();
    res.json(resume);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Start server ──────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Boogie Bot is online at http://localhost:${PORT}`);
  console.log(`LinkedIn Job Scraper available at http://localhost:${PORT}/jobs.html`);
});
