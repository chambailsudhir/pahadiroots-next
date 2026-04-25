// ═══════════════════════════════════════════════════════════════
//  5 Pahadi Roots — AI Content Generator API
//  File: api/generate-ai-content.js  (Vercel Serverless Function)
//  Repo: chambailsudhir/pahadiroots
//
//  Generates & stores ALL AI content for a product in one call:
//    • ai_description        — 2-3 sentence product description
//    • ai_health_benefits    — JSON array of 5 benefits (icon+title+desc)
//    • ai_how_to_use         — JSON array of 3-5 usage steps
//    • ai_storage_tips       — JSON array of 3-4 storage tips
//    • ai_who_should_buy     — 2 sentence customer profile
//    • ai_generated_at       — timestamp
//    • ai_provider           — 'claude'
//
//  Called from: pahadi-admin → Catalogue → Edit Product → AI Content
//
//  Environment Variables (Vercel → pahadiroots → Settings → Env Vars):
//    ANTHROPIC_API_KEY     = sk-ant-api03-xxxxx
//    SUPABASE_URL          = https://xxxx.supabase.co
//    SUPABASE_SERVICE_KEY  = eyJhbGci...
//    ADMIN_PASSWORD        = 1147
//    ENABLE_AI_CONTENT     = true
// ═══════════════════════════════════════════════════════════════

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const CORS = {
  'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || 'https://pahadiroots.com',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ── Supabase PATCH helper ─────────────────────────────────────
async function sbPatch(table, query, body) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${query}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase PATCH failed (${res.status}): ${err}`);
  }
  return res.json();
}

export default async function handler(req, res) {
  // ── CORS preflight ──
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── Kill switch ──
  if (process.env.ENABLE_AI_CONTENT === 'false') {
    return res.status(503).json({ error: 'AI content generation is currently disabled' });
  }

  // ── Parse body ──
  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const { productId, name, category, ingredients, password } = body || {};

  // ── Auth ──
  if (!password || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // ── Validate inputs ──
  if (!productId || !name) {
    return res.status(400).json({ error: 'productId and name are required' });
  }
  if (!ANTHROPIC_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured in Vercel' });
  }
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Supabase environment variables not configured' });
  }

  // ── Build the Claude prompt ──
  const ingredientsLine = ingredients ? `\nIngredients/Key Components: ${ingredients}` : '';
  const categoryLine = category ? `\nCategory: ${category}` : '';

  const prompt =
    `You are a product content writer for "5 Pahadi Roots" — a premium Himalayan organic products brand.\n` +
    `Products are sourced directly from mountain farming communities across India.\n\n` +
    `Product: ${name}${categoryLine}${ingredientsLine}\n` +
    `Brand tone: Natural, honest, warm — no marketing fluff or fake claims.\n\n` +
    `Write ALL of the following content for this product.\n` +
    `Respond ONLY with valid JSON — no markdown, no backticks, no explanation:\n\n` +
    `{\n` +
    `  "description": "2-3 sentences: what the product is, its Himalayan/regional origin, why it's special. Honest, no hyperbole.",\n` +
    `  "benefits": [\n` +
    `    {"icon": "relevant health emoji", "title": "3-4 word benefit title", "desc": "One specific sentence, 12-15 words, about this benefit for ${name}."}\n` +
    `  ],\n` +
    `  "how_to_use": [\n` +
    `    "Step 1: clear action instruction",\n` +
    `    "Step 2: ...",\n` +
    `    "Step 3: ..."\n` +
    `  ],\n` +
    `  "storage_tips": [\n` +
    `    "Storage tip 1",\n` +
    `    "Storage tip 2",\n` +
    `    "Storage tip 3"\n` +
    `  ],\n` +
    `  "who_should_buy": "2 sentences describing who benefits most from this product and why."\n` +
    `}\n\n` +
    `Rules:\n` +
    `- "benefits": exactly 5 items, specific to ${name}, not generic\n` +
    `- "how_to_use": 3-5 practical steps\n` +
    `- "storage_tips": 3-4 tips\n` +
    `- All content must be accurate and relevant to the actual product\n` +
    `- Do NOT invent ingredients or health claims not supported by the product type`;

  // ── Call Claude Haiku ──
  let aiResponse;
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1200,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Anthropic API error:', response.status, errText);
      return res.status(502).json({ error: `Claude API error: ${response.status}` });
    }

    aiResponse = await response.json();
  } catch (err) {
    console.error('Claude fetch error:', err);
    return res.status(502).json({ error: 'Failed to reach Claude API' });
  }

  // ── Parse Claude's JSON response ──
  let parsed;
  try {
    const text = (aiResponse.content || []).map(c => c.text || '').join('');
    const clean = text.replace(/```json|```/g, '').trim();
    parsed = JSON.parse(clean);
  } catch (parseErr) {
    console.error('JSON parse error:', parseErr);
    return res.status(502).json({ error: 'Claude returned invalid JSON — please try regenerating' });
  }

  // ── Validate structure ──
  if (!parsed.description || !Array.isArray(parsed.benefits) || parsed.benefits.length === 0) {
    return res.status(502).json({ error: 'Incomplete AI response — please regenerate' });
  }

  // ── Save to Supabase ──
  try {
    await sbPatch('products', `id=eq.${productId}`, {
      ai_description:   parsed.description,
      ai_health_benefits: JSON.stringify(parsed.benefits),
      ai_how_to_use:    JSON.stringify(parsed.how_to_use || []),
      ai_storage_tips:  JSON.stringify(parsed.storage_tips || []),
      ai_who_should_buy: parsed.who_should_buy || null,
      ai_generated_at:  new Date().toISOString(),
      ai_provider:      'claude',
    });
  } catch (dbErr) {
    console.error('Supabase save error:', dbErr);
    // Return the generated content even if save fails — admin can retry
    return res.status(207).json({
      success: false,
      warning: 'Content generated but failed to save to database. Please try again.',
      data: parsed,
    });
  }

  return res.status(200).json({ success: true, data: parsed });
}
