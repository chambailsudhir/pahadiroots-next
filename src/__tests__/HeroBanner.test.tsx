// @vitest-environment jsdom
/**
 * HeroBanner.test.tsx
 *
 * Component-level coverage for the P1 audit fix: with multiple hero
 * slides, every slide rendered its own <h1> — since all slides stay
 * mounted simultaneously (only opacity toggles), N slides meant N <h1>
 * elements coexisting in the DOM at once. Bad for SEO (one clear H1
 * expected) and for screen readers, which read every hidden slide's
 * text in full since none of them were aria-hidden. Zero test coverage
 * existed for this component before this file.
 */

import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import React from 'react'

vi.mock('next/image', () => ({
  default: ({ fill, priority, ...props }: Record<string, unknown>) =>
    React.createElement('img', { ...props, alt: props.alt as string }),
}))
vi.mock('next/link', () => ({
  default: ({ children, href }: { children?: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}))

window.matchMedia = window.matchMedia || vi.fn().mockImplementation((query: string) => ({
  matches: false,
  media: query,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
}))

import HeroBanner from '@/components/homepage/HeroBanner'
import type { SiteSettings } from '@/types'

const settings = {} as SiteSettings

const slides = [
  { url: '/hero1.jpg', alt_text: 'Slide 1', title: 'First Slide' },
  { url: '/hero2.jpg', alt_text: 'Slide 2', title: 'Second Slide' },
  { url: '/hero3.jpg', alt_text: 'Slide 3', title: 'Third Slide' },
]

describe('HeroBanner — single <h1> across multiple slides (P1 fix)', () => {
  it('renders exactly one <h1> even with 3 slides mounted at once', () => {
    const { container } = render(<HeroBanner images={slides} settings={settings} />)
    // This is the actual bug: the old version rendered one <h1> PER
    // slide, all mounted simultaneously — 3 slides would mean 3 <h1>s.
    expect(container.querySelectorAll('h1').length).toBe(1)
  })

  it('the single <h1> belongs to the currently visible (first) slide', () => {
    const { container } = render(<HeroBanner images={slides} settings={settings} />)
    expect(container.querySelector('h1')?.textContent).toContain('First Slide')
  })

  it('non-visible slides are aria-hidden so screen readers skip them', () => {
    const { container } = render(<HeroBanner images={slides} settings={settings} />)
    const slideWrappers = container.querySelectorAll('[aria-hidden]')
    // 2 of the 3 slides (everything but the currently-visible one) should
    // be aria-hidden.
    const hiddenCount = Array.from(slideWrappers).filter(el => el.getAttribute('aria-hidden') === 'true').length
    expect(hiddenCount).toBe(2)
  })

  it('the visible slide is not aria-hidden', () => {
    const { container } = render(<HeroBanner images={slides} settings={settings} />)
    const h1 = container.querySelector('h1')
    // Walk up to the slide wrapper and confirm it isn't hidden.
    const slideWrapper = h1?.closest('[aria-hidden]')
    expect(slideWrapper?.getAttribute('aria-hidden')).toBe('false')
  })

  it('single-image case still renders one real <h1>', () => {
    const { container } = render(<HeroBanner images={[slides[0]]} settings={settings} />)
    expect(container.querySelectorAll('h1').length).toBe(1)
  })

  it('no-images fallback case renders exactly one <h1> (not part of a loop, so never duplicated)', () => {
    const { container } = render(<HeroBanner images={[]} settings={settings} />)
    expect(container.querySelectorAll('h1').length).toBe(1)
  })
})

describe('HeroBanner — admin-schema fields (eyebrow, colours, coupon, CTAs, video, headline highlight)', () => {
  it('renders a custom eyebrow instead of the hardcoded default', () => {
    const { container } = render(<HeroBanner images={[{ url: '/hero1.jpg', eyebrow: 'Summer Collection' }]} settings={settings} />)
    expect(container.textContent).toContain('Summer Collection')
    expect(container.textContent).not.toContain('Pure · Himalayan · Natural')
  })

  it('parses *word* in the headline into a highlighted <em>, not literal asterisks', () => {
    const { container } = render(<HeroBanner images={[{ url: '/hero1.jpg', title: 'Born in the *Himalayas*' }]} settings={settings} />)
    const h1 = container.querySelector('h1')
    expect(h1?.textContent).toBe('Born in the Himalayas')
    expect(h1?.querySelector('em')?.textContent).toBe('Himalayas')
  })

  it('renders the coupon badge when coupon fields are set', () => {
    const { container } = render(<HeroBanner images={[{ url: '/hero1.jpg', coupon_offer: 'FLAT 10% OFF', coupon_code: 'SUMMER10' }]} settings={settings} />)
    expect(container.textContent).toContain('FLAT 10% OFF')
    expect(container.textContent).toContain('SUMMER10')
  })

  it('omits the coupon badge when no coupon fields are set', () => {
    const { container } = render(<HeroBanner images={[{ url: '/hero1.jpg' }]} settings={settings} />)
    expect(container.textContent).not.toContain('OFF')
  })

  it('uses per-slide CTA text and link instead of the hardcoded /products and /about', () => {
    const { container } = render(<HeroBanner images={[{ url: '/hero1.jpg', cta_text: 'Shop Honey', cta_link: '/collections/honey', cta2_text: 'Learn More', cta2_link: '/faq' }]} settings={settings} />)
    const links = Array.from(container.querySelectorAll('a'))
    expect(links.some(a => a.getAttribute('href') === '/collections/honey' && a.textContent === 'Shop Honey')).toBe(true)
    expect(links.some(a => a.getAttribute('href') === '/faq' && a.textContent?.includes('Learn More'))).toBe(true)
  })

  it('renders a <video> background when a slide has a video set', () => {
    const { container } = render(<HeroBanner images={[{ url: '/hero1.jpg', video: '/hero1.mp4' }]} settings={settings} />)
    const video = container.querySelector('video')
    expect(video?.getAttribute('src')).toBe('/hero1.mp4')
    expect(video?.getAttribute('poster')).toBe('/hero1.jpg')
  })

  it('does not crash on a video-only slide with no still image', () => {
    const { container } = render(<HeroBanner images={[{ url: '', video: '/hero1.mp4' }]} settings={settings} />)
    expect(container.querySelector('video')?.getAttribute('src')).toBe('/hero1.mp4')
  })

  it('renders a self-contained banner image (no text fields set) without the default overlay text or CTA buttons', () => {
    const { container } = render(<HeroBanner images={[{ url: '/hero1.jpg', alt_text: 'Sea Buckthorn banner' }]} settings={settings} />)
    expect(container.textContent).not.toContain('Explore Our Store')
    expect(container.textContent).not.toContain('Born in the')
    expect(container.querySelectorAll('h1').length).toBe(1)
    expect(container.querySelector('h1')?.textContent).toBe('Sea Buckthorn banner')
  })

  it('still shows the default overlay text/CTA when a slide has a plain photo plus at least one admin-set text field', () => {
    const { container } = render(<HeroBanner images={[{ url: '/hero1.jpg', subtitle: 'Handcrafted in small batches' }]} settings={settings} />)
    expect(container.textContent).toContain('Explore Our Store')
    expect(container.textContent).toContain('Handcrafted in small batches')
  })
})
