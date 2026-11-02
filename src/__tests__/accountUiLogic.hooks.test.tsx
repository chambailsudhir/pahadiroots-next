/**
 * Account UI logic audit (E1): useProfile address/profile-form behaviour and useAuth logout / expiry.
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const updateProfile = vi.fn()
vi.mock('@/lib/services/profileService', () => ({
  updateProfile: (...a: unknown[]) => updateProfile(...a),
  changePassword: vi.fn(), sendForgotPasswordEmail: vi.fn(),
  fetchProfile: vi.fn(),
  ServiceError: class ServiceError extends Error { status: number; constructor(m: string, s = 500) { super(m); this.status = s } },
}))
const clearProfileCache = vi.fn()
vi.mock('@/lib/profileCache', () => ({ clearProfileCache: () => clearProfileCache() }))
vi.mock('@/lib/clientLogout', () => ({ clearClientPII: () => clearProfileCache() }))
vi.mock('@/lib/analytics/ga4', () => ({ ga4AccountAction: vi.fn() }))

import { useProfile } from '@/app/account/hooks/useProfile'
import { useAuth } from '@/app/account/hooks/useAuth'
import { useUserStore } from '@/store/userStore'

const baseProfile: any = { id: 1, first_name: 'Asha', last_name: 'R', address_line1: '1 Hill Rd', city: 'Nainital', state: 'Uttarakhand', pincode: '263001', phone: '+919876543210', saved_addresses: '[]' }

beforeEach(() => { vi.clearAllMocks(); updateProfile.mockResolvedValue(undefined) })

async function fillAddress(result: any, label: string, addr: string) {
  await act(async () => { result.current.addresses.startAdd() })
  await act(async () => {
    const f = { label, name: 'Asha', phone: '9876543210', addr, city: 'Delhi', state: 'Delhi', pin: '110001' }
    for (const [k, v] of Object.entries(f)) result.current.addresses.setField(k as any, v)
  })
}

describe('useProfile / addresses (E1-1, E1-7)', () => {
  it('adding an address mirrors it into the local profile and clears the checkout cache; the next add keeps it', async () => {
    let profile: any = { ...baseProfile }
    const updateLocal = vi.fn((u: any) => { profile = { ...profile, ...u } })
    const { result, rerender } = renderHook(() => useProfile(profile, updateLocal, vi.fn()))
    await fillAddress(result, 'Home', '12 Green Park')
    await act(async () => { await result.current.addresses.save() })
    expect(updateLocal).toHaveBeenCalledTimes(1)
    expect(JSON.parse(profile.saved_addresses)).toHaveLength(1)
    expect(clearProfileCache).toHaveBeenCalled()
    rerender()
    await fillAddress(result, 'Office', '99 Connaught Place')
    await act(async () => { await result.current.addresses.save() })
    const saved = JSON.parse(profile.saved_addresses)
    expect(saved.map((a: any) => a.label)).toEqual(['Home', 'Office'])
  })

  it('does not touch the local profile or cache when the save fails', async () => {
    updateProfile.mockRejectedValueOnce(new Error('nope'))
    const updateLocal = vi.fn()
    const { result } = renderHook(() => useProfile({ ...baseProfile }, updateLocal, vi.fn()))
    await fillAddress(result, 'Home', '12 Green Park')
    await act(async () => { await result.current.addresses.save() })
    expect(updateLocal).not.toHaveBeenCalled()
    expect(clearProfileCache).not.toHaveBeenCalled()
  })

  it('saving the name clears the checkout profile cache', async () => {
    const { result } = renderHook(() => useProfile({ ...baseProfile }, vi.fn(), vi.fn()))
    act(() => result.current.initFromProfile(baseProfile))
    await act(async () => { await result.current.saveName() })
    expect(clearProfileCache).toHaveBeenCalled()
  })
})

describe('useProfile form sync (E1-3)', () => {
  it('an own save / rollback does not reset the other cards, an external change updates only its field', async () => {
    let profile: any = { ...baseProfile }
    const updateLocal = vi.fn((u: any) => { profile = { ...profile, ...u } })
    const { result, rerender } = renderHook(() => useProfile(profile, updateLocal, vi.fn()))
    act(() => result.current.initFromProfile(profile))
    act(() => result.current.setPf(p => ({ ...p, phone: '9000000000', fname: 'Meera' })))
    updateProfile.mockRejectedValueOnce(new Error('boom'))
    await act(async () => { await result.current.saveName() })   // fails -> rollback
    rerender()
    act(() => result.current.syncFromProfile(profile))            // what page.tsx's effect does after the sig change
    expect(result.current.pf.phone).toBe('9000000000')            // other card untouched
    expect(result.current.pf.fname).toBe('Meera')                 // failed save keeps what was typed
    act(() => result.current.syncFromProfile({ ...profile, city: 'Almora' }))   // external change
    expect(result.current.pf.city).toBe('Almora')
    expect(result.current.pf.phone).toBe('9000000000')
    expect(result.current.pf.fname).toBe('Meera')
  })
})

describe('useAuth logout / expiry (E1-4, E1-9)', () => {
  const assign = vi.fn()
  beforeEach(() => {
    Object.defineProperty(window, 'location', { value: { ...window.location, assign, reload: vi.fn() }, writable: true })
    useUserStore.setState({ user: { id: 'u1', phone: '9', email: 'a@b.c' } as any })
  })

  it('reports failure and does not navigate when the server session was not cleared; retries once', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 })
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useAuth())
    let ok = true
    await act(async () => { ok = await result.current.logout() })
    expect(ok).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(4)   // 2 endpoints x (first try + one retry)
    expect(assign).not.toHaveBeenCalled()
    expect(result.current.loggingOut).toBe(false)
  })

  it('succeeds on a 2xx pair and navigates home', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }))
    const { result } = renderHook(() => useAuth())
    let ok = false
    await act(async () => { ok = await result.current.logout() })
    expect(ok).toBe(true)
    expect(assign).toHaveBeenCalledWith('/')
    expect(useUserStore.getState().user).toBeNull()
  })

  it('markExpired clears the persisted user', () => {
    const { result } = renderHook(() => useAuth())
    act(() => result.current.markExpired())
    expect(result.current.authState).toBe('expired')
    expect(useUserStore.getState().user).toBeNull()
  })

  it('init() with a stale persisted user and a 401 ends in "expired" and clears the store', async () => {
    const svc = await import('@/lib/services/profileService')
    ;(svc.fetchProfile as any).mockRejectedValueOnce(new (svc.ServiceError as any)('x', 401))
    const { result } = renderHook(() => useAuth())
    await act(async () => { await result.current.init() })
    expect(result.current.authState).toBe('expired')
    expect(useUserStore.getState().user).toBeNull()
  })
})
