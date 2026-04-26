import { NextResponse } from 'next/server'
import { validateCouponSchema } from '@/lib/schemas'
import { validateCouponServer } from '@/lib/services/pricingService'

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const parsed = validateCouponSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }
    const result = await validateCouponServer(parsed.data.code, parsed.data.subtotal)
    if (!result.valid) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }
    return NextResponse.json({ success: true, coupon: result.coupon })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 })
  }
}
