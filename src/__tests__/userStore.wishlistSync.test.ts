// @vitest-environment jsdom
/**
 * ACC-052 (found by live verification): the client uploaded its WHOLE local wishlist with PUT. On a device whose local list
 * was empty, merely opening the home page sent `PUT {wishlist: []}` and the customer's saved wishlist on the server
 * (live: [11,28]) became []. The storefront now sends only DELTAS (PATCH {add, remove}), which merge into the stored list.
 * Also covers ACC-047 (no duplicate syncs on login).
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

async function loadStore(signedIn = true) {
  const { useUserStore } = await import('@/store/userStore')
  if (signedIn) useUserStore.setState({ user: { id: 'u1', email: 'a@b.com' } as never })
  return useUserStore
}
const calls = () => fetchMock.mock.calls.filter(c => String(c[0]) === '/api/wishlist')
const bodies = () => calls().map(c => JSON.parse(c[1].body))
const tick = (ms = 900) => vi.advanceTimersByTimeAsync(ms)

describe('wishlist sync sends deltas, never the whole list', () => {
  it('NEVER uploads an empty list: rehydrating an empty local wishlist for a signed-in user sends nothing', async () => {
    const store = await loadStore()
    store.setState({ wishlist: [] })                       // what a rehydrate of an empty local list looks like (new array)
    await tick()
    expect(calls()).toHaveLength(0)
  })

  it('uses PATCH with only what the customer changed', async () => {
    const store = await loadStore()
    store.getState().addToWishlist('28')
    await tick()
    expect(calls()).toHaveLength(1)
    expect(calls()[0][1].method).toBe('PATCH')
    expect(bodies()[0]).toEqual({ add: ['28'], remove: [] })
  })

  it('a removal is sent as a removal — and only for the id the customer removed', async () => {
    const store = await loadStore()
    store.setState({ wishlist: ['28', '31'] }); await tick(); fetchMock.mockClear()
    store.getState().removeFromWishlist('28')
    await tick()
    expect(bodies()).toEqual([{ add: [], remove: ['28'] }])
  })

  it('rapid add then remove of the same id cancels out (nothing is sent)', async () => {
    const store = await loadStore()
    store.getState().addToWishlist('28'); store.getState().removeFromWishlist('28')
    await tick()
    expect(calls()).toHaveLength(0)
  })

  it('coalesces rapid taps into ONE request', async () => {
    const store = await loadStore()
    store.getState().addToWishlist('1'); store.getState().addToWishlist('2'); store.getState().addToWishlist('3')
    await tick()
    expect(calls()).toHaveLength(1)
    expect(bodies()[0].add.sort()).toEqual(['1', '2', '3'])
  })

  it('the login merge (server list ∪ local list) only ADDS — it can never remove anything from the account', async () => {
    const store = await loadStore()
    store.setState({ wishlist: ['5'] }); await tick(); fetchMock.mockClear()
    store.getState().setWishlist(['11', '28'])             // useAuth applying the server list
    await tick()
    for (const b of bodies()) expect(b.remove).toEqual([])
  })

  it('a failed request keeps the change and retries it with the next one', async () => {
    const store = await loadStore()
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 })
    store.getState().addToWishlist('28'); await tick()
    store.getState().addToWishlist('31'); await tick()
    expect(bodies()[1].add.sort()).toEqual(['28', '31'])
  })

  it('a guest’s wishlist is uploaded once they sign in (as adds), but never while a guest', async () => {
    const store = await loadStore(false)
    store.getState().addToWishlist('7'); store.getState().addToWishlist('9'); await tick()
    expect(calls()).toHaveLength(0)                        // guest: local only
    store.setState({ user: { id: 'u1', email: 'a@b.com' } as never }); await tick()
    expect(bodies()).toEqual([{ add: expect.arrayContaining(['7', '9']), remove: [] }])
  })

  it('does not send the same work twice while a request is in flight (no double sync on login)', async () => {
    const store = await loadStore()
    let release!: (v: unknown) => void
    fetchMock.mockImplementationOnce(() => new Promise(r => { release = r }))
    store.getState().addToWishlist('28'); await tick()
    store.getState().setWishlist(['28']); await tick()     // same content applied again
    expect(calls()).toHaveLength(1)
    release({ ok: true }); await tick(50)
    expect(calls()).toHaveLength(1)
  })
})

// Nov 2026 verification: a PATCH answer containing ids added on ANOTHER device went into lastSynced but not into the local list,
// so the next login merge (setWishlist) took them for "removed on this device" and hid them here for good.
describe('items added on another device', () => {
  it('appear on this device after a sync and survive the next login merge', async () => {
    const store = await loadStore()
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ wishlist: ['Y', 'X'] }) })   // server: Y (other device) + X (this one)
    store.getState().addToWishlist('X')
    await tick()
    expect(store.getState().wishlist.sort()).toEqual(['X', 'Y'])
    fetchMock.mockClear()
    store.getState().setWishlist(['Y', 'X'])          // next login applies the server list
    expect(store.getState().wishlist.sort()).toEqual(['X', 'Y'])
    await tick()
    expect(calls()).toHaveLength(0)                    // bringing Y in is not a customer edit: nothing is sent back
  })

  it('an id the customer removed here while the request was in flight is NOT brought back', async () => {
    const store = await loadStore()
    store.setState({ wishlist: ['Z'], lastSynced: ['Z'] }); await tick(); fetchMock.mockClear()
    let resolve!: (v: unknown) => void
    fetchMock.mockImplementationOnce(() => new Promise(r => { resolve = r }))
    store.getState().addToWishlist('X'); await tick()           // PATCH {add:[X]} on the wire
    store.getState().removeFromWishlist('Z')                    // removal queued, not yet sent
    resolve({ ok: true, json: async () => ({ wishlist: ['Z', 'X'] }) })
    await tick(0)
    expect(store.getState().wishlist).not.toContain('Z')
  })
})
