// @vitest-environment jsdom
// Nov 2026 browser audit: regressions this file pins.
//  - gallery: no interactive control nested inside another (axe nested-interactive); the zoom trigger is a real button
//  - mobile order: title, price and Add to Cart come right after the gallery, before the stats and certificate card
//  - accessible colours for the text that failed contrast (gold eyebrow, MRP, breadcrumb, cart/checkout labels)
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

vi.mock('next/image', () => ({ default: (props: { alt: string; src: string }) => React.createElement('img', { alt: props.alt, src: props.src }) }))
import ProductGallery from '@/components/product/ProductGallery'

const css = (rel: string) => readFileSync(join(process.cwd(), 'src', rel), 'utf8')
const pdpCss = css('app/products/[slug]/pdp.css')
const images = [{ url: 'a.jpg', alt: 'A' }, { url: 'b.jpg', alt: 'B' }, { url: 'c.jpg', alt: 'C' }]

describe('gallery accessibility', () => {
  it('zoom trigger is a real button and nothing interactive is nested inside another control', () => {
    const { container } = render(React.createElement(ProductGallery, { images, productName: 'Ghee', savings: 25 }))
    expect(screen.getByLabelText('View full image').tagName).toBe('BUTTON')
    expect(container.querySelector('[role="button"]')).toBeNull()
    expect(container.querySelectorAll('button button, a button, button a').length).toBe(0)
    expect(container.querySelector('.pdp-gallery-trigger')?.getAttribute('role')).toBeNull()
  })
  it('thumbnail strip has a class so mobile can scroll it in one row', () => {
    const { container } = render(React.createElement(ProductGallery, { images, productName: 'Ghee', savings: 0 }))
    expect(container.querySelector('.pdp-thumbs')).not.toBeNull()
  })
})

describe('mobile layout (pdp.css)', () => {
  it('puts the buy box before the stats and certificate card on phones', () => {
    expect(pdpCss).toMatch(/@media\(max-width:900px\)\{\s*\.pdp-img-col\{display:contents\}\s*\.pdp-info-col\{order:1\}\s*\.pdp-stat-trio\{order:2\}\s*\.pdp-certificate-section\{order:3\}/)
  })
  it('thumbnails scroll in one row and the duplicate back pill is hidden on phones', () => {
    expect(pdpCss).toMatch(/\.pdp-thumbs\{flex-wrap:nowrap!important;overflow-x:auto/)
    expect(pdpCss).toMatch(/\.pdp-back-pill\{display:none\}/)
  })
})

describe('text contrast', () => {
  it('product page uses accessible colours', () => {
    expect(pdpCss).toMatch(/\.pdp-vendor\{font-size:12px;font-weight:800;color:#8a6205;/)
    expect(pdpCss).toMatch(/\.pdp-mrp\{font-size:20px;color:#666;/)
    expect(pdpCss).not.toMatch(/\.pdp-vendor\{[^}]*color:#c8920a/)
    // no text on the product page may use the faint gold or grey (backgrounds and borders may keep the gold)
    expect(pdpCss).not.toMatch(/(?<![-\w])color:#c8920a/)
    expect(pdpCss).not.toMatch(/(?<![-\w])color:#7a7a7a/)
  })
  it('cart and checkout labels no longer use the faint greys', () => {
    for (const [f, bad] of [['components/cart/cart-item-card.css', '#9a8e7e'], ['components/checkout/checkout-stepper.css', '#c0b8ae'], ['components/checkout/OrderSummary.css', '#B0A898'], ['components/checkout/OrderSummary.css', '#9A9080'], ['components/checkout/AddressForm.tsx', '#9A9080'], ['components/checkout/AddressForm.tsx', '#A09888']] as const) {
      expect(css(f), `${f} still has ${bad}`).not.toContain(bad)
    }
    expect(css('components/product/RelatedProducts.tsx')).not.toContain('color:#7a7a7a')
    expect(css('app/cart/cart-page.css')).not.toMatch(/\.cp-whatsapp \{[^}]*background: #25d366;/)
  })
})
