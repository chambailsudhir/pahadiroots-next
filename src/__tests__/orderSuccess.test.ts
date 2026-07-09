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

  it('shows the order number from URL params without needing any fetch to succeed', async () => {
    const { default: OrderSuccessPage } = await import('@/app/order-success/page')
    render(React.createElement(OrderSuccessPage))

    await waitFor(() => {
      expect(screen.getByText(/PRMR4OEQ/)).toBeTruthy()
    })
  })

  it('footer links point to real routes, not the dead /our-story or /terms#section paths', async () => {
    const { default: OrderSuccessPage } = await import('@/app/order-success/page')
    render(React.createElement(OrderSuccessPage))

    await waitFor(() => {
      expect(screen.getByText('Our Story').closest('a')?.getAttribute('href')).toBe('/about')
    })
    expect(screen.getByText('Returns & Refunds').closest('a')?.getAttribute('href')).toBe('/policies/returns')
    expect(screen.getByText('Shipping Policy').closest('a')?.getAttribute('href')).toBe('/policies/shipping')
    expect(screen.getByText('Privacy Policy').closest('a')?.getAttribute('href')).toBe('/policies/privacy')
    expect(screen.getByText('Terms & Conditions').closest('a')?.getAttribute('href')).toBe('/policies/terms')

    // None of the old dead paths should appear anywhere on the page.
    const allHrefs = screen.getAllByRole('link').map(a => a.getAttribute('href'))
    expect(allHrefs.some(h => h === '/our-story')).toBe(false)
    expect(allHrefs.some(h => h?.startsWith('/terms'))).toBe(false)
  })

  it('clicking a rating star never calls the dead /api/admin-api endpoint, even when the order-details block is showing', async () => {
    // Mock a SUCCESSFUL lookup so `order` becomes non-null and the
    // order-details block (which contains the rating widget) actually
    // renders — this is the exact condition that made rateOrder's dead
    // call reachable in production once /api/v1/orders/lookup started
    // working.
    fetchSpy.mockImplementation((url: string) => {
      if (String(url).includes('/api/v1/orders/lookup')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            order: {
              order_number: 'PRMR4OEQ', order_status: 'confirmed', payment_status: 'cod_pending',
              payment_method: 'cod', total_amount: 262, items: [],
            },
          }),
        })
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`))
    })

    const { default: OrderSuccessPage } = await import('@/app/order-success/page')
    render(React.createElement(OrderSuccessPage))

    await waitFor(() => {
      // getAllByText, not getByText: the hidden (CSS display:none) invoice
      // block also renders the order number for printing — jsdom doesn't
      // evaluate CSS visibility, so both the visible hero and the
      // print-only invoice match this text query.
      expect(screen.getAllByText(/PRMR4OEQ/).length).toBeGreaterThan(0)
    })

    fetchSpy.mockClear() // only care about calls AFTER this point
    const stars = document.querySelectorAll('.oc-review-star')
    expect(stars.length).toBeGreaterThan(0) // sanity: widget actually rendered
    fireEvent.click(stars[3])

    const adminApiCalls = fetchSpy.mock.calls.filter(([url]) => String(url).includes('/api/admin-api'))
    expect(adminApiCalls).toHaveLength(0)
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
