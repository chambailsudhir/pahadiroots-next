/**
 * layoutAnalyticsInjection.test.ts
 *
 * Covers the Google Analytics / GTM script injection in RootLayout
 * (src/app/layout.tsx) — previously untested (listed as a known coverage
 * gap in the audit session summary). This was a real P1 fix: the admin
 * SEO tab's own UI claimed "Google Tag ID: GA4 loads automatically ✅"
 * while nothing in the codebase ever read `google_tag_id` or loaded any
 * analytics script at all.
 *
 * RootLayout is an async Server Component — it's called directly here
 * (`await RootLayout({children})`) rather than rendered to a DOM, and the
 * returned React element tree is walked to find the injected <script> /
 * <noscript> tags. That's more robust than `render()` + jsdom for a
 * Server Component like this, and avoids needing to stand up a full DOM
 * for what's fundamentally a "is the right script in the tree" question.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReactElement, ReactNode } from 'react'

const mockGetSiteSettings = vi.fn()
vi.mock('@/lib/getSiteSettings', () => ({
  getSiteSettings: () => mockGetSiteSettings(),
}))

vi.mock('next/font/google', () => ({
  Playfair_Display: () => ({ variable: '--font-playfair' }),
  Lato: () => ({ variable: '--font-lato' }),
}))

vi.mock('@/lib/server/sanitize', () => ({ sanitizeHtml: (s: string) => s }))
vi.mock('@/lib/supabase', () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [] }) }) }) }) },
}))

vi.mock('@/components/layout/Header', () => ({ default: () => null }))
vi.mock('@/components/layout/Footer', () => ({ default: () => null }))
vi.mock('@/components/layout/MobileMenu', () => ({ default: () => null }))
vi.mock('@/app/providers', () => ({ Providers: ({ children }: any) => children }))
vi.mock('@/components/ui/SkipLink', () => ({ default: () => null }))
vi.mock('@/components/ui/ScrollRestorationFix', () => ({ default: () => null }))
vi.mock('@/components/cart/CartDrawer', () => ({ default: () => null }))
vi.mock('@/components/search/SearchOverlay', () => ({ default: () => null }))
vi.mock('@/components/auth/AuthModal', () => ({ default: () => null }))
vi.mock('@/components/auth/GoogleAuthHandler', () => ({ default: () => null }))
vi.mock('@/components/ProfilePrefetcher', () => ({ default: () => null }))

const RootLayout = (await import('@/app/layout')).default

// Walks a React element tree (pre-DOM — just nested {type, props} objects)
// and returns every element whose type matches, in document order.
function findAll(node: ReactNode, type: string): ReactElement<any>[] {
  const out: ReactElement<any>[] = []
  const visit = (n: ReactNode): void => {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n)) { n.forEach(visit); return }
    const el = n as ReactElement<any>
    if (el.type === type) out.push(el)
    const children = el.props?.children
    if (children) visit(children)
  }
  visit(node)
  return out
}

beforeEach(() => {
  mockGetSiteSettings.mockReset()
  mockGetSiteSettings.mockResolvedValue({})
})

describe('RootLayout — Google Analytics / GTM injection reads google_tag_id from settings', () => {
  it('injects nothing when google_tag_id is unset (no-op, matches the fallback-free default)', async () => {
    mockGetSiteSettings.mockResolvedValue({})
    const tree = await RootLayout({ children: null })
    const scripts = findAll(tree, 'script')
    const analyticsScripts = scripts.filter(s =>
      s.props.src?.includes('googletagmanager.com') || s.props.dangerouslySetInnerHTML?.__html?.includes('gtag')
    )
    expect(analyticsScripts).toHaveLength(0)
    expect(findAll(tree, 'noscript')).toHaveLength(0)
  })

  it('injects the GTM container script + <noscript> iframe fallback for a GTM- ID', async () => {
    mockGetSiteSettings.mockResolvedValue({ google_tag_id: 'GTM-ABC1234' })
    const tree = await RootLayout({ children: null })

    const scripts = findAll(tree, 'script')
    const gtmScript = scripts.find(s => s.props.dangerouslySetInnerHTML?.__html?.includes('gtm.js'))
    expect(gtmScript?.props.dangerouslySetInnerHTML.__html).toContain('GTM-ABC1234')

    const noscripts = findAll(tree, 'noscript')
    expect(noscripts).toHaveLength(1)
    const iframe = findAll(noscripts[0], 'iframe')[0]
    expect(iframe.props.src).toBe('https://www.googletagmanager.com/ns.html?id=GTM-ABC1234')

    // A GTM- ID should NOT also trigger the separate gtag.js/GA4 path.
    expect(scripts.some(s => s.props.src?.includes('gtag/js'))).toBe(false)
  })

  it('injects the gtag.js script + inline config for a GA4 (G-) measurement ID', async () => {
    mockGetSiteSettings.mockResolvedValue({ google_tag_id: 'G-XYZ987654' })
    const tree = await RootLayout({ children: null })

    const scripts = findAll(tree, 'script')
    const loaderScript = scripts.find(s => s.props.src?.includes('gtag/js'))
    expect(loaderScript?.props.src).toBe('https://www.googletagmanager.com/gtag/js?id=G-XYZ987654')

    const configScript = scripts.find(s => s.props.dangerouslySetInnerHTML?.__html?.includes("gtag('config'"))
    expect(configScript?.props.dangerouslySetInnerHTML.__html).toContain("gtag('config','G-XYZ987654')")

    // A GA4 ID should NOT also trigger the GTM container / noscript path.
    expect(scripts.some(s => s.props.dangerouslySetInnerHTML?.__html?.includes('gtm.js'))).toBe(false)
    expect(findAll(tree, 'noscript')).toHaveLength(0)
  })
})
