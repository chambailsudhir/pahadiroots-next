// @vitest-environment jsdom
/**
 * Audit Nov 2026 (wishlist): ownership of the local list across accounts, un-favourite during an in-flight add,
 * and no whole-list re-upload on every page load.
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

const load = async () => (await import('@/store/userStore')).useUserStore
const calls  = () => fetchMock.mock.calls.filter(c => String(c[0]) === '/api/wishlist')
const bodies = () => calls().map(c => JSON.parse(c[1].body))
const tick = (ms = 900) => vi.advanceTimersByTimeAsync(ms)
const user = (id: string) => ({ id, email: `${id}@x.com` }) as never

describe('wishlist ownership across accounts', () => {
  it("another user signing in on the same browser does not inherit or upload the previous user's list", async () => {
    const s = await load()
    s.getState().setUser(user('A')); s.getState().addToWishlist('1'); s.getState().addToWishlist('2'); await tick()
    fetchMock.mockClear()
    s.getState().logout()
    expect(s.getState().wishlist).toEqual(['1', '2'])            // kept for A
    s.getState().setUser(user('B')); await tick()
    expect(s.getState().wishlist).toEqual([])
    expect(calls()).toHaveLength(0)                                // nothing of A's reached B's account
    s.getState().setWishlist(['9'])
    expect(s.getState().wishlist).toEqual(['9'])
  })

  it('the same user signing back in keeps the list', async () => {
    const s = await load()
    s.getState().setUser(user('A')); s.getState().addToWishlist('1'); await tick()
    s.getState().logout(); s.getState().setUser(user('A'))
    expect(s.getState().wishlist).toEqual(['1'])
  })

  it('a guest list is still merged into the first account that signs in', async () => {
    const s = await load()
    s.getState().addToWishlist('7'); s.getState().addToWishlist('9')
    s.getState().setUser(user('A')); await tick()
    expect(bodies()).toEqual([{ add: expect.arrayContaining(['7', '9']), remove: [] }])
    expect(s.getState().wishlistOwner).toBe('A')
  })

  it('pending deltas of user A are never flushed after user B signs in', async () => {
    const s = await load()
    s.getState().setUser(user('A')); s.getState().addToWishlist('1')   // pending, debounce not elapsed
    s.getState().logout(); s.getState().setUser(user('B')); await tick()
    expect(calls()).toHaveLength(0)
  })

  it('a user set without setUser() follows the same rules', async () => {
    const s = await load()
    s.setState({ user: user('A'), wishlistOwner: 'A', wishlist: ['1'], lastSynced: ['1'] }); await tick()
    s.setState({ user: null }); s.setState({ user: user('B') }); await tick()
    expect(s.getState().wishlist).toEqual([]); expect(calls()).toHaveLength(0)
  })

  it('logout({clearWishlist}) wipes the list (account deletion)', async () => {
    const s = await load()
    s.getState().setUser(user('A')); s.getState().addToWishlist('1')
    s.getState().logout({ clearWishlist: true })
    expect(s.getState().wishlist).toEqual([]); expect(s.getState().wishlistOwner).toBeNull()
  })
})

describe('un-favourite during an in-flight add', () => {
  it('queues a remove so the server does not keep the item', async () => {
    const s = await load()
    s.getState().setUser(user('A'))
    let release!: (v: unknown) => void
    fetchMock.mockImplementationOnce(() => new Promise(r => { release = r }))
    s.getState().addToWishlist('5'); await tick()                 // add:[5] on the wire
    s.getState().removeFromWishlist('5')                           // un-favourite while in flight
    release({ ok: true }); await tick()
    expect(bodies()).toEqual([{ add: ['5'], remove: [] }, { add: [], remove: ['5'] }])
  })

  it('add, remove, add, remove during flight still ends with a remove', async () => {
    const s = await load()
    s.getState().setUser(user('A'))
    let release!: (v: unknown) => void
    fetchMock.mockImplementationOnce(() => new Promise(r => { release = r }))
    s.getState().addToWishlist('5'); await tick()
    s.getState().removeFromWishlist('5'); s.getState().addToWishlist('5'); s.getState().removeFromWishlist('5')
    release({ ok: true }); await tick()
    expect(bodies()[1]).toEqual({ add: [], remove: ['5'] })
  })

  it('unsent add+remove pairs still collapse', async () => {
    const s = await load()
    s.getState().setUser(user('A'))
    s.getState().addToWishlist('5'); s.getState().removeFromWishlist('5'); await tick()
    expect(calls()).toHaveLength(0)
  })
})

describe('reload does not re-upload the whole list', () => {
  it('a hydrated, already-synced list sends nothing', async () => {
    localStorage.setItem('pr-user', JSON.stringify({ state: { user: { id: 'A' }, wishlist: ['1', '2'], wishlistOwner: 'A', lastSynced: ['1', '2'] }, version: 1 }))
    const s = await load()
    await s.persist.rehydrate(); await tick()
    expect(calls()).toHaveLength(0)
  })

  it('only ids not yet synced are uploaded on load', async () => {
    localStorage.setItem('pr-user', JSON.stringify({ state: { user: { id: 'A' }, wishlist: ['1', '2', '3'], wishlistOwner: 'A', lastSynced: ['1', '2'] }, version: 1 }))
    const s = await load()
    await s.persist.rehydrate(); await tick()
    expect(bodies()).toEqual([{ add: ['3'], remove: [] }])
  })

  it('an item removed on another device is not resurrected by a stale device, nor re-sent', async () => {
    const s = await load()
    s.setState({ user: user('A'), wishlistOwner: 'A', wishlist: ['1', '2', '3'], lastSynced: ['1', '2', '3'] }); await tick()
    s.getState().setWishlist(['1', '3'])                           // server no longer has 2
    await tick()
    expect(s.getState().wishlist).toEqual(['1', '3'])
    expect(calls()).toHaveLength(0)
  })

  it('an item the customer removed here is not resurrected by the server list before the removal is sent', async () => {
    const s = await load()
    s.setState({ user: user('A'), wishlistOwner: 'A', wishlist: ['1', '2'], lastSynced: ['1', '2'] }); await tick()
    s.getState().removeFromWishlist('2')
    s.getState().setWishlist(['1', '2'])
    expect(s.getState().wishlist).toEqual(['1'])
    await tick()
    expect(bodies()).toEqual([{ add: [], remove: ['2'] }])
  })

  it('ACC-052: an empty local list never erases the server list', async () => {
    const s = await load()
    s.setState({ user: user('A'), wishlistOwner: 'A', wishlist: [], lastSynced: [] }); await tick()
    s.getState().setWishlist(['11', '28']); await tick()
    expect([...s.getState().wishlist].sort()).toEqual(['11', '28'])
    expect(calls()).toHaveLength(0)
  })

  it('records the server list after a successful sync', async () => {
    const s = await load()
    s.getState().setUser(user('A'))
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ wishlist: ['5', '6'] }) })
    s.getState().addToWishlist('5'); await tick()
    expect(s.getState().lastSynced).toEqual(['5', '6'])
  })

  it('a full wishlist (409 wishlist_full) drops the adds instead of retrying them forever', async () => {
    const s = await load()
    s.getState().setUser(user('A'))
    fetchMock.mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ code: 'wishlist_full' }) })
    s.getState().addToWishlist('5'); await tick()
    s.getState().addToWishlist('6'); await tick()
    expect(bodies()[1]).toEqual({ add: ['6'], remove: [] })
  })
})
