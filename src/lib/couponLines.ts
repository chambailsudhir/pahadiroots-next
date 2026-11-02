// Cart lines in the shape /api/v1/coupons expects, so a category-limited coupon is previewed on its eligible lines only.
export function couponLines(items: ReadonlyArray<{ productId: string | number; price: number; qty: number }>) {
  return items.map(i => ({ productId: i.productId, amount: Math.max(0, Math.round(i.price * i.qty)) }))
}
