// @vitest-environment jsdom
/**
 * ACC-047 — login applied the server wishlist twice (new array each time) → two identical PUT /api/wishlist.
 * Only a PUT the server confirmed is remembered, so nothing is ever lost.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const fetchMock = vi.fn()

beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers()
  fetchMock.mockReset(); fetchMock.mockResolvedValue({ ok: true })
  vi.stubGlobal('fetch', fetchMock)
  localStorage.clear()
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

async function loadStore() {
  const { useUserStore } = await import('@/store/userStore')
  useUserStore.setState({ user: { id: 'u1', email: 'a@b.com' } as never })
  return useUserStore
}
const puts = () => fetchMock.mock.calls.filter(c => String(c[0]) === '/api/wishlist' && c[1]?.method === 'PUT')

describe('wishlist sync de-duplication', () => {
  it('sends ONE PUT when the same list is applied twice as new arrays (login merge, then account init)', async () => {
    const store = await loadStore()
    store.getState().setWishlist(['28', '31'])
    await vi.advanceTimersByTimeAsync(900)
    store.getState().setWishlist(['31', '28'])          // same content, new reference, different order
    await vi.advanceTimersByTimeAsync(900)
    expect(puts()).toHaveLength(1)
  })

  it('still syncs a genuinely different list', async () => {
    const store = await loadStore()
    store.getState().setWishlist(['28'])
    await vi.advanceTimersByTimeAsync(900)
    store.getState().setWishlist(['28', '31'])
    await vi.advanceTimersByTimeAsync(900)
    expect(puts()).toHaveLength(2)
  })

  it('does NOT remember a failed PUT — the identical list is retried', async () => {
    const store = await loadStore()
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 })
    store.getState().setWishlist(['28'])
    await vi.advanceTimersByTimeAsync(900)
    store.getState().setWishlist(['28'])
    await vi.advanceTimersByTimeAsync(900)
    expect(puts()).toHaveLength(2)
  })

  it('a guest list uploaded for the first time after login is always sent', async () => {
    const store = await loadStore()
    store.getState().setWishlist(['7', '9'])
    await vi.advanceTimersByTimeAsync(900)
    expect(puts()).toHaveLength(1)
    expect(JSON.parse(puts()[0][1].body)).toEqual({ wishlist: ['7', '9'] })
  })
})
