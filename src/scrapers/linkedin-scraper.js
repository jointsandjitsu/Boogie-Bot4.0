/**
 * LinkedIn Videography Job Scraper
 *
 * Uses LinkedIn's public guest job search API (no login required).
 * Searches for videography roles related to events and combat sports.
 *
 * LinkedIn public endpoint:
 *   https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search
 *   ?keywords=<term>&location=<loc>&start=<offset>&f_TPR=r604800
 *
 * f_TPR filters:
 *   r86400   = past 24 hours
 *   r604800  = past week
 *   r2592000 = past month
 */

'use strict';

const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const JOBS_FILE = path.join(__dirname, '../data/jobs.json');

// Search terms targeting videography + events + combat sports
const SEARCH_QUERIES = [
  'videographer',
  'event videographer',
  'combat sports videographer',
  'sports videographer',
  'videography',
  'video production',
  'MMA videographer',
  'martial arts videographer',
  'fight night videographer'
];

// Time filter: default to past month so we get a good volume
const TIME_FILTER = 'r2592000';

// Max pages per query (25 results per page)
const MAX_PAGES = 3;

// Polite delay between requests (ms)
const REQUEST_DELAY = 1500;

// Headers to mimic a real browser
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  Connection: 'keep-alive',
  'Cache-Control': 'no-cache'
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch one page of job results from LinkedIn's guest search API.
 * Returns an array of raw job objects parsed from the HTML response.
 */
async function fetchJobPage(keyword, location, start = 0) {
  const url = 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search';
  const params = {
    keywords: keyword,
    location: location || '',
    start,
    f_TPR: TIME_FILTER,
    trk: 'public_jobs_jobs-search-bar_search-submit'
  };

  try {
    const response = await axios.get(url, {
      params,
      headers: HEADERS,
      timeout: 15000
    });

    return parseJobCards(response.data, keyword);
  } catch (err) {
    if (err.response) {
      // 429 = rate limited; 999 = LinkedIn bot block
      if ([429, 999].includes(err.response.status)) {
        console.warn(`[Scraper] Rate limited (${err.response.status}) on "${keyword}" — skipping page`);
        return [];
      }
    }
    console.error(`[Scraper] Error fetching "${keyword}" start=${start}:`, err.message);
    return [];
  }
}

/**
 * Parse LinkedIn job card HTML (the format returned by their guest API).
 */
function parseJobCards(html, sourceQuery) {
  const $ = cheerio.load(html);
  const jobs = [];

  $('li').each((_, el) => {
    const card = $(el);

    const titleEl = card.find('.base-search-card__title');
    const companyEl = card.find('.base-search-card__subtitle');
    const locationEl = card.find('.job-search-card__location');
    const timeEl = card.find('time');
    const linkEl = card.find('a.base-card__full-link, a.base-search-card__info-container');

    const title = titleEl.text().trim();
    const company = companyEl.text().trim();
    const location = locationEl.text().trim();
    const postedAt = timeEl.attr('datetime') || timeEl.text().trim();
    const url = linkEl.attr('href') || '';

    // Extract LinkedIn job ID from URL
    const idMatch = url.match(/(\d{10,})/);
    const jobId = idMatch ? idMatch[1] : `${Date.now()}-${Math.random()}`;

    if (!title) return; // skip empty cards

    jobs.push({
      id: jobId,
      title,
      company,
      location,
      postedAt,
      url: url.split('?')[0], // strip tracking params
      sourceQuery,
      scrapedAt: new Date().toISOString(),
      description: '' // filled in by fetchJobDescription()
    });
  });

  return jobs;
}

/**
 * Fetch the full job description from the individual job page.
 * LinkedIn's public job detail page renders description server-side.
 */
async function fetchJobDescription(jobUrl) {
  if (!jobUrl) return '';

  try {
    const response = await axios.get(jobUrl, {
      headers: HEADERS,
      timeout: 15000
    });

    const $ = cheerio.load(response.data);
    const desc =
      $('.description__text').text().trim() ||
      $('.show-more-less-html__markup').text().trim() ||
      $('[class*="description"]').first().text().trim();

    return desc.substring(0, 4000); // cap at 4k chars
  } catch (err) {
    return '';
  }
}

/**
 * De-duplicate jobs by LinkedIn job ID.
 */
function deduplicateJobs(jobs) {
  const seen = new Set();
  return jobs.filter((job) => {
    if (seen.has(job.id)) return false;
    seen.add(job.id);
    return true;
  });
}

/**
 * Main scrape function.
 * @param {string} location  - e.g. "Los Angeles, CA" or "United States"
 * @param {string[]} [extraQueries] - additional search terms beyond defaults
 * @param {boolean} [fetchDescriptions=true] - whether to fetch full descriptions
 * @returns {Promise<object[]>} array of job objects
 */
async function scrapeLinkedInJobs(location = '', extraQueries = [], fetchDescriptions = true) {
  const queries = [...new Set([...SEARCH_QUERIES, ...extraQueries])];
  const allJobs = [];

  console.log(`[Scraper] Starting LinkedIn scrape for ${queries.length} queries in "${location || 'any location'}"`);

  for (const query of queries) {
    console.log(`[Scraper] Searching: "${query}"`);

    for (let page = 0; page < MAX_PAGES; page++) {
      const start = page * 25;
      const pageJobs = await fetchJobPage(query, location, start);

      if (pageJobs.length === 0) break; // no more results

      allJobs.push(...pageJobs);
      console.log(`  Page ${page + 1}: ${pageJobs.length} jobs`);

      await sleep(REQUEST_DELAY);
    }

    await sleep(REQUEST_DELAY);
  }

  const dedupedJobs = deduplicateJobs(allJobs);
  console.log(`[Scraper] Total unique jobs: ${dedupedJobs.length}`);

  // Fetch descriptions for a reasonable batch (avoid hammering LinkedIn)
  if (fetchDescriptions) {
    const withUrls = dedupedJobs.filter((j) => j.url);
    const batchSize = Math.min(withUrls.length, 50); // cap at 50 description fetches

    console.log(`[Scraper] Fetching descriptions for up to ${batchSize} jobs...`);
    for (let i = 0; i < batchSize; i++) {
      const job = withUrls[i];
      job.description = await fetchJobDescription(job.url);
      if ((i + 1) % 5 === 0) console.log(`  Descriptions: ${i + 1}/${batchSize}`);
      await sleep(REQUEST_DELAY);
    }
  }

  // Persist to disk
  saveJobs(dedupedJobs);

  return dedupedJobs;
}

function saveJobs(jobs) {
  try {
    fs.writeFileSync(JOBS_FILE, JSON.stringify(jobs, null, 2));
    console.log(`[Scraper] Saved ${jobs.length} jobs to ${JOBS_FILE}`);
  } catch (err) {
    console.error('[Scraper] Failed to save jobs:', err.message);
  }
}

function loadJobs() {
  try {
    const raw = fs.readFileSync(JOBS_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

module.exports = { scrapeLinkedInJobs, loadJobs, saveJobs };
