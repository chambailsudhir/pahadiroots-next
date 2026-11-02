/**
 * orderSuccess.test.ts
 *
 * Covers three confirmed, real, pre-existing production bugs found via
 * browser console 404s on the live order-success page:
 *
 *   1. loadOrder() POSTed to /api/admin-api — the OLD vanilla-site's API
 *      path, never ported to this Next.js app (only POST /api/v1/orders
 *      for order *creation* exists; there's no lookup endpoint). This
 *      always 404'd, on every single order, meaning the "rich" order
 *      status UI never once rendered in production. Fixed by removing the
 *      dead fetch — the page now goes straight to its already-correct
 *      fallback state instead of wasting a request + 5s timeout on
 *      something guaranteed to fail.
 *   2. The footer's "Our Story" / "Terms" / "Returns" / "Shipping" /
 *      "Privacy" links pointed to /our-story and /terms#<section>, neither
 *      of which exist as routes in this app (confirmed: no other page in
 *      the codebase has this bug — the shared Footer.tsx already used the
 *      correct /policies/[type] paths; this standalone page's own
 *      hand-rolled footer just never got the same fix).
 *   3. rateOrder() (star-rating click handler) POSTed to the SAME dead
 *      /api/admin-api endpoint as loadOrder — but was never caught by the
 *      original loadOrder fix, because the rating widget only renders
 *      inside the order-details block, which requires `order` to be
 *      non-null. Before /api/v1/orders/lookup existed, `order` was ALWAYS
 *      null, so this code was unreachable dead code. Once the real lookup
 *      endpoint started working (this session), the widget became live —
 *      customers could click a star, see "thanks!", and have the rating
 *      silently discarded every time. Fixed by removing the dead fetch
 *      (see the file's own comment for why a real fix needs a new,
 *      properly-authorized endpoint, not a silent add-on here).
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import React from 'react'

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('id=PRMR4OEQ&method=cod&total=262'),
}))

const fetchSpy = vi.fn()

beforeEach(() => {
  fetchSpy.mockReset()
  vi.stubGlobal('fetch', fetchSpy)
})

describe('order-success page', () => {
  it('never calls the dead /api/admin-api endpoint', async () => {
    const { default: OrderSuccessPage } = await import('@/app/order-success/page')
    render(React.createElement(OrderSuccessPage))

    // Wait for the component's effects/state to settle.
    await waitFor(() => {
      expect(screen.getByText(/PRMR4OEQ/)).toBeTruthy()
    })

    const adminApiCalls = fetchSpy.mock.calls.filter(([url]) => String(url).includes('/api/admin-api'))
    expect(adminApiCalls).toHaveLength(0)
  })

  it('CF1: with no verified order it does NOT show the URL order number as a confirmation', async () => {
    // (previously: "shows the order number from URL params without needing any fetch to
    // succeed" — exactly the behaviour that let any URL render a confirmed order.)
    const { default: OrderSuccessPage } = await import('@/app/order-success/page')
    render(React.createElement(OrderSuccessPage))

    await waitFor(() => {
      expect(screen.getAllByText(/couldn.t verify this order/i).length).toBeGreaterThan(0)
    })
    expect(screen.queryByText(/Order Confirmed/i)).toBeNull()
  })

  it('does not render its own header/footer/main (the site layout provides them) — no duplicate chrome or nested <main>', async () => {
    const { default: OrderSuccessPage } = await import('@/app/order-success/page')
    const { container } = render(React.createElement(OrderSuccessPage))
    await waitFor(() => {
      expect(screen.getAllByText(/couldn.t verify this order/i).length).toBeGreaterThan(0)
    })
    expect(container.querySelector('nav.oc-nav')).toBeNull()
    expect(container.querySelector('footer')).toBeNull()
    expect(container.querySelector('main')).toBeNull()
    expect(container.querySelector('h1')?.textContent).toMatch(/couldn.t verify this order/i)
    // The unverified state points guests at Track Order.
    expect(screen.getByText('Track Order').closest('a')?.getAttribute('href')).toBe('/track')
  })

  it('has no fake rating widget (it saved nothing yet said "thanks"), and shows ETA/tracking/print only for a confirmed order', async () => {
    fetchSpy.mockImplementation((url: string) => {
      if (String(url).includes('/api/v1/orders/lookup')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, order: {
          order_number: 'PRMR4OEQ', order_status: 'cancelled', payment_status: 'refunded', payment_method: 'razorpay', total_amount: 262, items: [],
        } }) })
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`))
    })
    const { default: OrderSuccessPage } = await import('@/app/order-success/page')
    const { container } = render(React.createElement(OrderSuccessPage))
    await waitFor(() => { expect(screen.getAllByText(/PRMR4OEQ/).length).toBeGreaterThan(0) })
    expect(container.querySelector('.oc-review-star')).toBeNull()
    expect(screen.queryByText(/Print Invoice/)).toBeNull()
    expect(container.querySelector('.invoice-print-only')).toBeNull()
    expect(screen.queryByText(/Estimated Delivery/i)).toBeNull()
  })

  it('a refunded online order is NOT shown as "Confirming your payment…"', async () => {
    fetchSpy.mockImplementation((url: string) => String(url).includes('/api/v1/orders/lookup')
      ? Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, order: {
          order_number: 'PRMR4OEQ', order_status: 'returned', payment_status: 'refund_pending', payment_method: 'razorpay', total_amount: 262, items: [],
        } }) })
      : Promise.reject(new Error(`unexpected fetch: ${url}`)))
    const { default: OrderSuccessPage } = await import('@/app/order-success/page')
    render(React.createElement(OrderSuccessPage))
    await waitFor(() => { expect(screen.getByText(/Payment refunded/i)).toBeTruthy() })
    expect(screen.queryByText(/Confirming your payment/i)).toBeNull()
  })

  it('renders a real GST invoice (GSTIN, HSN, tax split) instead of just printing the confirmation page', async () => {
    fetchSpy.mockImplementation((url: string) => {
      if (String(url).includes('/api/v1/orders/lookup')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            order: {
              order_number: 'PRMR4OEQ', order_status: 'confirmed', payment_status: 'cod_pending',
              payment_method: 'cod', total_amount: 262, subtotal: 235, tax: 27,
              created_at: '2026-07-01T10:00:00Z',
              customer_name: 'Sudhir Chambail', state: 'Delhi', city: 'New Delhi',
              delivery_address: 'C4/33 Acharya Niketan', pincode: '110091',
              items: [
                { name: 'Himalayan Wild Honey', hsn_code: '0409', gst_rate: 5, qty: 1, price: 210 },
              ],
            },
          }),
        })
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`))
    })

    const { default: OrderSuccessPage } = await import('@/app/order-success/page')
    render(React.createElement(OrderSuccessPage))

    await waitFor(() => {
      expect(screen.getAllByText(/PRMR4OEQ/).length).toBeGreaterThan(0)
    })

    // Seller GSTIN present.
    expect(screen.getByText(/02AAWFC5939L1ZV/)).toBeTruthy()
    // HSN code for the actual item present.
    expect(screen.getByText('0409')).toBeTruthy()
    // Delhi ≠ Himachal Pradesh → inter-state → IGST label shown (table header
    // + totals row), not CGST/SGST.
    expect(screen.getAllByText('IGST').length).toBeGreaterThan(0)
    expect(screen.queryByText('CGST')).toBeNull()
  })
})
