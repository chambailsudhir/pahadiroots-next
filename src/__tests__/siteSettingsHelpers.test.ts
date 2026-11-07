import { describe, it, expect } from 'vitest'

import { stripServerOnlySettings, SERVER_ONLY_SETTING_KEYS } from '@/lib/siteSettingsHelpers'
describe('stripServerOnlySettings (keeps admin-only keys out of client component props)', () => {
  it('removes the admin notification address and email switch, keeps everything else', () => {
    const input = { whatsapp_number: '91999', admin_notify_email: 'ops@example.com', order_email_enabled: 'true', fssai_license: '123' }
    const out = stripServerOnlySettings(input)
    expect(out).toEqual({ whatsapp_number: '91999', fssai_license: '123' })
    for (const k of SERVER_ONLY_SETTING_KEYS) expect(k in out).toBe(false)
  })
  it('does not mutate the original object (server code still needs the keys)', () => {
    const input = { admin_notify_email: 'ops@example.com' }
    stripServerOnlySettings(input)
    expect(input.admin_notify_email).toBe('ops@example.com')
  })
})

import { settingsForCheckout, CHECKOUT_CLIENT_SETTING_KEYS } from '@/lib/siteSettingsHelpers'
describe('settingsForCheckout — ALLOW-list for the /checkout client tree (L-09)', () => {
  it('is exactly the set of keys the checkout client reads — nothing more', () => {
    expect([...CHECKOUT_CLIENT_SETTING_KEYS].sort()).toEqual([
      'cod_enabled', 'cod_max_value', 'cod_surcharge_amount', 'flat_shipping_charge', 'free_shipping_min',
      'loyalty_coin_step_rupees', 'loyalty_coins_per_order', 'loyalty_coins_per_step', 'loyalty_enabled', 'loyalty_max_redeem_pct', 'loyalty_min_redeem',
      'loyalty_points_label', 'loyalty_points_value', 'min_order_amount', 'prepaid_discount_pct', 'upi_enabled', 'whatsapp_number',
    ])
  })
  it('drops every key that is not on the list (an admin-only key added later never reaches the browser)', () => {
    const input = {
      cod_enabled: 'true', free_shipping_min: '499', whatsapp_number: '919999',
      admin_notify_email: 'ops@example.com', order_email_enabled: 'true', some_future_internal_key: 'secret', ann_text: 'hello',
    }
    const out = settingsForCheckout(input) as Record<string, unknown>
    expect(Object.keys(out).sort()).toEqual(['cod_enabled', 'free_shipping_min', 'whatsapp_number'])
    expect(input.admin_notify_email).toBe('ops@example.com')   // never mutates the server copy
  })
  it('does not invent keys that are missing from the source (defaults stay with the readers)', () => {
    expect(settingsForCheckout({})).toEqual({})
  })
})
