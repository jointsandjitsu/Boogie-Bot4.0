/**
 * Job Filter & Relevance Ranker
 *
 * Scores and filters scraped LinkedIn jobs based on:
 *  - Videography relevance
 *  - Combat sports relevance (MMA, boxing, BJJ, etc.)
 *  - Events / live production relevance
 *  - Recency
 *  - Exclusion of irrelevant roles
 */

'use strict';

// ── Keyword scoring tables ──────────────────────────────────────────────────

const VIDEOGRAPHY_KEYWORDS = [
  { terms: ['videographer', 'videography'], score: 10 },
  { terms: ['video production', 'video producer'], score: 9 },
  { terms: ['cinematographer', 'cinematography'], score: 9 },
  { terms: ['camera operator', 'cameraman', 'camerawoman'], score: 8 },
  { terms: ['content creator', 'content creation'], score: 5 },
  { terms: ['media production', 'media specialist'], score: 5 },
  { terms: ['digital media', 'video editor'], score: 4 },
  { terms: ['filmmaker', 'film production'], score: 7 }
];

const COMBAT_SPORTS_KEYWORDS = [
  { terms: ['mma', 'mixed martial arts', 'ufc', 'bellator', 'one fc'], score: 10 },
  { terms: ['boxing', 'boxing match', 'fight night'], score: 9 },
  { terms: ['bjj', 'brazilian jiu-jitsu', 'jiu jitsu', 'grappling'], score: 9 },
  { terms: ['wrestling', 'submission grappling', 'no-gi'], score: 7 },
  { terms: ['muay thai', 'kickboxing', 'combat sports'], score: 8 },
  { terms: ['martial arts', 'fight', 'fighter', 'bout', 'ring', 'cage'], score: 6 },
  { terms: ['gym', 'training facility', 'fight club', 'academy'], score: 3 }
];

const EVENTS_KEYWORDS = [
  { terms: ['event videographer', 'event video', 'events'], score: 8 },
  { terms: ['live event', 'live production', 'live coverage'], score: 9 },
  { terms: ['sports event', 'athletic event', 'tournament'], score: 8 },
  { terms: ['concert', 'performance', 'show', 'festival'], score: 6 },
  { terms: ['corporate event', 'conference', 'tradeshow'], score: 5 },
  { terms: ['wedding', 'ceremony', 'celebration'], score: 3 },
  { terms: ['broadcast', 'streaming', 'live stream'], score: 7 }
];

// Roles that signal the job is NOT a videography role
const EXCLUSION_TERMS = [
  'photographer only',
  'graphic design',
  'web developer',
  'software engineer',
  'data analyst',
  'marketing manager',
  'sales',
  'accountant',
  'administrator'
];

// ── Scoring logic ───────────────────────────────────────────────────────────

/**
 * Score a single text string against a keyword table.
 */
function scoreText(text, keywordTable) {
  if (!text) return 0;
  const lower = text.toLowerCase();
  let total = 0;

  for (const entry of keywordTable) {
    for (const term of entry.terms) {
      if (lower.includes(term)) {
        total += entry.score;
        break; // count each entry once
      }
    }
  }

  return total;
}

/**
 * Compute a recency bonus: newer postings score higher.
 * Returns 0–5 bonus points.
 */
function recencyBonus(postedAt) {
  if (!postedAt) return 0;

  try {
    const posted = new Date(postedAt);
    const now = new Date();
    const ageDays = (now - posted) / (1000 * 60 * 60 * 24);

    if (ageDays <= 1) return 5;
    if (ageDays <= 3) return 4;
    if (ageDays <= 7) return 3;
    if (ageDays <= 14) return 2;
    if (ageDays <= 30) return 1;
    return 0;
  } catch {
    return 0;
  }
}

/**
 * Check if a job should be excluded (clearly off-topic).
 */
