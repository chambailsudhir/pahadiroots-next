/**
 * orderSuccess.test.ts
 *
 * Covers two confirmed, real, pre-existing production bugs found via
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
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
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
})
