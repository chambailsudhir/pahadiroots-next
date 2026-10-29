/**
 * socialLinks.systemAudit.test.tsx — System audit (Oct 2026).
 * Footer social links came straight from admin settings into href, with hard-coded guesses for blank fields
 * (blank X/Twitter field → a link to twitter.com/pahadiroots, an account nobody confirmed is ours).
 */
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'
import { safeSocialUrl } from '@/lib/siteSettingsHelpers'
import { getFooterData, SocialRow } from '@/components/layout/FooterShared'
import type { SiteSettings } from '@/types'

const S = (o: Record<string, string>) => o as unknown as SiteSettings

describe('safeSocialUrl', () => {
  it('accepts a real https profile address', () => {
    expect(safeSocialUrl('https://www.instagram.com/himveda.pahadiroots/')).toBe('https://www.instagram.com/himveda.pahadiroots/')
    expect(safeSocialUrl('  https://linkedin.com/company/himveda-by-pahadiroots  ')).toBe('https://linkedin.com/company/himveda-by-pahadiroots'.trim())
  })
  it.each(['', '   ', undefined, null, 'javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html,<script>x</script>', 'http://insecure.example/x', 'ftp://x.example',
    'instagram.com/x', '//evil.example/x', 'https://nodot', 'https://has space.example', 'https://' + 'a'.repeat(600) + '.com'])('%j → ""', (v) => {
    expect(safeSocialUrl(v as string)).toBe('')
  })
})

describe('footer social row', () => {
  const live = S({
    social_instagram: 'https://www.instagram.com/himveda.pahadiroots/', social_facebook: 'https://www.facebook.com/HimVedaByPahadiRoots',
    social_youtube: 'https://www.youtube.com/@HimVedaPahadiRoots', social_linkedin: 'https://linkedin.com/company/himveda-by-pahadiroots', social_twitter: '',
  })
  it('the live configuration (X left blank) shows four icons and NO X link; no guessed twitter.com/pahadiroots anywhere', () => {
    const html = renderToStaticMarkup(React.createElement(SocialRow, { d: getFooterData(live) }))
    expect(html).toContain('aria-label="Instagram"'); expect(html).toContain('aria-label="Facebook"'); expect(html).toContain('aria-label="YouTube"'); expect(html).toContain('aria-label="LinkedIn"')
    expect(html).not.toContain('aria-label="X"')
    expect(html).not.toMatch(/twitter\.com/)
    expect(html).not.toContain('x.com/pahadiroots')
  })
  it('the configured value wins, and every link opens safely (noopener noreferrer, new tab)', () => {
    const html = renderToStaticMarkup(React.createElement(SocialRow, { d: getFooterData(S({ ...live as any, social_twitter: 'https://x.com/himveda' })) }))
    expect(html).toContain('href="https://x.com/himveda"')
    expect((html.match(/rel="noopener noreferrer"/g) || []).length).toBe(5)
  })
  it('an unsafe stored value (javascript:, http:) renders NO link at all', () => {
    const html = renderToStaticMarkup(React.createElement(SocialRow, { d: getFooterData(S({ social_instagram: 'javascript:alert(1)', social_facebook: 'http://insecure.example/x' })) }))
    expect(html).toBe('')
    expect(html).not.toContain('javascript:')
  })
  it('nothing configured → no social icons and no crash', () => {
    expect(renderToStaticMarkup(React.createElement(SocialRow, { d: getFooterData(S({})) }))).toBe('')
  })
  it('the legacy linkedin_url key still works when social_linkedin is empty', () => {
    expect(getFooterData(S({ linkedin_url: 'https://linkedin.com/company/x-co' })).linkedin).toBe('https://linkedin.com/company/x-co')
  })
})
