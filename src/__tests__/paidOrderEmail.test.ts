// MAIL-001 (Nov 2026 audit): the payment-confirmation e-mail must quote the published delivery policy and only promise
// notifications the system really sends (e-mail — there is no WhatsApp sender), and must escape customer-controlled text.
import { describe, it, expect, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/services/orderService', () => ({ logOrderEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/services/inventoryService', () => ({ reserveStockAtomicForOrder: vi.fn(), orderItemsToStockItems: vi.fn() }))
vi.mock('@/lib/server/loyalty', () => ({ awardLoyaltyPoints: vi.fn().mockResolvedValue(undefined), redeemLoyaltyPoints: vi.fn().mockResolvedValue(true) }))
const send = vi.fn().mockResolvedValue({ sent: true })
vi.mock('@/lib/server/email', () => ({ sendTransactionalEmail: (...a: unknown[]) => send(...a) }))
vi.mock('@/lib/logger', () => ({ captureError: vi.fn(), logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import { runPaidSideEffects } from '@/lib/server/orderPayments'
import { DELIVERY_WINDOWS_TEXT, TRACKING_NOTIFICATION_TEXT } from '@/lib/shippingCopy'

function dbWithCustomer(first_name: string, email: string | null) {
  const single = vi.fn().mockResolvedValue({ data: { first_name, email }, error: null })
  const chain = { select: () => chain, eq: () => chain, single }
  return { from: () => chain } as never
}

async function sentHtml(customer: { first_name: string; email: string | null }) {
  send.mockClear()
  const deferred: Array<() => Promise<void>> = []
  await runPaidSideEffects(dbWithCustomer(customer.first_name, customer.email), {
    order: { id: '9', order_number: 'ORD-2026-00200', total_amount: 650, customer_id: 'c1', loyalty_points_redeemed: 0 },
    razorpayOrderId: 'order_X', razorpayPaymentId: 'pay_X', settings: { loyalty_enabled: 'false' },
    defer: fn => { deferred.push(fn) },
  })
  for (const fn of deferred) await fn()
  return send.mock.calls[0]?.[0] as { html: string; to: string; subject: string } | undefined
}

describe('payment confirmation e-mail', () => {
  it('quotes the policy delivery windows and the real notification channel, and makes no WhatsApp promise', async () => {
    const mail = await sentHtml({ first_name: 'Asha', email: 'asha@example.org' })
    expect(mail).toBeDefined()
    expect(mail!.html).toContain(DELIVERY_WINDOWS_TEXT.replace(/&/g, '&amp;'))
    expect(mail!.html).toContain(TRACKING_NOTIFICATION_TEXT)
    expect(mail!.html).not.toMatch(/WhatsApp you/i)
    expect(mail!.html).not.toMatch(/3–5 business days<\/p>/)   // the old flat promise
    expect(mail!.subject).toContain('ORD-2026-00200')
  })
  it('escapes a hostile first name', async () => {
    const mail = await sentHtml({ first_name: '<img src=x onerror=alert(1)>', email: 'a@example.org' })
    expect(mail!.html).not.toContain('<img src=x')
    expect(mail!.html).toContain('&lt;img')
  })
  it('a customer with no e-mail address is not e-mailed (and nothing throws)', async () => {
    expect(await sentHtml({ first_name: 'Ravi', email: null })).toBeUndefined()
  })
})

describe('payment confirmation e-mail — recipient', () => {
  async function run(row: Record<string, unknown>) {
    send.mockClear()
    const single = vi.fn().mockResolvedValue({ data: row, error: null })
    const chain = { select: () => chain, eq: () => chain, single }
    const deferred: Array<() => Promise<void>> = []
    await runPaidSideEffects({ from: () => chain } as never, {
      order: { id: '9', order_number: 'ORD-2026-00201', total_amount: 350, customer_id: 'c1', loyalty_points_redeemed: 0 },
      razorpayOrderId: 'order_X', razorpayPaymentId: 'pay_X', settings: { loyalty_enabled: 'true', loyalty_points_per_rupee: '0.01' },
      defer: fn => { deferred.push(fn) },
    })
    for (const fn of deferred) await fn()
    return send.mock.calls[0]?.[0] as { html: string; to: string } | undefined
  }

  it('a guest whose e-mail collided with an account (customers.email NULL) still gets the e-mail, at the address typed on the order', async () => {
    const mail = await run({ first_name: 'T', email: null, auth_user_id: null, shipping_address: { name: 'T', email: 'typed@example.org', state: 'Himachal Pradesh' }, order_items: [] })
    expect(mail?.to).toBe('typed@example.org')
    expect(mail!.html).not.toContain('Pahadi Coins')       // guest: no coins promise
  })

  it('an account holder gets the coins line (account = auth_user_id; there is no is_guest column)', async () => {
    const mail = await run({ first_name: 'A', email: 'a@example.org', auth_user_id: 'u-1', shipping_address: { state: 'Himachal Pradesh' }, order_items: [] })
    expect(mail?.to).toBe('a@example.org')
    expect(mail!.html).toContain('You earned 3 Pahadi Coins')
  })
})

describe('online-paid order — owner notification', () => {
  it('the shop owner is e-mailed about a paid order too (ADMIN_EMAIL fallback)', async () => {
    vi.stubEnv('ADMIN_EMAIL', 'owner@shop.test')
    send.mockClear()
    const single = vi.fn().mockResolvedValue({ data: { first_name: 'A', email: 'a@example.org', auth_user_id: null, shipping_address: { state: 'Himachal Pradesh' }, order_items: [] }, error: null })
    const chain = { select: () => chain, eq: () => chain, single }
    const deferred: Array<() => Promise<void>> = []
    await runPaidSideEffects({ from: () => chain } as never, {
      order: { id: '9', order_number: 'ORD-2026-00300', total_amount: 350, customer_id: 'c1', loyalty_points_redeemed: 0 },
      razorpayOrderId: 'order_X', razorpayPaymentId: 'pay_X', settings: { loyalty_enabled: 'false' },
      defer: fn => { deferred.push(fn) },
    })
    for (const fn of deferred) await fn()
    const toOwner = send.mock.calls.map(c => c[0]).find((m: { type: string }) => m.type === 'admin_order_notify') as { to: string; subject: string } | undefined
    expect(toOwner?.to).toBe('owner@shop.test')
    expect(toOwner?.subject).toContain('ORD-2026-00300')
    vi.unstubAllEnvs()
  })
})
