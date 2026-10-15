/** F-09 — optional, settings-driven PIN/state serviceability. */
import { describe, it, expect } from 'vitest'
import { checkServiceability, parseServiceableStates, parseBlockedPincodes } from '@/lib/serviceability'

describe('checkServiceability', () => {
  it('with nothing configured every destination is served (shipping this changes nothing)', () => {
    expect(checkServiceability({ state: 'Kerala', pincode: '682001' }, {})).toEqual({ ok: true })
    expect(checkServiceability({ state: '', pincode: '' }, { serviceable_states: '', blocked_pincodes: '  ' })).toEqual({ ok: true })
  })

  it('serviceable_states is case/space-insensitive', () => {
    const s = { serviceable_states: 'Uttarakhand,  himachal   pradesh ; Jammu & Kashmir' }
    expect(checkServiceability({ state: 'Himachal Pradesh', pincode: '171001' }, s).ok).toBe(true)
    expect(checkServiceability({ state: ' UTTARAKHAND ', pincode: '248001' }, s).ok).toBe(true)
    expect(checkServiceability({ state: 'Jammu & Kashmir', pincode: '190001' }, s).ok).toBe(true)
  })

  it('refuses a state outside the list, naming it', () => {
    const r = checkServiceability({ state: 'Kerala', pincode: '682001' }, { serviceable_states: 'Uttarakhand' })
    expect(r).toEqual({ ok: false, reason: 'Sorry, we do not deliver to Kerala yet.' })
  })

  it('blocks exact PINs and PIN prefixes', () => {
    const s = { blocked_pincodes: '193101, 744' }
    expect(checkServiceability({ state: 'X', pincode: '193101' }, s).ok).toBe(false)
    expect(checkServiceability({ state: 'X', pincode: '744105' }, s).ok).toBe(false)
    expect(checkServiceability({ state: 'X', pincode: '193102' }, s).ok).toBe(true)
  })

  it('ignores junk entries in blocked_pincodes instead of blocking everything', () => {
    expect(parseBlockedPincodes('abc, 12, 1234567, 744')).toEqual(['744'])
    expect(checkServiceability({ state: 'X', pincode: '171001' }, { blocked_pincodes: 'abc' }).ok).toBe(true)
  })

  it('parseServiceableStates normalises', () => {
    expect(parseServiceableStates(' A ,B;C\nD ')).toEqual(['a', 'b', 'c', 'd'])
  })
})
