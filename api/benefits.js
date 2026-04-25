// ═══════════════════════════════════════════════════════
//  5 Pahadi Roots — AI Benefits API
//  File: /api/benefits.js  (Vercel Serverless Function)
//
//  Environment Variables needed in Vercel Dashboard:
//    ANTHROPIC_API_KEY     = sk-ant-api03-xxxxx
//    ENABLE_AI_BENEFITS    = true
//    ALLOWED_ORIGIN        = https://pahadiroots.com
// ═══════════════════════════════════════════════════════

// Simple in-memory cache (lives for duration of function instance)
// For production scale, replace with Vercel KV or Redis
const memCache = {};
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export default async function handler(req, res) {

  // ── CORS headers ──
  const allowedOrigin = process.env.ALLOWED_ORIGIN || 'https://pahadiroots.com';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow GET
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── ADMIN KILL SWITCH ──
  // Set ENABLE_AI_BENEFITS=false in Vercel dashboard to instantly disable
  if (process.env.ENABLE_AI_BENEFITS === 'false') {
    return res.status(503).json({
      error: 'disabled',
      message: 'AI benefits are currently disabled by admin'
    });
  }

  // ── VALIDATE INPUT ──
  const { product } = req.query;
  if (!product || product.trim().length < 2) {
    return res.status(400).json({ error: 'Product name required' });
  }

  const productName = product.trim().substring(0, 100); // max 100 chars

  // ── CHECK MEMORY CACHE ──
  const cacheKey = productName.toLowerCase().replace(/\s+/g, '_');
  const cached = memCache[cacheKey];
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    res.setHeader('X-Cache', 'HIT');
    return res.status(200).json(cached.data);
  }

  // ── CHECK API KEY ──
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  // ── CALL ANTHROPIC ──
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001', // Cheapest model — perfect for benefits
        max_tokens: 600,
        messages: [{
          role: 'user',
          content:
            'You are a Himalayan organic product expert. Generate benefits data for: "' + productName + '".\n' +
            'Return ONLY valid JSON, no markdown, no explanation:\n' +
            '{\n' +
            '  "benefits": [\n' +
            '    {"icon":"emoji","title":"3-4 word title","desc":"one sentence, 12-15 words"}\n' +
            '  ],\n' +
            '  "how_to_use": ["step 1","step 2","step 3"],\n' +
            '  "storage_tips": ["tip 1","tip 2","tip 3"],\n' +
            '  "who_should_buy": "2 sentences about ideal customer"\n' +
            '}\n' +
            'Rules: exactly 4 benefits, relevant health emojis, specific to ' + productName + ' not generic.'
        }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Anthropic API error:', response.status, errText);
      return res.status(502).json({ error: 'AI service error', status: response.status });
    }

    const aiData = await response.json();
    const text = (aiData.content || []).map(c => c.text || '').join('');

    // Parse JSON from AI response
    let parsed;
    try {
      parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    } catch (parseErr) {
      console.error('JSON parse error:', parseErr, 'Raw text:', text);
      return res.status(502).json({ error: 'Invalid AI response format' });
    }

    // Validate structure
    if (!parsed.benefits || !Array.isArray(parsed.benefits)) {
      return res.status(502).json({ error: 'Missing benefits in AI response' });
    }

    // ── STORE IN CACHE ──
    memCache[cacheKey] = { ts: Date.now(), data: parsed };

    // Tell browser to cache for 1 hour too (reduces server calls)
    res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
    res.setHeader('X-Cache', 'MISS');

    return res.status(200).json(parsed);

  } catch (err) {
    console.error('Benefits function error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
