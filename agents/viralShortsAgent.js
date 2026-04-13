/**
 * Viral Shorts Video Production Agent
 *
 * A multi-step AI agent that produces complete short-form video packages
 * for Joints & Jitsu. Uses Claude's tool_use to orchestrate four production
 * phases: hooks → script → production plan → titles & hashtags.
 */

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';

// --- Lightweight Anthropic API client (uses native fetch, no SDK required) ---

async function callAnthropic(params) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY environment variable is not set.');

  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${err}`);
  }

  return response.json();
}

// --- Tool definitions ---

const PRODUCTION_TOOLS = [
  {
    name: 'generate_hooks',
    description:
      'Generate 3 viral hook options for the opening 3 seconds of the video. ' +
      'Hooks must stop scrolling instantly through curiosity, relatability, or shock.',
    input_schema: {
      type: 'object',
      properties: {
        topic:    { type: 'string', description: 'The video topic or product being featured' },
        platform: { type: 'string', enum: ['TikTok', 'Instagram Reels', 'YouTube Shorts'] },
        duration: { type: 'number', description: 'Target video length in seconds' },
      },
      required: ['topic', 'platform', 'duration'],
    },
  },
  {
    name: 'write_script',
    description:
      'Write a complete, timed video script with dialogue, on-screen text cues, ' +
      'and visual action notes based on the chosen hook.',
    input_schema: {
      type: 'object',
      properties: {
        topic:       { type: 'string' },
        hook:        { type: 'string', description: 'The chosen opening hook line' },
        platform:    { type: 'string' },
        duration:    { type: 'number' },
        brand_voice: { type: 'string', description: 'Brand tone and style guidance' },
      },
      required: ['topic', 'hook', 'platform', 'duration', 'brand_voice'],
    },
  },
  {
    name: 'plan_production',
    description:
      'Create a shot-by-shot production guide: camera angles, B-roll suggestions, ' +
      'lighting notes, editing rhythm, and platform-specific optimization tips.',
    input_schema: {
      type: 'object',
      properties: {
        script:   { type: 'string', description: 'The full video script' },
        platform: { type: 'string' },
        duration: { type: 'number' },
      },
      required: ['script', 'platform', 'duration'],
    },
  },
  {
    name: 'generate_titles_and_hashtags',
    description:
      'Produce platform-optimized titles, a caption with CTA, hashtag strategy ' +
      '(primary, niche, brand), and the best posting window.',
    input_schema: {
      type: 'object',
      properties: {
        topic:          { type: 'string' },
        platform:       { type: 'string' },
        script_summary: { type: 'string', description: 'One-sentence summary of what the video covers' },
      },
      required: ['topic', 'platform', 'script_summary'],
    },
  },
];

// --- Tool executors (each calls Claude as a specialist for that task) ---

const TOOL_PROMPTS = {
  generate_hooks: ({ topic, platform, duration }) => `
Generate 3 highly viral hook options for a ${duration}-second ${platform} video about: "${topic}".

Joints & Jitsu is a BJJ and cannabis lifestyle brand. Each hook should:
- Fit in 1–2 punchy sentences (delivered in the first 3 seconds)
- Create immediate curiosity, shock, or relatability
- Match the brand's fun, irreverent, authentic voice

Format exactly as:
HOOK 1: [hook text]
TYPE: [curiosity | shock | controversy | relatable | challenge]

HOOK 2: [hook text]
TYPE: [type]

HOOK 3: [hook text]
TYPE: [type]
`.trim(),

  write_script: ({ topic, hook, platform, duration, brand_voice }) => `
Write a complete ${duration}-second ${platform} video script for Joints & Jitsu about: "${topic}".

Opening hook: "${hook}"
Brand voice: ${brand_voice}

Script format:
[0:00] HOOK — ${hook}
(VISUAL: describe the opening shot)

[0:03] BODY
[timestamp] Line of dialogue or narration
(VISUAL: shot description)
(TEXT OVERLAY: optional on-screen text)

[0:${duration - 5}] CTA
(VISUAL: closing shot)

