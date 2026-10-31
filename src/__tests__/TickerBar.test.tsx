// @vitest-environment jsdom
/**
 * TickerBar — accessibility contract (audit HOME-010 / WCAG 2.2.2 + 4.1.2):
 *  - the duplicated seamless-loop copy is hidden from assistive tech (no double announcements)
 *  - there is a real pause control that works without a mouse, and it toggles the paused state
 */
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import TickerBar from '@/components/layout/TickerBar'
import type { SiteSettings } from '@/types'

const settings = (over: Record<string, string> = {}) => ({
  ticker_1_text: 'Free shipping', ticker_2_text: 'Use code WELCOME50', ...over,
}) as unknown as SiteSettings

describe('TickerBar', () => {
  it('renders nothing when hidden or empty', () => {
    const { container } = render(<TickerBar settings={settings({ ticker_hide: 'true' })} />)
    expect(container.firstChild).toBeNull()
  })

  it('hides the duplicated loop copy from screen readers but not the real items', () => {
    const { container } = render(<TickerBar settings={settings()} />)
    const items = container.querySelectorAll('.ticker-item')
    expect(items.length).toBe(4)                                   // 2 items x 2 copies
    expect([...items].map(i => i.getAttribute('aria-hidden'))).toEqual([null, null, 'true', 'true'])
  })

  it('has a keyboard-operable pause button that toggles the paused class and its own state', () => {
    const { container } = render(<TickerBar settings={settings()} />)
    const btn = screen.getByRole('button', { name: /pause scrolling announcements/i })
    expect(btn.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(btn)
    expect(container.querySelector('.ticker-wrap')!.classList.contains('ticker-paused')).toBe(true)
    expect(screen.getByRole('button', { name: /resume scrolling announcements/i }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: /resume/i }))
    expect(container.querySelector('.ticker-wrap')!.classList.contains('ticker-paused')).toBe(false)
  })
})
