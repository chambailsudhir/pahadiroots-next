// H2-3 (Nov 2026): purchase analytics events are only kept for real, recent, paid / confirmed-COD orders,
// and their value comes from the order — so a stranger can neither forge revenue nor pre-block a real purchase.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const sbAdmin = vi.fn()
vi.mock('@/lib/api/serverUtils', () => ({ sbAdmin: (...a: unknown[]) => sbAdmin(...a) }))
vi.mock('@/lib/logger', () => ({ captureError: vi.fn() }))

import { verifyPurchaseRows } from '@/lib/analytics/verifyPurchase'

const recent = new Date(Date.now() - 60_000).toISOString()
const old = new Date(Date.now() - 5 * 86400_000).toISOString()
const ev = (order_id: unknown, value = 99999) => ({ event_type: 'purchase', dedupe_key: `purchase:${order_id}`, metadata: { order_id, value } })

beforeEach(() => { sbAdmin.mockReset() })

describe('verifyPurchaseRows', () => {
  it('keeps a paid recent order and overwrites the value with the stored total', async () => {
    sbAdmin.mockResolvedValue([{ order_number: 'PR-1001', total_amount: 450, payment_status: 'paid', payment_method: 'razorpay', order_status: 'confirmed', created_at: recent }])
    const out = await verifyPurchaseRows([ev('PR-1001'), { event_type: 'page_view', metadata: null }])
    expect(out).toHaveLength(2)
    expect((out[0].metadata as { value: number }).value).toBe(450)
  })
  it('keeps confirmed COD; drops unpaid online, cancelled, old, unknown and malformed orders', async () => {
    sbAdmin.mockResolvedValue([
      { order_number: 'C-1', total_amount: 300, payment_status: 'cod_pending', payment_method: 'cod', order_status: 'confirmed', created_at: recent },
      { order_number: 'P-1', total_amount: 300, payment_status: 'pending', payment_method: 'razorpay', order_status: 'confirmed', created_at: recent },
      { order_number: 'X-1', total_amount: 300, payment_status: 'paid', payment_method: 'razorpay', order_status: 'cancelled', created_at: recent },
      { order_number: 'O-1', total_amount: 300, payment_status: 'paid', payment_method: 'razorpay', order_status: 'confirmed', created_at: old },
    ])
    const out = await verifyPurchaseRows([ev('C-1'), ev('P-1'), ev('X-1'), ev('O-1'), ev('NOPE-9'), ev('bad,ref)'), ev(42)])
    expect(out.map(r => (r.metadata as { order_id: string }).order_id)).toEqual(['C-1'])
  })
  it('drops purchase rows (but keeps the rest) when the order lookup fails', async () => {
    sbAdmin.mockImplementation(async () => { throw new Error('db down') })
    const out = await verifyPurchaseRows([ev('PR-1'), { event_type: 'add_to_cart', metadata: null }])
    expect(out.map(r => r.event_type)).toEqual(['add_to_cart'])
  })
  it('does not query the database when the batch has no purchase', async () => {
    expect(await verifyPurchaseRows([{ event_type: 'page_view', metadata: null }])).toHaveLength(1)
    expect(sbAdmin).not.toHaveBeenCalled()
  })
})
