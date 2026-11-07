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

/** Coins an order of `orderValue` ₹ earns on delivery: floor(value / step) × coins per step, capped only when a maximum is set. */
export function coinsForOrderValue(orderValue: number, settings: Settings): number {
  const max = coinsMaxPerOrder(settings)
  if (max === 0) return 0
  const v = Number.isFinite(Number(orderValue)) ? Number(orderValue) : 0
  const pts = Math.floor(v / coinStepRupees(settings) + 1e-9) * coinsPerStep(settings)
  return Math.max(0, max != null ? Math.min(pts, max) : pts)
}
