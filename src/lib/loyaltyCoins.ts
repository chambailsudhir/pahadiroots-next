/**
 * Pahadi Coins earned per DELIVERED order (owner decision, Nov 2026): a flat amount per order - 5 by default, admin setting
 * `loyalty_coins_per_order`. Paid only once the order is delivered (database trigger `trg_award_loyalty_on_delivered`,
 * db_migration_v28) and taken back automatically on return / refund (`trg_reverse_loyalty_on_order_end`). Orders no longer earn at
 * placement or payment. Pure (no server imports) so routes, e-mail builders and tests can all use it.
 */
export function coinsPerOrder(settings: Record<string, string | undefined>): number {
  const n = parseInt(String(settings.loyalty_coins_per_order ?? ''), 10)
  return Number.isFinite(n) && n >= 0 ? n : 5
}
