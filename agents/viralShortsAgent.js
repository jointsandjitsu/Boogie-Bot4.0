'use strict';

const fs   = require('fs');
const path = require('path');

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL        = 'claude-sonnet-4-6';
const REPO_ROOT    = path.join(__dirname, '..');
const PROJECTS_DIR = path.join(REPO_ROOT, 'video-projects');

// ── Lightweight Anthropic client (native fetch, no SDK) ──────────────────────

async function callAnthropic(params) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set.');
  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
      'content-type':      'application/json',
    },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── Tool definitions ──────────────────────────────────────────────────────────

const PRODUCTION_TOOLS = [
  {
    name: 'generate_hooks',
    description: 'Generate 3 viral hook options for the opening 3 seconds.',
    input_schema: {
      type: 'object',
      properties: {
        topic:    { type: 'string' },
        platform: { type: 'string', enum: ['TikTok', 'Instagram Reels', 'YouTube Shorts'] },
        duration: { type: 'number' },
      },
      required: ['topic', 'platform', 'duration'],
    },
  },
  {
    name: 'write_script',
    description: 'Write a complete, timed video script with dialogue and visual cues.',
    input_schema: {
      type: 'object',
      properties: {
        topic:       { type: 'string' },
        hook:        { type: 'string' },
        platform:    { type: 'string' },
        duration:    { type: 'number' },
        brand_voice: { type: 'string' },
      },
      required: ['topic', 'hook', 'platform', 'duration', 'brand_voice'],
    },
  },
  {
    name: 'plan_production',
    description: 'Shot-by-shot production guide: angles, B-roll, lighting, editing, platform tips.',
    input_schema: {
      type: 'object',
      properties: {
        script:   { type: 'string' },
        platform: { type: 'string' },
        duration: { type: 'number' },
      },
      required: ['script', 'platform', 'duration'],
    },
  },
  {
    name: 'generate_titles_and_hashtags',
    description: 'Platform-optimized titles, caption with CTA, hashtag strategy, best posting window.',
    input_schema: {
      type: 'object',
      properties: {
        topic:          { type: 'string' },
        platform:       { type: 'string' },
        script_summary: { type: 'string' },
      },
      required: ['topic', 'platform', 'script_summary'],
    },
  },
  {
    name: 'scaffold_composition',
    description:
      'Write a ready-to-render Hyperframes HTML composition to disk. ' +
      'Call this LAST after all other tools. ' +
      'Parse scene timings from the script (e.g. [0:03]) to build the scenes array.',
    input_schema: {
      type: 'object',
      properties: {
        slug:      { type: 'string', description: 'Kebab-case folder name, e.g. jj-bjj-2026' },
        hook_text: { type: 'string', description: 'Exact opening hook line' },
        scenes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type:    { type: 'string', enum: ['hook', 'body', 'cta'] },
              start_s: { type: 'number' },
              end_s:   { type: 'number' },
              text:    { type: 'string' },
            },
            required: ['type', 'start_s', 'end_s', 'text'],
          },
        },
        duration: { type: 'number' },
        platform: { type: 'string' },
      },
      required: ['slug', 'hook_text', 'scenes', 'duration', 'platform'],
    },
  },
];

// ── LLM-powered tool prompts ──────────────────────────────────────────────────

const TOOL_PROMPTS = {
  generate_hooks: ({ topic, platform, duration }) =>
    `Generate 3 highly viral hook options for a ${duration}-second ${platform} video about: "${topic}".

Joints & Jitsu is a BJJ and cannabis lifestyle brand. Each hook should:
- Fit in 1-2 punchy sentences (first 3 seconds)
- Create immediate curiosity, shock, or relatability
- Match the brand's fun, irreverent, authentic voice

Format exactly as:
HOOK 1: [hook text]
TYPE: [curiosity | shock | controversy | relatable | challenge]

HOOK 2: [hook text]
TYPE: [type]

HOOK 3: [hook text]
TYPE: [type]`,

  write_script: ({ topic, hook, platform, duration, brand_voice }) =>
    `Write a complete ${duration}-second ${platform} video script for Joints & Jitsu about: "${topic}".

Opening hook: "${hook}"
Brand voice: ${brand_voice}

Format:
[0:00] HOOK - ${hook}
(VISUAL: opening shot)

[0:03] BODY
[timestamp] Line of dialogue
(VISUAL: shot)

[0:${duration - 5}] CTA
(VISUAL: closing shot)

Keep punchy. Optimize for silent viewing with on-screen text cues.`,

  plan_production: ({ script, platform, duration }) =>
    `Create a detailed production guide for this ${duration}-second ${platform} video.

SCRIPT:
${script}

Provide:
## SHOT LIST
## VISUAL STYLE
## EDITING NOTES
## EQUIPMENT & PROPS
## ${platform.toUpperCase()} OPTIMISATION TIPS`,

  generate_titles_and_hashtags: ({ topic, platform, script_summary }) =>
    `Generate optimized titles and hashtags for a ${platform} video about "${topic}" for Joints & Jitsu.

Summary: ${script_summary}

Provide:
## TITLE OPTIONS (3 variations)
## CAPTION (with CTA)
## HASHTAGS (Primary 5, Niche 5, Brand 3)
## BEST POSTING WINDOW`,
};

