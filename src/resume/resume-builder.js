/**
 * AI Resume Builder
 *
 * Uses OpenAI GPT-4 to generate a tailored resume for a specific job posting
 * based on the user's base resume stored in src/data/base-resume.json.
 *
 * Outputs:
 *  - A plain-text ATS-friendly resume
 *  - A JSON structured resume (for further editing)
 *  - A match analysis explaining why you're a good fit
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { OpenAI } = require('openai');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const BASE_RESUME_FILE = path.join(__dirname, '../data/base-resume.json');

// Lazy-init so the module can be required without OPENAI_API_KEY set at load time
let _openai = null;
function getOpenAI() {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

function loadBaseResume() {
  try {
    const raw = fs.readFileSync(BASE_RESUME_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    throw new Error('Could not load base-resume.json: ' + err.message);
  }
}

function resumeToText(resume) {
  const r = resume;
  const info = r.personalInfo || {};

  let text = `${info.name || 'YOUR NAME'}\n`;
  if (info.email) text += `${info.email}`;
  if (info.phone) text += ` | ${info.phone}`;
  if (info.location) text += ` | ${info.location}`;
  if (info.linkedin) text += ` | ${info.linkedin}`;
  if (info.portfolio) text += ` | ${info.portfolio}`;
  text += '\n\n';

  if (r.summary) {
    text += `SUMMARY\n${r.summary}\n\n`;
  }

  if (r.skills) {
    text += 'SKILLS\n';
    for (const [category, items] of Object.entries(r.skills)) {
      if (Array.isArray(items) && items.length) {
        text += `  ${category.charAt(0).toUpperCase() + category.slice(1)}: ${items.join(', ')}\n`;
      }
    }
    text += '\n';
  }

  if (Array.isArray(r.experience)) {
    text += 'EXPERIENCE\n';
    for (const job of r.experience) {
      text += `${job.title} — ${job.company}, ${job.location} (${job.startDate} – ${job.endDate})\n`;
      if (Array.isArray(job.bullets)) {
        for (const b of job.bullets) text += `  • ${b}\n`;
      }
      text += '\n';
    }
  }

  if (Array.isArray(r.education)) {
    text += 'EDUCATION\n';
    for (const ed of r.education) {
      text += `${ed.degree} — ${ed.school}, ${ed.location} (${ed.year})\n`;
    }
    text += '\n';
  }

  if (Array.isArray(r.certifications) && r.certifications.length) {
    text += `CERTIFICATIONS\n${r.certifications.map((c) => `  • ${c}`).join('\n')}\n\n`;
  }

  return text.trim();
}

/**
 * Build a tailored resume for a specific job.
 *
 * @param {object} job  - job object with .title, .company, .description
 * @returns {Promise<{tailoredText: string, tailoredJson: object, matchAnalysis: string}>}
 */
async function buildTailoredResume(job) {
  const baseResume = loadBaseResume();
  const baseText = resumeToText(baseResume);

  const systemPrompt = `You are an expert professional resume writer specializing in creative and technical roles in videography, film production, and sports media.

Your task is to tailor the candidate's resume to a specific job posting while keeping all facts truthful — do NOT invent experience or skills the candidate doesn't have. You may:
  - Reorder bullet points to surface the most relevant experience first
  - Rephrase bullets to use keywords from the job description (ATS optimization)
  - Adjust the professional summary to speak directly to the role
  - Emphasize relevant skills and de-emphasize less relevant ones
  - Add power verbs and quantify achievements where possible

Output format — respond with a valid JSON object containing exactly these keys:
{
  "tailoredText": "<full plain-text resume, ATS-friendly, clean formatting>",
  "tailoredJson": { <structured resume matching the base-resume.json schema> },
  "matchAnalysis": "<3–5 sentence explanation of why this candidate is a strong fit>",
  "keywordsMatched": ["<keyword1>", "<keyword2>", "..."],
  "coverLetterOpening": "<2–3 sentence personalized cover letter opening paragraph>"
}`;

  const userPrompt = `JOB POSTING:
Title: ${job.title}
Company: ${job.company}
Location: ${job.location}
Description:
${job.description || '(No description available — tailor based on job title and company)'}

---

CANDIDATE'S BASE RESUME:
${baseText}

---

Please tailor this resume for the job posting above. Remember: facts must stay truthful, but framing and emphasis should be optimized for this specific role.`;

  try {
    const completion = await getOpenAI().chat.completions.create({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.4,
      max_tokens: 3000
    });

    const content = completion.choices[0].message.content;

    // Parse JSON from response (handle code fences if present)
    const jsonMatch = content.match(/```json\s*([\s\S]*?)```/) ||
                      content.match(/```\s*([\s\S]*?)```/) ||
                      [null, content];
    const jsonStr = jsonMatch[1].trim();
    const parsed = JSON.parse(jsonStr);

    return {
      jobId: job.id,
      jobTitle: job.title,
      company: job.company,
      tailoredText: parsed.tailoredText || '',
      tailoredJson: parsed.tailoredJson || {},
      matchAnalysis: parsed.matchAnalysis || '',
      keywordsMatched: parsed.keywordsMatched || [],
      coverLetterOpening: parsed.coverLetterOpening || '',
      generatedAt: new Date().toISOString()
    };
  } catch (err) {
    if (err instanceof SyntaxError) {
      // JSON parse failed — return raw text
      console.warn('[ResumeBuilder] Could not parse structured JSON from GPT, returning raw text');
      const rawContent = err.message;
      return {
        jobId: job.id,
        jobTitle: job.title,
        company: job.company,
        tailoredText: rawContent,
        tailoredJson: {},
        matchAnalysis: '',
        keywordsMatched: [],
        coverLetterOpening: '',
        generatedAt: new Date().toISOString()
      };
    }
    throw err;
  }
}

/**
 * Batch-build tailored resumes for multiple jobs.
 * Returns an array of results.
 */
async function buildResumesForJobs(jobs) {
  const results = [];
  for (const job of jobs) {
    console.log(`[ResumeBuilder] Building resume for: ${job.title} @ ${job.company}`);
    try {
      const result = await buildTailoredResume(job);
      results.push(result);
    } catch (err) {
      console.error(`[ResumeBuilder] Failed for job ${job.id}:`, err.message);
      results.push({ jobId: job.id, error: err.message });
    }
    // Small delay between GPT calls
    await new Promise((r) => setTimeout(r, 500));
  }
  return results;
}

module.exports = { buildTailoredResume, buildResumesForJobs, loadBaseResume, resumeToText };
