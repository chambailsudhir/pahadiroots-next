/**
 * Account UI logic audit (E1): Loyalty remount, Notifications load errors, Orders toolbar/empty state/return modal.
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import React from 'react'

vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => React.createElement('a', { href, ...r }, children) }))
vi.mock('@/components/ui/ErrorBoundary', () => ({ default: ({ children }: any) => React.createElement(React.Fragment, null, children) }))
vi.mock('../app/account/_components/OrderCard', () => ({
  default: ({ order, onReturnClick }: any) =>
    React.createElement('button', { 'data-testid': 'order-card', onClick: (e: any) => onReturnClick(String(order.id), e.currentTarget) }, 'card'),
}))

import LoyaltySection, { __resetLoyaltyCache } from '@/app/account/_sections/LoyaltySection'
import NotificationsSection from '@/app/account/_sections/NotificationsSection'
import OrdersSection from '@/app/account/_sections/OrdersSection'

beforeEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); __resetLoyaltyCache(); cleanup() })

const json = (body: unknown, status = 200) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) })

describe('LoyaltySection (E1-2)', () => {
  const loyalty = { enabled: true, points: 120, value_inr: 120, points_value: 1, min_redeem: 50, max_redeem_pct: 20, label: 'Coins', referral_code: 'ABC', referral_bonus: 100 }

  it('shows the content again after unmount/remount (no permanent skeleton)', async () => {
    const f = vi.fn(() => json(loyalty))
    vi.stubGlobal('fetch', f)
    const first = render(<LoyaltySection />)
    await waitFor(() => expect(first.container.querySelector('[aria-busy="true"]')).toBeNull())
    first.unmount()
    const second = render(<LoyaltySection />)
    // painted from cache straight away, no skeleton
    expect(second.container.querySelector('[aria-busy="true"]')).toBeNull()
    await waitFor(() => expect(f).toHaveBeenCalledTimes(2))
  })

  it('error state has a retry button that reloads', async () => {
    const f = vi.fn().mockImplementationOnce(() => json({ error: 'down' }, 500)).mockImplementation(() => json(loyalty))
    vi.stubGlobal('fetch', f)
    render(<LoyaltySection />)
    const retry = await screen.findByText('Try again')
    fireEvent.click(retry)
    await waitFor(() => expect(screen.queryByText('Try again')).toBeNull())
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('a 401 calls markExpired', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json({ error: 'x' }, 401)))
    const markExpired = vi.fn()
    render(<LoyaltySection markExpired={markExpired} />)
    await waitFor(() => expect(markExpired).toHaveBeenCalled())
  })
})

describe('NotificationsSection (E1-8)', () => {
  it('a 401 on load calls markExpired', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json({}, 401)))
    const markExpired = vi.fn()
    render(<NotificationsSection showToast={vi.fn()} markExpired={markExpired} />)
    await waitFor(() => expect(markExpired).toHaveBeenCalled())
  })

  it('a 500 shows an error + retry instead of default toggles; retry loads the saved prefs', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const f = vi.fn().mockImplementationOnce(() => json({ error: 'x' }, 500))
      .mockImplementation(() => json({ prefs: { notif_email_orders: false, notif_email_marketing: true } }))
    vi.stubGlobal('fetch', f)
    render(<NotificationsSection showToast={vi.fn()} />)
    fireEvent.click(await screen.findByText('Try again'))
    const sw = await screen.findByRole('switch', { name: 'Email notifications' })
    expect(sw.getAttribute('aria-checked')).toBe('false')
    expect(screen.getByRole('switch', { name: 'Promotional Emails notifications' }).getAttribute('aria-checked')).toBe('true')
  })
})

const stats = { total: 3, delivered: 1, active: 1, cancelled: 1, spent: 100, loyalty_points: 0 }
function ordersProp(over: Record<string, unknown> = {}) {
  return {
    orders: null, loading: false, hasFetched: true, error: null, filter: 'all', setFilter: vi.fn(), search: '', setSearch: vi.fn(),
    filtered: [], stats, settings: { return_photo_upload_enabled: 'true' }, fetchOrders: vi.fn(), refresh: vi.fn(), canReturn: () => true, page: 1, totalPages: 1,
    totalCount: 0, loadMore: vi.fn(), loadingMore: false, hasMore: false, ...over,
  } as any
}

describe('OrdersSection (E1-6, E1-10, E1-11)', () => {
  it('a search with zero hits says "Nothing found" + Clear Filters, not "No orders yet"', () => {
    render(<OrdersSection orders={ordersProp({ search: 'zzz' })} showToast={vi.fn()} />)
    expect(screen.getByText('Nothing found')).toBeTruthy()
    expect(screen.queryByText('No orders yet')).toBeNull()
    expect(screen.getByText('Clear Filters')).toBeTruthy()
  })

  it('the search box stays mounted while the first list is loading; only the list area shows the skeleton', () => {
    render(<OrdersSection orders={ordersProp({ loading: true, search: 'a' })} showToast={vi.fn()} />)
    expect(screen.getByLabelText(/Search orders by order number/)).toBeTruthy()
  })

  it('the search-clear button has an accessible name', () => {
    render(<OrdersSection orders={ordersProp({ search: 'abc' })} showToast={vi.fn()} />)
    expect(screen.getByLabelText('Clear search')).toBeTruthy()
  })

  function openModal() {
    const o = ordersProp({ orders: [{ id: 1 }], filtered: [{ id: 1, order_number: 'ORD-1', items: [] }], totalCount: 1 })
    render(<OrdersSection orders={o} showToast={vi.fn()} />)
    fireEvent.click(screen.getByTestId('order-card'))
    return o
  }

  it('moves focus into the dialog after a successful submit so Esc keeps working', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json({ message: 'ok' })))
    const o = openModal()
    fireEvent.click(screen.getByLabelText(/Damaged/i))
    fireEvent.click(screen.getByText(/Submit Return Request/))
    await screen.findByText(/has been submitted/)
    const box = screen.getByRole('dialog').firstElementChild as HTMLElement
    await waitFor(() => expect(document.activeElement).toBe(box))
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(o.refresh).toHaveBeenCalled()
  })

  it('cannot be closed while a photo upload is in flight', async () => {
    let release: (v: unknown) => void = () => {}
    vi.stubGlobal('fetch', vi.fn(() => new Promise(r => { release = r })))
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() }))
    openModal()
    const input = document.getElementById('return-photo-input') as HTMLInputElement
    const file = new File(['x'], 'a.png', { type: 'image/png' })
    fireEvent.change(input, { target: { files: [file] } })
    await screen.findByText('Uploading…')
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect((screen.getByLabelText('Close return modal') as HTMLButtonElement).disabled).toBe(true)
    release(json({ error: 'stop' }, 400))
    await waitFor(() => expect(screen.queryByText('Uploading…')).toBeNull())
  })
})
