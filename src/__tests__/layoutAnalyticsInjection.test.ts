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
// Layout reads categories/states via the cached getCatalogMeta() now (not
// Supabase directly) — see app/layout.tsx.
vi.mock('@/lib/storeData', () => ({
  getCatalogMeta: async () => ({ categories: [], states: [], state_images: [], settings: {} }),
}))
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
  it('loads no Google tag when google_tag_id is unset (the consent bootstrap still runs, with an empty id)', async () => {
    mockGetSiteSettings.mockResolvedValue({})
    const tree = await RootLayout({ children: null })
    const scripts = findAll(tree, 'script')
    expect(scripts.some(s => s.props.src?.includes('googletagmanager.com'))).toBe(false)
    const html = scripts.find(s => s.props.dangerouslySetInnerHTML?.__html?.includes("'consent','default'"))?.props.dangerouslySetInnerHTML.__html as string
    expect(html).toContain('var ID=""')
    expect(findAll(tree, 'noscript')).toHaveLength(0)
  })

  // Launch-readiness (DPDP/GDPR): the Google tag is no longer injected as a plain <script src>. The layout
  // renders ONE inline consent bootstrap (Consent Mode v2 = denied) that only loads gtag.js / gtm.js for a
  // visitor who already opted in, and the <noscript> GTM iframe (which would load GTM for everyone) is gone.
  // The load-on-consent behaviour itself is covered in consent.test.ts / CookieConsent.test.tsx.
  const bootstrapOf = (tree: any) =>
    findAll(tree, 'script').find(s => s.props.dangerouslySetInnerHTML?.__html?.includes("'consent','default'"))

  it('GTM- ID: renders only the consent bootstrap — no direct GTM script, no <noscript> iframe', async () => {
    mockGetSiteSettings.mockResolvedValue({ google_tag_id: 'GTM-ABC1234' })
    const tree = await RootLayout({ children: null })
    const scripts = findAll(tree, 'script')
    const html = bootstrapOf(tree)?.props.dangerouslySetInnerHTML.__html as string
    expect(html).toContain('GTM-ABC1234')
    expect(html).toContain('analytics_storage":"denied')
    expect(scripts.some(s => s.props.src?.includes('googletagmanager.com'))).toBe(false)
    expect(findAll(tree, 'noscript')).toHaveLength(0)
  })

  it('GA4 (G-) ID: renders only the consent bootstrap — gtag.js is not requested before opt-in', async () => {
    mockGetSiteSettings.mockResolvedValue({ google_tag_id: 'G-XYZ987654' })
    const tree = await RootLayout({ children: null })
    const scripts = findAll(tree, 'script')
    const html = bootstrapOf(tree)?.props.dangerouslySetInnerHTML.__html as string
    expect(html).toContain('G-XYZ987654')
    expect(scripts.some(s => s.props.src?.includes('gtag/js'))).toBe(false)
    expect(findAll(tree, 'noscript')).toHaveLength(0)
  })

  it('an unsafe tag id never reaches the page; the owner\'s consent mode does', async () => {
    mockGetSiteSettings.mockResolvedValue({ google_tag_id: "x');alert(1);//", cookie_consent_mode: 'always' })
    const tree = await RootLayout({ children: null })
    const html = bootstrapOf(tree)?.props.dangerouslySetInnerHTML.__html as string
    expect(html).not.toContain('alert(1)'); expect(html).toContain('var ID=""'); expect(html).toContain('var MODE="always"')
  })
})
