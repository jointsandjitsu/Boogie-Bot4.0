/* ── LinkedIn Videography Job Finder — Frontend ── */

const API = ''; // same origin

// ── DOM refs ────────────────────────────────────────────────────────────────
const scrapeBtn        = document.getElementById('scrapeBtn');
const loadCachedBtn    = document.getElementById('loadCachedBtn');
const scrapeStatus     = document.getElementById('scrapeStatus');
const locationInput    = document.getElementById('locationInput');
const extraKeywords    = document.getElementById('extraKeywords');
const fetchDesc        = document.getElementById('fetchDescriptions');

const statsBar         = document.getElementById('statsBar');
const statTotal        = document.getElementById('statTotal');
const statHigh         = document.getElementById('statHigh');
const statMedium       = document.getElementById('statMedium');
const statCombat       = document.getElementById('statCombat');
const statEvents       = document.getElementById('statEvents');

const filterBar        = document.getElementById('filterBar');
const filterCategory   = document.getElementById('filterCategory');
const filterRelevance  = document.getElementById('filterRelevance');
const filterLocation   = document.getElementById('filterLocation');
const applyFiltersBtn  = document.getElementById('applyFiltersBtn');

const jobsSection      = document.getElementById('jobsSection');
const jobsGrid         = document.getElementById('jobsGrid');
const resultsHeading   = document.getElementById('resultsHeading');
const noResults        = document.getElementById('noResults');

const resumeModal      = document.getElementById('resumeModal');
const modalBackdrop    = document.getElementById('modalBackdrop');
const modalClose       = document.getElementById('modalClose');
const modalJobInfo     = document.getElementById('modalJobInfo');
const resumeLoading    = document.getElementById('resumeLoading');
const resumeResult     = document.getElementById('resumeResult');
const matchAnalysis    = document.getElementById('matchAnalysis');
const tailoredResumeText = document.getElementById('tailoredResumeText');
const coverLetterText  = document.getElementById('coverLetterText');
const keywordsContainer = document.getElementById('keywordsContainer');
const copyResumeBtn    = document.getElementById('copyResumeBtn');
const downloadResumeBtn = document.getElementById('downloadResumeBtn');
const copyCoverBtn     = document.getElementById('copyCoverBtn');

let scrapePoller = null;

// ── Scrape ──────────────────────────────────────────────────────────────────

scrapeBtn.addEventListener('click', async () => {
  const location   = locationInput.value.trim();
  const rawExtra   = extraKeywords.value.trim();
  const extraList  = rawExtra ? rawExtra.split(',').map(s => s.trim()).filter(Boolean) : [];
  const doFetchDesc = fetchDesc.checked;

  setStatus('scraping', '&#9889; Scraping LinkedIn...');
  scrapeBtn.disabled = true;

  try {
    const res = await fetch(`${API}/api/jobs/scrape`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ location, extraQueries: extraList, fetchDescriptions: doFetchDesc })
    });
    const data = await res.json();

    if (!res.ok) {
      setStatus('error', '&#10060; ' + (data.error || 'Scrape failed'));
      scrapeBtn.disabled = false;
      return;
    }

    setStatus('scraping', '&#9889; Scraping in progress... polling for results');
    pollForCompletion();
  } catch (err) {
    setStatus('error', '&#10060; Network error: ' + err.message);
    scrapeBtn.disabled = false;
  }
});

function pollForCompletion() {
  let polls = 0;
  scrapePoller = setInterval(async () => {
    polls++;
    try {
      const res   = await fetch(`${API}/api/jobs/status`);
      const data  = await res.json();

      // Load results on every poll so user sees progress
      loadJobs();

      if (!data.scraping) {
        clearInterval(scrapePoller);
        setStatus('done', '&#10003; Scrape complete!');
        scrapeBtn.disabled = false;
        loadJobs(); // final load
      } else if (polls > 120) {
        // Timeout after ~4 minutes
        clearInterval(scrapePoller);
        setStatus('done', '&#9888; Timeout — showing partial results');
        scrapeBtn.disabled = false;
        loadJobs();
      }
    } catch {
      clearInterval(scrapePoller);
      setStatus('error', '&#10060; Lost connection');
      scrapeBtn.disabled = false;
    }
  }, 2000);
}

// ── Load Cached Jobs ─────────────────────────────────────────────────────────

loadCachedBtn.addEventListener('click', loadJobs);
applyFiltersBtn.addEventListener('click', loadJobs);

async function loadJobs() {
  const params = new URLSearchParams({
    category:       filterCategory.value,
    relevanceLevel: filterRelevance.value,
    location:       filterLocation.value.trim()
  });

  try {
    const res  = await fetch(`${API}/api/jobs?${params}`);
    const data = await res.json();

    renderStats(data.stats);
    renderJobs(data.jobs || []);
  } catch (err) {
    console.error('Failed to load jobs:', err);
  }
}

// ── Render Stats ─────────────────────────────────────────────────────────────

function renderStats(stats) {
  if (!stats) return;
  statTotal.textContent  = stats.total  || 0;
  statHigh.textContent   = stats.high   || 0;
  statMedium.textContent = stats.medium || 0;
  statCombat.textContent = stats.combatSports || 0;
  statEvents.textContent = stats.events || 0;

  statsBar.classList.remove('hidden');
  filterBar.classList.remove('hidden');
}

// ── Render Job Cards ──────────────────────────────────────────────────────────

function renderJobs(jobs) {
  jobsSection.classList.remove('hidden');
  jobsGrid.innerHTML = '';

  if (!jobs.length) {
    noResults.classList.remove('hidden');
    resultsHeading.textContent = 'No Results';
    return;
  }

  noResults.classList.add('hidden');
  resultsHeading.textContent = `${jobs.length} Job${jobs.length !== 1 ? 's' : ''} Found`;

  for (const job of jobs) {
    jobsGrid.appendChild(buildJobCard(job));
  }
}

