// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import React from 'react'
import { render, screen } from '@testing-library/react'
import { CartSettingsSeed, useCartSettingsSeed } from '@/components/cart/CartSettingsSeed'
import { CART_SETTING_KEYS } from '@/lib/cartSettingKeys'

function Probe() {
  const s = useCartSettingsSeed()
  return <div data-testid="p">{s ? `free:${s.free_shipping_min}` : 'none'}</div>
}

describe('cart settings seed (server-loaded so the order summary paints at once)', () => {
  it('gives the hook the server-provided settings, and null when there is no provider (browser fetch fallback)', () => {
    const { unmount } = render(<CartSettingsSeed settings={{ free_shipping_min: '0' }}><Probe /></CartSettingsSeed>)
    expect(screen.getByTestId('p').textContent).toBe('free:0')
    unmount()
    render(<Probe />)
    expect(screen.getByTestId('p').textContent).toBe('none')
  })
  it('shares one key list with the cart-settings API and contains the pricing keys the summary needs', () => {
    for (const k of ['free_shipping_min', 'flat_shipping_charge', 'min_order_amount', 'prepaid_discount_pct', 'cod_surcharge_amount']) {
      expect(CART_SETTING_KEYS).toContain(k)
    }
  })
})
