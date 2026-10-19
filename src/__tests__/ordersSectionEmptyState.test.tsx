/**
 * ordersSectionEmptyState.test.tsx — the account page must never say "No orders yet" when the server told us
 * there ARE orders (header "92 orders") or when loading failed. That message made it look like orders had vanished.
 */
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'

vi.mock('next/link', () => ({ default: ({ href, children, ...r }: any) => React.createElement('a', { href, ...r }, children) }))
vi.mock('@/components/ui/ErrorBoundary', () => ({ default: ({ children }: any) => React.createElement(React.Fragment, null, children) }))
vi.mock('../app/account/_components/OrderCard', () => ({ default: () => React.createElement('div', { 'data-testid': 'order-card' }) }))

import OrdersSection from '@/app/account/_sections/OrdersSection'

const stats = { total: 92, delivered: 70, active: 5, cancelled: 9, spent: 33100.32, loyalty_points: 0 }
function ordersProp(over: Record<string, unknown> = {}) {
  return {
    orders: null, loading: false, hasFetched: true, error: null, filter: 'all', setFilter: vi.fn(), search: '', setSearch: vi.fn(),
    filtered: [], stats, settings: {}, fetchOrders: vi.fn(), refresh: vi.fn(), canReturn: () => false, page: 1, totalPages: 5,
    totalCount: 92, loadMore: vi.fn(), loadingMore: false, hasMore: true, ...over,
  } as any
}
const show = (o: any) => render(<OrdersSection orders={o} showToast={vi.fn()} />)

describe('OrdersSection empty state', () => {
  it('server says 92 orders but none arrived → "couldn\'t load" with Try again, NOT "No orders yet"', () => {
    const o = ordersProp()
    show(o)
    expect(screen.queryByText('No orders yet')).toBeNull()
    expect(screen.getByText(/couldn.t load your orders/i)).toBeTruthy()
    fireEvent.click(screen.getByText('Try again'))
    expect(o.refresh).toHaveBeenCalledTimes(1)
  })

  it('a failed request (error set, nothing loaded) → "couldn\'t load", NOT "No orders yet"', () => {
    show(ordersProp({ error: 'Orders fetch failed', totalCount: 0, stats: null }))
    expect(screen.queryByText('No orders yet')).toBeNull()
    expect(screen.getByText(/couldn.t load your orders/i)).toBeTruthy()
  })

  it('a genuinely new customer (0 orders, no error) still sees "No orders yet" + Shop Now', () => {
    show(ordersProp({ totalCount: 0, stats: null, totalPages: 0, hasMore: false }))
    expect(screen.getByText('No orders yet')).toBeTruthy()
    expect(screen.getByText(/Shop Now/)).toBeTruthy()
    expect(screen.queryByText(/couldn.t load your orders/i)).toBeNull()
  })

  it('a filter/search that matches nothing still says "Nothing found" (not a load failure)', () => {
    show(ordersProp({ orders: [{ id: 1 }], filtered: [], filter: 'cancelled', totalCount: 92 }))
    expect(screen.getByText('Nothing found')).toBeTruthy()
    expect(screen.queryByText(/couldn.t load your orders/i)).toBeNull()
  })

  it('orders that did load are listed normally', () => {
    show(ordersProp({ orders: [{ id: 1 }], filtered: [{ id: 1, items: [] }] }))
    expect(screen.getByTestId('order-card')).toBeTruthy()
    expect(screen.queryByText(/couldn.t load your orders/i)).toBeNull()
  })
})
