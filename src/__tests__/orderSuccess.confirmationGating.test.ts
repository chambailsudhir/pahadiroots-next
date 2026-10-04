/**
 * CF1 / CF2 — the order-success page may only claim what the server verified.
 *
 *  CF1  /order-success?id=ANYTHING&total=99999 used to render "Order Confirmed!
 *       Total Paid: ₹99999" with no verification, and "Order placed!" when the
 *       lookup failed.
 *  CF2  trackPurchase / markCartConverted fired on mount for any URL with an id,
 *       before verification, and again on every refresh.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, act } from '@testing-library/react'
import React from 'react'

const h = vi.hoisted(() => ({ query: 'id=PRMR4OEQ&method=cod&total=99999&token=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }))
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(h.query),
}))
const trackPurchase      = vi.fn()
const markCartConverted  = vi.fn()
vi.mock('@/lib/analytics/track', () => ({
  trackPurchase:     (...a: unknown[]) => trackPurchase(...a),
  markCartConverted: (...a: unknown[]) => markCartConverted(...a),
}))

const fetchSpy = vi.fn()

function lookupReturns(order: Record<string, unknown> | null, status = 200) {
  fetchSpy.mockImplementation((url: string) => {
    if (String(url).includes('/api/v1/orders/lookup')) {
      return Promise.resolve({
        ok: status < 400, status,
        json: () => Promise.resolve(order ? { success: true, order } : { error: 'Order not found' }),
      })
    }
    return Promise.reject(new Error(`unexpected fetch: ${url}`))
  })
}

const codOrder = {
  order_number: 'PRMR4OEQ', order_status: 'confirmed', payment_status: 'cod_pending',
  payment_method: 'cod', total_amount: 262, items: [],
}

async function renderPage() {
  vi.resetModules() // fresh module → fresh in-memory purchase de-dupe set
  const { default: Page } = await import('@/app/order-success/page')
  return render(React.createElement(Page))
}

beforeEach(() => {
  h.query = 'id=PRMR4OEQ&method=cod&total=99999&token=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
  fetchSpy.mockReset(); trackPurchase.mockReset(); markCartConverted.mockReset()
  vi.stubGlobal('fetch', fetchSpy)
  window.localStorage.clear()
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('CF1 — confirmation is gated on a successful server lookup', () => {
  it('never shows "Order Confirmed" while the lookup is still loading', async () => {
    fetchSpy.mockReturnValue(new Promise(() => {})) // never resolves
    await renderPage()
    expect(screen.queryByText(/Order Confirmed/i)).toBeNull()
    expect(screen.getByText(/Confirming your order/i)).toBeTruthy()
  })

  it('lookup 404 (fake / unauthorised URL): no "Order Confirmed", no "Order placed!", and the URL total is NOT shown', async () => {
    lookupReturns(null, 404)
    await renderPage()
    await waitFor(() => expect(screen.getAllByText(/couldn.t verify this order/i).length).toBeGreaterThan(0))

    expect(screen.queryByText(/Order Confirmed/i)).toBeNull()
    expect(screen.queryByText(/Order placed!/i)).toBeNull()
    expect(document.body.textContent).not.toContain('99999')
    expect(document.body.textContent).not.toMatch(/Total Paid/i)
  })

  it('lookup network failure behaves the same (unverified, not "placed")', async () => {
    fetchSpy.mockRejectedValue(new Error('network down'))
    await renderPage()
    await waitFor(() => expect(screen.getAllByText(/couldn.t verify this order/i).length).toBeGreaterThan(0))
    expect(screen.queryByText(/Order Confirmed/i)).toBeNull()
  })

  it('no identifier at all → unverified', async () => {
    h.query = 'total=99999'
    await renderPage()
    await waitFor(() => expect(screen.getAllByText(/couldn.t verify this order/i).length).toBeGreaterThan(0))
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('a hostile id is never echoed into the page', async () => {
    h.query = 'id=' + encodeURIComponent('<img src=x onerror=alert(1)> ORDER CONFIRMED')
    lookupReturns(null, 404)
    await renderPage()
    await waitFor(() => expect(screen.getAllByText(/couldn.t verify this order/i).length).toBeGreaterThan(0))
    expect(document.body.innerHTML).not.toContain('onerror')
    expect(document.body.textContent).not.toContain('ORDER CONFIRMED')
  })

  it('verified COD order → "Order Confirmed!", total comes from the SERVER (not ?total=), labelled pay-on-delivery', async () => {
    lookupReturns(codOrder)
    await renderPage()
    await waitFor(() => expect(screen.getByText('Order Confirmed!')).toBeTruthy())

    expect(document.body.textContent).toContain('262')
    expect(document.body.textContent).not.toContain('99999')
    expect(screen.queryByText('Total Paid')).toBeNull()               // CF3: COD is not paid yet
    expect(screen.getByText(/pay on delivery/i)).toBeTruthy()
  })

  it('verified paid online order shows "Total Paid"', async () => {
    lookupReturns({ ...codOrder, payment_method: 'razorpay', payment_status: 'paid' })
    await renderPage()
    await waitFor(() => expect(screen.getByText('Order Confirmed!')).toBeTruthy())
    expect(screen.getAllByText('Total Paid').length).toBeGreaterThan(0)
  })

  it('payment_failed order is NOT presented as confirmed and shows no fulfilment stepper', async () => {
    lookupReturns({ ...codOrder, payment_method: 'razorpay', order_status: 'payment_failed', payment_status: 'failed' })
    await renderPage()
    await waitFor(() => expect(screen.getByText(/Payment not completed/i)).toBeTruthy())
    expect(screen.queryByText(/Order Confirmed/i)).toBeNull()
    expect(document.querySelector('.oc-stepper')).toBeNull()
  })

  it('cancelled order is NOT presented as confirmed', async () => {
    lookupReturns({ ...codOrder, order_status: 'cancelled' })
    await renderPage()
    await waitFor(() => expect(screen.getByText(/Order cancelled/i)).toBeTruthy())
    expect(screen.queryByText(/Order Confirmed/i)).toBeNull()
  })

  it('online order whose payment has not landed yet → "Confirming your payment", then flips to Confirmed by polling', async () => {
    vi.useFakeTimers()
    const pending   = { ...codOrder, payment_method: 'razorpay', order_status: 'pending', payment_status: 'pending' }
    const confirmed = { ...codOrder, payment_method: 'razorpay', order_status: 'confirmed', payment_status: 'paid' }
    let n = 0
    fetchSpy.mockImplementation(() => Promise.resolve({
      ok: true, status: 200,
      json: () => Promise.resolve({ success: true, order: n++ === 0 ? pending : confirmed }),
    }))

    await renderPage()
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })
    expect(screen.getByText(/Confirming your payment/i)).toBeTruthy()
    expect(screen.queryByText(/Order Confirmed/i)).toBeNull()
    expect(trackPurchase).not.toHaveBeenCalled()            // not a purchase yet

    await act(async () => { await vi.advanceTimersByTimeAsync(4100) })
    expect(screen.getByText('Order Confirmed!')).toBeTruthy()
    expect(trackPurchase).toHaveBeenCalledTimes(1)
  })

  it('polling is bounded — a payment that never lands stops polling after 8 attempts', async () => {
    vi.useFakeTimers()
    fetchSpy.mockImplementation(() => Promise.resolve({
      ok: true, status: 200,
      json: () => Promise.resolve({ success: true, order: { ...codOrder, payment_method: 'razorpay', order_status: 'pending', payment_status: 'pending' } }),
    }))
    await renderPage()
    for (let i = 0; i < 14; i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(4100) })   // one poll per render cycle
    }
    expect(fetchSpy.mock.calls.length).toBe(1 + 8)
  })
})

describe('CF2 — purchase analytics only for a verified, confirmed order, once', () => {
  it('fake URL (lookup fails): trackPurchase and markCartConverted are NOT called', async () => {
    lookupReturns(null, 404)
    await renderPage()
    await waitFor(() => expect(screen.getAllByText(/couldn.t verify this order/i).length).toBeGreaterThan(0))
    expect(trackPurchase).not.toHaveBeenCalled()
    expect(markCartConverted).not.toHaveBeenCalled()
  })

  it('verified order: fires once with the SERVER total (not ?total=99999)', async () => {
    lookupReturns(codOrder)
    await renderPage()
    await waitFor(() => expect(trackPurchase).toHaveBeenCalledTimes(1))
    expect(trackPurchase).toHaveBeenCalledWith('PRMR4OEQ', 262)
    expect(markCartConverted).toHaveBeenCalledTimes(1)
  })

  it('a refresh (fresh page load of the same order) does NOT fire again', async () => {
    lookupReturns(codOrder)
    await renderPage()
    await waitFor(() => expect(trackPurchase).toHaveBeenCalledTimes(1))
    cleanup()

    await renderPage()   // simulates F5: new module instance, same localStorage
    await waitFor(() => expect(screen.getByText('Order Confirmed!')).toBeTruthy())
    expect(trackPurchase).toHaveBeenCalledTimes(1)
    expect(markCartConverted).toHaveBeenCalledTimes(1)
  })

  it('failed / cancelled orders never count as a purchase', async () => {
    lookupReturns({ ...codOrder, payment_method: 'razorpay', order_status: 'payment_failed', payment_status: 'failed' })
    await renderPage()
    await waitFor(() => expect(screen.getByText(/Payment not completed/i)).toBeTruthy())
    expect(trackPurchase).not.toHaveBeenCalled()
    expect(markCartConverted).not.toHaveBeenCalled()
  })

  it('still works when localStorage is unavailable (private mode) — no crash, fires once per load', async () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
    lookupReturns(codOrder)
    await renderPage()
    await waitFor(() => expect(trackPurchase).toHaveBeenCalledTimes(1))
    spy.mockRestore()
  })
})


describe('S1 — confirmation page shows the Cart ✓ → Checkout ✓ → Confirmation stepper', () => {
  const steps = () => Array.from(document.querySelectorAll('.ck-crumb')).map(c => c.className)

  it('verified order: stepper present, Cart and Checkout done, Confirmation active, nothing is a link', async () => {
    lookupReturns(codOrder)
    await renderPage()
    await waitFor(() => expect(screen.getByText('Order Confirmed!')).toBeTruthy())

    const nav = screen.getByRole('navigation', { name: 'Checkout progress' })
    expect(nav).toBeTruthy()
    expect(steps().map(c => c.replace(' ck-crumb--link', ''))).toEqual(['ck-crumb ck-crumb--done', 'ck-crumb ck-crumb--done', 'ck-crumb ck-crumb--active'])
    expect(nav.querySelectorAll('a')).toHaveLength(0)
    expect(nav.querySelector('[aria-current="step"]')!.textContent).toMatch(/confirmation/i)
  })

  it('awaiting-payment order: stepper still shown (Confirmation is where the customer is waiting)', async () => {
    lookupReturns({ ...codOrder, payment_method: 'razorpay', order_status: 'pending', payment_status: 'pending' })
    await renderPage()
    await waitFor(() => expect(screen.getByText(/Confirming your payment/i)).toBeTruthy())
    expect(document.querySelector('nav[aria-label="Checkout progress"]')).toBeTruthy()
  })

  it.each([
    ['unverified (lookup 404)', null, 404],
    ['payment_failed', { ...codOrder, payment_method: 'razorpay', order_status: 'payment_failed', payment_status: 'failed' }, 200],
    ['cancelled', { ...codOrder, order_status: 'cancelled' }, 200],
  ])('%s → NO progress stepper (it would claim a successful confirmation)', async (_l, order, status) => {
    lookupReturns(order as Record<string, unknown> | null, status as number)
    await renderPage()
    await waitFor(() => expect(document.querySelector('.oc-hero[data-view]')!.getAttribute('data-view')).not.toBe('loading'))
    expect(document.querySelector('nav[aria-label="Checkout progress"]')).toBeNull()
  })
})
