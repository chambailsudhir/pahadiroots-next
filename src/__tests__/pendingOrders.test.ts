/**
 * I1 — pending-order expiry sweep.
 * Abandoned online payments used to hold stock forever. The sweep must:
 *   - release + restore stock only when Razorpay confirms nothing was paid
 *   - confirm (not release) an order that WAS paid but whose webhook/callback was lost
 *   - never release when Razorpay can't be asked, or a payment is in flight
 *   - restore stock exactly once (single-winner transition)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  fetchOrderPayments: vi.fn(),
  restoreReporting:   vi.fn(),
  logEvent:           vi.fn(),
  confirm:            vi.fn(),
  recordPayment:      vi.fn(),
  sideEffects:        vi.fn(),
  captureError:       vi.fn(),
  couponRpc:          vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase', () => ({ supabase: {}, getServiceClient: vi.fn() }))
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  captureError: (...a: unknown[]) => h.captureError(...a),
}))
vi.mock('@/lib/getSiteSettings', () => ({ getFreshSiteSettings: vi.fn().mockResolvedValue({}) }))
vi.mock('@/lib/services/orderService', () => ({ logOrderEvent: (...a: unknown[]) => h.logEvent(...a) }))
vi.mock('@/lib/services/inventoryService', async (orig) => {
  const actual = await orig<typeof import('@/lib/services/inventoryService')>()
  return { ...actual, restoreStockReporting: (...a: unknown[]) => h.restoreReporting(...a) }
})
vi.mock('@/lib/server/razorpay', async (orig) => {
  const actual = await orig<typeof import('@/lib/server/razorpay')>()
  return { ...actual, fetchRazorpayOrderPayments: (...a: unknown[]) => h.fetchOrderPayments(...a) }
})
vi.mock('@/lib/server/orderPayments', () => ({
  confirmOrderPayment:   (...a: unknown[]) => h.confirm(...a),
  recordCapturedPayment: (...a: unknown[]) => h.recordPayment(...a),
  runPaidSideEffects:    (...a: unknown[]) => h.sideEffects(...a),
}))

import { expireStalePendingOrders, resolveExpiryMinutes } from '@/lib/server/pendingOrders'

const NOW = new Date('2026-10-04T12:00:00Z')
const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString()

interface Cfg {
  candidates: Array<Record<string, unknown>>
  /** When set, successive candidate SELECTs return successive pages (for paging tests). */
  pages?: Array<Array<Record<string, unknown>>>
  releaseRows?: Array<{ id: string }> | Error   // result of the conditional release UPDATE
  items?: Array<Record<string, unknown>>
}
function makeDb(cfg: Cfg) {
  let selectCalls = 0
  const log: Array<{ table: string; op: string; payload?: unknown; filters: Array<[string, unknown]> }> = []
  const db = {
    from(table: string) {
      const st = { table, op: 'select', payload: undefined as unknown, filters: [] as Array<[string, unknown]> }
      const b: any = {
        select: () => b,
        update: (p: unknown) => { st.op = 'update'; st.payload = p; return b },
        eq:  (k: string, v: unknown) => { st.filters.push([k, v]); return b },
        lt:  (k: string, v: unknown) => { st.filters.push([`${k}<`, v]); return b },
        gt:  (k: string, v: unknown) => { st.filters.push([`${k}>`, v]); return b },
        order: () => b,
        limit: () => b,
        then: (res: (v: unknown) => unknown) => {
          log.push({ ...st })
          if (table === 'orders' && st.op === 'select') {
            const data = cfg.pages ? (cfg.pages[selectCalls] ?? []) : cfg.candidates
            selectCalls++
            return Promise.resolve({ data, error: null }).then(res)
          }
          if (table === 'orders' && st.op === 'update') {
            if (cfg.releaseRows instanceof Error) return Promise.resolve({ data: null, error: { message: cfg.releaseRows.message } }).then(res)
            return Promise.resolve({ data: cfg.releaseRows ?? [{ id: 'x' }], error: null }).then(res)
          }
          if (table === 'order_items') return Promise.resolve({ data: cfg.items ?? [], error: null }).then(res)
          return Promise.resolve({ data: null, error: null }).then(res)
        },
      }
      return b
    },
  }
  ;(db as any).rpc = (name: string, args: unknown) => h.couponRpc(name, args)
  return { db: db as any, log }
}

