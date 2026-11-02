// @vitest-environment jsdom
/** ACC-043b (client half): the address-list version is remembered, sent back, refreshed and a conflict is surfaced. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getAddressEtag, forgetAddressEtag } from '@/lib/addressVersion'
import { fetchProfile, updateProfile, ServiceError } from '@/lib/services/profileService'
import { invalidateProfileRequest } from '@/lib/profileRequest'

const fetchMock = vi.fn()
const reply = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body })
const lastBody = () => JSON.parse(fetchMock.mock.calls.at(-1)![1].body)

beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); forgetAddressEtag(); invalidateProfileRequest() })

describe('saved-address version on the client', () => {
  it('fetchProfile remembers the version the server reports', async () => {
    fetchMock.mockResolvedValue(reply(200, { profile: { id: 1, saved_addresses: '[]', saved_addresses_etag: 'v1' }, user: { id: 'u' } }))
    await fetchProfile()
    expect(getAddressEtag()).toBe('v1')
  })

  it('an address-list save sends the version it was based on and stores the new one', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { profile: { saved_addresses_etag: 'v1' } }))
    await fetchProfile()
    fetchMock.mockResolvedValueOnce(reply(200, { success: true, saved_addresses_etag: 'v2' }))
    await updateProfile({ saved_addresses: '[]' })
    expect(lastBody()).toMatchObject({ saved_addresses: '[]', saved_addresses_etag: 'v1' })
    expect(getAddressEtag()).toBe('v2')
  })

  it('other profile edits never carry the version', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { profile: { saved_addresses_etag: 'v1' } }))
    await fetchProfile()
    fetchMock.mockResolvedValueOnce(reply(200, { success: true }))
    await updateProfile({ first_name: 'Asha' })
    expect(lastBody()).toEqual({ first_name: 'Asha' })
  })

  it('a 409 conflict surfaces the server message (so the toast tells the customer what happened)', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { profile: { saved_addresses_etag: 'v1' } }))
    await fetchProfile()
    fetchMock.mockResolvedValue(reply(409, { error: 'Your saved addresses were changed in another tab or device. Please reload this page…', code: 'addresses_changed' }))
    await expect(updateProfile({ saved_addresses: '[]' })).rejects.toMatchObject({ status: 409, message: expect.stringContaining('another tab') })
    expect(getAddressEtag()).toBe('v1')           // unchanged — the customer must reload to get the real list
  })
})
