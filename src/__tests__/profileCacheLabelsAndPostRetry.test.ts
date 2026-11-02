// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildCacheEntry } from '@/lib/profileCache'
import { ADDRESS_LABELS } from '@/lib/account/constants'
import { updateProfile } from '@/lib/services/profileService'
import { forgetAddressEtag } from '@/lib/addressVersion'

describe('profileCache — address labels', () => {
  it.each([...ADDRESS_LABELS, 'Others'])('keeps a saved address labelled %s for checkout', (label) => {
    const entry = buildCacheEntry({
      first_name: 'Asha', phone: '9876543210',
      saved_addresses: JSON.stringify([{ id: 'x', label, addr: '12 Lane', city: 'Shimla', state: 'Himachal Pradesh', pin: '171001' }]),
    } as never)
    expect(entry.addresses.some(a => a.label === label)).toBe(true)
  })

  it('still drops an unknown label', () => {
    const entry = buildCacheEntry({
      first_name: 'Asha',
      saved_addresses: JSON.stringify([{ id: 'x', label: 'Bogus', addr: '12 Lane', city: 'Shimla', pin: '171001' }]),
    } as never)
    expect(entry.addresses.some(a => String(a.label) === 'Bogus')).toBe(false)
  })
})

describe('updateProfile — POST retry policy', () => {
  const fetchMock = vi.fn()
  const reply = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body })
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); forgetAddressEtag() })

  it('does not blindly retry a generic 500 (the write may have half-run)', async () => {
    fetchMock.mockResolvedValue(reply(500, { error: 'Profile update failed' }))
    await expect(updateProfile({ first_name: 'A' })).rejects.toMatchObject({ status: 500 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries a 503 once and succeeds', async () => {
    vi.useFakeTimers()
    fetchMock.mockResolvedValueOnce(reply(503, { error: 'busy' })).mockResolvedValueOnce(reply(200, { success: true }))
    const p = updateProfile({ first_name: 'A' })
    await vi.advanceTimersByTimeAsync(1000)
    await expect(p).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })
})
