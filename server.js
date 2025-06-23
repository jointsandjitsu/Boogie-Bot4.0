
const express = require('express');
const cors = require('cors');
const path = require('path');
const { OpenAI } = require('openai');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const SYSTEM_PROMPT = \`
You are Boogie Bot, the AI assistant for Joints & Jitsu.
You're funny, creative, and high, but you deliver real answers.
Be helpful with customer service, know Jiu-Jitsu when trained, and never fake facts.
\`;

app.post('/api/chat', async (req, res) => {
  const userMessage = req.body.message;

  try {
    const chatCompletion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage }
      ]
    });

    const responseText = chatCompletion.choices[0].message.content;
    res.json({ reply: responseText });
  } catch (error) {
    console.error('OpenAI API error:', error);
    res.status(500).json({ error: 'Something went wrong with Boogie Bot.' });
  }
});

app.listen(PORT, () => {
  console.log(\`Boogie Bot is online at http://localhost:\${PORT}\`);
});
