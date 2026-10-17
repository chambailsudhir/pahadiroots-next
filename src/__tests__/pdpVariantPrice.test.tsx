/**
 * pdpVariantPrice.test.tsx — PDP audit P1-2 / P2-1 regression.
 *
 * Before: the big price, MRP, SAVE %, stock line and urgency bar were computed once on the server from the
 * default pack and never changed when the customer picked another size (the cart was right, the page was not).
 * Now they are driven by the pack AddToCartSection reports to PdpVariantProvider. These tests render the REAL
 * AddToCartSection together with the live price/stock blocks and the gallery badge.
 */
// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/react'
import React from 'react'
import { useCartStore } from '@/store/cartStore'
import type { Product, ProductVariant } from '@/types'
import { resetIntersectionObserverMock } from './__mocks__/intersectionObserver'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }))
vi.mock('next/image', () => ({
  default: (props: { src: string; alt: string }) => React.createElement('img', { src: props.src, alt: props.alt }),
}))
vi.mock('@/lib/analytics/track', () => ({ trackProductView: vi.fn(), trackAddToCart: vi.fn() }))

import AddToCartSection from '@/components/product/AddToCartSection'
import ProductGallery from '@/components/product/ProductGallery'
import { PdpVariantProvider } from '@/components/product/PdpVariantContext'
import { PdpPriceBlock, PdpStockRow } from '@/components/product/PdpLivePrice'

const product = {
  id: 1, name: 'Spiti Honey', slug: 'spiti-honey', emoji: '🍯', state_id: 'himachal', unit_label: '250g', gst_rate: 5,
  price: 500, selling_price: 500, mrp: 600, available_stock: 40, image_url: '/h.jpg',
  badges_bestseller: false, badges_organic: false,
} as unknown as Product

function v(id: number, size: string, price: number, mrp: number, stock: number, initial: number | null = null) {
  return { id, product_id: 1, size, sku: `S-${id}`, price, mrp, available_stock: stock, initial_stock: initial, is_active: true } as unknown as ProductVariant
}
const variants = [v(11, '250g', 500, 600, 40), v(12, '500g', 900, 1200, 8, 20), v(13, '1kg', 1700, 1700, 3)]

function Page() {
  return (
    <PdpVariantProvider
      variants={variants.map(x => ({ id: x.id, price: x.price, mrp: Number((x as any).mrp), available_stock: x.available_stock, initial_stock: (x as any).initial_stock, size: (x as any).size }))}
      initialVariantId={11}
      fallback={{ price: 500, mrp: 600, stock: 40, initialStock: null }}
    >
      <ProductGallery images={[{ url: '/a.jpg', alt: 'a' }]} productName="Spiti Honey" savings={17} />
      <PdpPriceBlock hasVariants />
      <AddToCartSection product={product} variants={variants} />
      <PdpStockRow />
    </PdpVariantProvider>
  )
}

beforeEach(() => {
  useCartStore.getState().clearCart()
  useCartStore.setState({ _hasHydrated: true })
  resetIntersectionObserverMock()
})

const heroPrice = (c: HTMLElement) => c.querySelector('.pdp-price')!.textContent
const heroMrp   = (c: HTMLElement) => c.querySelector('.pdp-mrp')?.textContent ?? null
const badge     = (c: HTMLElement) => c.querySelector('.pdp-save-badge')?.textContent ?? null

describe('hero price block follows the selected pack', () => {
  it('starts on the default (cheapest in-stock) pack, matching the server render', () => {
    const { container } = render(<Page />)
    expect(heroPrice(container)).toBe('₹500')
    expect(heroMrp(container)).toBe('₹600')
    expect(badge(container)).toBe('SAVE 17%')
    expect(container.querySelector('.pdp-tax-note')!.textContent).toContain('250g')
  })

  it('updates price, MRP, SAVE %, size note and gallery badge when another pack is chosen', () => {
    const { container } = render(<Page />)
    fireEvent.click(screen.getByLabelText(/500g/))
    expect(heroPrice(container)).toBe('₹900')
    expect(heroMrp(container)).toBe('₹1200')
    expect(badge(container)).toBe('SAVE 25%')
    expect(container.querySelector('.pdp-tax-note')!.textContent).toContain('500g')
    expect(container.textContent).toContain('-25%')       // gallery badge, no longer stuck on the server value (-17%)
    expect(container.textContent).not.toContain('-17%')
  })

  it('hides MRP/SAVE when the chosen pack has no discount (mrp == price)', () => {
    const { container } = render(<Page />)
    fireEvent.click(screen.getByLabelText(/1kg/))
    expect(heroPrice(container)).toBe('₹1700')
    expect(heroMrp(container)).toBeNull()
    expect(badge(container)).toBeNull()
  })

  it('the price shown always equals the price the cart receives for that pack', () => {
    const { container } = render(<Page />)
    fireEvent.click(screen.getByLabelText(/500g/))
    fireEvent.click(screen.getByLabelText(/Add Spiti Honey to cart/i))
    const item = useCartStore.getState().items[0]
    expect(`₹${item.price}`).toBe(heroPrice(container))
    expect(String(item.variantId)).toBe('12')
  })
})

describe('stock line + low-stock notice follow the selected pack (no invented urgency)', () => {
  it('"In Stock" for a well-stocked pack, with no urgency notice', () => {
    const { container } = render(<Page />)
    expect(screen.getByText('In Stock')).toBeTruthy()
    expect(container.querySelector('.pdp-urgency')).toBeNull()
  })

  it('≤10 units: shows "Only N left" for THAT pack — and never "selling fast"', () => {
    const { container } = render(<Page />)
    fireEvent.click(screen.getByLabelText(/500g/))          // 8 left
    expect(container.querySelector('.pdp-urgency-label')!.textContent).toBe('Only 8 left')
    expect(screen.getByText('8 in stock')).toBeTruthy()
    expect(container.textContent).not.toMatch(/selling fast|🔥/)
  })

  it('urgency bar uses the REAL sold-percentage and only when initial stock is known', () => {
    const { container } = render(<Page />)
    fireEvent.click(screen.getByLabelText(/500g/))          // initial 20, left 8 → 60% sold
    expect((container.querySelector('.pdp-urgency-fill') as HTMLElement).style.width).toBe('60%')
    fireEvent.click(screen.getByLabelText(/1kg/))           // 3 left, initial unknown → no invented bar
    expect(container.querySelector('.pdp-urgency-label')!.textContent).toBe('Only 3 left')
    expect(container.querySelector('.pdp-urgency-track')).toBeNull()
    expect(screen.getByText('Only 3 left!')).toBeTruthy()
  })
})

describe('outside a provider (QuickView, tests) nothing crashes', () => {
  it('AddToCartSection and ProductGallery fall back to their own props', () => {
    const { container } = render(<><ProductGallery images={[{ url: '/a.jpg', alt: 'a' }]} productName="x" savings={17} /><AddToCartSection product={product} variants={variants} /></>)
    expect(container.textContent).toContain('-17%')
  })
})
