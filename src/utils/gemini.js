const config = require('../config');
const log = require('./logger');

// Gemini through Google's OpenAI-compatible endpoint, so the request and response shapes match Groq's.
// Provider only: no budget here. Callers (src/utils/ai.js) spend budget before calling.
const BASE = 'https://generativelanguage.googleapis.com/v1beta/openai';

function available() {
  return !!config.gemini?.apiKey;
}

async function request(messages, { maxTokens = 512, temperature = 0.7, model = config.gemini?.model } = {}) {
  const apiKey = config.gemini?.apiKey;
  if (!apiKey) return null;
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      log.warn(`Gemini API error: ${res.status}`);
      return null;
    }
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text) log.warn(`Gemini ${model} returned empty content (finish_reason: ${data.choices?.[0]?.finish_reason})`);
    return text || null;
  } catch (err) {
    log.warn('Gemini request failed:', err.message);
    return null;
  }
}

module.exports = { request, available };