async function executeLLMTool(name, input) {
  const response = await callAnthropic({
    model: MODEL,
    max_tokens: 1800,
    messages: [{ role: 'user', content: TOOL_PROMPTS[name](input) }],
  });
  return response.content[0].text;
}

// ── Composition HTML generator ────────────────────────────────────────────────

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function generateCompositionHTML({ slug, hook_text, scenes, duration, platform }) {
  const hookScene  = scenes.find(s => s.type === 'hook') || { start_s: 0, end_s: 3, text: hook_text };
  const bodyScenes = scenes.filter(s => s.type === 'body');
  const ctaScene   = scenes.find(s => s.type === 'cta')  || { start_s: duration - 5 };

  const bodyDivs = bodyScenes.map((sc, i) =>
    `  <!-- BODY ${i+1}: ${sc.start_s}s-${sc.end_s}s -->
  <div class="scene scene-body" id="scene-body-${i+1}">
    <div class="body-headline">${esc(sc.text)}</div>
  </div>`).join('\n');

  const bodyTimeline = bodyScenes.map((sc, i) => {
    const id  = `scene-body-${i+1}`;
    const txt = JSON.stringify(sc.text);
    return `
      tl.fromTo('#${id}', { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' }, ${sc.start_s})
        .call(cap, [${txt}], ${sc.start_s + 0.1})
        .to('#${id}', { opacity: 0, duration: 0.3 }, ${sc.end_s - 0.3});`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <!-- J&J Composition | ${slug} | ${platform} | ${duration}s
       Preview: npx hyperframes preview
       Render:  node pipeline/run.js --slug ${slug} -->
  <link rel="stylesheet" href="../../assets/brand-tokens.css" />
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{width:1080px;height:1920px;overflow:hidden;background:var(--jj-bg,#0a0a0f);
      font-family:var(--jj-font-body,'Courier New',monospace);position:relative}
    .bg-layer{position:absolute;inset:0;
      background:var(--jj-gradient-bg,radial-gradient(ellipse at 50% 20%,#0d1f1f 0%,#0a0a0f 65%));z-index:0}
    .bg-glow{position:absolute;inset:0;
      background:radial-gradient(ellipse at 50% 50%,rgba(0,255,204,.18) 0%,transparent 70%);z-index:1;opacity:0}
    .media-overlay{position:absolute;inset:0;background:rgba(0,0,0,.45);z-index:3;opacity:0}
    .scene{position:absolute;inset:0;z-index:40;display:flex;flex-direction:column;
      align-items:center;justify-content:center;padding:160px 64px 280px;opacity:0;pointer-events:none}
    .scene-hook .headline{font-family:var(--jj-font-display,Impact,'Arial Black',sans-serif);
      font-size:108px;font-weight:900;line-height:1.05;text-align:center;text-transform:uppercase;
      color:var(--jj-accent,#00ffcc);text-shadow:0 0 40px rgba(0,255,204,.55)}
    .scene-body .body-headline{font-family:var(--jj-font-display,Impact,'Arial Black',sans-serif);
      font-size:80px;font-weight:900;text-transform:uppercase;text-align:center;line-height:1.1;
      color:var(--jj-text,#e0e0f0)}
    .scene-cta{background:rgba(0,0,0,.55)}
    .scene-cta .cta-headline{font-family:var(--jj-font-display,Impact,'Arial Black',sans-serif);
      font-size:96px;font-weight:900;text-transform:uppercase;text-align:center;line-height:1.05;
      color:var(--jj-accent2,#ff6b35);text-shadow:0 0 40px rgba(255,107,53,.55);margin-bottom:48px}
    .scene-cta .handle{font-family:var(--jj-font-display,Impact,'Arial Black',sans-serif);
      font-size:52px;font-weight:900;letter-spacing:2px;color:var(--jj-accent,#00ffcc);
      text-shadow:0 0 40px rgba(0,255,204,.55);text-align:center}
    .scene-cta .cta-sub{font-size:40px;color:var(--jj-muted,#6b6b8a);text-align:center;margin-top:24px}
    .accent-line{position:absolute;left:0;right:0;height:3px;z-index:50;opacity:0;
      background:linear-gradient(90deg,transparent 0%,var(--jj-accent,#00ffcc) 20%,var(--jj-accent,#00ffcc) 80%,transparent 100%)}
    .accent-line.top{top:155px}.accent-line.bottom{bottom:270px}
    .captions{position:absolute;bottom:280px;left:64px;right:64px;padding:18px 28px;
      background:rgba(0,0,0,.60);border-radius:14px;border:1px solid rgba(0,255,204,.15);
      font-size:52px;font-weight:700;color:#fff;text-align:center;
      text-shadow:0 2px 12px rgba(0,0,0,.85);line-height:1.25;z-index:60;opacity:0;min-height:100px}
    .brand-badge{position:absolute;top:80px;left:64px;right:64px;
      display:flex;align-items:center;justify-content:center;gap:18px;z-index:70;opacity:0}
    .brand-badge .brand-name{font-family:var(--jj-font-display,Impact,'Arial Black',sans-serif);
      font-size:38px;font-weight:900;letter-spacing:4px;color:var(--jj-accent,#00ffcc);
      text-shadow:0 0 40px rgba(0,255,204,.55)}
    .brand-badge .brand-dot{width:10px;height:10px;border-radius:50%;background:var(--jj-accent2,#ff6b35);flex-shrink:0}
  </style>
</head>
<body>
  <div class="bg-layer"></div>
  <div class="bg-glow" id="bg-glow"></div>
  <div class="media-overlay" id="media-overlay"></div>

  <div class="scene scene-hook" id="scene-hook">
    <div class="headline">${esc(hook_text)}</div>
  </div>

${bodyDivs}

  <div class="scene scene-cta" id="scene-cta">
    <div class="cta-headline">FOLLOW<br/>FOR MORE</div>
    <div class="handle">@jointsandjitsu</div>
    <div class="cta-sub">Roll hard. Smoke smart.</div>
  </div>

  <div class="accent-line top"    id="accent-top"></div>
  <div class="accent-line bottom" id="accent-bottom"></div>
  <div class="captions"           id="captions"></div>
  <div class="brand-badge" id="brand-badge">
    <span class="brand-dot"></span>
    <span class="brand-name">JOINTS &amp; JITSU</span>
    <span class="brand-dot"></span>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
  <script>
    ;(function () {
      const captEl = document.getElementById('captions');
      function cap(text) { captEl.textContent = text; }
      const tl = gsap.timeline({ paused: true });

      tl.to('#accent-top, #accent-bottom', { opacity: 1, duration: 0.3 }, 0)
        .to('#brand-badge', { opacity: 1, y: 0, duration: 0.4 }, 0.05)
        .to('#bg-glow',     { opacity: 0.35, duration: 0.6 },   0);

      tl.fromTo('#scene-hook', { opacity: 0, scale: 0.95 },
          { opacity: 1, scale: 1, duration: 0.4, ease: 'power2.out' }, 0)
        .call(cap, [${JSON.stringify(hookScene.text || hook_text)}], 0.15)
        .to('#captions', { opacity: 1, duration: 0.2 }, 0.15)
        .to('#scene-hook', { opacity: 0, duration: 0.3 }, ${hookScene.end_s - 0.3});
${bodyTimeline}
      tl.to('#captions',  { opacity: 0, duration: 0.25 }, ${ctaScene.start_s - 0.25})
        .fromTo('#scene-cta', { opacity: 0, y: 40 },
            { opacity: 1, y: 0, duration: 0.5, ease: 'back.out(1.4)' }, ${ctaScene.start_s});

      tl.set({}, {}, ${duration});
      window.__timelines = window.__timelines || [];
      window.__timelines.push(tl);
    })();
  </script>
</body>
</html>`;
}

// ── scaffold_composition: write project files to disk ────────────────────────

function scaffoldComposition({ slug, hook_text, scenes, duration, platform }) {
  const projectDir = path.join(PROJECTS_DIR, slug);
  fs.mkdirSync(path.join(projectDir, 'compositions'), { recursive: true });
  fs.mkdirSync(path.join(projectDir, 'renders'),      { recursive: true });

  fs.writeFileSync(path.join(projectDir, 'meta.json'), JSON.stringify(
    { id: slug, name: `J&J — ${slug}`, width: 1080, height: 1920, fps: 30, duration }, null, 2));

  fs.writeFileSync(path.join(projectDir, 'hyperframes.json'), JSON.stringify(
    { entry: 'index.html', output: 'renders/', fps: 30, width: 1080, height: 1920, duration,
      compositions: 'compositions/' }, null, 2));

  fs.writeFileSync(path.join(projectDir, 'index.html'),
    generateCompositionHTML({ slug, hook_text, scenes, duration, platform }));

  const storyboard = [
    `# Storyboard — ${slug}`,
    `**Platform:** ${platform} | **Duration:** ${duration}s`, '',
    '| # | Type | Start | End | Text |',
    '|---|------|-------|-----|------|',
    ...scenes.map((sc, i) =>
      `| ${i+1} | ${sc.type.toUpperCase()} | ${sc.start_s}s | ${sc.end_s}s | ${sc.text} |`),
    '', '## Render', '```', `node pipeline/run.js --slug ${slug}`, '```',
  ].join('\n');
  fs.writeFileSync(path.join(projectDir, 'STORYBOARD.md'), storyboard);

  return {
    message: `Scaffolded at video-projects/${slug}/`,
    projectDir,
    relPath: `video-projects/${slug}`,
    slug,
  };
}

// ── Tool dispatch ─────────────────────────────────────────────────────────────

async function executeTool(name, input) {
  if (name === 'scaffold_composition') {
    const result = scaffoldComposition(input);
    return result.message + ' — files: meta.json, hyperframes.json, index.html, STORYBOARD.md';
  }
  return executeLLMTool(name, input);
}

// ── Orchestrator agentic loop ─────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the Viral Shorts Production Agent for Joints & Jitsu (BJJ + cannabis lifestyle brand).
Build a complete short-form video production package using these tools in order:
1. generate_hooks
2. write_script
3. plan_production
4. generate_titles_and_hashtags
5. scaffold_composition  (parse script timestamps to build the scenes array; derive slug from topic + year)

Call every tool. After all five, write a 3-5 sentence creative director's note.
Brand voice: fun, irreverent, authentic, high-energy.`.trim();

async function runViralShortsAgent({ topic, platform, duration, brandFocus }) {
  const msg =
    `Build a viral shorts package:\nTopic: ${topic}\nPlatform: ${platform}\n` +
    `Duration: ${duration}s\nBrand focus: ${brandFocus || 'General J&J lifestyle'}\n\nCall all five tools.`;

  let messages = [{ role: 'user', content: msg }];
  const pkg = {
    topic, platform, duration, brandFocus,
    hooks: null, script: null, productionPlan: null,
    titlesAndHashtags: null, compositionPath: null,
    directorNote: null, steps: [],
  };

  while (true) {
    const response = await callAnthropic({
      model: MODEL, max_tokens: 4096,
      system: SYSTEM_PROMPT, tools: PRODUCTION_TOOLS, messages,
    });

    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason === 'end_turn') {
      const text = response.content.find(b => b.type === 'text');
      pkg.directorNote = text?.text ?? null;
      break;
    }

    if (response.stop_reason === 'tool_use') {
      const toolResults = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        console.log(`[Agent] → ${block.name}`);

        const result = await executeTool(block.name, block.input);

        const store = {
          generate_hooks: 'hooks', write_script: 'script',
          plan_production: 'productionPlan',
          generate_titles_and_hashtags: 'titlesAndHashtags',
        };
        if (store[block.name]) pkg[store[block.name]] = result;
        if (block.name === 'scaffold_composition') {
          const sc = scaffoldComposition(block.input);
          pkg.compositionPath = sc.relPath;
        }

        pkg.steps.push({ tool: block.name, input: block.input });
        toolResults.push({
          type: 'tool_result', tool_use_id: block.id,
          content: typeof result === 'string' ? result : JSON.stringify(result),
        });
      }
      messages.push({ role: 'user', content: toolResults });
    } else {
      break;
    }
  }

  return pkg;
}

module.exports = { runViralShortsAgent, scaffoldComposition, generateCompositionHTML: null };
