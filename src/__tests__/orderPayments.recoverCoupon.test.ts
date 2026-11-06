/**
 * Verification L-2 (Nov 2026): a payment that lands AFTER the expiry sweep released the order used to re-reserve the stock but
 * leave the released coupon released — the order stayed confirmed with its discount while the code was free to be used again.
 * confirmOrderPayment() now re-claims the coupon recorded on the `pending_order_expired` event and attaches it to the order.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))
const h = vi.hoisted(() => ({ logEvent: vi.fn().mockResolvedValue(undefined), captureError: vi.fn(), reserve: vi.fn().mockResolvedValue({ ok: true }) }))
vi.mock('@/lib/services/orderService', () => ({ logOrderEvent: h.logEvent }))
vi.mock('@/lib/services/inventoryService', () => ({ reserveStockAtomicForOrder: h.reserve, orderItemsToStockItems: (i: unknown) => i }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, captureError: h.captureError }))
vi.mock('@/lib/server/loyalty', () => ({ redeemLoyaltyPoints: vi.fn() }))
vi.mock('@/lib/server/email', () => ({ sendTransactionalEmail: vi.fn() }))
vi.mock('@/lib/server/adminOrderEmail', () => ({ loadAdminOrderEmail: vi.fn() }))

type Call = { table: string; op: string; payload?: unknown; filters: Array<[string, unknown]> }
function makeDb(opts: { expiredEvent?: unknown; claim?: unknown; claimError?: { message: string } | null; attachError?: { message: string } | null }) {
  const calls: Call[] = []
  const rpc = vi.fn(async (name: string, args: unknown) => {
    calls.push({ table: 'rpc:' + name, op: 'rpc', payload: args, filters: [] })
    return { data: opts.claim ?? { ok: true, usage_id: 99 }, error: opts.claimError ?? null }
  })
  const from = (table: string) => {
    const c: Call = { table, op: 'select', filters: [] }
    calls.push(c)
    const b: Record<string, unknown> = {}
    const chain = () => b
    b.select = (cols: string) => { c.payload = cols; return b }
    b.update = (p: unknown) => { c.op = 'update'; c.payload = p; return b }
    b.eq = (k: string, v: unknown) => { c.filters.push([k, v]); return b }
    b.limit = chain; b.in = chain
    b.single = async () => {
      if (table === 'orders') return { data: { id: 'o1', order_status: 'payment_failed', payment_status: 'failed' }, error: null }
      return { data: null, error: null }
    }
    b.then = (res: (v: unknown) => unknown) => {
      let data: unknown = []
      let error: unknown = null
      if (table === 'orders' && c.op === 'update') data = [{ id: 'o1' }]
      if (table === 'order_items') data = [{ product_id: '1', variant_id: '11', quantity: 1 }]
      if (table === 'order_events') data = opts.expiredEvent === undefined ? [] : [{ metadata: { coupon_released: opts.expiredEvent } }]
      if (table === 'coupon_usage' && c.op === 'update') error = opts.attachError ?? null
      return Promise.resolve(res({ data, error }))
    }
    return b
  }
  return { db: { from, rpc } as never, calls, rpc }
}

beforeEach(() => { vi.clearAllMocks() })

describe('confirmOrderPayment — late payment after the sweep released the order', () => {
  it('re-claims the released coupon through claim_coupon_use and attaches it to the order', async () => {
    const { confirmOrderPayment } = await import('@/lib/server/orderPayments')
    const { db, calls, rpc } = makeDb({ expiredEvent: { coupon_id: 7, customer_id: 3, discount_amount: 50 } })
    const out = await confirmOrderPayment(db, { orderId: 'o1', razorpayPaymentId: 'pay_late', source: 'webhook' })
    expect(out).toMatchObject({ outcome: 'recovered', stockReReserved: true })
    expect(rpc).toHaveBeenCalledWith('claim_coupon_use', { p_coupon_id: 7, p_customer_id: 3, p_identity_key: null })
    const attach = calls.find(c => c.table === 'coupon_usage' && c.op === 'update')
    expect(attach?.payload).toEqual({ order_id: 'o1', discount_amount: 50 })
    expect(attach?.filters).toContainEqual(['id', 99])
    expect(h.logEvent).toHaveBeenCalledWith('o1', 'payment_recovered_after_failure', 'razorpay', expect.objectContaining({ coupon_reclaim: 'reclaimed' }))
    expect(h.captureError).not.toHaveBeenCalled()
  })

  it('a guest order (no customer id) is re-claimed with a NULL customer', async () => {
    const { confirmOrderPayment } = await import('@/lib/server/orderPayments')
    const { db, rpc } = makeDb({ expiredEvent: { coupon_id: '7', customer_id: null, discount_amount: 50 } })
    await confirmOrderPayment(db, { orderId: 'o1', razorpayPaymentId: 'pay_late', source: 'expiry_sweep' })
    expect(rpc).toHaveBeenCalledWith('claim_coupon_use', { p_coupon_id: 7, p_customer_id: null, p_identity_key: null })
  })

  it('a guest re-claim carries the identity key recorded at release, so the per-phone limit (v32) still applies', async () => {
    const { confirmOrderPayment } = await import('@/lib/server/orderPayments')
    const { db, rpc } = makeDb({ expiredEvent: { coupon_id: 7, customer_id: null, discount_amount: 50, identity_key: 'ph:abc', via: 'trigger' } })
    await confirmOrderPayment(db, { orderId: 'o1', razorpayPaymentId: 'pay_late', source: 'webhook' })
    expect(rpc).toHaveBeenCalledWith('claim_coupon_use', { p_coupon_id: 7, p_customer_id: null, p_identity_key: 'ph:abc' })
  })

  it('does nothing when the release recorded no coupon', async () => {
    const { confirmOrderPayment } = await import('@/lib/server/orderPayments')
    const { db, rpc } = makeDb({})
    await confirmOrderPayment(db, { orderId: 'o1', razorpayPaymentId: 'pay_late', source: 'webhook' })
    expect(rpc).not.toHaveBeenCalled()
    expect(h.logEvent).toHaveBeenCalledWith('o1', 'payment_recovered_after_failure', 'razorpay', expect.objectContaining({ coupon_reclaim: 'none' }))
  })

  it('a refused claim (cap reached meanwhile) keeps the order confirmed and alerts ops', async () => {
    const { confirmOrderPayment } = await import('@/lib/server/orderPayments')
    const { db } = makeDb({ expiredEvent: { coupon_id: 7, customer_id: 3, discount_amount: 50 }, claim: { ok: false, error: 'This coupon has reached its usage limit' } })
    const out = await confirmOrderPayment(db, { orderId: 'o1', razorpayPaymentId: 'pay_late', source: 'webhook' })
    expect(out).toMatchObject({ outcome: 'recovered' })
    expect(h.captureError).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'orderPayments.recover.coupon_refused', alert: true }))
    expect(h.logEvent).toHaveBeenCalledWith('o1', 'payment_recovered_after_failure', 'razorpay', expect.objectContaining({ coupon_reclaim: 'refused' }))
  })

  it('a database error during the re-claim never breaks the recovery', async () => {
    const { confirmOrderPayment } = await import('@/lib/server/orderPayments')
    const { db } = makeDb({ expiredEvent: { coupon_id: 7, customer_id: 3, discount_amount: 50 }, claimError: { message: 'rpc down' } })
    const out = await confirmOrderPayment(db, { orderId: 'o1', razorpayPaymentId: 'pay_late', source: 'webhook' })
    expect(out).toMatchObject({ outcome: 'recovered' })
    expect(h.captureError).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'orderPayments.recover.coupon_reclaim' }))
  })
})
