/**
 * invoiceShippingName.test.ts
 *
 * Covers the "proper, Amazon/Myntra-style" fix requested after the
 * account-identity-overwrite bug: the account holder's own name/address
 * must never change just because they shipped one order to a friend's or
 * parent's address — but the invoice for THAT order should still be able
 * to show who the delivery was actually addressed to, separately from who
 * placed and is billed for the order.
 *
 * Two real bugs are covered here:
 *
 * 1. orders.shipping_address never stored a recipient name at all, so
 *    there was nowhere to record "this one was for Vivek" without abusing
 *    the customer's own profile fields (the original bug). Fixed by
 *    storing `name` in the shipping_address JSON snapshot at order-
 *    creation time (orderService.ts).
 *
 * 2. Independently, the invoice route read addr.addr / addr.pin, but
 *    orderService.ts actually writes address_line1 / pincode — a genuine
 *    key-name mismatch (those short keys belong to the UNRELATED
 *    saved_addresses entry shape used on the account page). Every invoice
 *    was silently missing its street address line and pincode — this is
 *    exactly what the live report showed ("New Delhi, Delhi" with no
 *    street address or pincode).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  sbAuth: vi.fn(), sbAdmin: vi.fn(), syncCustomerProfile: vi.fn(),
  getToken: vi.fn(), tryRefresh: vi.fn(), applyNewCookies: vi.fn(),
}))

vi.mock('@/lib/api/serverUtils', () => mocks)

function makeRequest(id: string) {
  return new NextRequest(`https://pahadiroots.com/api/orders/${id}/invoice`, {
    headers: { cookie: 'pr_session=faketoken' },
  })
}

async function callInvoice(id: string) {
  const { GET } = await import('@/app/api/orders/[id]/invoice/route')
  return GET(makeRequest(id), { params: Promise.resolve({ id }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getToken.mockReturnValue('faketoken')
  mocks.sbAuth.mockResolvedValue({ id: 'auth-sudhir', email: 'chambail.sudhir@gmail.com' })
  mocks.syncCustomerProfile.mockResolvedValue({
    id: 26, first_name: 'Sudhir', last_name: 'Chambail', phone: '9717255662',
  })
})

const ORDER_ITEMS = [{ quantity: 1, price_at_time: 200, product_name_snapshot: 'Kangra Tea', variant_value_snapshot: null }]

describe('GET /api/orders/[id]/invoice — shipping recipient name + address key fix', () => {
  it('"Billed To" always shows the ACCOUNT HOLDER\'S OWN name, never the delivery recipient\'s', async () => {
    mocks.sbAdmin.mockResolvedValueOnce([{
      id: 112, order_number: 'ORD-2026-00087', customer_id: 26, created_at: '2026-07-30T00:00:00Z',
      total_amount: 589, coupon_discount: 0, shipping_charge: 99, tax: 33.84,
      payment_method: 'cod', order_status: 'delivered',
      shipping_address: { name: 'Vivek', address_line1: 'Ajanara', city: 'Noida', state: 'Uttar Pradesh', pincode: '201301' },
      order_items: ORDER_ITEMS,
    }])

    const res  = await callInvoice('112')
    const html = await res.text()

    // The bug this must never regress to: "Billed To" showing "Vivek"
    // instead of the account holder.
    expect(html).toContain('<strong>Sudhir Chambail</strong>')
  })

  it('shows a separate "Ship To" line with the recipient name when it differs from the account holder', async () => {
    mocks.sbAdmin.mockResolvedValueOnce([{
      id: 112, order_number: 'ORD-2026-00087', customer_id: 26, created_at: '2026-07-30T00:00:00Z',
      total_amount: 589, coupon_discount: 0, shipping_charge: 99, tax: 33.84,
      payment_method: 'cod', order_status: 'delivered',
      shipping_address: { name: 'Vivek', address_line1: 'Ajanara', city: 'Noida', state: 'Uttar Pradesh', pincode: '201301' },
      order_items: ORDER_ITEMS,
    }])

    const res  = await callInvoice('112')
    const html = await res.text()

    expect(html).toContain('Ship To')
    expect(html).toContain('Vivek')
  })

  it('the street address line and pincode actually render (the key-mismatch fix) — not silently dropped', async () => {
    mocks.sbAdmin.mockResolvedValueOnce([{
      id: 112, order_number: 'ORD-2026-00087', customer_id: 26, created_at: '2026-07-30T00:00:00Z',
      total_amount: 589, coupon_discount: 0, shipping_charge: 99, tax: 33.84,
      payment_method: 'cod', order_status: 'delivered',
      shipping_address: { name: 'Sudhir', address_line1: 'C4/33 Acharya Niketan, Street-2 Mayur Vihar ph-1', city: 'New Delhi', state: 'Delhi', pincode: '110091' },
      order_items: ORDER_ITEMS,
    }])

    const res  = await callInvoice('112')
    const html = await res.text()

    expect(html).toContain('C4/33 Acharya Niketan, Street-2 Mayur Vihar ph-1')
    expect(html).toContain('110091')
  })

  it('does NOT show a redundant duplicate name when the order shipped to the account holder\'s own address', async () => {
    mocks.sbAdmin.mockResolvedValueOnce([{
      id: 111, order_number: 'ORD-2026-00086', customer_id: 26, created_at: '2026-07-30T00:00:00Z',
      total_amount: 500, coupon_discount: 0, shipping_charge: 0, tax: 0,
      payment_method: 'cod', order_status: 'delivered',
      shipping_address: { name: 'Sudhir Chambail', address_line1: 'C4/33 Acharya Niketan', city: 'New Delhi', state: 'Delhi', pincode: '110091' },
      order_items: ORDER_ITEMS,
    }])

    const res  = await callInvoice('111')
    const html = await res.text()

    // "Ship To" label without a redundant second name when it's the same person.
    const shipToMatch = html.match(/<strong>Ship To(: [^<]*)?<\/strong>/)
    expect(shipToMatch?.[1] ?? '').toBe('')
  })

  it('still renders correctly (no crash) for an old order with no shipping_address.name at all (pre-fix orders)', async () => {
    mocks.sbAdmin.mockResolvedValueOnce([{
      id: 50, order_number: 'ORD-2026-00030', customer_id: 26, created_at: '2026-05-01T00:00:00Z',
      total_amount: 300, coupon_discount: 0, shipping_charge: 0, tax: 0,
      payment_method: 'cod', order_status: 'delivered',
      shipping_address: { address_line1: 'Old Address', city: 'Delhi', state: 'Delhi', pincode: '110001' }, // no `name` key
      order_items: ORDER_ITEMS,
    }])

    const res  = await callInvoice('50')
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('Old Address')
  })
})
