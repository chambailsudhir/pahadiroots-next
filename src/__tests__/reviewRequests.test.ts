/** sendReviewRequests: eligibility, claim-before-send, settings, never throws. */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase', () => ({ supabase: {}, getServiceClient: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, captureError: vi.fn() }))
vi.mock('@/lib/server/email', () => ({ sendTransactionalEmail: (...a: unknown[]) => h.send(...a) }))

type Op = { table: string; ops: Array<[string, unknown[]]> }
let log: Op[]
let data: Record<string, unknown>
let claimWins: boolean
let claimErr: unknown

// Chainable + thenable stand-in for the supabase-js query builder.
function fakeDb() {
  return {
    from(table: string) {
      const rec: Op = { table, ops: [] }
      log.push(rec)
      const chain: Record<string, unknown> = {}
      for (const name of ['select', 'eq', 'in', 'gte', 'lte', 'not', 'order', 'range', 'upsert', 'delete']) {
        chain[name] = (...args: unknown[]) => { rec.ops.push([name, args]); return chain }
      }
      chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
        const isClaim = table === 'review_requests' && rec.ops.some(([n]) => n === 'upsert')
        const isDelete = rec.ops.some(([n]) => n === 'delete')
        let out: unknown
        if (isClaim) out = claimErr ? { data: null, error: claimErr } : { data: claimWins ? [{ order_id: 1 }] : [], error: null }
        else if (isDelete) out = { data: null, error: null }
        else out = { data: data[table] ?? [], error: null }
        return Promise.resolve(out).then(res, rej)
      }
      return chain
    },
  } as never
}

const NOW = new Date('2026-11-20T00:00:00Z')
const order = { id: 1, order_number: 'ORD-1', customer_id: 42, delivered_at: '2026-11-05T00:00:00Z' }
const customer = { id: 42, first_name: 'Priya', email: 'p@x.com', auth_user_id: 'u1', notif_email_orders: true }

beforeEach(() => {
  log = []; claimWins = true; claimErr = null
  h.send.mockReset(); h.send.mockResolvedValue({ sent: true })
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://shop.test')
  data = {
    site_settings: [],
    orders: [order],
    customers: [customer],
    review_requests: [],
    order_items: [{ product_id: 11, product_name_snapshot: 'Honey <b>' }, { product_id: 12, product_name_snapshot: 'Ghee' }],
    reviews: [],
  }
})

const run = async (opts = {}) => (await import('@/lib/server/reviewRequests')).sendReviewRequests(fakeDb(), { now: NOW, ...opts })

describe('sendReviewRequests', () => {
  it('claims the order, then sends one branded review_request e-mail with the review link', async () => {
    const stats = await run()
    expect(stats).toMatchObject({ enabled: true, sent: 1, errors: 0 })
    expect(h.send).toHaveBeenCalledTimes(1)
    const arg = h.send.mock.calls[0][0]
    expect(arg).toMatchObject({ type: 'review_request', to: 'p@x.com', subject: 'How was your order ORD-1?' })
    expect(arg.html).toContain('https://shop.test/account/orders/1/review')
    expect(arg.html).toContain('Honey &lt;b&gt;')           // names are escaped
    // claim happened before the send
    const claimIdx = log.findIndex(o => o.table === 'review_requests' && o.ops.some(([n]) => n === 'upsert'))
    expect(claimIdx).toBeGreaterThanOrEqual(0)
    const upsert = log[claimIdx].ops.find(([n]) => n === 'upsert')![1]
    expect(upsert[1]).toMatchObject({ onConflict: 'order_id', ignoreDuplicates: true })
  })

  it('queries delivered orders inside the [now-60d, now-7d] window', async () => {
    await run()
    const q = log.find(o => o.table === 'orders')!.ops
    const get = (n: string) => q.filter(([x]) => x === n).map(([, a]) => a)
    expect(get('eq')).toContainEqual(['order_status', 'delivered'])
    expect(get('gte')[0]).toEqual(['delivered_at', '2026-09-21T00:00:00.000Z'])
    expect(get('lte')[0]).toEqual(['delivered_at', '2026-11-13T00:00:00.000Z'])
  })

  it('does nothing when review_request_enabled is false', async () => {
    data.site_settings = [{ key: 'review_request_enabled', value: 'false' }]
    const stats = await run()
    expect(stats.enabled).toBe(false)
    expect(h.send).not.toHaveBeenCalled()
    expect(log.some(o => o.table === 'orders')).toBe(false)
  })

  it('uses review_request_days from settings (default 7, junk -> 7)', async () => {
    data.site_settings = [{ key: 'review_request_days', value: '3' }]
    await run()
    expect(log.find(o => o.table === 'orders')!.ops.find(([n]) => n === 'lte')![1]).toEqual(['delivered_at', '2026-11-17T00:00:00.000Z'])
    log = []; data.site_settings = [{ key: 'review_request_days', value: 'abc' }]
    await run()
    expect(log.find(o => o.table === 'orders')!.ops.find(([n]) => n === 'lte')![1]).toEqual(['delivered_at', '2026-11-13T00:00:00.000Z'])
  })

  it.each([
    ['guest (no auth user)', { ...customer, auth_user_id: null }],
    ['no e-mail', { ...customer, email: null }],
    ['order e-mails switched off', { ...customer, notif_email_orders: false }],
  ])('skips %s without claiming', async (_n, c) => {
    data.customers = [c]
    const stats = await run()
    expect(stats.sent).toBe(0)
    expect(h.send).not.toHaveBeenCalled()
    expect(log.some(o => o.ops.some(([n]) => n === 'upsert'))).toBe(false)
  })

  it('skips an order already claimed, and one whose items are all reviewed', async () => {
    data.review_requests = [{ order_id: 1 }]
    expect((await run()).sent).toBe(0)
    data.review_requests = []; data.reviews = [{ product_id: 11 }, { product_id: 12 }]
    expect((await run()).sent).toBe(0)
    expect(h.send).not.toHaveBeenCalled()
  })

  it('a lost claim (another run won) sends nothing', async () => {
    claimWins = false
    expect((await run()).sent).toBe(0)
    expect(h.send).not.toHaveBeenCalled()
  })

  it('releases the claim when the send fails with no retry queued, keeps it when dead-lettered', async () => {
    h.send.mockResolvedValue({ sent: false, error: 'x' })
    let stats = await run()
    expect(stats).toMatchObject({ sent: 0, errors: 1 })
    expect(log.some(o => o.table === 'review_requests' && o.ops.some(([n]) => n === 'delete'))).toBe(true)
    log = []
    h.send.mockResolvedValue({ sent: false, deadLettered: true })
    stats = await run()
    expect(stats.sent).toBe(1)
    expect(log.some(o => o.ops.some(([n]) => n === 'delete'))).toBe(false)
  })

  it('respects the batch limit', async () => {
    data.orders = [1, 2, 3].map(i => ({ ...order, id: i, order_number: 'ORD-' + i }))
    expect((await run({ limit: 2 })).sent).toBe(2)
    expect(h.send).toHaveBeenCalledTimes(2)
  })

  it('never throws: a failing claim table (migration missing) is counted as an error', async () => {
    claimErr = { message: 'relation "review_requests" does not exist' }
    const stats = await run()
    expect(stats.errors).toBe(1)
    expect(h.send).not.toHaveBeenCalled()
    const broken = { from: () => { throw new Error('db down') } } as never
    const { sendReviewRequests } = await import('@/lib/server/reviewRequests')
    await expect(sendReviewRequests(broken, { now: NOW })).resolves.toMatchObject({ errors: 1, sent: 0 })
  })
})