function isExcluded(job) {
  const combined = `${job.title} ${job.description}`.toLowerCase();
  return EXCLUSION_TERMS.some((term) => combined.includes(term));
}

/**
 * Score a job object and attach metadata.
 * Returns the job with .relevanceScore, .categories, .relevanceLabel added.
 */
function scoreJob(job) {
  const searchText = `${job.title} ${job.company} ${job.description}`;

  const videoScore = scoreText(searchText, VIDEOGRAPHY_KEYWORDS);
  const combatScore = scoreText(searchText, COMBAT_SPORTS_KEYWORDS);
  const eventsScore = scoreText(searchText, EVENTS_KEYWORDS);
  const recency = recencyBonus(job.postedAt);

  const totalScore = videoScore + combatScore + eventsScore + recency;

  const categories = [];
  if (videoScore >= 5) categories.push('videography');
  if (combatScore >= 5) categories.push('combat-sports');
  if (eventsScore >= 5) categories.push('events');

  let relevanceLabel = 'low';
  if (totalScore >= 20) relevanceLabel = 'high';
  else if (totalScore >= 10) relevanceLabel = 'medium';

  return {
    ...job,
    relevanceScore: totalScore,
    scoreBreakdown: { video: videoScore, combat: combatScore, events: eventsScore, recency },
    categories,
    relevanceLabel
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Filter and rank jobs.
 *
 * @param {object[]} jobs         - raw job array from scraper
 * @param {object}   [options]
 * @param {string}   [options.category]        - 'all' | 'videography' | 'combat-sports' | 'events'
 * @param {string}   [options.relevanceLevel]  - 'all' | 'high' | 'medium' | 'low'
 * @param {number}   [options.minScore]        - minimum total relevance score
 * @param {string}   [options.locationFilter]  - substring to match in job.location (case-insensitive)
 * @returns {object[]} scored, filtered, sorted jobs
 */
function filterAndRankJobs(jobs, options = {}) {
  const {
    category = 'all',
    relevanceLevel = 'all',
    minScore = 1,
    locationFilter = ''
  } = options;

  // Score all jobs
  let scored = jobs.map(scoreJob);

  // Remove clearly off-topic jobs
  scored = scored.filter((j) => !isExcluded(j));

  // Must have at least some videography signal
  scored = scored.filter((j) => j.scoreBreakdown.video > 0);

  // Apply minimum score threshold
  scored = scored.filter((j) => j.relevanceScore >= minScore);

  // Category filter
  if (category !== 'all') {
    scored = scored.filter((j) => j.categories.includes(category));
  }

  // Relevance level filter
  if (relevanceLevel !== 'all') {
    scored = scored.filter((j) => j.relevanceLabel === relevanceLevel);
  }

  // Location filter
  if (locationFilter) {
    const lcFilter = locationFilter.toLowerCase();
    scored = scored.filter((j) => j.location.toLowerCase().includes(lcFilter));
  }

  // Sort by score descending, then by recency
  scored.sort((a, b) => {
    if (b.relevanceScore !== a.relevanceScore) return b.relevanceScore - a.relevanceScore;
    return (b.scoreBreakdown.recency || 0) - (a.scoreBreakdown.recency || 0);
  });

  return scored;
}

/**
 * Get summary statistics for a set of scored jobs.
 */
function getJobStats(jobs) {
  const scored = jobs.map(scoreJob);
  return {
    total: scored.length,
    high: scored.filter((j) => j.relevanceLabel === 'high').length,
    medium: scored.filter((j) => j.relevanceLabel === 'medium').length,
    low: scored.filter((j) => j.relevanceLabel === 'low').length,
    combatSports: scored.filter((j) => j.categories.includes('combat-sports')).length,
    events: scored.filter((j) => j.categories.includes('events')).length,
    videography: scored.filter((j) => j.categories.includes('videography')).length
  };
}

module.exports = { filterAndRankJobs, scoreJob, getJobStats };
