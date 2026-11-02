/**
 * ACC-047 — a login used to cost two identical GET /api/profile calls (AuthModal pre-cache + account page init).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sharedProfileRequest, invalidateProfileRequest } from '@/lib/profileRequest'

beforeEach(() => { invalidateProfileRequest(); vi.useRealTimers() })

describe('sharedProfileRequest', () => {
  it('shares one in-flight request between concurrent callers', async () => {
    const fetcher = vi.fn(async () => ({ profile: { id: 1 } }))
    const [a, b] = await Promise.all([sharedProfileRequest(fetcher), sharedProfileRequest(fetcher)])
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(a).toBe(b)
  })

  it('reuses a result that is only seconds old, then asks again', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-02T10:00:00Z'))
    const fetcher = vi.fn(async () => ({ n: fetcher.mock.calls.length }))
    await sharedProfileRequest(fetcher)
    vi.advanceTimersByTime(3_000)
    await sharedProfileRequest(fetcher)
    expect(fetcher).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(2_000)                       // 5 s > reuse window
    await sharedProfileRequest(fetcher)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('invalidate() forces a fresh read (after a profile edit, logout or deletion)', async () => {
    const fetcher = vi.fn(async () => ({ ok: true }))
    await sharedProfileRequest(fetcher)
    invalidateProfileRequest()
    await sharedProfileRequest(fetcher)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('never caches a failure or a null (logged-out) answer', async () => {
    const bad = vi.fn().mockRejectedValueOnce(new Error('503')).mockResolvedValue({ profile: { id: 2 } })
    await expect(sharedProfileRequest(bad)).rejects.toThrow('503')
    await expect(sharedProfileRequest(bad)).resolves.toEqual({ profile: { id: 2 } })
    expect(bad).toHaveBeenCalledTimes(2)

    invalidateProfileRequest()
    const nul = vi.fn(async () => null)
    await sharedProfileRequest(nul); await sharedProfileRequest(nul)
    expect(nul).toHaveBeenCalledTimes(2)
  })

  it('clearing the profile cache (logout) drops the shared copy so the next user never sees it', async () => {
    const { clearProfileCache } = await import('@/lib/profileCache')
    const fetcher = vi.fn(async () => ({ profile: { id: 'previous-user' } }))
    await sharedProfileRequest(fetcher)
    clearProfileCache()
    const next = vi.fn(async () => ({ profile: { id: 'next-user' } }))
    await expect(sharedProfileRequest(next)).resolves.toEqual({ profile: { id: 'next-user' } })
  })

  it('shares state through globalThis, so a bundler that duplicates this module into two chunks still shares ONE request', async () => {
    const fetcher = vi.fn(async () => ({ profile: { id: 7 } }))
    await sharedProfileRequest(fetcher)
    vi.resetModules()                                                              // a second, independent copy of the module
    const copy = await import('@/lib/profileRequest')
    await copy.sharedProfileRequest(fetcher)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
