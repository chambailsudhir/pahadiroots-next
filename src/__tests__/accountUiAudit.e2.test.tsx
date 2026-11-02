// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'

vi.mock('next/link', () => ({
  default: ({ children, href, prefetch: _p, ...rest }: { children?: React.ReactNode; href: string; prefetch?: boolean }) =>
    React.createElement('a', { href, ...rest }, children),
}))
vi.mock('next/image', () => ({
  default: (p: { src: string; alt: string }) => React.createElement('img', { src: p.src, alt: p.alt }),
}))
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: '42' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))

import { formatCurrency } from '@/lib/account/utils'
import OrderCard from '@/app/account/_components/OrderCard'
import OrderDetailPage from '@/app/account/orders/[id]/page'
import DangerZoneSection from '@/app/account/_sections/DangerZoneSection'

afterEach(() => { vi.restoreAllMocks() })

describe('formatCurrency', () => {
  it('caps fraction digits at 2 and drops trailing zeros', () => {
    expect(formatCurrency(1234.5678)).toBe('₹1,234.57')
    expect(formatCurrency(499)).toBe('₹499')
    expect(formatCurrency(0.1 + 0.2)).toBe('₹0.3')
  })
})

describe('OrderCard invoice link', () => {
  const base = { id: 7, order_number: 'ORD-1', total_amount: 100, items: [], created_at: '2026-01-01T00:00:00Z' }
  const render1 = (status: string) => render(
    <OrderCard order={{ ...base, order_status: status, _displayStatus: status } as never} canReturn={() => false} onReturnClick={vi.fn()} />,
  )
  it('is a plain anchor (no Next prefetch) for a confirmed order', () => {
    render1('confirmed')
    const a = screen.getByText('Invoice').closest('a')!
    expect(a.getAttribute('href')).toBe('/api/orders/7/invoice')
    expect(a.getAttribute('target')).toBe('_blank')
  })
  it.each(['cancelled', 'pending', 'payment_failed'])('is hidden for %s orders', (st) => {
    render1(st)
    expect(screen.queryByText('Invoice')).toBeNull()
  })
})

function mockOrderFetch(order: Record<string, unknown> | null, status = 200) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
    Promise.resolve(new Response(JSON.stringify(order ? { order } : { error: 'Unauthorized' }), { status })))
}
const baseOrder = {
  id: '42', order_number: 'ORD-42', order_status: 'confirmed', payment_method: 'cod', total_amount: 100,
  created_at: '2026-01-01T00:00:00Z', items: [{ name: 'Honey', qty: 1, price: 100, emoji: '', image_url: null }],
}

describe('Order detail page', () => {
  it('prints address_line1 and falls back to flat/area for legacy rows', async () => {
    mockOrderFetch({ ...baseOrder, shipping_address: { name: 'A', address_line1: '12 Hill Rd', city: 'Dehradun', state: 'Uttarakhand', pincode: '248001' } })
    const { unmount } = render(<OrderDetailPage />)
    expect(await screen.findByText('12 Hill Rd')).toBeTruthy()
    unmount()
    mockOrderFetch({ ...baseOrder, shipping_address: { flat: '5B', area: 'Mall Road', city: 'Dehradun' } })
    render(<OrderDetailPage />)
    expect(await screen.findByText('5B, Mall Road')).toBeTruthy()
    // missing state/pincode must not leave ", —"
    expect(screen.getByText('Dehradun')).toBeTruthy()
  })

  it('offers a sign-in action on 401', async () => {
    mockOrderFetch(null, 401)
    render(<OrderDetailPage />)
    const link = await screen.findByText('Sign in')
    expect(link.getAttribute('href')).toBe('/account')
    expect(screen.queryByText('Unauthorized')).toBeNull()
  })

  it('shows the return reason label, not the internal code', async () => {
    mockOrderFetch({ ...baseOrder, order_status: 'delivered', _return: { status: 'requested', reason: 'damaged', description: null, refund_amount: null, created_at: '', updated_at: null } })
    render(<OrderDetailPage />)
    expect(await screen.findByText(/Reason: Damaged or defective product/)).toBeTruthy()
  })

  it('cancel dialog: backdrop closes it, Tab wraps, focus returns to the opener', async () => {
    mockOrderFetch({ ...baseOrder, can_cancel: true })
    render(<OrderDetailPage />)
    const opener = await screen.findByText('Cancel order')
    opener.focus()
    fireEvent.click(opener)
    const dialog = await screen.findByRole('dialog')
    const select = screen.getByLabelText('Why are you cancelling?')
    const keep = screen.getByText('Keep order')
    keep.focus()
    fireEvent.keyDown(keep, { key: 'Tab' })      // "Yes, cancel" is disabled, so Keep is last -> wraps to the select
    expect(document.activeElement).toBe(select)
    fireEvent.keyDown(select, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(keep)
    fireEvent.mouseDown(dialog)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(opener)
  })
})

describe('DangerZoneSection', () => {
  async function openStep2() {
    render(<DangerZoneSection userEmail="a@b.co" onLogout={vi.fn()} showToast={vi.fn()} />)
    fireEvent.click(screen.getByText('Delete Account'))
    fireEvent.click(await screen.findByText('Continue →'))
    return screen.getByLabelText('Type DELETE to confirm account deletion')
  }
  it('Shift+Tab from the dialog box itself stays inside the dialog', async () => {
    render(<DangerZoneSection userEmail="a@b.co" onLogout={vi.fn()} showToast={vi.fn()} />)
    fireEvent.click(screen.getByText('Delete Account'))
    const box = (await screen.findByRole('dialog')).firstElementChild as HTMLElement
    box.focus()
    fireEvent.keyDown(box, { key: 'Tab', shiftKey: true })
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true)
    expect(document.activeElement).not.toBe(box)
  })
  it('Enter before typing DELETE explains why nothing happened', async () => {
    const input = await openStep2()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect((await screen.findByRole('alert')).textContent).toMatch(/Type DELETE/)
  })
  it('blocks the page behind a status overlay after a successful delete', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(new Response('{}', { status: 200 })))
    const input = await openStep2()
    fireEvent.change(input, { target: { value: 'DELETE' } })
    fireEvent.click(screen.getByText('Permanently Delete Account'))
    expect(await screen.findByText(/Redirecting/)).toBeTruthy()
  })
})
