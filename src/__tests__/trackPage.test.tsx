/**
 * trackPage.test.tsx
 *
 * BUG FIX regression: track/page.tsx used to query the `orders` table
 * directly from the browser with the public anon Supabase client — see
 * /api/v1/orders/track/route.ts's header comment for why that's a real
 * infra gap (either silently broken for every real order because RLS has
 * no anon SELECT policy on `orders`, or a PII leak if it did). This covers
 * the fix: the page now calls the new rate-limited server route instead,
 * same shape of test as orderSuccess.test.ts (which caught the sibling bug
 * of a page silently calling a dead endpoint on every load).
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import React from 'react'

const fetchSpy = vi.fn()

beforeEach(() => {
  fetchSpy.mockReset()
  vi.stubGlobal('fetch', fetchSpy)
})

async function fillAndSubmit(orderNumber: string, phone: string) {
  const { default: TrackPage } = await import('@/app/track/page')
  render(React.createElement(TrackPage))

  fireEvent.change(screen.getByPlaceholderText('e.g. PR-2024-0001'), { target: { value: orderNumber } })
  fireEvent.change(screen.getByPlaceholderText('98765 43210'),        { target: { value: phone } })
  fireEvent.click(screen.getByText('Track Order'))
}

describe('track page — calls the real server endpoint, not Supabase directly', () => {
  it('never touches @/lib/supabase — calls /api/v1/orders/track instead', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        order: { order_number: 'PR1A2B3C4D', order_status: 'shipped', payment_method: 'cod', created_at: '2026-08-01T00:00:00Z', total_amount: 500 },
      }),
    })

    await fillAndSubmit('PR1A2B3C4D', '9876543210')

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    const [url] = fetchSpy.mock.calls[0]
    expect(String(url)).toContain('/api/v1/orders/track')
    expect(String(url)).toContain('order_number=PR1A2B3C4D')
    expect(String(url)).toContain('phone=9876543210')
  })

  it('renders the status stepper on a successful lookup', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        order: { order_number: 'PR1A2B3C4D', order_status: 'shipped', payment_method: 'cod', created_at: '2026-08-01T00:00:00Z', total_amount: 500 },
      }),
    })

    await fillAndSubmit('PR1A2B3C4D', '9876543210')

    await waitFor(() => expect(screen.getByText('PR1A2B3C4D')).toBeTruthy())
    expect(screen.getByText('Shipped').closest('div')).toBeTruthy()
    expect(screen.getByText('Cash on Delivery')).toBeTruthy()
  })

  it('shows the "order not found" message on a 404, not a blank/broken state', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: 'Order not found. Check your order number and phone number.' }),
    })

    await fillAndSubmit('BADORDER', '9876543210')

    await waitFor(() => expect(screen.getByText(/order not found/i)).toBeTruthy())
  })

  it('shows a friendly error and logs to console (not a silent failure) if the fetch itself throws', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchSpy.mockRejectedValue(new Error('network down'))

    await fillAndSubmit('PR1A2B3C4D', '9876543210')

    await waitFor(() => expect(screen.getByText(/something went wrong/i)).toBeTruthy())
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it('requires both fields before attempting a fetch', async () => {
    const { default: TrackPage } = await import('@/app/track/page')
    render(React.createElement(TrackPage))

    fireEvent.click(screen.getByText('Track Order'))

    expect(await screen.findByText(/enter both order number and phone/i)).toBeTruthy()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
