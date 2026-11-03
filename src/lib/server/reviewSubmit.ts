// Verified-purchase product reviews (Nov 2026) - server side.
//
// Modelled on Amazon / Flipkart / Myntra / Nykaa: a review can only be written by the customer who RECEIVED the
// product. Everything that identifies the reviewer (customer id, display name, order) is derived on the server from the
// session and the order; the request body only carries `product_id`, `order_id`, `rating` and `comment`.
//
// Used by POST /api/v1/actions {action:'submit_review'} and GET /api/v1/reviews/eligible.
import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import {
  sbAuth, sbAdmin, getToken, tryRefresh, applyNewCookies,
  syncCustomerProfile, checkRateLimitShared,
} from '@/lib/api/serverUtils'
import { reviewSchema } from '@/lib/schemas'
import { cleanReviewComment, reviewerDisplayName } from '@/lib/reviews'
import { captureError } from '@/lib/logger'

type Profile = Record<string, unknown> & { id: number | string }
export type CustomerAuth =
  | { ok: true; profile: Profile; cookies: { token: string; refresh: string } | null }
  | { ok: false; res: NextResponse }

const err = (status: number, error: string, code?: string) =>
  NextResponse.json(code ? { error, code } : { error }, { status })

/** Session -> customers row (via syncCustomerProfile). Never reads an identity from the request body. */
export async function authenticateCustomer(req: NextRequest): Promise<CustomerAuth> {
  let token = getToken(req)
  const refreshed = !token ? await tryRefresh(req) : null
  if (!token && !refreshed) return { ok: false, res: err(401, 'Please sign in to review a product', 'auth_required') }
  if (refreshed) token = refreshed.token
  try {
    const user = await sbAuth('/user', null, token!)
    const profile = await syncCustomerProfile(user)
    if (!profile) return { ok: false, res: err(404, 'Profile not found', 'no_profile') }
    return { ok: true, profile: profile as Profile, cookies: refreshed ? { token: refreshed.token, refresh: refreshed.refresh } : null }
  } catch (e) {
    const status = (e as { status?: number })?.status
    if (status === 401) return { ok: false, res: err(401, 'Your session has expired - please sign in again', 'auth_required') }
    captureError(e, { action: 'reviews.auth' })
    return { ok: false, res: err(503, 'Please try again in a moment', 'unavailable') }
  }
}

export function withCookies(res: NextResponse, auth: Extract<CustomerAuth, { ok: true }>): NextResponse {
  if (auth.cookies) applyNewCookies(res, auth.cookies.token, auth.cookies.refresh)
  return res
}

const isPgUnique = (e: unknown) => {
  const x = e as { status?: number; message?: unknown }
  return x?.status === 409 || /23505/.test(String(x?.message ?? ''))
}

// ── POST: submit one review ───────────────────────────────────────────────────
export async function submitVerifiedReview(req: NextRequest, body: unknown): Promise<NextResponse> {
  const auth = await authenticateCustomer(req)
  if (!auth.ok) return auth.res
  const fin = (r: NextResponse) => withCookies(r, auth)

  const parsed = reviewSchema.safeParse(body)
  if (!parsed.success) return fin(err(400, 'Invalid review data', 'invalid'))
  const { product_id, order_id, rating } = parsed.data
  const comment = cleanReviewComment(parsed.data.comment)
  const customerId = auth.profile.id

  // Shared (cross-instance) limit per customer.
  if (!await checkRateLimitShared(`review_submit:${customerId}`, 20, 60 * 60_000)) {
    return fin(NextResponse.json({ error: 'Too many reviews in a short time - please try again later', code: 'rate_limited' }, { status: 429, headers: { 'Retry-After': '3600' } }))
  }

  try {
    // 1. The order must belong to THIS customer (a foreign / unknown order is just "not found").
    const orders = await sbAdmin('GET', `/rest/v1/orders?id=eq.${order_id}&customer_id=eq.${customerId}&select=id,order_status&limit=1`)
    const order = Array.isArray(orders) ? orders[0] : null
    if (!order) return fin(err(404, 'Order not found', 'order_not_found'))

    // 2. ...and must have been delivered.
    if (order.order_status !== 'delivered') {
      return fin(err(409, 'You can review a product once your order has been delivered', 'order_not_delivered'))
    }

    // 3. ...and must contain the product.
    const items = await sbAdmin('GET', `/rest/v1/order_items?order_id=eq.${order_id}&product_id=eq.${product_id}&select=product_id&limit=1`)
    if (!Array.isArray(items) || items.length === 0) {
      return fin(err(400, 'That product is not part of this order', 'product_not_in_order'))
    }

    // 4. One review per product per customer.
    const existing = await sbAdmin('GET', `/rest/v1/reviews?customer_id=eq.${customerId}&product_id=eq.${product_id}&select=id&limit=1`)
    if (Array.isArray(existing) && existing.length > 0) {
      return fin(err(409, 'You have already reviewed this product', 'already_reviewed'))
    }

    // 5. Insert as PENDING; moderation happens in the admin app. (The unique index closes the race between 4 and 5.)
    try {
      await sbAdmin('POST', '/rest/v1/reviews', {
        product_id,
        customer_id:          customerId,
        order_id,
        is_verified_purchase: true,
        customer_name:        reviewerDisplayName(auth.profile.first_name, auth.profile.last_name),
        rating,
        review_text:          comment,   // main column
        comment,                         // added column (same value)
        status:               'pending',
        created_at:           new Date().toISOString(),
      }, 'return=minimal')
    } catch (e) {
      if (isPgUnique(e)) return fin(err(409, 'You have already reviewed this product', 'already_reviewed'))
      throw e
    }

    return fin(NextResponse.json({ success: true, message: 'Review submitted for approval' }))
  } catch (e) {
    captureError(e, { action: 'reviews.submit', customer_id: String(customerId) })
    return fin(err(503, 'Could not save your review - please try again', 'unavailable'))
  }
}

