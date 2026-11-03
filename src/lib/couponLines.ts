// Cart lines in the shape /api/v1/coupons expects, so a category-limited coupon is previewed on its eligible lines only.
// Amounts are exact to the paisa (unrounded per line), like the server's order maths, so the preview base matches the order's.
export function couponLines(items: ReadonlyArray<{ productId: string | number; price: number; qty: number }>) {
  return items.map(i => ({ productId: i.productId, amount: Math.max(0, Math.round(i.price * i.qty * 100) / 100) }))
}
