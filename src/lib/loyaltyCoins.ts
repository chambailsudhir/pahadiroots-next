/**
 * Pahadi Coins earned on a DELIVERED order (owner decision, Nov 2026): 1 coin for every ₹`loyalty_coin_step_rupees` of the order value
 * (default ₹200), at least 1, and AT MOST `loyalty_coins_per_order` (default 5 - the maximum per order). Paid only once the order is
 * delivered (database trigger `trg_award_loyalty_on_delivered`, db_migration_v31) and taken back automatically on return / refund
 * (`trg_reverse_loyalty_on_order_end`). Orders never earn at placement or payment. Pure (no server imports) so routes, e-mail builders,
 * the checkout and tests all use the same rule; the database function applies the identical formula.
 */
type Settings = Record<string, string | undefined>

/** The per-order MAXIMUM (admin setting `loyalty_coins_per_order`, default 5; 0 switches earning off). */
export function coinsPerOrder(settings: Settings): number {
  const n = parseInt(String(settings.loyalty_coins_per_order ?? ''), 10)
  return Number.isFinite(n) && n >= 0 ? n : 5
}

/** ₹ of order value per coin (admin setting `loyalty_coin_step_rupees`, default 200, never below 1). */
export function coinStepRupees(settings: Settings): number {
  const n = parseInt(String(settings.loyalty_coin_step_rupees ?? ''), 10)
  return Number.isFinite(n) && n >= 1 ? n : 200
}

/** Coins an order of `orderValue` ₹ earns on delivery: floor(value / step), at least 1, at most the per-order maximum. */
export function coinsForOrderValue(orderValue: number, settings: Settings): number {
  const max = coinsPerOrder(settings)
  if (max <= 0) return 0
  const v = Number.isFinite(Number(orderValue)) ? Number(orderValue) : 0
  return Math.min(max, Math.max(1, Math.floor(v / coinStepRupees(settings) + 1e-9)))
}
