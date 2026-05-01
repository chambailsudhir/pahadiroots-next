import { NextResponse } from 'next/server';

const GEMINI_MODEL    = 'gemini-2.0-flash';
const CLAUDE_MODEL    = 'claude-haiku-4-5-20251001';
const GEMINI_API_KEY  = process.env.Gemini_API_Key;
const ANTHROPIC_KEY   = process.env.ANTHROPIC_API_KEY;

const ADMIN_SYSTEM = `You are "Pahadi Assist" — the internal business AI for 5 Pahadi Roots (pahadiroots.com).
You are talking to Sudhir Chambail (founder) or his trusted team.

YOU HAVE LIVE WEB SEARCH — use it for any market research, competitor pricing, trends, or current data questions. Always search before answering such queries.

BUSINESS CONTEXT:
- Ecommerce brand selling authentic Himalayan natural products
- Products: Wild Honey, A2 Bilona Ghee, Kashmiri Saffron, Ladakhi Shilajit, Assam Tea, Kangra Tea, Lakadong Turmeric, Bamboo Shoot, Joha Rice, Bhut Jolokia, Black Rice, Large Cardamom, Cold Pressed Mustard Oil, Pahadi Basmati
- Sourced directly from Himalayan farming communities across 8+ states
- Free shipping above Rs.799 | 4-7 day delivery | pahadiroots.com

NO RESTRICTIONS — internal business tool. You can:
- Write product descriptions, SEO content, social media posts in Hindi and English
- Draft customer service replies, email campaigns, WhatsApp broadcasts
- Research competitors, market trends, pricing using web search
- Create content calendars, gift combos, launch plans
- Analyse any business data provided

RESPONSE STYLE: Direct, warm, specific, actionable. Ready-to-use content only. No markdown ## headers. Plain text with bullet points.`;

async function callGemini(messages, systemPrompt) {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_KEY_MISSING');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  const sys = systemPrompt || ADMIN_SYSTEM;

  // Inject system prompt as first user/model exchange (system_instruction conflicts with googleSearch)
  const contents = [
    { role: 'user',  parts: [{ text: `[SYSTEM INSTRUCTIONS - follow always]\n${sys}\n[END SYSTEM]` }] },
    { role: 'model', parts: [{ text: 'Understood. I am Pahadi Assist, ready to help.' }] },
    ...messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),
  ];

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents,
      tools: [{ googleSearch: {} }],
      generationConfig: { temperature: 0.75, maxOutputTokens: 2048 },
    }),
  });

  if (!res.ok) {
    const e = await res.json();
    throw new Error(`Gemini ${res.status}: ${e.error?.message || 'Unknown error'}`);
  }

  const data = await res.json();
  const cand = data.candidates?.[0];
  if (!cand) throw new Error('Gemini: No candidates returned');

  let text = '';
  cand.content?.parts?.forEach(p => { if (p.text) text += p.text; });

  const sources = [];
  cand.groundingMetadata?.groundingChunks?.forEach(c => {
    if (c.web?.uri) sources.push({ uri: c.web.uri, title: c.web.title || '' });
  });

  return { text: text || 'No response.', sources, provider: 'gemini' };
}

async function callClaude(messages, systemPrompt) {
  if (!ANTHROPIC_KEY) throw new Error('CLAUDE_KEY_MISSING');

  // Convert to Claude format
  const claudeMessages = messages.map(m => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: m.content,
  }));

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':     'application/json',
      'x-api-key':        ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 2048,
      system: systemPrompt || ADMIN_SYSTEM,
      messages: claudeMessages,
    }),
  });

  if (!res.ok) {
    const e = await res.text();
    throw new Error(`Claude ${res.status}: ${e}`);
  }

  const data = await res.json();
  const text = (data.content || []).map(c => c.text || '').join('');

  return { text: text || 'No response.', sources: [], provider: 'claude' };
}

export async function POST(req) {
  try {
    const pw = req.headers.get('x-admin-pw');
    if (!pw || pw !== process.env.ADMIN_PASSWORD) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { messages, preferred = 'gemini', systemPrompt, allowFallback = true } = body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: 'messages array required' }, { status: 400 });
    }

    // Check which keys are available
    const hasGemini  = !!GEMINI_API_KEY;
    const hasClaude  = !!ANTHROPIC_KEY;

    if (!hasGemini && !hasClaude) {
      return NextResponse.json({
        error: 'No AI keys configured. Set Gemini_API_Key or ANTHROPIC_API_KEY in Vercel environment variables.',
        keyStatus: { gemini: false, claude: false },
      }, { status: 503 });
    }

    let result;
    let usedFallback = false;
    let primaryError = null;

    if (preferred === 'gemini') {
      // Try Gemini first
      if (hasGemini) {
        try {
          result = await callGemini(messages, systemPrompt);
        } catch (e) {
          primaryError = e.message;
          // Fallback to Claude if allowed
          if (allowFallback && hasClaude) {
            result = await callClaude(messages, systemPrompt);
            usedFallback = true;
          } else {
            throw e;
          }
        }
      } else if (hasClaude) {
        // Gemini key missing, use Claude
        result = await callClaude(messages, systemPrompt);
        usedFallback = true;
        primaryError = 'Gemini key not configured';
      }
    } else {
      // Claude preferred
      if (hasClaude) {
        try {
          result = await callClaude(messages, systemPrompt);
        } catch (e) {
          primaryError = e.message;
          if (allowFallback && hasGemini) {
            result = await callGemini(messages, systemPrompt);
            usedFallback = true;
          } else {
            throw e;
          }
        }
      } else if (hasGemini) {
        result = await callGemini(messages, systemPrompt);
        usedFallback = true;
        primaryError = 'Claude key not configured';
      }
    }

    return NextResponse.json({
      ...result,
      usedFallback,
      primaryError,
      keyStatus: { gemini: hasGemini, claude: hasClaude },
    });

  } catch (err) {
    console.error('[ai-chat] Error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}



