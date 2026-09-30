// @vitest-environment jsdom
/**
 * mountainStories.test.tsx
 *
 * Covers the split of the two homepage story CTAs:
 *   - "Discover Our Story" (BrandStory)      -> /our-stories        (brand / founder story)
 *   - "Read the mountain stories" (LifeInMountains) -> /mountain-stories (dham, Gaddis, forests)
 * Before this fix both CTAs landed on /our-stories, and the #mountain-stories anchor pointed at
 * a "day in the hills" section that did not match the photos on the homepage.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'
import fs from 'fs'
import path from 'path'
import { renderToStaticMarkup } from 'react-dom/server'
import StoryVideo from '@/components/story/StoryVideo'

vi.mock('@/lib/supabase', () => ({ supabase: {}, getServiceClient: () => ({}) }))
vi.mock('next/cache', () => ({ unstable_cache: (fn: (...a: unknown[]) => unknown) => fn, revalidateTag: vi.fn() }))
vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  default: ({ fill, priority, ...p }: Record<string, unknown>) => <img {...(p as React.ImgHTMLAttributes<HTMLImageElement>)} />,
}))
vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('NEXT_NOT_FOUND') },
}))

const mockGetSiteSettings = vi.fn()
vi.mock('@/lib/getSiteSettings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/getSiteSettings')>()
  return { ...actual, getSiteSettings: () => mockGetSiteSettings() }
})

import MountainStoriesPage from '@/app/mountain-stories/page'
import LifeInMountains from '@/components/story/LifeInMountains'
import BrandStory from '@/components/story/BrandStory'

beforeEach(() => {
  mockGetSiteSettings.mockReset()
  // jsdom has no matchMedia; <Reveal> reads it. Report reduced-motion so it skips its observer.
  window.matchMedia = ((q: string) => ({
    matches: true, media: q, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
})

describe('/mountain-stories page', () => {
  it('renders the hero and the three stories with anchors matching the homepage deep-links', async () => {
    mockGetSiteSettings.mockResolvedValue({ show_life_in_mountains: 'true' })
    const ui = await MountainStoriesPage()
    const { container } = render(ui)

    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/still lived/i)
    for (const id of ['dham', 'gaddi', 'forests']) {
      expect(container.querySelector(`section#${id}`), `missing #${id}`).not.toBeNull()
      expect(container.querySelector(`a[href="#${id}"]`), `missing jump link #${id}`).not.toBeNull()
    }
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(3)
    expect(container.querySelector('main')).toBeNull() // layout.tsx already provides <main>
  })

  it('Dham uses the silent looping clip plus the wide kitchen photo; every referenced media file exists', async () => {
    mockGetSiteSettings.mockResolvedValue({})
    const { container } = render(await MountainStoriesPage())

    const video = container.querySelector('section#dham video') as HTMLVideoElement | null
    expect(video, 'dham video missing').not.toBeNull()
    expect(video!.muted).toBe(true)                       // silent + autoplay-eligible
    expect(video!.hasAttribute('loop')).toBe(true)
    expect(video!.getAttribute('poster')).toBe('/story/dham-poster.webp')
    expect(container.querySelector('section#dham figure img[src="/story/dham-kitchen.webp"]')).not.toBeNull()
    expect(container.querySelector('img[src*="dham-pangat"]')).toBeNull()             // removed on request
    expect(container.querySelector('audio')).toBeNull()

    // Gaddi + forests use the supplied photos, and no leftover AI insets remain
    expect(container.querySelector('section#gaddi img[src="/story/gaddi-shepherd.webp"]')).not.toBeNull()
    expect(container.querySelector('section#forests img[src="/story/mountain-village.webp"]')).not.toBeNull()
    expect(container.querySelector('img[src*="day-fire"], img[src*="ghee-pasture"], img[src*="day-bloom"]')).toBeNull()

    const used = Array.from(container.querySelectorAll('img[src], video source[src], video[poster]'))
      .flatMap(el => [el.getAttribute('src'), el.getAttribute('poster')]).filter((x): x is string => !!x && x.startsWith('/story/'))
    expect(new Set(used)).toEqual(new Set(['/story/dham.mp4', '/story/dham-poster.webp', '/story/dham-kitchen.webp', '/story/gaddi-shepherd.webp', '/story/mountain-village.webp']))
    for (const u of used) expect(fs.existsSync(path.join(process.cwd(), 'public', u)), `missing public${u}`).toBe(true)
  })

  it('server-rendered <video> is silent, looping and autoplay-eligible (what the browser sees before JS runs)', () => {
    const html = renderToStaticMarkup(<StoryVideo src="/story/dham.mp4" poster="/story/dham-poster.webp" label="Dham" />)
    expect(html).toMatch(/<video[^>]*\bmuted=""/)
    expect(html).toMatch(/<video[^>]*\bloop=""/)
    expect(html).toMatch(/playsinline/i)
    expect(html).toContain('poster="/story/dham-poster.webp"')
    expect(html).toContain('<source src="/story/dham.mp4" type="video/mp4"/>')
    expect(html).not.toMatch(/\bcontrols\b|autoplay/i)   // JS starts it only while visible; reduced-motion users get controls via effect
  })

  it('is gated by show_life_in_mountains (404 when off, on by default)', async () => {
    mockGetSiteSettings.mockResolvedValue({ show_life_in_mountains: 'false' })
    await expect(MountainStoriesPage()).rejects.toThrow('NEXT_NOT_FOUND')

    mockGetSiteSettings.mockResolvedValue({})
    await expect(MountainStoriesPage()).resolves.toBeTruthy()
  })
})

describe('homepage story CTAs', () => {
  it('"Read the mountain stories" and its photos go to /mountain-stories, not /our-stories', () => {
    const { container } = render(<LifeInMountains />)
    const cta = screen.getByText(/Read the mountain stories/i).closest('a')
    expect(cta?.getAttribute('href')).toBe('/mountain-stories')
    const hrefs = Array.from(container.querySelectorAll('a')).map(a => a.getAttribute('href'))
    expect(hrefs).toEqual(expect.arrayContaining([
      '/mountain-stories#dham', '/mountain-stories#gaddi', '/mountain-stories#forests',
    ]))
    expect(hrefs.some(h => h?.startsWith('/our-stories'))).toBe(false)
  })

  it('"Discover Our Story" still goes to /our-stories', () => {
    render(<BrandStory />)
    expect(screen.getByText(/Discover Our Story/i).closest('a')?.getAttribute('href')).toBe('/our-stories')
  })
})