function buildJobCard(job) {
  const card = document.createElement('div');
  card.className = `job-card relevance-${job.relevanceLabel || 'low'}`;

  const cats = (job.categories || []).map(c =>
    `<span class="category-tag ${c}">${c.replace('-', ' ')}</span>`
  ).join('');

  const descPreview = job.description
    ? `<div class="job-desc-preview">${escHtml(job.description.substring(0, 200))}</div>`
    : '';

  const postedText = job.postedAt
    ? `Posted: ${formatDate(job.postedAt)}`
    : '';

  card.innerHTML = `
    <div class="job-header">
      <div class="job-title">${escHtml(job.title)}</div>
      <span class="relevance-badge ${job.relevanceLabel || 'low'}">${job.relevanceLabel || 'low'}</span>
    </div>
    <div class="job-company">${escHtml(job.company || 'Unknown Company')}</div>
    <div class="job-location">&#128205; ${escHtml(job.location || 'Location not specified')}</div>
    ${postedText ? `<div class="job-posted">&#128336; ${postedText}</div>` : ''}
    ${cats ? `<div class="job-categories">${cats}</div>` : ''}
    ${descPreview}
    <div class="job-score">Relevance Score: ${job.relevanceScore || 0}</div>
    <div class="job-actions">
      ${job.url ? `<a href="${escHtml(job.url)}" target="_blank" rel="noopener" class="btn btn-secondary btn-sm">View on LinkedIn &#8599;</a>` : ''}
      <button class="btn-resume" data-job-id="${escHtml(job.id)}">&#129354; Build Resume</button>
    </div>
  `;

  card.querySelector('.btn-resume').addEventListener('click', () => openResumeModal(job));
  return card;
}

// ── Resume Modal ─────────────────────────────────────────────────────────────

function openResumeModal(job) {
  modalJobInfo.innerHTML = `
    <strong>${escHtml(job.title)}</strong> at <strong>${escHtml(job.company || '?')}</strong>
    <br><span>&#128205; ${escHtml(job.location || 'N/A')}</span>
  `;

  resumeLoading.classList.remove('hidden');
  resumeResult.classList.add('hidden');
  resumeModal.classList.remove('hidden');

  buildResume(job);
}

async function buildResume(job) {
  try {
    const res  = await fetch(`${API}/api/resume/build`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId: job.id, job })
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Resume build failed');

    // Populate tabs
    matchAnalysis.textContent    = data.matchAnalysis || 'No analysis available.';
    tailoredResumeText.textContent = data.tailoredText || '';
    coverLetterText.textContent  = data.coverLetterOpening || 'No cover letter generated.';

    keywordsContainer.innerHTML = '';
    for (const kw of (data.keywordsMatched || [])) {
      const chip = document.createElement('span');
      chip.className = 'keyword-chip';
      chip.textContent = kw;
      keywordsContainer.appendChild(chip);
    }

    resumeLoading.classList.add('hidden');
    resumeResult.classList.remove('hidden');
    activateTab('analysis');

    // Store for download
    resumeResult.dataset.jobTitle = job.title;
    resumeResult.dataset.company  = job.company || 'unknown';

  } catch (err) {
    resumeLoading.innerHTML = `<p style="color:var(--magenta)">&#10060; ${escHtml(err.message)}</p>`;
  }
}

// ── Tab switching ────────────────────────────────────────────────────────────

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => activateTab(btn.dataset.tab));
});

function activateTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${name}`));
}

// ── Copy / Download ───────────────────────────────────────────────────────────

copyResumeBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(tailoredResumeText.textContent).then(() => {
    copyResumeBtn.textContent = '&#10003; Copied!';
    setTimeout(() => { copyResumeBtn.innerHTML = '&#128203; Copy'; }, 2000);
  });
});

downloadResumeBtn.addEventListener('click', () => {
  const title   = resumeResult.dataset.jobTitle || 'Resume';
  const company = resumeResult.dataset.company  || 'Job';
  const filename = `Resume_${title}_${company}.txt`
    .replace(/[^a-z0-9_\-. ]/gi, '_').replace(/\s+/g, '_');

  const blob = new Blob([tailoredResumeText.textContent], { type: 'text/plain' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
});

copyCoverBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(coverLetterText.textContent).then(() => {
    copyCoverBtn.textContent = '&#10003; Copied!';
    setTimeout(() => { copyCoverBtn.innerHTML = '&#128203; Copy'; }, 2000);
  });
});

// ── Modal close ───────────────────────────────────────────────────────────────

modalClose.addEventListener('click', closeModal);
modalBackdrop.addEventListener('click', closeModal);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

function closeModal() {
  resumeModal.classList.add('hidden');
  resumeLoading.classList.add('hidden');
  resumeResult.classList.add('hidden');
  resumeLoading.innerHTML = `
    <div class="spinner"></div>
    <p>GPT-4 is tailoring your resume...</p>
  `;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function setStatus(type, html) {
  scrapeStatus.className = `status-badge ${type}`;
  scrapeStatus.innerHTML = html;
  scrapeStatus.classList.remove('hidden');
}

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(dateStr) {
  try {
    const d = new Date(dateStr);
    if (isNaN(d)) return dateStr;
    const diff = Math.floor((Date.now() - d) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    if (diff < 7)  return `${diff} days ago`;
    if (diff < 30) return `${Math.floor(diff / 7)} week${diff >= 14 ? 's' : ''} ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}
