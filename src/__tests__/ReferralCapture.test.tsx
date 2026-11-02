// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'

const state = vi.hoisted(() => ({ user: null as null | { id: string } }))
vi.mock('@/store/userStore', () => ({ useUserStore: (sel: (s: typeof state) => unknown) => sel(state) }))
import ReferralCapture from '@/components/auth/ReferralCapture'
import { REF_STORAGE_KEY } from '@/lib/referral'

const fetchMock = vi.fn()
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); state.user = null; vi.stubGlobal('fetch', fetchMock); fetchMock.mockResolvedValue({ ok: true, status: 200 }) })

describe('ReferralCapture', () => {
  it('remembers ?ref= for a visitor who is not signed in, and sends nothing yet', () => {
    window.history.pushState({}, '', '/?ref=ab12cd34')
    render(<ReferralCapture />)
    expect(JSON.parse(localStorage.getItem(REF_STORAGE_KEY)!).code).toBe('AB12CD34')
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('once signed in, offers the code to the server once and forgets it', async () => {
    window.history.pushState({}, '', '/')
    localStorage.setItem(REF_STORAGE_KEY, JSON.stringify({ code: 'AB12CD34', at: Date.now() }))
    state.user = { id: 'u1' }
    render(<ReferralCapture />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/referral')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ code: 'AB12CD34' })
    await waitFor(() => expect(localStorage.getItem(REF_STORAGE_KEY)).toBeNull())
  })
  it('keeps the code when the server is unavailable, so a later page view can retry', async () => {
    window.history.pushState({}, '', '/')
    localStorage.setItem(REF_STORAGE_KEY, JSON.stringify({ code: 'AB12CD34', at: Date.now() }))
    state.user = { id: 'u1' }
    fetchMock.mockResolvedValue({ ok: false, status: 503 })
    render(<ReferralCapture />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(localStorage.getItem(REF_STORAGE_KEY)).not.toBeNull()
  })
  it('does nothing for a signed-in visitor with no remembered code', () => {
    window.history.pushState({}, '', '/'); state.user = { id: 'u1' }
    render(<ReferralCapture />)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
