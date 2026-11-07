/**
 * Pahadi Coins earned on a DELIVERED order. Owner rule (Nov 2026, second revision): NO coins below ₹500; then
 * `loyalty_coins_per_step` coins (default 5) for every full ₹`loyalty_coin_step_rupees` (default 500) of the order value, with NO
 * per-order limit unless `loyalty_coins_per_order` is set (a number > 0 caps it; 0 switches earning off). 1 coin = ₹1 → 1% back.
 *   ₹499 → 0 · ₹500 → 5 · ₹999 → 5 · ₹1,000 → 10 · ₹3,000 → 30.
 * Paid only once the order is delivered (database trigger `trg_award_loyalty_on_delivered`, db_migration_v36, which calls the
 * SQL function `delivery_coins_for` holding the identical formula) and taken back automatically on return / refund. Pure (no server
 * imports) so routes, e-mail builders, the checkout and tests all use the same rule.
 */
type Settings = Record<string, string | undefined>

const intSetting = (v: string | undefined): number | null => {
  const s = String(v ?? '').trim()
  return /^\d+$/.test(s) ? parseInt(s, 10) : null
}

/** Optional per-order MAXIMUM (`loyalty_coins_per_order`): null = no limit (the default), 0 = earning off. */
export function coinsMaxPerOrder(settings: Settings): number | null {
  return intSetting(settings.loyalty_coins_per_order)
}

/** ₹ of order value per step (`loyalty_coin_step_rupees`, default 500, never below 1). Below one step an order earns nothing. */
export function coinStepRupees(settings: Settings): number {
  const n = intSetting(settings.loyalty_coin_step_rupees)
  return n != null && n >= 1 ? n : 500
}

/** Coins per full step (`loyalty_coins_per_step`, default 5). */
export function coinsPerStep(settings: Settings): number {
  const n = intSetting(settings.loyalty_coins_per_step)
  return n != null ? n : 5
}

/** "4 months" / "12 months" / "45 days" for loyalty_expiry_days; null when coins never expire (0). Default 120 days. */
export function expirySpan(days?: number | string | null): string | null {
  const raw = typeof days === 'string' ? (days.trim() === '' ? NaN : Number(days)) : days
  const d = typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 120
  if (d === 0) return null
  return d === 365 || d === 366 ? '12 months' : d % 30 === 0 ? `${d / 30} ${d === 30 ? 'month' : 'months'}` : `${d} days`
}

/**
 * The value coins (and the ₹999 referral minimum) are measured on: the GOODS the customer paid for — order total minus shipping and
 * the COD fee (coupon, prepaid discount and coins are already off the total). Same as big marketplaces, which never reward delivery
 * charges. The database uses the same formula (order_goods_value, db_migration_v39).
 */
export function coinBaseValue(total: number, shipping?: number | null, codSurcharge?: number | null): number {
  const n = (x: unknown) => { const v = Number(x); return Number.isFinite(v) && v > 0 ? v : 0 }
  return Math.max(0, n(total) - n(shipping) - n(codSurcharge))
}

/** Coins an order of `orderValue` ₹ earns on delivery: floor(value / step) × coins per step, capped only when a maximum is set. */
export function coinsForOrderValue(orderValue: number, settings: Settings): number {
  const max = coinsMaxPerOrder(settings)
  if (max === 0) return 0
  const v = Number.isFinite(Number(orderValue)) ? Number(orderValue) : 0
  const pts = Math.floor(v / coinStepRupees(settings) + 1e-9) * coinsPerStep(settings)
  return Math.max(0, max != null ? Math.min(pts, max) : pts)
}

/**
 * "Add ₹X more to earn N coins" (Nov 2026, owner request): how far this order is from the next full step. null when earning is off,
 * or when a per-order maximum is set and already reached. `more` = the order already earns coins (so the next ones are "more").
 */
export function coinNudge(orderValue: number, settings: Settings): { addRupees: number; coins: number; more: boolean } | null {
  const max = coinsMaxPerOrder(settings)
  const perStep = coinsPerStep(settings)
  if (max === 0 || perStep <= 0) return null
  const v = Number.isFinite(Number(orderValue)) && Number(orderValue) > 0 ? Number(orderValue) : 0
  const step = coinStepRupees(settings)
  const now = coinsForOrderValue(v, settings)
  if (max != null && now >= max) return null
  const nextAt = (Math.floor(v / step + 1e-9) + 1) * step
  const coins = max != null ? Math.min(perStep, max - now) : perStep
  return { addRupees: Math.max(1, Math.ceil(nextAt - v)), coins, more: now > 0 }
}

/**
 * Most a customer may take off with coins on one order (₹), owner rule Nov 2026: the coupon and the coins TOGETHER may not exceed
 * `loyalty_max_redeem_pct` (owner: 15%) of the goods subtotal — a ₹500 order with WELCOME50 (₹50) leaves ₹25 for coins.
 * Used by the checkout display, /api/v1/loyalty (validate) and createOrder (authoritative), so the three always agree.
 */
export function maxCoinDiscountInr(subtotal: number, couponDiscount: number, settings: Settings): number {
  const pctRaw = parseFloat(String(settings.loyalty_max_redeem_pct ?? ''))
  const pct = Number.isFinite(pctRaw) && pctRaw >= 0 ? pctRaw : 20
  const s = Number.isFinite(subtotal) && subtotal > 0 ? subtotal : 0
  const c = Number.isFinite(couponDiscount) && couponDiscount > 0 ? couponDiscount : 0
  return Math.max(0, Math.floor(s * pct / 100) - Math.ceil(c))
}
