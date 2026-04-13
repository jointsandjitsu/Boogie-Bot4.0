
const express = require('express');
const cors = require('cors');
const path = require('path');
const { OpenAI } = require('openai');
const { runViralShortsAgent } = require('./agents/viralShortsAgent');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const SYSTEM_PROMPT = `
You are Boogie Bot, the AI assistant for Joints & Jitsu.
You're funny, creative, and high, but you deliver real answers.
Be helpful with customer service, know Jiu-Jitsu when trained, and never fake facts.
`;

// --- Boogie Bot chat ---
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

// --- Viral Shorts Production Agent ---
app.post('/api/viral-shorts', async (req, res) => {
  const { topic, platform, duration, brandFocus } = req.body;

  if (!topic || !platform || !duration) {
    return res.status(400).json({
      error: 'Missing required fields: topic, platform, duration'
    });
  }

  const validPlatforms = ['TikTok', 'Instagram Reels', 'YouTube Shorts'];
  if (!validPlatforms.includes(platform)) {
    return res.status(400).json({
      error: `platform must be one of: ${validPlatforms.join(', ')}`
    });
  }

  const durationNum = Number(duration);
  if (!Number.isInteger(durationNum) || durationNum < 15 || durationNum > 60) {
    return res.status(400).json({
      error: 'duration must be an integer between 15 and 60 seconds'
    });
  }

  try {
    console.log(`[/api/viral-shorts] Starting agent — topic: "${topic}", platform: ${platform}, duration: ${durationNum}s`);
    const productionPackage = await runViralShortsAgent({
      topic,
      platform,
      duration: durationNum,
      brandFocus: brandFocus || '',
    });
    res.json({ success: true, package: productionPackage });
  } catch (error) {
    console.error('[/api/viral-shorts] Agent error:', error);
    res.status(500).json({ error: 'The Viral Shorts Agent hit a snag. Check server logs.' });
  }
});

app.listen(PORT, () => {
  console.log(`Boogie Bot is online at http://localhost:${PORT}`);
});
