/**
 * C1 — shared load-time revalidation hook (used by the cart page and checkout) + banner.
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import React from 'react'
import { useCartRevalidation } from '@/hooks/useCartRevalidation'
import CartNoticeBanner from '@/components/cart/CartNoticeBanner'
import { useCartStore } from '@/store/cartStore'
import type { CartItem } from '@/types'

const item = { productId: 'p1', variantId: 'v1', name: 'Honey', slug: 'h', image: null, emoji: null, size: '500g', price: 500, mrp: 600, gstRate: 5, qty: 1, isOrganic: false, isHimalayan: false, isBestseller: false } as CartItem
const fetchMock = vi.fn()
const lines = (over = {}) => ({ ok: true, status: 200, json: async () => ({ lines: [{ productId: 'p1', variantId: 'v1', status: 'ok', name: 'Honey', price: 500, mrp: 600, available: 9, ...over }] }) })

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  useCartStore.getState().clearCart()
  useCartStore.setState({ _hasHydrated: true })
  useCartStore.getState().addItem(item)
})
afterEach(() => vi.unstubAllGlobals())

describe('useCartRevalidation', () => {
  it('runs ONCE when enabled, and exposes the messages', async () => {
    fetchMock.mockResolvedValue(lines({ price: 560 }))
    const { result, rerender } = renderHook(({ on }) => useCartRevalidation(on), { initialProps: { on: true } })
    await waitFor(() => expect(result.current.notices).toHaveLength(1))
    expect(result.current.notices[0]).toMatch(/₹500 to ₹560/)
    rerender({ on: true }); rerender({ on: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does nothing until enabled (cart not hydrated / empty)', async () => {
    fetchMock.mockResolvedValue(lines())
    const { rerender } = renderHook(({ on }) => useCartRevalidation(on), { initialProps: { on: false } })
    expect(fetchMock).not.toHaveBeenCalled()
    rerender({ on: true })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
  })

  it('no messages when nothing changed; fails open (no notices, cart untouched) on error', async () => {
    fetchMock.mockResolvedValue(lines())
    const a = renderHook(() => useCartRevalidation(true))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await act(async () => { await Promise.resolve() })
    expect(a.result.current.notices).toEqual([])

    fetchMock.mockReset().mockRejectedValue(new Error('offline'))
    const before = useCartStore.getState().items
    const b = renderHook(() => useCartRevalidation(true))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await act(async () => { await Promise.resolve() })
    expect(b.result.current.notices).toEqual([])
    expect(useCartStore.getState().items[0].price).toBe(before[0].price)
  })
})

describe('CartNoticeBanner', () => {
  it('renders nothing without messages', () => {
    const { container } = render(React.createElement(CartNoticeBanner, { messages: [], onDismiss: () => {} }))
    expect(container.firstChild).toBeNull()
  })
  it('lists messages in a polite live region and can be dismissed', () => {
    const onDismiss = vi.fn()
    render(React.createElement(CartNoticeBanner, { messages: ['A changed.', 'B removed.'], onDismiss }))
    const box = screen.getByTestId('cart-notice-banner')
    expect(box.getAttribute('role')).toBe('status')
    expect(box.getAttribute('aria-live')).toBe('polite')
    expect(screen.getByText('A changed.')).toBeTruthy()
    fireEvent.click(screen.getByLabelText(/dismiss/i))
    expect(onDismiss).toHaveBeenCalled()
  })
})
