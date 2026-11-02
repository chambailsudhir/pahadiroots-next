import type { KeyboardEvent } from 'react'

// Shared ARIA-tabs plumbing for the two account tablists (desktop sidebar + mobile bar).
// Both reference ONE tabpanel (the content region), so every tab's aria-controls is ACCOUNT_PANEL_ID and the panel is
// labelled by the desktop tab of the active section (the desktop tablist is always in the DOM; CSS hides it on mobile,
// and aria-labelledby resolves hidden elements).
export const ACCOUNT_PANEL_ID = 'account-tabpanel'
export const sidebarTabId = (key: string) => `acc-tab-${key}`
export const mobileTabId  = (key: string) => `acc-mtab-${key}`

/** WAI-ARIA tabs keyboard model with automatic activation: arrows / Home / End move focus AND select. */
export function onTabKeyDown<K extends string>(
  e: KeyboardEvent<HTMLElement>,
  keys: readonly K[],
  current: K,
  orientation: 'horizontal' | 'vertical',
  select: (k: K) => void,
): void {
  const prev = orientation === 'vertical' ? 'ArrowUp'   : 'ArrowLeft'
  const next = orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight'
  const i = keys.indexOf(current)
  let target = -1
  if (e.key === next) target = (i + 1) % keys.length
  else if (e.key === prev) target = (i - 1 + keys.length) % keys.length
  else if (e.key === 'Home') target = 0
  else if (e.key === 'End') target = keys.length - 1
  if (target < 0) return
  e.preventDefault()
  const list = e.currentTarget.closest('[role="tablist"]')
  const el = list?.querySelectorAll<HTMLElement>('[role="tab"]')[target]
  select(keys[target])
  el?.focus()
}
