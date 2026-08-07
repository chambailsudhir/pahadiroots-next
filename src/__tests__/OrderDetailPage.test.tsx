// @vitest-environment jsdom
/**
 * OrderDetailPage.test.tsx
 *
 * Covers src/app/account/orders/[id]/page.tsx — previously untested
 * (listed as a known coverage gap in the audit session summary).
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'order-1' }),
}))

vi.mock('next/image', () => ({
  default: ({ fill, priority, ...props }: Record<string, unknown>) =>
    React.createElement('img', { ...props, alt: props.alt as string }),
}))

const mockFetch = vi.fn()
global.fetch = mockFetch as any

import OrderDetailPage from '@/app/account/orders/[id]/page'

function order(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-1', order_number: 'PR1A2B3C4D', order_status: 'shipped',
    payment_method: 'cod', total_amount: 598, subtotal: 499,
    coupon_discount: 0, shipping_charge: 99, tax: 25,
    created_at: '2026-07-15T10:00:00.000Z',
    items: [{ name: 'Wild Multiflora Honey', qty: 1, price: 499, emoji: '🍯', image_url: null }],
    shipping_address: { name: 'Asha Devi', flat: 'A-12', area: 'Sector 5', city: 'Delhi', state: 'Delhi', pincode: '110001', phone: '9111111111' },
    tracking_number: null, courier: null, _return: null,
    ...overrides,
  }
}

function mockFetchOk(orderData: Record<string, unknown>) {
  mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ order: orderData }) })
}

beforeEach(() => {
  mockFetch.mockReset()
})

describe('Order detail page — loading & error states', () => {
  it('fetches /api/orders/:id and shows the order once loaded', async () => {
    mockFetchOk(order())
    render(<OrderDetailPage />)

    await waitFor(() => expect(screen.getByText('PR1A2B3C4D')).toBeTruthy())
    expect(mockFetch).toHaveBeenCalledWith('/api/orders/order-1', expect.objectContaining({ signal: expect.anything() }))
  })

  it('shows an error message + back-to-account link when the fetch fails', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404, json: () => Promise.resolve({ error: 'Order not found' }) })
    render(<OrderDetailPage />)

    await waitFor(() => expect(screen.getByText('Order not found')).toBeTruthy())
    expect(screen.getByText('← Back to Account').getAttribute('href')).toBe('/account')
  })
})

describe('Order detail page — order info', () => {
  it('renders order number, formatted date, formatted total, and COD payment method', async () => {
    mockFetchOk(order({ payment_method: 'cod', total_amount: 598, created_at: '2026-07-15T10:00:00.000Z' }))
    render(<OrderDetailPage />)

    await waitFor(() => expect(screen.getByText('PR1A2B3C4D')).toBeTruthy())
    expect(screen.getAllByText('₹598').length).toBeGreaterThan(0)
    expect(screen.getByText('Cash on Delivery')).toBeTruthy()
    expect(screen.getByText(/Placed on/)).toBeTruthy()
  })

  it("labels non-COD orders as 'Online Payment'", async () => {
    mockFetchOk(order({ payment_method: 'razorpay' }))
    render(<OrderDetailPage />)
    await waitFor(() => expect(screen.getByText('Online Payment')).toBeTruthy())
  })

  it('shows a tracking chip with the courier URL when tracking_number is set', async () => {
    mockFetchOk(order({ tracking_number: 'AWB123456', courier: 'Delhivery' }))
    render(<OrderDetailPage />)
    await waitFor(() => expect(screen.getByText(/Track Shipment · AWB123456/)).toBeTruthy())
  })

  it('shows no tracking chip when tracking_number is null', async () => {
    mockFetchOk(order({ tracking_number: null }))
    render(<OrderDetailPage />)
    await waitFor(() => expect(screen.getByText('PR1A2B3C4D')).toBeTruthy())
    expect(screen.queryByText(/Track Shipment/)).toBeNull()
  })
})

describe('Order detail page — status tracker', () => {
  it('shows the step tracker (not the cancelled state) for a normal in-progress order', async () => {
    mockFetchOk(order({ order_status: 'shipped' }))
    render(<OrderDetailPage />)
    await waitFor(() => expect(screen.getByText('Shipped')).toBeTruthy())
    expect(screen.getByText('Your order is on the way')).toBeTruthy() // active step's desc
    expect(screen.queryByText('cancelled')).toBeNull()
  })

  it("shows the cancelled state (not the step tracker) when order_status is 'cancelled'", async () => {
    mockFetchOk(order({ order_status: 'cancelled' }))
    render(<OrderDetailPage />)
    await waitFor(() => expect(screen.getByText('cancelled')).toBeTruthy())
    expect(screen.queryByText('Order Confirmed')).toBeNull()
  })

  it("shows the cancelled-style state when order_status is 'returned' (not a step-tracker status)", async () => {
    mockFetchOk(order({ order_status: 'returned' }))
    render(<OrderDetailPage />)
    await waitFor(() => expect(screen.getByText('returned')).toBeTruthy())
  })
})

describe('Order detail page — return status card', () => {
  it('shows nothing extra when _return is null', async () => {
    mockFetchOk(order({ _return: null }))
    render(<OrderDetailPage />)
    await waitFor(() => expect(screen.getByText('PR1A2B3C4D')).toBeTruthy())
    expect(screen.queryByText('Return Status')).toBeNull()
  })

  it('shows the Return Status card with the mapped label and reason when a return exists', async () => {
    mockFetchOk(order({
      _return: { status: 'approved', reason: 'Damaged in transit', description: 'Box was crushed', refund_amount: null, created_at: '2026-07-20T00:00:00.000Z', updated_at: null },
    }))
    render(<OrderDetailPage />)

    await waitFor(() => expect(screen.getByText('Return Status')).toBeTruthy())
    expect(screen.getByText('Return Approved')).toBeTruthy() // STATUS_LABEL['return_approved']
    expect(screen.getByText('Reason: Damaged in transit')).toBeTruthy()
    expect(screen.getByText('Box was crushed')).toBeTruthy()
  })

  it("shows the refunded icon/label for a return.status of 'refunded'", async () => {
    mockFetchOk(order({
      _return: { status: 'refunded', reason: null, description: null, refund_amount: 499, created_at: '2026-07-20T00:00:00.000Z', updated_at: null },
    }))
    render(<OrderDetailPage />)
    await waitFor(() => expect(screen.getByText('Refund Issued')).toBeTruthy())
  })
})

describe('Order detail page — items, address, and price summary', () => {
  it('renders each item with name, quantity, and line total (price × qty)', async () => {
    mockFetchOk(order({
      items: [
        { name: 'Wild Multiflora Honey', qty: 2, price: 499, emoji: '🍯', image_url: null },
        { name: 'Sea Buckthorn Concentrate', qty: 1, price: 799, emoji: '🫐', image_url: null },
      ],
    }))
    render(<OrderDetailPage />)

    await waitFor(() => expect(screen.getByText('Wild Multiflora Honey')).toBeTruthy())
    expect(screen.getByText('Qty: 2')).toBeTruthy()
    expect(screen.getByText('₹998')).toBeTruthy() // 499 * 2
    expect(screen.getByText('₹799')).toBeTruthy()
  })

  it('renders the delivery address, joining flat/area and city/state/pincode', async () => {
    mockFetchOk(order({ shipping_address: { name: 'Asha Devi', flat: 'A-12', area: 'Sector 5', city: 'Delhi', state: 'Delhi', pincode: '110001', phone: '9111111111' } }))
    render(<OrderDetailPage />)

    await waitFor(() => expect(screen.getByText('Asha Devi')).toBeTruthy())
    expect(screen.getByText('A-12, Sector 5')).toBeTruthy()
    expect(screen.getByText('9111111111')).toBeTruthy()
  })

  it('shows FREE for zero shipping_charge, not ₹0', async () => {
    mockFetchOk(order({ shipping_charge: 0 }))
    render(<OrderDetailPage />)
    await waitFor(() => expect(screen.getByText('FREE')).toBeTruthy())
  })

  it('shows the formatted shipping charge when non-zero', async () => {
    mockFetchOk(order({ shipping_charge: 99 }))
    render(<OrderDetailPage />)
    await waitFor(() => expect(screen.getByText('₹99')).toBeTruthy())
  })

  it('shows the discount row only when coupon_discount > 0', async () => {
    mockFetchOk(order({ coupon_discount: 50 }))
    render(<OrderDetailPage />)
    await waitFor(() => expect(screen.getByText('Discount')).toBeTruthy())
    expect(screen.getByText('−₹50')).toBeTruthy()
  })

  it('hides the discount row when coupon_discount is 0', async () => {
    mockFetchOk(order({ coupon_discount: 0 }))
    render(<OrderDetailPage />)
    await waitFor(() => expect(screen.getByText('Price Details')).toBeTruthy())
    expect(screen.queryByText('Discount')).toBeNull()
  })
})

describe('Order detail page — support link', () => {
  it('builds a WhatsApp link with the correct number and an order-number-specific pre-filled message', async () => {
    mockFetchOk(order({ order_number: 'PR1A2B3C4D' }))
    render(<OrderDetailPage />)

    await waitFor(() => expect(screen.getByText('💬 WhatsApp Support')).toBeTruthy())
    const href = screen.getByText('💬 WhatsApp Support').getAttribute('href')!
    expect(href.startsWith('https://wa.me/919899984895?text=')).toBe(true)
    expect(decodeURIComponent(href.split('text=')[1])).toBe('Hi, I need help with order PR1A2B3C4D')
  })
})
