/**
 * pincodeDelivery.test.ts
 *
 * Covers the audit finding #6 fix: PincodeRow now shows an inline delivery
 * estimate instead of always hopping to WhatsApp.
 *
 *   1. estimateDelivery() — PIN validation, zone-based tiering, no-fabrication
 *      (returns null rather than a fake answer for malformed input).
 *   2. PincodeRow component — Check button shows the inline estimate and does
 *      NOT open WhatsApp for a valid PIN; invalid PIN shows an error and does
 *      NOT show an estimate; the secondary "Confirm on WhatsApp" link still
 *      opens WhatsApp with a pre-filled message.
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/react'
import React from 'react'
import { estimateDelivery, PIN_REGEX } from '@/lib/pincodeZones'
import PincodeRow from '@/components/product/PincodeRow'
import { DELIVERY_WINDOWS_TEXT, SHIPPING_TIMING } from '@/lib/shippingCopy'

describe('estimateDelivery', () => {
  it('rejects PINs that are not 6 digits', () => {
    expect(estimateDelivery('12345')).toBeNull()
    expect(estimateDelivery('1234567')).toBeNull()
    expect(estimateDelivery('')).toBeNull()
  })

  it('rejects a PIN starting with 0 (not a valid Indian PIN)', () => {
    expect(estimateDelivery('012345')).toBeNull()
    expect(PIN_REGEX.test('012345')).toBe(false)
  })

  it('rejects non-numeric input', () => {
    expect(estimateDelivery('abcdef')).toBeNull()
  })

  it('gives the fastest tier for the origin zone (Himachal Pradesh, zone 1)', () => {
    const est = estimateDelivery('171001') // Shimla, HP
    expect(est).not.toBeNull()
    expect(est!.etaLabel).toBe('2-4 business days')
  })

  it('gives the middle tier for zones adjacent to origin (UP/Uttarakhand = 2, Bihar/Jharkhand = 8)', () => {
    expect(estimateDelivery('201001')!.etaLabel).toBe('4-6 business days') // zone 2
    expect(estimateDelivery('800001')!.etaLabel).toBe('4-6 business days') // zone 8
  })

  it('gives the longest tier for distant zones', () => {
    expect(estimateDelivery('600001')!.etaLabel).toBe('5-8 business days') // Tamil Nadu, zone 6
    expect(estimateDelivery('700001')!.etaLabel).toBe('5-8 business days') // West Bengal, zone 7
  })

  it('never returns a bare numeric promise — always includes the region label alongside the estimate', () => {
    const est = estimateDelivery('400001')! // Maharashtra
    expect(est.zoneLabel).toContain('Maharashtra')
    expect(est.etaLabel).toMatch(/business days/)
  })
})

describe('PincodeRow', () => {
  const openSpy = vi.fn()

  beforeEach(() => {
    openSpy.mockClear()
    vi.stubGlobal('open', openSpy)
  })

  it('shows an inline estimate for a valid PIN and does NOT open WhatsApp', () => {
    render(React.createElement(PincodeRow, { waNumber: '919999999999', deliveryWindows: DELIVERY_WINDOWS_TEXT }))
    fireEvent.change(screen.getByLabelText('PIN code'), { target: { value: '171001' } })
    fireEvent.click(screen.getByLabelText('Check delivery for entered PIN code'))

    // PDP audit P1-6: shows the Shipping Policy's windows (not the old per-zone 2-4 / 4-6 / 5-8 tiers).
    const status = screen.getByRole('status')
    expect(status.textContent).toContain(SHIPPING_TIMING.metro)
    expect(status.textContent).toContain(SHIPPING_TIMING.remote)
    expect(status.textContent).toContain('Himachal Pradesh')
    expect(status.textContent).not.toMatch(/2-4 business days/)
    expect(openSpy).not.toHaveBeenCalled()
  })

  it('says we do not deliver when the PIN matches the admin\'s blocked PIN list (PDP audit P2-3)', () => {
    render(React.createElement(PincodeRow, { waNumber: '919999999999', blockedPincodes: '1941, 7900', deliveryWindows: DELIVERY_WINDOWS_TEXT }))
    fireEvent.change(screen.getByLabelText('PIN code'), { target: { value: '194101' } })
    fireEvent.click(screen.getByLabelText('Check delivery for entered PIN code'))
    expect(screen.getByRole('status').textContent).toMatch(/do not deliver to PIN code 194101/)
    expect(screen.queryByText('Confirm exact date on WhatsApp')).toBeNull()
  })

  it('does not block a PIN that is not on the list, and clears the blocked message on edit', () => {
    render(React.createElement(PincodeRow, { waNumber: '919999999999', blockedPincodes: '1941', deliveryWindows: DELIVERY_WINDOWS_TEXT }))
    fireEvent.change(screen.getByLabelText('PIN code'), { target: { value: '194101' } })
    fireEvent.click(screen.getByLabelText('Check delivery for entered PIN code'))
    expect(screen.getByRole('status').textContent).toMatch(/do not deliver/)
    fireEvent.change(screen.getByLabelText('PIN code'), { target: { value: '110001' } })
    expect(screen.queryByRole('status')).toBeNull()
    fireEvent.click(screen.getByLabelText('Check delivery for entered PIN code'))
    expect(screen.getByRole('status').textContent).not.toMatch(/do not deliver/)
  })

  it('lists the admin\'s serviceable states and defers the state check to checkout when a state list is set', () => {
    render(React.createElement(PincodeRow, { waNumber: '919999999999', serviceableStates: 'himachal pradesh, uttarakhand', deliveryWindows: DELIVERY_WINDOWS_TEXT }))
    fireEvent.change(screen.getByLabelText('PIN code'), { target: { value: '171001' } })
    fireEvent.click(screen.getByLabelText('Check delivery for entered PIN code'))
    expect(screen.getByRole('status').textContent).toMatch(/We currently deliver to Himachal Pradesh, Uttarakhand; your state is confirmed at checkout/)
  })

  it('no longer renders the stale "5 PAHADI ROOTS" vendor chip', () => {
    const { container } = render(React.createElement(PincodeRow, { waNumber: '919999999999' }))
    expect(container.textContent).not.toMatch(/PAHADI ROOTS/i)
    expect(container.textContent).not.toMatch(/VENDOR/i)
  })

  it('shows an error and no estimate for an invalid PIN', () => {
    render(React.createElement(PincodeRow, { waNumber: '919999999999' }))
    fireEvent.change(screen.getByLabelText('PIN code'), { target: { value: '123' } })
    fireEvent.click(screen.getByLabelText('Check delivery for entered PIN code'))

    expect(screen.getByRole('alert').textContent).toMatch(/valid 6-digit PIN/i)
    expect(screen.queryByText(/business days/)).toBeNull()
    expect(openSpy).not.toHaveBeenCalled()
  })

  it('opens WhatsApp with a pre-filled message only when the secondary confirm link is used', () => {
    render(React.createElement(PincodeRow, { waNumber: '919999999999' }))
    fireEvent.change(screen.getByLabelText('PIN code'), { target: { value: '171001' } })
    fireEvent.click(screen.getByLabelText('Check delivery for entered PIN code'))
    fireEvent.click(screen.getByText('Confirm exact date on WhatsApp'))

    expect(openSpy).toHaveBeenCalledTimes(1)
    const [url] = openSpy.mock.calls[0]
    expect(url).toContain('https://wa.me/919999999999')
    expect(url).toContain('171001')
  })

  it('clears the estimate when the PIN is edited again', () => {
    render(React.createElement(PincodeRow, { waNumber: '919999999999', deliveryWindows: DELIVERY_WINDOWS_TEXT }))
    fireEvent.change(screen.getByLabelText('PIN code'), { target: { value: '171001' } })
    fireEvent.click(screen.getByLabelText('Check delivery for entered PIN code'))
    expect(screen.getByRole('status')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('PIN code'), { target: { value: '171002' } })
    expect(screen.queryByRole('status')).toBeNull()
  })
})
