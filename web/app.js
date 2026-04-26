/* Token Dashboard — frontend (vanilla JS, no build step) */

'use strict';

// ── Format helpers ──────────────────────────────────────────────────────────

function fmtK(n) {
  n = n || 0;
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(n);
}

function fmtCost(usd) {
  if (usd == null) return '—';
  if (usd >= 1) return '$' + usd.toFixed(2);
  if (usd >= 0.01) return '$' + usd.toFixed(4);
  return '$' + usd.toFixed(6);
}

function fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }); }
  catch { return iso.slice(0, 16).replace('T', ' '); }
}

function fmtDay(dayStr) {
  if (!dayStr) return '';
  const [, m, d] = dayStr.split('-');
  return `${m}/${d}`;
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function truncate(s, n = 120) {
  s = (s || '').replace(/\n/g, ' ').trim();
  return s.length > n ? s.slice(0, n) + '…' : s;
}

// ── Colour palette for models / projects ────────────────────────────────────

const PALETTE = ['#58a6ff', '#3fb950', '#d29922', '#f85149', '#bc8cff', '#39d353', '#ff7b72', '#79c0ff'];
function colorFor(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xffffffff;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

// ── SVG chart primitives ─────────────────────────────────────────────────────

function svgLineChart(data, opts = {}) {
  // data: [{label, value, value2?}]
  if (!data.length) return '<p class="empty">No data yet.</p>';

  const W = 600, H = opts.height || 130;
  const PAD = { top: 10, right: 10, bottom: 28, left: 54 };
  const iW = W - PAD.left - PAD.right;
  const iH = H - PAD.top - PAD.bottom;

  const vals1 = data.map(d => d.value || 0);
  const vals2 = opts.dual ? data.map(d => d.value2 || 0) : [];
  const maxV  = Math.max(...vals1, ...vals2, 1);

  const scX = i => PAD.left + (data.length > 1 ? i / (data.length - 1) : 0.5) * iW;
  const scY = v => PAD.top + iH - (v / maxV) * iH;

  const pts1 = data.map((d, i) => `${scX(i).toFixed(1)},${scY(d.value || 0).toFixed(1)}`).join(' ');
  const areaBottom = `${scX(data.length - 1).toFixed(1)},${(PAD.top + iH).toFixed(1)} ${scX(0).toFixed(1)},${(PAD.top + iH).toFixed(1)}`;

  // X-axis label step
  const step = Math.max(1, Math.ceil(data.length / 7));
  const xLabels = data
    .map((d, i) => ({ d, i }))
    .filter(({ i }) => i % step === 0 || i === data.length - 1)
    .map(({ d, i }) =>
      `<text x="${scX(i).toFixed(1)}" y="${H - 4}" text-anchor="middle" font-size="10" fill="#7d8590">${esc(fmtDay(d.label))}</text>`
    ).join('');

  // Y-axis ticks
  const yTicks = [0, 0.5, 1].map(t => {
    const y = scY(t * maxV);
    return `<text x="${(PAD.left - 6).toFixed(1)}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="10" fill="#7d8590">${fmtK(t * maxV)}</text>
      <line x1="${PAD.left}" y1="${y.toFixed(1)}" x2="${(PAD.left + iW).toFixed(1)}" y2="${y.toFixed(1)}" stroke="#30363d" stroke-width="1"/>`;
  }).join('');

  const color1 = opts.color || '#58a6ff';
  const color2 = opts.color2 || '#3fb950';

  let dualSvg = '';
  if (opts.dual && vals2.length) {
    const pts2 = data.map((d, i) => `${scX(i).toFixed(1)},${scY(d.value2 || 0).toFixed(1)}`).join(' ');
    dualSvg = `<polyline points="${pts2}" fill="none" stroke="${color2}" stroke-width="1.5" stroke-dasharray="4,3" stroke-linejoin="round" opacity="0.8"/>`;
  }

  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" style="overflow:visible">
    <defs>
      <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${color1}" stop-opacity="0.25"/>
        <stop offset="100%" stop-color="${color1}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    ${yTicks}
    <polygon points="${pts1} ${areaBottom}" fill="url(#g1)"/>
    <polyline points="${pts1}" fill="none" stroke="${color1}" stroke-width="2" stroke-linejoin="round"/>
    ${dualSvg}
    ${xLabels}
  </svg>`;
}

function svgBarChart(data, opts = {}) {
  // data: [{label, value}]
  if (!data.length) return '<p class="empty">No data yet.</p>';

  const maxVal = Math.max(...data.map(d => d.value), 1);
  const rows = data.map(d => {
    const pct = (d.value / maxVal * 100).toFixed(1);
    const color = d.color || opts.color || colorFor(d.label);
    return `<div class="bar-row">
      <span class="bar-label" title="${esc(d.label)}">${esc(truncate(d.label, 22))}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${pct}%;background:${color}"></span></span>
      <span class="bar-count">${opts.fmtVal ? opts.fmtVal(d.value) : fmtK(d.value)}</span>
    </div>`;
  }).join('');
  return `<div>${rows}</div>`;
}

function svgDonut(data, opts = {}) {
  // data: [{label, value}]
  if (!data.length) return '<p class="empty">No data.</p>';

  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const R = 60, CX = 70, CY = 70, SW = 22;

  let startAngle = -Math.PI / 2;
  const slices = data.map((d, i) => {
    const frac = d.value / total;
    const angle = frac * 2 * Math.PI;
    const x1 = CX + R * Math.cos(startAngle);
    const y1 = CY + R * Math.sin(startAngle);
    const endA = startAngle + angle;
    const x2 = CX + R * Math.cos(endA);
    const y2 = CY + R * Math.sin(endA);
    const large = angle > Math.PI ? 1 : 0;
    const color = d.color || PALETTE[i % PALETTE.length];
    const path = `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${R} ${R} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
    startAngle = endA;
    return `<path d="${path}" fill="none" stroke="${color}" stroke-width="${SW}"/>`;
  }).join('');

  const legend = data.slice(0, 6).map((d, i) => {
    const color = d.color || PALETTE[i % PALETTE.length];
    const pct = (d.value / total * 100).toFixed(1);
    return `<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;font-size:12px">
      <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0"></span>
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted)" title="${esc(d.label)}">${esc(truncate(d.label, 20))}</span>
      <span style="margin-left:auto;color:var(--text);white-space:nowrap">${pct}%</span>
    </div>`;
  }).join('');

  return `<div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap">
    <svg width="140" height="140" style="flex-shrink:0">${slices}</svg>
    <div style="flex:1;min-width:120px">${legend}</div>
  </div>`;
}

