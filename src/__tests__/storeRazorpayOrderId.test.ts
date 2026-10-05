/**
 * storeRazorpayOrderId — create_payment must never hand a customer a payable Razorpay order
 * that our database failed to link (Oct 2026 audit). See lib/server/orderPayments.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))
const h = vi.hoisted(() => ({ captureError: vi.fn() }))
vi.mock('@/lib/logger', () => ({ captureError: h.captureError, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/services/orderService', () => ({ logOrderEvent: vi.fn() }))
vi.mock('@/lib/services/inventoryService', () => ({ reserveStockAtomicForOrder: vi.fn(), orderItemsToStockItems: vi.fn() }))
vi.mock('@/lib/server/loyalty', () => ({ awardLoyaltyPoints: vi.fn(), redeemLoyaltyPoints: vi.fn() }))
vi.mock('@/lib/server/email', () => ({ sendTransactionalEmail: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ getServiceClient: vi.fn(), supabase: {} }))

import { storeRazorpayOrderId } from '@/lib/server/orderPayments'

/** Fake db whose successive update() results come from `results` (an Error = returned `{ error }`, 'throw' = rejects). */
function fakeDb(results: Array<null | Error | 'throw'>) {
  const updates: Array<{ payload: unknown; id: unknown }> = []
  let i = 0
  const db = {
    from: (_t: string) => ({
      update: (payload: unknown) => ({
        eq: (_c: string, id: unknown) => {
          updates.push({ payload, id })
          const r = results[Math.min(i++, results.length - 1)]
          if (r === 'throw') return Promise.reject(new Error('network down'))
          return Promise.resolve({ error: r ? { message: r.message } : null })
        },
      }),
    }),
  } as any
  return { db, updates }
}

beforeEach(() => h.captureError.mockClear())

describe('storeRazorpayOrderId', () => {
  it('writes payment_id on the order and returns', async () => {
    const { db, updates } = fakeDb([null])
    await expect(storeRazorpayOrderId(db, '42', 'order_ABC')).resolves.toBeUndefined()
    expect(updates).toEqual([{ payload: { payment_id: 'order_ABC' }, id: '42' }])
    expect(h.captureError).not.toHaveBeenCalled()
  })

  it('a transient failure is retried once and then succeeds', async () => {
    const { db, updates } = fakeDb([new Error('timeout'), null])
    await expect(storeRazorpayOrderId(db, '42', 'order_ABC')).resolves.toBeUndefined()
    expect(updates).toHaveLength(2)
    expect(h.captureError).not.toHaveBeenCalled()
  })

  it('a thrown network error is also retried', async () => {
    const { db, updates } = fakeDb(['throw', null])
    await expect(storeRazorpayOrderId(db, '42', 'order_ABC')).resolves.toBeUndefined()
    expect(updates).toHaveLength(2)
  })

  it('FAILS CLOSED after two failures: alerts ops and throws so the customer is never given a payable order', async () => {
    const { db, updates } = fakeDb([new Error('db write failed')])
    await expect(storeRazorpayOrderId(db, '42', 'order_ABC')).rejects.toThrow(/could not start your payment/i)
    expect(updates).toHaveLength(2)
    expect(h.captureError).toHaveBeenCalledTimes(1)
    expect(h.captureError.mock.calls[0][1]).toMatchObject({ action: 'payments.create.store_payment_id', order_id: '42', razorpay_order_id: 'order_ABC', alert: true })
  })

  it('the thrown message avoids the keywords the route shows to customers (so it renders as the generic payment error)', async () => {
    const { db } = fakeDb([new Error('x')])
    const err = (await storeRazorpayOrderId(db, '1', 'order_X').then(() => null, e => e)) as Error
    expect(String(err.message).toLowerCase()).not.toMatch(/stock|coupon|already in progress|no longer available|multiple options|invalid cart item|loyalty|cod is/)
  })
})
