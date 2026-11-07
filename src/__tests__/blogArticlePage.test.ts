/**
 * Nov 2026 verification — src/app/blog/[slug]/page.tsx
 *  - articles stayed live with show_blog === 'false' (the index already 404'd)
 *  - meta titles repeated the brand ("… | HimVeda | HimVeda by Pahadi Roots")
 *  - every OG image was declared 1200x630 regardless of its real size
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { blogMetaTitle } from '@/lib/blogMetaTitle'

const state: { settings: Record<string, string>; post: Record<string, unknown> | null } = { settings: {}, post: null }

vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND') } }))
vi.mock('@/lib/getSiteSettings', () => ({ getSiteSettings: vi.fn(async () => state.settings) }))
vi.mock('@/lib/storeData', () => ({ getNormalizedProducts: vi.fn(async () => []) }))
vi.mock('@/lib/supabase', () => {
  const q: any = {
    select: () => q, eq: () => q, neq: () => q, order: () => q, limit: () => q,
    single: async () => ({ data: state.post, error: state.post ? null : { code: 'PGRST116' } }),
    then: (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res),
  }
  return { supabase: { from: () => q } }
})

const POST = {
  id: 'p1', title: 'Why Bilona Ghee', slug: 'bilona-ghee', content: '<p>x</p>', cover_image: 'https://img/x.jpg', og_image: null,
  published_at: '2026-10-01', updated_at: null, excerpt: 'e', meta_title: 'Bilona Ghee Guide | HimVeda', meta_description: 'd',
  focus_keyword: null, keywords: null, canonical_url: null, category: null, tags: null, author: null, reading_time_minutes: 3,
  faq: null, related_product_id: null, related_product_ids: null,
}

beforeEach(() => { state.settings = { show_blog: 'true' }; state.post = { ...POST } })

describe('blogMetaTitle', () => {
  it('strips a trailing "| HimVeda…" brand suffix (the layout template adds it once)', () => {
    expect(blogMetaTitle('Bilona Ghee Guide | HimVeda', 'x')).toBe('Bilona Ghee Guide')
    expect(blogMetaTitle('Bilona Ghee Guide | HimVeda by Pahadi Roots', 'x')).toBe('Bilona Ghee Guide')
    expect(blogMetaTitle('Bilona Ghee Guide | HimVeda | HimVeda by Pahadi Roots', 'x')).toBe('Bilona Ghee Guide')
    expect(blogMetaTitle('HimVeda Honey: a guide', 'x')).toBe('HimVeda Honey: a guide')
    expect(blogMetaTitle(null, 'Post title')).toBe('Post title')
  })
})

describe('blog article page', () => {
  it('generateMetadata does not repeat the brand and drops hard-coded OG dimensions', async () => {
    const { generateMetadata } = await import('@/app/blog/[slug]/page')
    const meta = await generateMetadata({ params: Promise.resolve({ slug: 'bilona-ghee' }) })
    expect(meta.title).toBe('Bilona Ghee Guide')
    const img = (meta.openGraph as { images: Record<string, unknown>[] }).images[0]
    expect(img.url).toBe('https://img/x.jpg')
    expect(img).not.toHaveProperty('width')
    expect(img).not.toHaveProperty('height')
  })

  it("404s when the blog is switched off (show_blog === 'false'), like the blog index", async () => {
    state.settings = { show_blog: 'false' }
    const { default: Page } = await import('@/app/blog/[slug]/page')
    await expect(Page({ params: Promise.resolve({ slug: 'bilona-ghee' }) })).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('renders when the blog is on', async () => {
    const { default: Page } = await import('@/app/blog/[slug]/page')
    await expect(Page({ params: Promise.resolve({ slug: 'bilona-ghee' }) })).resolves.toBeTruthy()
  })
})
