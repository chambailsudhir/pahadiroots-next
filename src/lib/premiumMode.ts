// ═══════════════════════════════════════════════════════════════
// lib/premiumMode.ts — "Premium mode" theme (replaces the old dark toggle).
//
// A deep-forest + antique-gold look. It is driven by a class on <html>
// (`premium`, plus the legacy `dark` class so the existing mega-menu rules in
// globals.css keep working) and remembered in localStorage.
//
// Why a boot script: React only runs after the page has painted, so applying
// the class from a component would flash the light theme first on every page
// load for a returning premium-mode visitor. PREMIUM_BOOT_SCRIPT is a tiny
// inline script in <head> that sets the class before first paint (the same
// technique next-themes and every large storefront use).
// ═══════════════════════════════════════════════════════════════

export const PREMIUM_KEY = 'pr-theme'

/** Inline <head> script: applies the saved theme before first paint. */
export const PREMIUM_BOOT_SCRIPT =
  `try{if(localStorage.getItem('${PREMIUM_KEY}')==='premium'){var c=document.documentElement.classList;c.add('premium');c.add('dark')}}catch(e){}`

export function readPremium(): boolean {
  if (typeof document === 'undefined') return false
  return document.documentElement.classList.contains('premium')
}

/** Turns premium mode on/off, persists the choice and returns the new state. */
export function setPremium(on: boolean): boolean {
  const cl = document.documentElement.classList
  cl.toggle('premium', on)
  cl.toggle('dark', on)
  try { localStorage.setItem(PREMIUM_KEY, on ? 'premium' : 'standard') } catch { /* private mode etc. */ }
  return on
}