const order = (over: Record<string, unknown> = {}) => ({
  id: 'o1', order_number: 'PR1', payment_id: 'order_rzp_1', total_amount: 500,
  customer_id: 'c1', loyalty_points_redeemed: 0, created_at: minsAgo(60), ...over,
})
const rzpPay = (over: Record<string, unknown> = {}) => ({
  id: 'pay_1', order_id: 'order_rzp_1', amount: 50000, currency: 'INR', status: 'failed', ...over,
})
const releaseUpdates = (log: ReturnType<typeof makeDb>['log']) => log.filter(l => l.table === 'orders' && l.op === 'update')

beforeEach(() => {
  Object.values(h).forEach(m => m.mockReset())
  h.restoreReporting.mockResolvedValue({ failed: [] })
  h.logEvent.mockResolvedValue(undefined)
  h.recordPayment.mockResolvedValue(undefined)
  h.sideEffects.mockResolvedValue(undefined)
  h.confirm.mockResolvedValue({ outcome: 'confirmed' })
  h.couponRpc.mockResolvedValue({ data: { released: false }, error: null })
})

describe('resolveExpiryMinutes', () => {
  it('defaults to 30, clamps to [20, 1440], ignores junk', () => {
    expect(resolveExpiryMinutes(undefined)).toBe(30)
    expect(resolveExpiryMinutes('abc')).toBe(30)
    expect(resolveExpiryMinutes('5')).toBe(20)
    expect(resolveExpiryMinutes('999999')).toBe(1440)
    expect(resolveExpiryMinutes('45')).toBe(45)
  })
})

describe('expireStalePendingOrders — selection', () => {
  it('only selects unpaid razorpay orders older than the cutoff', async () => {
    const { db, log } = makeDb({ candidates: [] })
    await expireStalePendingOrders(db, { now: NOW, olderThanMinutes: 30 })
    const sel = log[0]
    expect(sel.filters).toContainEqual(['payment_method', 'razorpay'])
    expect(sel.filters).toContainEqual(['payment_status', 'pending'])
    expect(sel.filters).toContainEqual(['order_status', 'pending'])
    expect(sel.filters).toContainEqual(['created_at<', minsAgo(30)])
  })
})