// ── GET: items of one order and whether each is already reviewed ──────────────
export async function eligibleItems(req: NextRequest): Promise<NextResponse> {
  const raw = req.nextUrl.searchParams.get('order_id') ?? ''
  if (!/^[0-9]{1,15}$/.test(raw)) return err(400, 'Invalid order', 'invalid')

  const auth = await authenticateCustomer(req)
  if (!auth.ok) return auth.res
  const fin = (r: NextResponse) => withCookies(r, auth)
  const customerId = auth.profile.id

  try {
    const orders = await sbAdmin('GET', `/rest/v1/orders?id=eq.${raw}&customer_id=eq.${customerId}&select=id,order_number,order_status&limit=1`)
    const order = Array.isArray(orders) ? orders[0] : null
    if (!order) return fin(err(404, 'Order not found', 'order_not_found'))

    const delivered = order.order_status === 'delivered'
    const base = { order_id: order.id, order_number: order.order_number, delivered }
    if (!delivered) return fin(NextResponse.json({ ...base, items: [] }))

    const rows = await sbAdmin('GET', `/rest/v1/order_items?order_id=eq.${raw}&select=product_id,product_name_snapshot,variant_value_snapshot,products(name,image_url,emoji)&order=id.asc`)
    // One entry per product (the same product in two variants is one review).
    const seen = new Set<number>()
    const items: Array<{ product_id: number; name: string; variant: string | null; image: string | null; emoji: string | null; already_reviewed: boolean }> = []
    for (const r of (Array.isArray(rows) ? rows : []) as Array<{ product_id: number; product_name_snapshot?: string | null; variant_value_snapshot?: string | null; products?: { name?: string | null; image_url?: string | null; emoji?: string | null } | null }>) {
      if (r.product_id == null || seen.has(r.product_id)) continue
      seen.add(r.product_id)
      items.push({
        product_id: r.product_id,
        name:       r.product_name_snapshot || r.products?.name || 'Product',
        variant:    r.variant_value_snapshot || null,
        image:      r.products?.image_url || null,
        emoji:      r.products?.emoji || null,
        already_reviewed: false,
      })
    }

    if (items.length > 0) {
      const ids = items.map(i => i.product_id).join(',')
      const mine = await sbAdmin('GET', `/rest/v1/reviews?customer_id=eq.${customerId}&product_id=in.(${ids})&select=product_id&limit=200`)
      const done = new Set((Array.isArray(mine) ? mine : []).map((m: { product_id: number }) => m.product_id))
      for (const i of items) i.already_reviewed = done.has(i.product_id)
    }

    return fin(NextResponse.json({ ...base, items }))
  } catch (e) {
    captureError(e, { action: 'reviews.eligible', customer_id: String(customerId) })
    return fin(err(503, 'Could not load your order - please try again', 'unavailable'))
  }
}
