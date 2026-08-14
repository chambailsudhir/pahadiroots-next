// @vitest-environment jsdom
/**
 * BestSellers.test.tsx
 *
 * Component-level coverage for BestSellers.tsx (the async Server
 * Component wrapper) — previously zero test coverage. BestSellersClient
 * itself is mocked here since its own logic (filter/sort/emoji) is
 * covered separately in BestSellersClient.test.tsx and
 * normalizeProduct.test.ts / categoryEmoji.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'

const mockGetStoreData          = vi.fn()
const mockGetProductsWithImages = vi.fn()
vi.mock('@/lib/storeData', () => ({
  getStoreData: () => mockGetStoreData(),
  getProductsWithImages: (sd: unknown) => mockGetProductsWithImages(sd),
}))
vi.mock('@/components/homepage/BestSellersClient', () => ({
  default: ({ initialProducts, categories }: { initialProducts: { name: string }[]; categories: { name: string }[] }) =>
    React.createElement('div', { 'data-testid': 'best-sellers-client' },
      `products:${initialProducts.length} categories:${categories.length}`),
}))

const mockLoggerError = vi.fn()
const mockLoggerWarn  = vi.fn()
vi.mock('@/lib/logger', () => ({
  logger: { error: (...a: unknown[]) => mockLoggerError(...a), warn: (...a: unknown[]) => mockLoggerWarn(...a) },
}))

import BestSellers from '@/components/homepage/BestSellers'

function product(overrides: Record<string, unknown> = {}) {
  return {
    id: 1, name: 'Test Product', slug: 'test-product', price: 100, mrp: 120,
    available_stock: 5, badges: [], is_deleted: false, status: 'active',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('BestSellers', () => {
  it('passes the full active catalog and active categories through to BestSellersClient', async () => {
    mockGetStoreData.mockResolvedValue({
      categories: [
        { id: 1, name: 'Honey', slug: 'honey', is_active: true },
        { id: 2, name: 'Discontinued', slug: 'old', is_active: false },
      ],
    })
    mockGetProductsWithImages.mockReturnValue([product({ id: 1 }), product({ id: 2 })])

    const el = await BestSellers()
    render(el as React.ReactElement)

    // 2 products, and only 1 of the 2 categories (the active one).
    expect(screen.getByTestId('best-sellers-client').textContent).toBe('products:2 categories:1')
  })

  it('renders nothing when there are no products', async () => {
    mockGetStoreData.mockResolvedValue({ categories: [] })
    mockGetProductsWithImages.mockReturnValue([])

    const el = await BestSellers()
    expect(el).toBeNull()
  })

  // BUG FIX regression (observability — "section disappeared with zero
  // trace anywhere"): the empty-catalog fail-safe path used to be silent.
  // It must now leave a log line so an empty active catalog is diagnosable
  // instead of just being an unexplained gap on the homepage.
  it('logs a warning (not silence) when there are no products', async () => {
    mockGetStoreData.mockResolvedValue({ categories: [] })
    mockGetProductsWithImages.mockReturnValue([])

    await BestSellers()

    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.stringContaining('[BestSellers]'),
    )
    expect(mockLoggerError).not.toHaveBeenCalled()
  })

  it('renders nothing (fails safe) when the data fetch throws', async () => {
    mockGetStoreData.mockRejectedValue(new Error('db down'))

    const el = await BestSellers()
    expect(el).toBeNull()
  })

  // BUG FIX regression (observability — the exact bug reported: "Bestsellers
  // section is missing with no error anywhere in the logs"): a bare
  // `catch { return null }` swallowed the real error completely. This
  // asserts the error is now captured with enough detail (message + stack)
  // to actually debug a recurrence from Vercel's function logs.
  it('logs the real error (message + stack) when the data fetch throws, instead of failing silently', async () => {
    const err = new Error('db down')
    mockGetStoreData.mockRejectedValue(err)

    await BestSellers()

    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.stringContaining('[BestSellers]'),
      expect.objectContaining({ error: 'db down', stack: expect.any(String) }),
    )
    expect(mockLoggerWarn).not.toHaveBeenCalled()
  })

  it('treats a category with no explicit is_active flag as active', async () => {
    mockGetStoreData.mockResolvedValue({
      categories: [{ id: 1, name: 'No Flag Set', slug: 'no-flag' }],
    })
    mockGetProductsWithImages.mockReturnValue([product()])

    const el = await BestSellers()
    render(el as React.ReactElement)

    expect(screen.getByTestId('best-sellers-client').textContent).toContain('categories:1')
  })
})
