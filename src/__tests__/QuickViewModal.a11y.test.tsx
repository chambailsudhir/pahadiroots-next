// @vitest-environment jsdom
/**
 * QuickViewModal — keyboard/screen-reader contract (audit C-3, WCAG 2.1.2 / 2.4.3 / 4.1.2):
 *  focus moves into the dialog, Tab is trapped inside it, Esc closes it, focus returns to the opener,
 *  size buttons announce which is selected, and an out-of-stock item no longer shows a dead "Notify Me" button.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useState } from 'react'

// eslint-disable-next-line @next/next/no-img-element
vi.mock('next/image', () => ({ default: (p: Record<string, unknown>) => <img alt={String(p.alt ?? '')} /> }))
vi.mock('next/link', () => ({ default: (p: { href: string; children: React.ReactNode }) => <a href={p.href}>{p.children}</a> }))
vi.mock('@/lib/analytics/cartEvents', () => ({ reportCardAddToCart: vi.fn() }))
const addItem = vi.fn(); const openCart = vi.fn()
vi.mock('@/store/cartStore', () => ({ useCartStore: (sel: (s: unknown) => unknown) => sel({ addItem }) }))
vi.mock('@/store/uiStore', () => ({ useUIStore: (sel: (s: unknown) => unknown) => sel({ openCart }) }))

import QuickViewModal from '@/components/product/QuickViewModal'
import type { Product, ProductVariant } from '@/types'

const variant = (id: number, size: string, stock: number) =>
  ({ id, size, price: 100 * id, mrp: 120 * id, available_stock: stock, is_active: true }) as unknown as ProductVariant
const product = (variants: ProductVariant[], stock = 10) =>
  ({ id: 1, name: 'Wild Honey', slug: 'wild-honey', image_url: '/x.jpg', price: 100, available_stock: stock, product_variants: variants }) as unknown as Product

function Harness({ p }: { p: Product }) {
  const [open, setOpen] = useState(false)
  const [, setTick] = useState(0)
  return (<>
    <button onClick={() => setOpen(true)}>Quick View</button>
    <button onClick={() => setTick(t => t + 1)}>rerender parent</button>
    {open && <QuickViewModal product={p} initialVariant={null} onClose={() => setOpen(false)} />}
  </>)
}

describe('QuickViewModal accessibility', () => {
  it('moves focus into the dialog, traps Tab, closes on Escape and returns focus to the opener', () => {
    render(<Harness p={product([variant(1, '250g', 5), variant(2, '500g', 5)])} />)
    const opener = screen.getByText('Quick View'); opener.focus()
    fireEvent.click(opener)

    const close = screen.getByRole('button', { name: /close quick view/i })
    expect(document.activeElement).toBe(close)

    // Shift+Tab from the first control wraps to the last; Tab from the last wraps to the first.
    const dialog = screen.getByRole('dialog')
    const focusables = Array.from(dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'))
    const first = focusables[0], last = focusables[focusables.length - 1]
    first.focus(); fireEvent.keyDown(window, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
    last.focus(); fireEvent.keyDown(window, { key: 'Tab' })
    expect(document.activeElement).toBe(first)

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
    expect(document.body.style.overflow).toBe('')            // scroll lock released
  })

  it('announces the selected size to assistive tech', () => {
    render(<Harness p={product([variant(1, '250g', 5), variant(2, '500g', 5)])} />)
    fireEvent.click(screen.getByText('Quick View'))
    const a = screen.getByRole('button', { name: '250g' }), b = screen.getByRole('button', { name: '500g' })
    expect(a.getAttribute('aria-pressed')).toBe('true'); expect(b.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(b)
    expect(b.getAttribute('aria-pressed')).toBe('true'); expect(a.getAttribute('aria-pressed')).toBe('false')
  })

  it('does not offer a dead "Notify Me" button when out of stock', () => {
    render(<Harness p={product([], 0)} />)
    fireEvent.click(screen.getByText('Quick View'))
    expect(screen.queryByText('Notify Me')).toBeNull()
    const btn = screen.getByRole('button', { name: /out of stock/i }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })

  it('re-rendering the parent (new inline onClose each time) does not re-run the scroll lock / reset body padding', () => {
    render(<Harness p={product([variant(1, '250g', 5)])} />)
    fireEvent.click(screen.getByText('Quick View'))
    document.body.style.paddingRight = '17px'                // something else (e.g. cart drawer) adjusts padding
    fireEvent.click(screen.getByText('rerender parent'))     // parent re-renders -> brand-new onClose arrow function
    expect(document.body.style.paddingRight).toBe('17px')    // untouched (the old code reset it to '')
    expect(document.body.style.overflow).toBe('hidden')      // still locked
  })
})
