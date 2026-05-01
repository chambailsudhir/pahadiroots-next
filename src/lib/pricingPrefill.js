// ── pricingPrefill.js ─────────────────────────────────────────
// Zero-coupling bridge between the Pricing Engine and the
// existing Add Product modal on the Products page.
//
// HOW IT WORKS
// ────────────
// 1. Pricing Engine calls `savePricingPrefill(calc, f)` and
//    navigates to /admin/products?addNew=1&fromPricing=1
//
// 2. Products page calls `usePricingPrefill()` once on mount.
//    If the URL has ?fromPricing=1 it reads the stored payload,
//    clears it, and returns the prefill object.
//
// 3. Your existing Add Product modal receives `prefill` as a prop.
//    Any field that exists in prefill is set as the initial value.
//    Fields the user hasn't filled yet (name, slug, state…) stay
//    blank as normal — the user completes them themselves.
//
// PREFILL SHAPE (matches your existing product DB columns)
// ─────────────────────────────────────────────────────────
// {
//   price:       number   ← base price excl GST
//   mrp:         number   ← selling price incl GST  (your DB "mrp" = selling price)
//   mrp_display: number   ← MRP strikethrough shown to customer
//   cost_price:  number   ← purchase price from Stage 1
//   gst_rate:    number   ← output GST %
//   // Meta — shown in the green banner inside the modal
//   _margin_pct: number
//   _profit_val: number
//   _source:     'pricing_engine'
// }

const KEY = 'pahadi_pricing_prefill';

/** Call from Pricing Engine before navigating away. */
export function savePricingPrefill(calc, f) {
  if (typeof window === 'undefined') return;
  const payload = {
    price:       Math.round((calc.base_price) * 100) / 100,
    mrp:         Math.round(calc.sp * 100) / 100,
    mrp_display: Math.round(calc.mrp),
    cost_price:  Math.round((Number(f.purchase)) * 100) / 100,
    gst_rate:    Number(f.gst_out),
    // Display-only meta for the banner
    _margin_pct: Math.round(calc.margin_pct),
    _profit_val: Math.round(calc.profit_val),
    _source:     'pricing_engine',
  };
  sessionStorage.setItem(KEY, JSON.stringify(payload));
}

/** Call once on mount in your Products page / modal manager. */
export function readAndClearPricingPrefill() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    sessionStorage.removeItem(KEY);
    const data = JSON.parse(raw);
    if (data?._source !== 'pricing_engine') return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * React hook — use inside your Products page component.
 *
 *   const prefill = usePricingPrefill();
 *   // then pass prefill into your Add Product modal:
 *   <AddProductModal prefill={prefill} ... />
 *
 * Returns null when there's nothing to prefill.
 * Returns the prefill object (once) when arriving from Pricing Engine.
 * Clears sessionStorage immediately so a refresh doesn't re-trigger.
 */
export function usePricingPrefill() {
  // We use a module-level variable so the hook is safe to call
  // multiple times in StrictMode — the read only happens once.
  if (typeof window === 'undefined') return null;

  // Lazy one-time read — store result in a closure variable on the module
  if (!usePricingPrefill._read) {
    usePricingPrefill._read = true;
    usePricingPrefill._cached = readAndClearPricingPrefill();
  }
  return usePricingPrefill._cached ?? null;
}
