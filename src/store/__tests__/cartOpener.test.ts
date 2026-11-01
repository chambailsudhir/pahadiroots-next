// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { useUIStore, takeCartOpener } from '../uiStore'

// AUD-035: the cart drawer is lazy-mounted, so it cannot rely on document.activeElement at mount time to know
// which control opened it. openCart() records the opener at click time; focus returns there when the drawer closes.
describe('cart drawer opener (AUD-035)', () => {
  beforeEach(() => { document.body.innerHTML = ''; takeCartOpener() })

  it('records the focused control when the cart opens, and hands it back once', () => {
    const btn = document.createElement('button'); document.body.appendChild(btn); btn.focus()
    useUIStore.getState().openCart()
    expect(takeCartOpener()).toBe(btn)
    expect(takeCartOpener()).toBeNull()
  })

  it('records nothing when focus is on <body> (caller falls back to the header cart button)', () => {
    useUIStore.getState().openCart()
    expect(takeCartOpener()).toBeNull()
  })
})
