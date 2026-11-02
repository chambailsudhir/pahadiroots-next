// GET /api/v1/reviews/eligible?order_id=<id>
// Owner-scoped: the items of the signed-in customer's own order with { product_id, name, image, already_reviewed }.
// A not-yet-delivered order answers { delivered:false, items:[] } so the review page can explain instead of erroring.
import { NextRequest } from 'next/server'
import { eligibleItems } from '@/lib/server/reviewSubmit'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const res = await eligibleItems(req)
  res.headers.set('Cache-Control', 'private, no-store')
  return res
}
