// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { PREMIUM_BOOT_SCRIPT, PREMIUM_KEY, readPremium, setPremium } from '@/lib/premiumMode'

beforeEach(() => {
  document.documentElement.className = ''
  localStorage.clear()
})

describe('premium mode', () => {
  it('starts off', () => {
    expect(readPremium()).toBe(false)
  })

  it('turning it on adds the premium (and legacy dark) classes and persists the choice', () => {
    expect(setPremium(true)).toBe(true)
    expect(readPremium()).toBe(true)
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(localStorage.getItem(PREMIUM_KEY)).toBe('premium')
  })

  it('turning it off removes both classes and persists "standard"', () => {
    setPremium(true)
    setPremium(false)
    expect(readPremium()).toBe(false)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(localStorage.getItem(PREMIUM_KEY)).toBe('standard')
  })

  it('the pre-paint boot script restores a saved premium choice (no light-theme flash)', () => {
    localStorage.setItem(PREMIUM_KEY, 'premium')
    new Function(PREMIUM_BOOT_SCRIPT)()
    expect(readPremium()).toBe(true)
  })

  it('the boot script does nothing for a visitor who never chose premium', () => {
    new Function(PREMIUM_BOOT_SCRIPT)()
    expect(readPremium()).toBe(false)
  })
})
