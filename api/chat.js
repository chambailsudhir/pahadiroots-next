// api/chat.js — Vercel Serverless Function
// Primary: Google Gemini | Fallback: Claude (Anthropic)
// Keys stored in Vercel Environment Variables — never exposed to browser

const GEMINI_KEY    = process.env.GEMINI_API_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + GEMINI_KEY;
const CLAUDE_URL = 'https://api.anthropic.com/v1/messages';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { contents, system_instruction, generationConfig } = req.body;
  const systemText = system_instruction?.parts?.[0]?.text || '';

  // ── 1. Try Gemini first ──────────────────────────────────
  if (GEMINI_KEY) {
    try {
      const geminiRes = await fetch(GEMINI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction,
          contents,
          tools: [{ google_search: {} }],
          generationConfig: generationConfig || {
            temperature: 0.7,
            maxOutputTokens: 1024,
          },
        }),
      });

      const data = await geminiRes.json();

      if (geminiRes.ok && data.candidates?.[0]) {
        console.log('[chat.js] Gemini responded OK');
        return res.status(200).json(data);
      }

      console.warn('[chat.js] Gemini failed:', data.error?.message || geminiRes.status, '— trying Claude fallback');

    } catch (err) {
      console.warn('[chat.js] Gemini fetch error:', err.message, '— trying Claude fallback');
    }
  }

  // ── 2. Fallback: Claude (Anthropic) ─────────────────────
  if (!ANTHROPIC_KEY) {
    return res.status(500).json({ error: 'Both Gemini and Claude are unavailable' });
  }

  try {
    // Convert Gemini-style contents to Anthropic messages format
    const messages = (contents || []).map(c => ({
      role: c.role === 'model' ? 'assistant' : 'user',
      content: c.parts?.[0]?.text || '',
    }));

    const claudeRes = await fetch(CLAUDE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: systemText,
        messages,
      }),
    });

    const claudeData = await claudeRes.json();

    if (!claudeRes.ok) {
      console.error('[chat.js] Claude also failed:', claudeData.error?.message);
      return res.status(claudeRes.status).json({ error: claudeData.error?.message || 'Claude error' });
    }

    // Convert Claude response → Gemini-style format so frontend works without any changes
    const text = claudeData.content?.[0]?.text || '';
    console.log('[chat.js] Claude fallback responded OK');

    return res.status(200).json({
      candidates: [{
        content: {
          parts: [{ text }],
          role: 'model',
        },
        finishReason: 'STOP',
      }],
    });

  } catch (err) {
    console.error('[chat.js] Claude fetch error:', err.message);
    return res.status(500).json({ error: 'All AI services unavailable. Please try again.' });
  }
}