describe('expireStalePendingOrders — release', () => {
  it('nothing paid at Razorpay → releases (conditional update) and restores stock once', async () => {
    h.fetchOrderPayments.mockResolvedValue([rzpPay({ status: 'failed' })])
    const { db, log } = makeDb({ candidates: [order()], items: [{ product_id: 'p1', variant_id: 'v1', quantity: 2 }] })

    const stats = await expireStalePendingOrders(db, { now: NOW, olderThanMinutes: 30 })

    expect(stats).toMatchObject({ scanned: 1, expired: 1, recovered: 0, skipped: 0, errors: 0 })
    const upd = releaseUpdates(log)
    expect(upd).toHaveLength(1)
    expect(upd[0].payload).toMatchObject({ order_status: 'payment_failed', payment_status: 'failed' })
    expect(upd[0].filters).toContainEqual(['order_status', 'pending'])     // single-winner guard
    expect(upd[0].filters).toContainEqual(['payment_status', 'pending'])
    expect(h.restoreReporting).toHaveBeenCalledTimes(1)
    expect(h.restoreReporting).toHaveBeenCalledWith([{ variantId: 'v1', productId: 'p1', qty: 2, kind: 'variant' }])
    expect(h.logEvent).toHaveBeenCalledWith('o1', 'pending_order_expired', 'system', expect.anything())
  })

  it('a stored row whose variant_id equals its product_id is still a REAL variant and is restored through the VARIANT path', async () => {
    // order_items.variant_id is NOT NULL with a foreign key to product_variants(id), so a stored
    // row can never be a bare product. Live example: product 1 (Manali Honey) owns variant 1.
    // Guessing "no variant" from the equal ids credited the PRODUCTS row and leaked the
    // variant's stock on every expiry.
    h.fetchOrderPayments.mockResolvedValue([])
    const { db } = makeDb({ candidates: [order()], items: [{ product_id: '1', variant_id: '1', quantity: 1 }] })
    await expireStalePendingOrders(db, { now: NOW, olderThanMinutes: 30 })
    expect(h.restoreReporting).toHaveBeenCalledWith([{ variantId: '1', productId: '1', qty: 1, kind: 'variant' }])
  })

  it('order with no Razorpay order id (create_payment died before Razorpay) → released without calling Razorpay', async () => {
    const { db } = makeDb({ candidates: [order({ payment_id: null })], items: [{ product_id: 'p1', variant_id: 'v1', quantity: 1 }] })
    const stats = await expireStalePendingOrders(db, { now: NOW, olderThanMinutes: 30 })
    expect(h.fetchOrderPayments).not.toHaveBeenCalled()
    expect(stats.expired).toBe(1)
    expect(h.restoreReporting).toHaveBeenCalledTimes(1)
  })

  it('lost the race (conditional UPDATE matches 0 rows) → NO stock restore', async () => {
    h.fetchOrderPayments.mockResolvedValue([])
    const { db } = makeDb({ candidates: [order()], releaseRows: [] })
    const stats = await expireStalePendingOrders(db, { now: NOW, olderThanMinutes: 30 })
    expect(stats).toMatchObject({ expired: 0, skipped: 1 })
    expect(h.restoreReporting).not.toHaveBeenCalled()
  })

  it('records how many items failed to restore', async () => {
    h.fetchOrderPayments.mockResolvedValue([])
    h.restoreReporting.mockResolvedValue({ failed: [{ variantId: 'v1', qty: 1 }] })
    const { db } = makeDb({ candidates: [order()], items: [{ product_id: 'p1', variant_id: 'v1', quantity: 1 }] })
    await expireStalePendingOrders(db, { now: NOW, olderThanMinutes: 30 })
    expect(h.logEvent).toHaveBeenCalledWith('o1', 'pending_order_expired', 'system', expect.objectContaining({ stock_restore_failed_items: 1 }))
  })
})

