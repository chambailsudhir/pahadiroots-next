import { describe, it, expect, beforeEach } from 'vitest'
import { useUserStore } from '@/store/userStore'

const UUID = '0b7e3b0e-1111-4222-8333-444455556666'
const reset = () => useUserStore.setState({ user: null, wishlist: [], wishlistOwner: null, lastSynced: [] } as never)

describe('store user id stays the auth uuid (round-2 audit: the id flipped to customers.id on the first /account load)', () => {
  beforeEach(reset)

  it('re-setting the SAME id (login, then the account page sync) keeps the wishlist', () => {
    useUserStore.getState().setUser({ id: UUID, email: 'a@b.com', name: 'A', phone: '' })
    useUserStore.setState({ wishlist: ['1', '2'] } as never)
    useUserStore.getState().setUser({ id: UUID, email: 'a@b.com', name: 'A', phone: '9876543210' })
    expect(useUserStore.getState().wishlist).toEqual(['1', '2'])
  })

  it('a different id (another person signing in on the same browser) still drops the previous list', () => {
    useUserStore.getState().setUser({ id: UUID, email: 'a@b.com', name: 'A', phone: '' })
    useUserStore.setState({ wishlist: ['1'] } as never)
    useUserStore.getState().setUser({ id: 'a-different-uuid', email: 'c@d.com', name: 'C', phone: '' })
    expect(useUserStore.getState().wishlist).toEqual([])
  })
})
