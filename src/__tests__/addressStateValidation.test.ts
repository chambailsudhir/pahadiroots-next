// 25 Oct 2026: GST depends on the delivery state, so the server accepts only a real Indian state or
// union territory and stores its canonical spelling. Free text like "Utter prades" was found in live data.
import { describe, it, expect } from 'vitest'
import { addressSchema } from '@/lib/schemas'

const base = { name: 'Asha Devi', phone: '9876543210', flat: '12 Main Road', city: 'Shimla', pincode: '171001' }
// PIN must be consistent with the state since the Nov 2026 audit (lib/pinState.ts) — each case uses a real PIN of that state.

describe('addressSchema state', () => {
  it('accepts a real state and returns the canonical spelling', () => {
    expect(addressSchema.parse({ ...base, state: 'himachal pradesh' }).state).toBe('Himachal Pradesh')
    expect(addressSchema.parse({ ...base, pincode: '110001', state: '  DELHI ' }).state).toBe('Delhi')
    expect(addressSchema.parse({ ...base, pincode: '248001', state: 'Uttarakhand' }).state).toBe('Uttarakhand')
  })
  it('accepts union territories', () => {
    expect(addressSchema.parse({ ...base, pincode: '194101', state: 'Ladakh' }).state).toBe('Ladakh')
    expect(addressSchema.parse({ ...base, pincode: '160017', state: 'chandigarh' }).state).toBe('Chandigarh')
  })
  it('rejects free text that would break the GST split', () => {
    expect(addressSchema.safeParse({ ...base, state: 'Utter prades' }).success).toBe(false)
    expect(addressSchema.safeParse({ ...base, state: 'Mars' }).success).toBe(false)
    expect(addressSchema.safeParse({ ...base, state: 'HP' }).success).toBe(false)
  })
})