Keep it punchy. Optimise for silent viewing with clear on-screen text cues.
Total spoken words should fit comfortably in ${duration} seconds.
`.trim(),

  plan_production: ({ script, platform, duration }) => `
Create a detailed production guide for this ${duration}-second ${platform} video.

SCRIPT:
${script}

Provide the following sections:

## SHOT LIST
Number every shot. Include: angle, subject, movement, duration.

## VISUAL STYLE
Lighting setup, colour palette, aesthetic direction.

## EDITING NOTES
Cut timing, transitions, music energy level, text overlay timing.

## EQUIPMENT & PROPS
Minimum gear needed, any props or locations required.

## ${platform.toUpperCase()} OPTIMISATION TIPS
Three specific tips for maximum reach on ${platform}.
`.trim(),

  generate_titles_and_hashtags: ({ topic, platform, script_summary }) => `
Generate optimised titles and hashtags for a ${platform} video about: "${topic}" for Joints & Jitsu.

Video summary: ${script_summary}

Provide:

## TITLE OPTIONS
Title 1 (curiosity gap):
Title 2 (bold/direct):
Title 3 (story/relatable):

## CAPTION
2–3 sentences that complement the video and include a clear CTA.

## HASHTAGS
Primary (5 high-traffic):
Niche (5 community-specific):
Brand (3 brand-specific):

## BEST POSTING WINDOW
Optimal day(s) and time(s) for ${platform} in ET.
`.trim(),
};

async function executeTool(name, input) {
  const prompt = TOOL_PROMPTS[name](input);
  const response = await callAnthropic({
    model: MODEL,
    max_tokens: 1800,
    messages: [{ role: 'user', content: prompt }],
  });
  return response.content[0].text;
}

// --- Orchestrator agent ---

const SYSTEM_PROMPT = `
You are the Viral Shorts Production Agent for Joints & Jitsu, a BJJ and cannabis lifestyle brand.
Your job is to build a complete short-form video production package by calling tools in sequence:

1. generate_hooks   — create three viral opening hook options
2. write_script     — write the full script using the strongest hook
3. plan_production  — build the shot list and production guide
4. generate_titles_and_hashtags — create platform-optimised titles and hashtag strategy

Call every tool. Do not skip any step. After all four tools complete, write a brief (3–5 sentence)
creative director's note summarising the video concept and what makes it likely to go viral.

Brand voice: Fun, irreverent, authentic, high-energy. Appeals to BJJ athletes and cannabis culture enthusiasts.
`.trim();

async function runViralShortsAgent({ topic, platform, duration, brandFocus }) {
  const userMessage =
    `Create a complete viral shorts production package:\n` +
    `- Topic: ${topic}\n` +
    `- Platform: ${platform}\n` +
    `- Duration: ${duration} seconds\n` +
    `- Brand focus: ${brandFocus || 'General Joints & Jitsu lifestyle content'}\n\n` +
    `Call each tool in order to build the full package.`;

  let messages = [{ role: 'user', content: userMessage }];

  const pkg = {
    topic, platform, duration, brandFocus,
    hooks: null,
    script: null,
    productionPlan: null,
    titlesAndHashtags: null,
    directorNote: null,
    steps: [],   // ordered log of every tool call
  };

  // Agentic loop
  while (true) {
    const response = await callAnthropic({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: PRODUCTION_TOOLS,
      messages,
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

        console.log(`[ViralShortsAgent] → ${block.name}`);
        const result = await executeTool(block.name, block.input);

        // Store results in package
        const store = {
          generate_hooks:               'hooks',
          write_script:                 'script',
          plan_production:              'productionPlan',
          generate_titles_and_hashtags: 'titlesAndHashtags',
        };
        if (store[block.name]) pkg[store[block.name]] = result;

        pkg.steps.push({ tool: block.name, input: block.input });

        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: result,
        });
      }

      messages.push({ role: 'user', content: toolResults });
    } else {
      // Unexpected stop reason — bail out
      break;
    }
  }

  return pkg;
}

module.exports = { runViralShortsAgent };