// ── API fetcher ──────────────────────────────────────────────────────────────

async function api(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── Router ───────────────────────────────────────────────────────────────────

const tabs = ['overview', 'prompts', 'sessions', 'projects', 'skills', 'tips', 'settings'];
let _currentTab = null;

function showTab(name) {
  if (!tabs.includes(name)) name = 'overview';
  if (_currentTab === name) return;
  _currentTab = name;

  document.querySelectorAll('.tab-link').forEach(el => {
    el.classList.toggle('active', el.dataset.tab === name);
  });
  document.querySelectorAll('.section').forEach(el => {
    el.classList.toggle('active', el.id === `sec-${name}`);
  });

  TAB_INITS[name]?.();
}

function navigate(name) {
  location.hash = name;
}

window.addEventListener('hashchange', () => {
  showTab(location.hash.slice(1) || 'overview');
});

// ── Tab: Overview ────────────────────────────────────────────────────────────

let _overviewLoaded = false;

async function initOverview() {
  if (_overviewLoaded) return;
  _overviewLoaded = true;

  const sec = document.getElementById('sec-overview');
  sec.querySelector('#ov-loading').textContent = 'Loading…';

  let data;
  try {
    data = await api('/api/overview');
  } catch (e) {
    sec.querySelector('#ov-loading').textContent = 'Error loading data — is the server running?';
    return;
  }
  sec.querySelector('#ov-loading').textContent = '';

  const t = data.totals || {};
  const totalTok = (t.input_tokens || 0) + (t.output_tokens || 0);

  // Stat cards
  const statMap = {
    'ov-input':       { val: fmtK(t.input_tokens),       sub: 'input tokens' },
    'ov-output':      { val: fmtK(t.output_tokens),      sub: 'output tokens' },
    'ov-cache-read':  { val: fmtK(t.cache_read_tokens),  sub: 'cache-read tokens' },
    'ov-cache-write': { val: fmtK(t.cache_write_tokens), sub: 'cache-write tokens' },
    'ov-sessions':    { val: fmtK(t.sessions),            sub: 'sessions' },
    'ov-turns':       { val: fmtK(t.turns),               sub: 'turns' },
    'ov-cost':        { val: fmtCost(data.total_cost_usd), sub: `est. cost (${data.plan})` },
  };
  for (const [id, { val, sub }] of Object.entries(statMap)) {
    const el = document.getElementById(id);
    if (el) { el.querySelector('.stat-value').textContent = val; el.querySelector('.stat-sub').textContent = sub; }
  }

  // Daily chart
  const daily = data.daily || [];
  document.getElementById('ov-daily-chart').innerHTML = svgLineChart(
    daily.map(d => ({ label: d.day, value: d.work_tokens, value2: d.cache_tokens })),
    { dual: true, color: '#58a6ff', color2: '#3fb950', height: 140 }
  );

  // Cache hit rate
  const totalEligible = (t.input_tokens || 0) + (t.cache_read_tokens || 0);
  const hitRate = totalEligible > 0 ? ((t.cache_read_tokens || 0) / totalEligible * 100).toFixed(1) : 0;
  const el = document.getElementById('ov-cache-rate');
  if (el) el.textContent = `Cache hit rate: ${hitRate}%`;

  // Projects bar
  document.getElementById('ov-projects-chart').innerHTML = svgBarChart(
    (data.projects || []).map(p => ({ label: p.project, value: p.tokens }))
  );

  // Model donut
  document.getElementById('ov-models-chart').innerHTML = svgDonut(
    (data.models || []).map(m => ({ label: m.primary_model || 'unknown', value: m.tokens }))
  );

  // Top tools
  const tools = data.top_tools || [];
  const maxCalls = Math.max(...tools.map(t => t.calls), 1);
  document.getElementById('ov-tools-chart').innerHTML = svgBarChart(
    tools.map(t => ({ label: t.tool_name, value: t.calls, color: '#bc8cff' })),
    { fmtVal: n => n + 'x' }
  );

  // Recent sessions
  const tbody = document.getElementById('ov-sessions-body');
  tbody.innerHTML = (data.recent_sessions || []).map(s => `
    <tr>
      <td><a href="#" onclick="openSession('${esc(s.session_id)}');return false">${esc(s.session_id.slice(0, 8))}…</a></td>
      <td>${esc(s.project)}</td>
      <td class="muted">${fmtDate(s.start_time)}</td>
      <td class="num">${s.turn_count}</td>
      <td class="num">${fmtK(s.tokens)}</td>
      <td class="muted">${esc((s.primary_model || '').split('-').slice(1, 3).join('-'))}</td>
    </tr>
  `).join('');
}

// ── Tab: Prompts ─────────────────────────────────────────────────────────────

let _promptsLoaded = false;

async function initPrompts() {
  if (_promptsLoaded) return;
  _promptsLoaded = true;

  document.getElementById('prompts-loading').textContent = 'Loading…';
  let data;
  try { data = await api('/api/prompts'); }
  catch { document.getElementById('prompts-loading').textContent = 'Error loading.'; return; }
  document.getElementById('prompts-loading').textContent = '';

  const tbody = document.getElementById('prompts-body');
  tbody.innerHTML = (data.prompts || []).map(p => {
    const tools = (() => { try { return JSON.parse(p.tool_names || '[]'); } catch { return []; } })();
    const total = (p.input_tokens || 0) + (p.output_tokens || 0);
    return `<tr>
      <td class="truncate" title="${esc(p.user_text)}">${esc(truncate(p.user_text || '', 100))}</td>
      <td>${esc(p.project)}</td>
      <td class="num">${fmtK(total)}</td>
      <td class="num">${fmtK(p.input_tokens)}</td>
      <td class="num">${fmtK(p.output_tokens)}</td>
      <td class="num">${fmtK(p.cache_read_tokens)}</td>
      <td>${tools.slice(0, 4).map(t => `<span class="tool-badge">${esc(t)}</span>`).join(' ')}</td>
      <td class="muted" style="white-space:nowrap">${fmtDate(p.timestamp)}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="8" class="empty">No prompts yet.</td></tr>';
}

// ── Tab: Sessions ─────────────────────────────────────────────────────────────

let _sessionsLoaded = false;

async function initSessions() {
  if (_sessionsLoaded) return;
  _sessionsLoaded = true;

  document.getElementById('sessions-loading').textContent = 'Loading…';
  let data;
  try { data = await api('/api/sessions'); }
  catch { document.getElementById('sessions-loading').textContent = 'Error loading.'; return; }
  document.getElementById('sessions-loading').textContent = '';

  const tbody = document.getElementById('sessions-body');
  tbody.innerHTML = (data.sessions || []).map(s => `
    <tr>
      <td><a href="#" onclick="openSession('${esc(s.session_id)}');return false">${esc(s.session_id.slice(0, 12))}…</a></td>
      <td>${esc(s.project)}</td>
      <td class="muted">${fmtDate(s.start_time)}</td>
      <td class="num">${s.turn_count}</td>
      <td class="num">${fmtK((s.input_tokens || 0) + (s.output_tokens || 0))}</td>
      <td class="num">${fmtK(s.cache_read_tokens)}</td>
      <td class="muted">${esc((s.primary_model || '').split('-').slice(1, 3).join('-'))}</td>
    </tr>
  `).join('') || '<tr><td colspan="7" class="empty">No sessions found.</td></tr>';
}

// ── Session detail ────────────────────────────────────────────────────────────

function openSession(sessionId) {
  navigate(`session:${sessionId}`);
}

async function showSessionDetail(sessionId) {
  document.querySelectorAll('.section').forEach(el => el.classList.remove('active'));
  const detail = document.getElementById('sec-session-detail');
  detail.classList.add('active');
  detail.innerHTML = '<p class="loading">Loading session…</p>';

  let data;
  try { data = await api(`/api/sessions/${sessionId}`); }
  catch { detail.innerHTML = '<p class="empty">Session not found.</p>'; return; }

  const s = data.session;
  const turns = data.turns || [];
  const toolCalls = data.tool_calls || [];

  // Build tool lookup
  const toolsByTurn = {};
  for (const tc of toolCalls) {
    if (!toolsByTurn[tc.turn_id]) toolsByTurn[tc.turn_id] = [];
    toolsByTurn[tc.turn_id].push(tc);
  }

  const totalTok = (s.input_tokens || 0) + (s.output_tokens || 0);

  const turnHtml = turns.map(t => {
    const tools = (() => { try { return JSON.parse(t.tool_names || '[]'); } catch { return []; } })();
    const tokText = `${fmtK((t.input_tokens || 0) + (t.output_tokens || 0))} tok`;
    const cacheText = t.cache_read_tokens ? ` · ${fmtK(t.cache_read_tokens)} cached` : '';
    return `<div class="turn-card">
      <div class="turn-header">
        <span class="turn-role">Turn ${t.turn_index + 1}</span>
        <span class="turn-tokens">${tokText}${cacheText}</span>
      </div>
      <div class="turn-text">${esc(truncate(t.user_text || '', 500))}</div>
      ${tools.length ? `<div class="turn-tools">${tools.map(n => `<span class="tool-badge">${esc(n)}</span>`).join('')}</div>` : ''}
    </div>`;
  }).join('');

  detail.innerHTML = `
    <a class="back-link" href="#sessions">← Back to Sessions</a>
    <div class="card" style="margin-bottom:16px">
      <h2>Session ${s.session_id.slice(0, 12)}… — ${esc(s.project)}</h2>
      <p style="color:var(--muted);font-size:12px;margin-top:4px">
        ${fmtDate(s.start_time)} · ${s.turn_count} turns · ${fmtK(totalTok)} tokens
        ${s.primary_model ? ` · ${esc(s.primary_model)}` : ''}
      </p>
    </div>
    <div>${turnHtml || '<p class="empty">No turns recorded.</p>'}</div>
  `;
}

// ── Tab: Projects ─────────────────────────────────────────────────────────────

let _projectsLoaded = false;

async function initProjects() {
  if (_projectsLoaded) return;
  _projectsLoaded = true;

  document.getElementById('projects-loading').textContent = 'Loading…';
  let data;
  try { data = await api('/api/projects'); }
  catch { document.getElementById('projects-loading').textContent = 'Error loading.'; return; }
  document.getElementById('projects-loading').textContent = '';

  const tbody = document.getElementById('projects-body');
  tbody.innerHTML = (data.projects || []).map(p => `
    <tr>
      <td>${esc(p.project)}</td>
      <td class="num">${p.sessions}</td>
      <td class="num">${p.turns}</td>
      <td class="num">${fmtK(p.input_tokens)}</td>
      <td class="num">${fmtK(p.output_tokens)}</td>
      <td class="num">${fmtK(p.cache_read_tokens)}</td>
      <td class="muted">${fmtDate(p.last_active)}</td>
    </tr>
  `).join('') || '<tr><td colspan="7" class="empty">No projects found.</td></tr>';
}

// ── Tab: Skills ───────────────────────────────────────────────────────────────

let _skillsLoaded = false;

async function initSkills() {
  if (_skillsLoaded) return;
  _skillsLoaded = true;

  document.getElementById('skills-loading').textContent = 'Loading…';
  let data;
  try { data = await api('/api/skills'); }
  catch { document.getElementById('skills-loading').textContent = 'Error loading.'; return; }
  document.getElementById('skills-loading').textContent = '';

  document.getElementById('skills-chart').innerHTML = svgBarChart(
    (data.skills || []).map(s => ({ label: s.skill, value: s.invocations, color: '#bc8cff' })),
    { fmtVal: n => n + 'x' }
  );

  const tbody = document.getElementById('skills-body');
  tbody.innerHTML = (data.skills || []).map(s => `
    <tr>
      <td style="color:var(--purple)">${esc(s.skill)}</td>
      <td class="num">${s.invocations}</td>
      <td class="num">${fmtK(s.total_tokens)}</td>
    </tr>
  `).join('') || '<tr><td colspan="3" class="empty">No skills detected.</td></tr>';
}

// ── Tab: Tips ─────────────────────────────────────────────────────────────────

let _tipsLoaded = false;

async function initTips() {
  if (_tipsLoaded) return;
  _tipsLoaded = true;

  document.getElementById('tips-loading').textContent = 'Loading…';
  let data;
  try { data = await api('/api/tips'); }
  catch { document.getElementById('tips-loading').textContent = 'Error loading.'; return; }
  document.getElementById('tips-loading').textContent = '';

  const container = document.getElementById('tips-container');
  if (!data.tips || !data.tips.length) {
    container.innerHTML = '<p class="empty">No tips — your usage looks clean!</p>';
    return;
  }

  const icons = { warning: '⚠️', info: 'ℹ️' };
  container.innerHTML = data.tips.map(tip => `
    <div class="tip" data-severity="${esc(tip.severity)}">
      <div class="tip-header">
        <span class="tip-icon">${icons[tip.severity] || '•'}</span>
        <span class="tip-title">${esc(tip.title)}</span>
      </div>
      <div class="tip-detail">${esc(tip.detail)}</div>
    </div>
  `).join('');
}

// ── Tab: Settings ─────────────────────────────────────────────────────────────

let _settingsLoaded = false;

async function initSettings() {
  if (_settingsLoaded) return;
  _settingsLoaded = true;

  let data;
  try { data = await api('/api/settings'); }
  catch { document.getElementById('settings-status').textContent = 'Error loading settings.'; return; }

  const sel = document.getElementById('plan-select');
  sel.innerHTML = Object.entries(data.plans || {}).map(([k, v]) =>
    `<option value="${esc(k)}" ${k === data.plan ? 'selected' : ''}>${esc(v.name)}</option>`
  ).join('');

  document.getElementById('settings-desc').textContent =
    (data.plans[data.plan] || {}).description || '';
}

async function savePlan() {
  const plan = document.getElementById('plan-select').value;
  try {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan }),
    });
    document.getElementById('settings-status').textContent = '✓ Saved — reload to see updated costs.';
    // Bust caches so Overview reloads
    _overviewLoaded = false;
  } catch {
    document.getElementById('settings-status').textContent = 'Save failed.';
  }
}

// ── Tab init map ─────────────────────────────────────────────────────────────

const TAB_INITS = {
  overview: initOverview,
  prompts:  initPrompts,
  sessions: initSessions,
  projects: initProjects,
  skills:   initSkills,
  tips:     initTips,
  settings: initSettings,
};

// ── Live refresh via SSE ──────────────────────────────────────────────────────

function connectSSE() {
  const es = new EventSource('/api/events');
  es.onmessage = () => {
    // Mark all tabs stale so they reload on next visit
    _overviewLoaded = _promptsLoaded = _sessionsLoaded = _projectsLoaded = _skillsLoaded = _tipsLoaded = false;
    // Refresh current tab
    TAB_INITS[_currentTab]?.();
  };
  es.onerror = () => {
    es.close();
    setTimeout(connectSSE, 10_000);
  };
}

// ── Boot ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Tab click handlers
  document.querySelectorAll('.tab-link').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      navigate(el.dataset.tab);
    });
  });

  // Hash-based routing
  const hash = location.hash.slice(1) || 'overview';
  if (hash.startsWith('session:')) {
    showSessionDetail(hash.slice(8));
  } else {
    showTab(hash);
  }

  connectSSE();
});

// Handle session detail routing
window.addEventListener('hashchange', () => {
  const hash = location.hash.slice(1) || 'overview';
  if (hash.startsWith('session:')) {
    showSessionDetail(hash.slice(8));
  } else {
    showTab(hash);
  }
});