describe('expireStalePendingOrders — never releases a paid / possibly-paid order', () => {
  it('payment actually captured (webhook lost) → confirms, runs side effects, does NOT release or restore', async () => {
    h.fetchOrderPayments.mockResolvedValue([rzpPay({ status: 'captured' })])
    const { db, log } = makeDb({ candidates: [order()] })

    const stats = await expireStalePendingOrders(db, { now: NOW, olderThanMinutes: 30 })

    expect(stats).toMatchObject({ recovered: 1, expired: 0 })
    expect(h.confirm).toHaveBeenCalledWith(db, { orderId: 'o1', razorpayPaymentId: 'pay_1', source: 'expiry_sweep' })
    expect(h.recordPayment).toHaveBeenCalledTimes(1)
    expect(h.sideEffects).toHaveBeenCalledTimes(1)
    expect(releaseUpdates(log)).toHaveLength(0)
    expect(h.restoreReporting).not.toHaveBeenCalled()
  })

  it('captured but for the WRONG amount → not treated as paid (and not released if in doubt is impossible: it is released only because nothing valid was paid)', async () => {
    h.fetchOrderPayments.mockResolvedValue([rzpPay({ status: 'captured', amount: 100 })])
    const { db } = makeDb({ candidates: [order()], items: [] })
    await expireStalePendingOrders(db, { now: NOW, olderThanMinutes: 30 })
    expect(h.confirm).not.toHaveBeenCalled()
  })

  it('Razorpay unreachable → SKIPPED, never released', async () => {
    h.fetchOrderPayments.mockRejectedValue(new Error('network down'))
    const { db, log } = makeDb({ candidates: [order()] })
    const stats = await expireStalePendingOrders(db, { now: NOW, olderThanMinutes: 30 })
    expect(stats).toMatchObject({ skipped: 1, expired: 0, errors: 0 })
    expect(releaseUpdates(log)).toHaveLength(0)
    expect(h.restoreReporting).not.toHaveBeenCalled()
  })

  it('payment authorized (in flight) and order young → SKIPPED', async () => {
    h.fetchOrderPayments.mockResolvedValue([rzpPay({ status: 'authorized' })])
    const { db, log } = makeDb({ candidates: [order({ created_at: minsAgo(120) })] })
    const stats = await expireStalePendingOrders(db, { now: NOW, olderThanMinutes: 30 })
    expect(stats.skipped).toBe(1)
    expect(releaseUpdates(log)).toHaveLength(0)
  })

  it('payment authorized for > 24h (stuck) → released', async () => {
    h.fetchOrderPayments.mockResolvedValue([rzpPay({ status: 'authorized' })])
    const { db } = makeDb({ candidates: [order({ created_at: minsAgo(60 * 25) })], items: [{ product_id: 'p1', variant_id: 'v1', quantity: 1 }] })
    const stats = await expireStalePendingOrders(db, { now: NOW, olderThanMinutes: 30 })
    expect(stats.expired).toBe(1)
  })

  it('confirm reports an error → counted as error, order NOT released', async () => {
    h.fetchOrderPayments.mockResolvedValue([rzpPay({ status: 'captured' })])
    h.confirm.mockResolvedValue({ outcome: 'error', message: 'db down' })
    const { db, log } = makeDb({ candidates: [order()] })
    const stats = await expireStalePendingOrders(db, { now: NOW, olderThanMinutes: 30 })
    expect(stats.errors).toBe(1)
    expect(releaseUpdates(log)).toHaveLength(0)
  })

  it('one bad order does not stop the rest of the batch', async () => {
    h.fetchOrderPayments
      .mockResolvedValueOnce([rzpPay({ status: 'captured' })])
      .mockResolvedValueOnce([])
    h.confirm.mockRejectedValueOnce(new Error('boom'))
    const { db } = makeDb({
      candidates: [order({ id: 'o1' }), order({ id: 'o2', payment_id: 'order_rzp_2' })],
      items: [{ product_id: 'p1', variant_id: 'v1', quantity: 1 }],
    })
    const stats = await expireStalePendingOrders(db, { now: NOW, olderThanMinutes: 30 })
    expect(stats).toMatchObject({ scanned: 2, errors: 1, expired: 1 })
  })
})


