// @vitest-environment jsdom
/**
 * ProductCard.NotifyMe.test.tsx
 *
 * Component-level coverage for two P1 audit fixes to ProductCard.tsx,
 * both previously untested:
 *
 *   1. "Notify Me" on out-of-stock products used to be a permanently
 *      disabled button with no onClick, no email capture, and no backend
 *      call at all. Now: logged-in users submit with one click using
 *      their account email; guests get an inline email form. Both hit
 *      the real notify_stock API action.
 *
 *   2. The star rating used to be hardcoded "★★★★★" for every product
 *      regardless of any real data. Product has no aggregate rating
 *      field at all (only per-review Review.rating exists) — the fix
 *      was to remove the fake stars entirely, not fabricate a number.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import type { Product } from '@/types'

vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => React.createElement('img', { ...props, alt: props.alt as string }),
}))
vi.mock('next/link', () => ({
  default: ({ children, href, onClick, className, 'aria-label': ariaLabel }: { children?: React.ReactNode; href: string; onClick?: () => void; className?: string; 'aria-label'?: string }) =>
    React.createElement('a', { href, onClick, className, 'aria-label': ariaLabel }, children),
}))
vi.mock('@/components/product/QuickViewModal', () => ({
  default: () => null,
}))

import ProductCard from '@/components/product/ProductCard'
import { useUserStore } from '@/store/userStore'

function outOfStockProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 101,
    name: 'Wild Himalayan Honey',
    slug: 'wild-himalayan-honey',
    price: 499,
    mrp: 599,
    available_stock: 0,
    image_url: null,
    badges: [],
    review_count: 12,
    product_variants: [],
    ...overrides,
  } as unknown as Product
}

describe('ProductCard — Notify Me (P1 fix)', () => {
  beforeEach(() => {
    useUserStore.setState({ user: null, wishlist: [] })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows the Notify Me button (not a disabled dead button) when out of stock', () => {
    render(<ProductCard product={outOfStockProduct()} />)
    const btn = screen.getByRole('button', { name: /notify me/i })
    // This is the actual bug: the old button had `disabled` with no
    // handler — it's clickable now.
    expect((btn as HTMLButtonElement).disabled).toBe(false)
  })

  it('logged-in users submit with one click using their account email', async () => {
    useUserStore.setState({ user: { id: 'u1', email: 'jane@example.com', name: 'Jane', phone: '' }, wishlist: [] })
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) })
    vi.stubGlobal('fetch', fetchMock)

    render(<ProductCard product={outOfStockProduct()} />)
    fireEvent.click(screen.getByRole('button', { name: /notify me/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/actions', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ action: 'notify_stock', email: 'jane@example.com', product_id: 101 }),
      }))
    })
    await waitFor(() => {
      expect(screen.getByText(/we.ll email you/i)).toBeTruthy()
    })
  })

  it('guests get an inline email form instead of an immediate submit', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) })
    vi.stubGlobal('fetch', fetchMock)

    render(<ProductCard product={outOfStockProduct()} />)
    fireEvent.click(screen.getByRole('button', { name: /notify me/i }))

    // No request yet — guests must enter an email first.
    expect(fetchMock).not.toHaveBeenCalled()
    const input = await screen.findByPlaceholderText('you@example.com')
    fireEvent.change(input, { target: { value: 'guest@example.com' } })
    fireEvent.submit(input.closest('form')!)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/actions', expect.objectContaining({
        body: JSON.stringify({ action: 'notify_stock', email: 'guest@example.com', product_id: 101 }),
      }))
    })
  })

  it('shows a retry state when the request fails, not a silent dead end', async () => {
    useUserStore.setState({ user: { id: 'u1', email: 'jane@example.com', name: 'Jane', phone: '' }, wishlist: [] })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))

    render(<ProductCard product={outOfStockProduct()} />)
    fireEvent.click(screen.getByRole('button', { name: /notify me/i }))

    await waitFor(() => {
      expect(screen.getByText(/try again/i)).toBeTruthy()
    })
  })
})

describe('ProductCard — no fabricated star rating (P1 fix)', () => {
  beforeEach(() => {
    useUserStore.setState({ user: null, wishlist: [] })
  })

  it('never renders star characters — Product has no real rating field to render', () => {
    render(<ProductCard product={outOfStockProduct({ review_count: 25 })} />)
    // The actual bug: this used to always render "★★★★★" regardless of
    // any real data. There's no per-product rating field to render
    // honestly, so no star characters should appear anywhere.
    expect(screen.queryByText('★★★★★')).toBeNull()
    expect(document.querySelector('.pstars')).toBeNull()
  })

  it('still shows the real review count', () => {
    render(<ProductCard product={outOfStockProduct({ review_count: 25 })} />)
    expect(screen.getByText(/25 reviews/i)).toBeTruthy()
  })

  it('shows nothing rating-related when there are zero reviews', () => {
    render(<ProductCard product={outOfStockProduct({ review_count: 0 })} />)
    expect(screen.queryByText(/reviews?/i)).toBeNull()
  })
})
