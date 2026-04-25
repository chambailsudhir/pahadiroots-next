// ═══════════════════════════════════════════════════════════════
// 5 Pahadi Roots — Newsletter Subscribe API (Public — no auth needed)
// File path: api/subscribe.js
//
// Bug #6 fix: newsletter signup previously showed a success toast
// but never saved the email. This endpoint inserts into subscribers.
// ═══════════════════════════════════════════════════════════════

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Simple in-memory rate limit — 5 subscribes per IP per 10 minutes
const _rateMap = new Map();
function isRateLimited(ip) {
  const now = Date.now();
  const entry = _rateMap.get(ip) || { count: 0, start: now };
  if (now - entry.start > 10 * 60 * 1000) { _rateMap.set(ip, { count: 1, start: now }); return false; }
  if (entry.count >= 5) return true;
  entry.count++;
  _rateMap.set(ip, entry);
  return false;
}

export default async function handler(req, res) {
  const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://pahadiroots.com';
  res.setHeader('Access-Control-Allow-Origin',  ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type',                 'application/json');
  res.setHeader('Cache-Control',                'no-store');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
  if (isRateLimited(ip)) return res.status(429).json({ error: 'Too many requests' });

  let body = {};
  try { body = req.body || {}; if (typeof body === 'string') body = JSON.parse(body); } catch(e) {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const email = (body.email || '').trim().toLowerCase();
  if (!email || !email.includes('@') || email.length > 254) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  try {
    // Check if already subscribed
    const checkUrl = `${SUPABASE_URL}/rest/v1/subscribers?email=eq.${encodeURIComponent(email)}&select=id,status`;
    const checkRes = await fetch(checkUrl, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    if (checkRes.ok) {
      const existing = await checkRes.json();
      if (existing && existing.length > 0) {
        // If unsubscribed before, reactivate them
        if (existing[0].status === 'unsubscribed') {
          await fetch(`${SUPABASE_URL}/rest/v1/subscribers?id=eq.${existing[0].id}`, {
            method: 'PATCH',
            headers: {
              'apikey': SUPABASE_KEY,
              'Authorization': `Bearer ${SUPABASE_KEY}`,
              'Content-Type': 'application/json',
              'Prefer': 'return=representation',
            },
            body: JSON.stringify({ status: 'active', subscribed_at: new Date().toISOString() })
          });
          return res.status(200).json({ success: true });
        }
        return res.status(200).json({ success: true, error: 'already_subscribed' });
      }
    }

    // Insert new subscriber
    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/subscribers`, {
      method: 'POST',
      headers: {
        'apikey':        SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type':  'application/json',
        'Prefer':        'return=representation',
      },
      body: JSON.stringify({
        email,
        status: 'active',
        source: 'website_footer',
        subscribed_at: new Date().toISOString(),
      })
    });

    if (!insertRes.ok) {
      const errText = await insertRes.text().catch(() => 'unknown');
      console.error('Subscribe insert failed:', insertRes.status, errText);
      return res.status(500).json({ error: 'Could not save subscription' });
    }

    return res.status(200).json({ success: true });
  } catch(e) {
    console.error('Subscribe error:', e.message);
    return res.status(500).json({ error: 'Subscription failed' });
  }
}