describe('expireStalePendingOrders — coupon release (Oct 2026 audit)', () => {
  it('releases the coupon the unpaid order consumed, once, and records what was released on the event', async () => {
    h.fetchOrderPayments.mockResolvedValue([])
    const released = { released: true, coupon_id: 7, customer_id: 3, discount_amount: 50 }
    h.couponRpc.mockResolvedValue({ data: released, error: null })
    const { db } = makeDb({ candidates: [order()], items: [{ product_id: '1', variant_id: '11', quantity: 1 }] })

    await expireStalePendingOrders(db, { now: NOW, olderThanMinutes: 30 })

    expect(h.couponRpc).toHaveBeenCalledTimes(1)
    expect(h.couponRpc).toHaveBeenCalledWith('release_coupon_for_order', { p_order_id: 'o1' })
    expect(h.logEvent).toHaveBeenCalledWith('o1', 'pending_order_expired', 'system', expect.objectContaining({ coupon_released: released }))
  })

  it('a failing coupon release is NOT fatal: order still released, stats.expired counted, not paged as an error', async () => {
    h.fetchOrderPayments.mockResolvedValue([])
    h.couponRpc.mockResolvedValue({ data: null, error: { message: 'function does not exist' } })
    const { db } = makeDb({ candidates: [order()], items: [] })

    const stats = await expireStalePendingOrders(db, { now: NOW, olderThanMinutes: 30 })

    expect(stats).toMatchObject({ expired: 1, errors: 0 })
    expect(h.captureError).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'cron.expire_pending_orders.coupon_release', alert: false }))
  })

  it('does NOT release the coupon when the order turned out to be PAID (recovered) or lost the release race', async () => {
    h.fetchOrderPayments.mockResolvedValue([rzpPay({ status: 'captured' })])
    const { db } = makeDb({ candidates: [order()] })
    await expireStalePendingOrders(db, { now: NOW, olderThanMinutes: 30 })
    expect(h.couponRpc).not.toHaveBeenCalled()

    h.fetchOrderPayments.mockResolvedValue([])
    const lost = makeDb({ candidates: [order()], releaseRows: [] })   // someone else won the transition
    await expireStalePendingOrders(lost.db, { now: NOW, olderThanMinutes: 30 })
    expect(h.couponRpc).not.toHaveBeenCalled()
  })
})

describe('expireStalePendingOrders — paging and time budget (Oct 2026 audit)', () => {
  const o = (id: string, mins: number) => order({ id, order_number: id, created_at: minsAgo(mins) })

  it('keeps going past one page: with batch=2 and 5 stale orders all 5 are processed (was capped at one page)', async () => {
    h.fetchOrderPayments.mockResolvedValue([])
    const pages = [[o('a', 500), o('b', 400)], [o('c', 300), o('d', 200)], [o('e', 100)]]
    const { db, log } = makeDb({ candidates: [], pages, items: [] })

    const stats = await expireStalePendingOrders(db, { now: NOW, olderThanMinutes: 30, batch: 2 })

    expect(stats).toMatchObject({ scanned: 5, expired: 5, errors: 0 })
    expect(stats.timeBudgetHit).toBeUndefined()
    // pages 2 and 3 resume AFTER the last created_at of the previous page (keyset paging)
    const selects = log.filter(l => l.table === 'orders' && l.op === 'select')
    expect(selects).toHaveLength(3)
    expect(selects[0].filters.some(([k]) => k === 'created_at>')).toBe(false)
    expect(selects[1].filters).toContainEqual(['created_at>', minsAgo(400)])
    expect(selects[2].filters).toContainEqual(['created_at>', minsAgo(200)])
  })

  it('stops starting new orders when the time budget is spent and reports it (next run continues)', async () => {
    h.fetchOrderPayments.mockResolvedValue([])
    const { db } = makeDb({ candidates: [o('a', 500), o('b', 400)], items: [] })

    const stats = await expireStalePendingOrders(db, { now: NOW, olderThanMinutes: 30, timeBudgetMs: -1 })

    expect(stats.timeBudgetHit).toBe(true)
    expect(stats.scanned).toBe(0)
    expect(h.restoreReporting).not.toHaveBeenCalled()
  })

  it('a skipped order (payment in flight) is not fetched again within the same run', async () => {
    h.fetchOrderPayments.mockResolvedValue([rzpPay({ status: 'authorized' })])
    const pages = [[o('a', 100), o('b', 90)], []]
    const { db } = makeDb({ candidates: [], pages })
    const stats = await expireStalePendingOrders(db, { now: NOW, olderThanMinutes: 30, batch: 2 })
    expect(stats).toMatchObject({ scanned: 2, skipped: 2, expired: 0 })
  })
})
