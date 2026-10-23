import { describe, it, expect, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/services/orderService', () => ({ logOrderEvent: vi.fn() }))
vi.mock('@/lib/services/inventoryService', () => ({ reserveStockAtomicForOrder: vi.fn(), orderItemsToStockItems: vi.fn() }))
vi.mock('@/lib/server/loyalty', () => ({ awardLoyaltyPoints: vi.fn(), redeemLoyaltyPoints: vi.fn() }))
vi.mock('@/lib/server/htmlEscape', () => ({ esc: (x: string) => x }))
vi.mock('@/lib/server/email', () => ({ sendTransactionalEmail: vi.fn() }))
vi.mock('@/lib/logger', () => ({ captureError: vi.fn(), logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import { recordCapturedPayment } from '@/lib/server/orderPayments'

function fakeDb(error: { message: string } | null) {
  const insert = vi.fn().mockReturnValue({ select: vi.fn().mockResolvedValue({ error }) })
  return { db: { from: vi.fn().mockReturnValue({ insert }) } as never, insert }
}
const args = { orderId: '143', razorpayPaymentId: 'pay_X', amountInr: 1400, alertAction: 'test' }

describe('recordCapturedPayment (money first rule: callers stop when this is false)', () => {
  it('returns true when the payment row is inserted', async () => {
    const { db, insert } = fakeDb(null)
    expect(await recordCapturedPayment(db, args)).toBe(true)
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ order_id: '143', amount: 1400, status: 'captured', payment_reference: 'pay_X' }))
  })
  it('returns true on a duplicate (already recorded, idempotent)', async () => {
    const { db } = fakeDb({ message: 'duplicate key value violates unique constraint' })
    expect(await recordCapturedPayment(db, args)).toBe(true)
  })
  it('returns false on any other database error so the order is NOT marked paid', async () => {
    const { db } = fakeDb({ message: 'connection reset' })
    expect(await recordCapturedPayment(db, args)).toBe(false)
  })
})
