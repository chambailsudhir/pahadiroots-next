// ═══════════════════════════════════════════════════════════════
// Pahadi Roots — Store Data API (Vercel Serverless Function)
// File path: api/store-data.js
// Returns: states, products, site_settings for the main site
// ═══════════════════════════════════════════════════════════════

export const config = {
  api: { bodyParser: false }
};

const SUPABASE_URL      = process.env.SUPABASE_URL;
const SUPABASE_KEY      = process.env.SUPABASE_SERVICE_KEY;
const RAZORPAY_KEY_ID   = process.env.RAZORPAY_KEY_ID || ''; // ← from Vercel env, never hardcoded

const CORS = {
  'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || 'https://pahadiroots.com',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 's-maxage=60, stale-while-revalidate=300',
};

async function sbGet(table, query = '') {
  const url = `${SUPABASE_URL}/rest/v1/${table}${query ? '?' + query : ''}`;
  const res = await fetch(url, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    }
  });
  if (!res.ok) throw new Error(`Supabase ${table}: ${res.status}`);
  return res.json();
}

export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return res.writeHead(204, CORS).end();
  }

  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));

  try {
    // Fetch states, products, site_settings, and image tables in parallel
    const [states, products, siteSettings, coupons, stateImages, productImages, founderImages, productVariants, teamMembers, categories] = await Promise.all([
      sbGet('states', 'is_active=eq.true&order=name.asc').catch(() => []),
      sbGet('products', 'select=*&status=eq.active&is_deleted=eq.false&order=name.asc&limit=200').catch(() => []),
      sbGet('site_settings', 'select=key,value').catch(() => []),
      sbGet('coupons', 'is_active=eq.true&select=code,type,value,min_order,max_uses,uses_count,expires_at,first_order_only,max_discount').catch(() => []),
      sbGet('state_images',   'select=state_id,image_url,sort_order&order=state_id.asc,sort_order.asc').catch(() => []),
      sbGet('product_images', 'select=product_id,image_url,sort_order&order=product_id.asc,sort_order.asc').catch(() => []),
      sbGet('founder_images', 'order=sort_order.asc').catch(() => []),
      sbGet('product_variants', 'is_active=eq.true&order=product_id.asc,sort_order.asc').catch(() => []),
      sbGet('team_members', 'is_active=eq.true&order=sort_order.asc').catch(() => []),
      sbGet('categories', 'select=id,name,slug,image_url,sort_order&is_active=eq.true&order=sort_order.asc,name.asc').catch(() => []),
    ]);

    // Convert site_settings array to object
    const settings = {};
    (siteSettings || []).forEach(s => { settings[s.key] = s.value; });

    res.status(200).json({
      states:           states          || [],
      products:         products        || [],
      settings,
      coupons:          coupons         || [],
      state_images:     stateImages     || [],
      product_images:   productImages   || [],
      founder_images:   founderImages   || [],
      product_variants: productVariants || [],
      team_members:     teamMembers     || [],
      categories:       categories      || [],
      razorpay_key:     RAZORPAY_KEY_ID,   // ← served from env, safe
    });

  } catch (e) {
    console.error('store-data error:', e.message);
    res.status(500).json({ error: e.message, states: [], products: [], settings: {} });
  }
}
