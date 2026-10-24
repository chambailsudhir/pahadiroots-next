import { describe, it, expect } from 'vitest'
import { assertPaymentMethodAvailable, isRazorpayEnabledByAdmin, isStoreOpen, isCodEnabled } from '@/lib/siteSettingsHelpers'
import fs from 'node:fs'
import path from 'node:path'

describe('Razorpay switch (upi_enabled) is ON unless explicitly off, in any spelling', () => {
  it.each([undefined, null, 'true', 'TRUE', '1', 'yes', ''])('%s → enabled', (v) => {
    // '' is treated as a value by isEnabled (not off), matching the checkout UI which only hid the button on an explicit off
    expect(isRazorpayEnabledByAdmin({ upi_enabled: v as string })).toBe(true)
  })
  it.each(['false', 'False', 'FALSE', ' false ', '0', 'off', 'no'])('%j → disabled', (v) => {
    expect(isRazorpayEnabledByAdmin({ upi_enabled: v })).toBe(false)
  })
})

describe('store open switch uses the same parsing everywhere (maintenance gate, order routes, layout)', () => {
  it.each(['false', 'False', '0', 'off', 'no'])('%j → closed', (v) => expect(isStoreOpen({ store_open: v })).toBe(false))
  it.each([undefined, 'true', 'True', '1'])('%s → open', (v) => expect(isStoreOpen({ store_open: v as string })).toBe(true))
})

describe('assertPaymentMethodAvailable (server side gate used by createOrder)', () => {
  it('COD off → rejects COD with the existing message, still allows Razorpay', () => {
    const s = { cod_enabled: 'false', upi_enabled: 'true' }
    expect(() => assertPaymentMethodAvailable('cod', s)).toThrow('COD is not available at this time')
    expect(() => assertPaymentMethodAvailable('razorpay', s)).not.toThrow()
  })
  it('Razorpay off → rejects online payment, still allows COD', () => {
    const s = { cod_enabled: 'true', upi_enabled: 'false' }
    expect(() => assertPaymentMethodAvailable('razorpay', s)).toThrow('Online payment is not available at this time')
    expect(() => assertPaymentMethodAvailable('cod', s)).not.toThrow()
  })
  it('both off → both rejected', () => {
    const s = { cod_enabled: 'false', upi_enabled: 'false' }
    expect(() => assertPaymentMethodAvailable('cod', s)).toThrow()
    expect(() => assertPaymentMethodAvailable('razorpay', s)).toThrow()
  })
  it('COD unset defaults to disabled (unchanged behaviour), Razorpay unset defaults to enabled', () => {
    expect(isCodEnabled({})).toBe(false)
    expect(() => assertPaymentMethodAvailable('razorpay', {})).not.toThrow()
  })
})

describe('wiring (a refactor must not silently remove the server side checks)', () => {
  const root = path.resolve(__dirname, '..')
  const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8')
  it('createOrder calls the availability gate', () => {
    expect(read('lib/services/orderService.ts')).toContain('assertPaymentMethodAvailable(input.paymentMethod')
  })
  it('the maintenance gate caches the flag for at most 5 seconds', () => {
    const m = /STORE_OPEN_TTL_OK_MS\s*=\s*([\d_]+)/.exec(read('proxy.ts'))
    expect(m).not.toBeNull()
    expect(Number(m![1].replace(/_/g, ''))).toBeLessThanOrEqual(5000)
  })
  it('orders and payments routes use the shared store open check', () => {
    expect(read('app/api/v1/orders/route.ts')).toContain('!isStoreOpen(settings)')
    expect(read('app/api/v1/payments/route.ts')).toContain('!isStoreOpen(settings)')
  })
})
