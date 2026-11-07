// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import CoinNudge from '@/components/loyalty/CoinNudge'
import { useUserStore } from '@/store/userStore'

const ON = { loyalty_enabled: 'true' }

describe('CoinNudge (cart + checkout)', () => {
  beforeEach(() => { useUserStore.setState({ user: null } as never) })
  it('a signed-in customer at ₹380 sees "Add ₹120 more to earn 5 Pahadi Coins on delivery"', () => {
    useUserStore.setState({ user: { id: 'u1', email: 'a@b.com' } } as never)
    const { getByTestId } = render(<CoinNudge total={380} settings={ON} />)
    expect(getByTestId('coin-nudge').textContent).toBe('🪙 Add ₹120 more to earn 5 Pahadi Coins on delivery')
  })
  it('above ₹500 it says "more"', () => {
    useUserStore.setState({ user: { id: 'u1', email: 'a@b.com' } } as never)
    const { getByTestId } = render(<CoinNudge total={750} settings={ON} />)
    expect(getByTestId('coin-nudge').textContent).toContain('Add ₹250 more to earn 5 more Pahadi Coins')
  })
  it('guests and stores with coins off see nothing', () => {
    expect(render(<CoinNudge total={380} settings={ON} />).container.textContent).toBe('')
    useUserStore.setState({ user: { id: 'u1', email: 'a@b.com' } } as never)
    expect(render(<CoinNudge total={380} settings={{ loyalty_enabled: 'false' }} />).container.textContent).toBe('')
  })
})
