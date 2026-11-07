// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'

vi.mock('next/image', () => ({ default: (p: Record<string, unknown>) => { const { fill: _f, priority: _p, ...rest } = p; void _f; void _p; return <img alt="" {...(rest as object)} /> } }))
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }))
const addItem = vi.fn()
vi.mock('@/store/cartStore', () => ({ useCartStore: (sel: (s: unknown) => unknown) => sel({ addItem }) }))
vi.mock('@/store/uiStore', () => ({ useUIStore: (sel: (s: unknown) => unknown) => sel({ openCart: vi.fn() }) }))

import RelatedCard from '@/components/product/RelatedCard'

// Nov 2026 verification: the Add button sits inside the card's link; without preventDefault the browser followed the anchor and
// hard-navigated to the product right after adding it to the cart.
describe('RelatedCard — Add to Cart stays on the page', () => {
  it('adds the item and cancels the surrounding link navigation', () => {
    const product = {
      id: 7, name: 'Honey', slug: 'honey', emoji: null, price: 300, mrp: 350, image_url: null, unit_label: null,
      gst_rate: 5, available_stock: 9, state_id: null, badges_organic: false, badges_bestseller: false,
    }
    const { getByRole } = render(<RelatedCard product={product as never} />)
    const button = getByRole('button')
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true })
    fireEvent(button, ev)
    expect(addItem).toHaveBeenCalledTimes(1)
    expect(ev.defaultPrevented).toBe(true)
  })
})
