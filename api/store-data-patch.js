// ═══════════════════════════════════════════════════════════════
// Pahadi Roots — api/store-data.js
// ADD THESE 3 FETCHES inside your existing handler,
// alongside where you currently fetch states, products, settings.
// ═══════════════════════════════════════════════════════════════

// In your store-data handler, add these 3 parallel fetches:
// (add inside the Promise.all or alongside existing fetches)

const [
  statesRes,
  productsRes,
  settingsRes,
  couponsRes,
  stateImgsRes,    // ← NEW
  productImgsRes,  // ← NEW
  founderImgsRes,  // ← NEW
] = await Promise.all([
  sbFetch('states',   'is_active=eq.true&order=name.asc'),
  sbFetch('products', 'is_deleted=eq.false&status=eq.active&order=name.asc'),
  sbFetch('site_settings', 'select=key,value'),
  sbFetch('coupons',  'select=*'),
  sbFetch('state_images',   'order=state_id.asc,sort_order.asc'),   // ← NEW
  sbFetch('product_images', 'order=product_id.asc,sort_order.asc'), // ← NEW
  sbFetch('founder_images', 'order=sort_order.asc'),                // ← NEW
]);

// Then include them in the returned JSON:
return res.json({
  states:         statesRes   || [],
  products:       productsRes || [],
  settings:       settingsMap,   // your existing settings map
  coupons:        couponsRes  || [],
  state_images:   stateImgsRes   || [],   // ← NEW
  product_images: productImgsRes || [],   // ← NEW
  founder_images: founderImgsRes || [],   // ← NEW
});

// ═══════════════════════════════════════════════════════════════
// If your store-data.js uses a different pattern (not Promise.all),
// just add these 3 individual fetches and include them in the response.
// Upload your store-data.js and I'll make the exact edit for you!
// ═══════════════════════════════════════════════════════════════
