import { MetadataRoute } from 'next'
import { supabase } from '@/lib/supabase'
import { getSiteSettings, isEnabled } from '@/lib/getSiteSettings'

const BASE = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.pahadiroots.com'

// SEO blog engine: without an explicit revalidate window, Next can treat this
// route as fully static at build time — a new blog post published from the
// admin autopilot would never appear in sitemap.xml until the next deploy.
// 1 hour keeps Google's crawl reasonably fresh without hitting Supabase on
// every single sitemap request.
export const revalidate = 3600

// Supabase returns at most 1,000 rows per request, so a plain select silently truncates the sitemap once the catalogue or
// blog grows past that — products simply stop being submitted to Google. Page through instead.
const PAGE = 1000
async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error?: unknown }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1)
    if (error) throw error
    if (!data?.length) break
    out.push(...data)
    if (data.length < PAGE) break
  }
  return out
}

// "Last modified" must mean the content last changed — crawlers learn to ignore a feed that stamps the build time on
// everything. Listing pages take the newest change among the things they list; the fixed content pages use the date their
// text was last reviewed (bump when you edit them).
const CONTENT_REVIEWED = new Date('2026-10-01T00:00:00Z')
const POLICIES_REVIEWED = new Date('2026-10-01T00:00:00Z')
const newest = (dates: (Date | null | undefined)[], fallback: Date): Date => {
  const t = dates.filter((d): d is Date => !!d && !Number.isNaN(d.getTime())).map(d => d.getTime())
  return t.length ? new Date(Math.max(...t)) : fallback
}
const toDate = (v?: string | null) => (v ? new Date(v) : null)

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date()
  // Nov 2026 verification: /blog (+ every post), /our-stories and /mountain-stories were always listed, even with their admin
  // toggles off — those URLs 404, so the sitemap advertised dead pages. Use the exact same rules as the pages themselves.
  // strict: a settings outage must fail the sitemap (last good copy keeps serving), not silently drop sections.
  const settings = await getSiteSettings({ strict: true })
  const blogOn         = settings.show_blog !== 'false'                 // blog/page.tsx, blog/[slug]/page.tsx
  const ourStoriesOn   = settings.about_page_enabled !== 'false'        // our-stories/page.tsx
  const mountainOn     = isEnabled(settings.show_life_in_mountains)     // mountain-stories/page.tsx

  // Products
  let products: { slug: string; updated_at: string | null; image_url: string | null; category_id: number | null; state_id?: string | null }[] = []
  try {
    products = await fetchAll(( from, to ) => supabase.from('products').select('slug, updated_at, image_url, category_id, state_id, is_active')
      .eq('is_deleted', false).eq('status', 'active').order('id').range(from, to))
    products = products.filter(p => (p as { is_active?: boolean | null }).is_active !== false)  // SEC-001: deactivated products are not submitted
  } catch (e: unknown) { console.error('[sitemap] products fetch failed:', e); throw e }

  const productPages: MetadataRoute.Sitemap = products.map(p => ({
    url:             `${BASE}/products/${p.slug}`,
    lastModified:    new Date(p.updated_at || now),
    changeFrequency: 'weekly' as const,
    priority:        0.8,
    // Image sitemap entry: helps Google Images discover the main product photo.
    ...(p.image_url && /^https?:\/\//.test(p.image_url) ? { images: [p.image_url] } : {}),
  }))
  const catalogueUpdated = newest(products.map(p => toDate(p.updated_at)), CONTENT_REVIEWED)

  // Collections — a collection changes when any product in it changes
  let categories: { id: number; slug: string }[] = []
  try {
    categories = await fetchAll(( from, to ) => supabase.from('categories').select('id, slug').eq('is_active', true).order('id').range(from, to))
  } catch (e: unknown) { console.error('[sitemap] categories fetch failed:', e); throw e }

  // Nov 2026 audit: 7 of 10 collections had no products and were still submitted to Google — thin, empty pages that read as broken.
  // Only collections that hold at least one live product are listed; an empty one rejoins the sitemap the day it gets stock.
  const populatedCategoryIds = new Set(products.map(p => p.category_id))
  const collectionPages: MetadataRoute.Sitemap = categories.filter(c => populatedCategoryIds.has(c.id)).map(c => ({
    url:             `${BASE}/collections/${c.slug}`,
    lastModified:    newest(products.filter(p => p.category_id === c.id).map(p => toDate(p.updated_at)), catalogueUpdated),
    changeFrequency: 'daily' as const,
    priority:        0.75,
  }))

  // Regions — only active states (matches getStoreData()/generateStaticParams, so no entry 404s).
  let states: { id: string; updated_at: string | null }[] = []
  try {
    states = await fetchAll(( from, to ) => supabase.from('states').select('id, updated_at').eq('is_active', true).order('id').range(from, to))
  } catch (e: unknown) { console.error('[sitemap] states fetch failed:', e); throw e }

  // Nov 2026 verification: a region with no live products (e.g. /regions/jk) is a thin page (noindex on the page itself);
  // same rule as collections — it rejoins the sitemap once it has products.
  const populatedStateIds = new Set(products.map(p => String(p.state_id ?? '').toLowerCase()).filter(Boolean))
  const regionPages: MetadataRoute.Sitemap = states.filter(s => populatedStateIds.has(String(s.id).toLowerCase())).map(s => ({
    url:             `${BASE}/regions/${s.id}`,
    lastModified:    s.updated_at ? new Date(s.updated_at) : catalogueUpdated,
    changeFrequency: 'weekly' as const,
    priority:        0.65,
  }))

  // Blog posts — only published rows are ever eligible (the editorial `status` column is kept in sync with
  // is_published by a DB trigger).
  let blogPosts: { slug: string; updated_at: string | null; published_at: string | null }[] = []
  if (blogOn) try {
    blogPosts = await fetchAll(( from, to ) => supabase.from('blog_posts').select('slug, updated_at, published_at')
      .eq('is_published', true).order('published_at', { ascending: false }).range(from, to))
  } catch (e: unknown) { console.error('[sitemap] blog fetch failed:', e); throw e }

  const blogPages: MetadataRoute.Sitemap = blogPosts.map(p => ({
    url:             `${BASE}/blog/${p.slug}`,
    lastModified:    new Date(p.updated_at || p.published_at || now),
    changeFrequency: 'monthly' as const,
    priority:        0.6,
  }))
  const blogUpdated   = newest(blogPosts.map(p => toDate(p.updated_at || p.published_at)), CONTENT_REVIEWED)
  const regionUpdated = newest(states.map(s => toDate(s.updated_at)), catalogueUpdated)

  // Static pages. /regions (the hub) and /blog (the listing) are entry points in their own right, separate from the
  // per-item entries above.
  const staticPages: MetadataRoute.Sitemap = [
    { url: BASE,                   lastModified: catalogueUpdated, changeFrequency: 'daily',   priority: 1.0 },
    { url: `${BASE}/products`,     lastModified: catalogueUpdated, changeFrequency: 'daily',   priority: 0.9 },
    { url: `${BASE}/new-arrivals`, lastModified: catalogueUpdated, changeFrequency: 'daily',   priority: 0.7 },
    { url: `${BASE}/regions`,      lastModified: regionUpdated,    changeFrequency: 'weekly',  priority: 0.7 },
    ...(blogOn ? [{ url: `${BASE}/blog`, lastModified: blogUpdated, changeFrequency: 'weekly' as const, priority: 0.7 }] : []),
    ...(ourStoriesOn ? [{ url: `${BASE}/our-stories`, lastModified: CONTENT_REVIEWED, changeFrequency: 'monthly' as const, priority: 0.6 }] : []),
    ...(mountainOn ? [{ url: `${BASE}/mountain-stories`, lastModified: CONTENT_REVIEWED, changeFrequency: 'monthly' as const, priority: 0.5 }] : []),
    { url: `${BASE}/contact`,      lastModified: CONTENT_REVIEWED, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE}/lab-reports`,  lastModified: CONTENT_REVIEWED, changeFrequency: 'monthly', priority: 0.6 },
    // Shipping / returns policy pages get real search volume for FMCG ("cash on delivery available", "return policy").
    { url: `${BASE}/policies/shipping`, lastModified: POLICIES_REVIEWED, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${BASE}/policies/returns`,  lastModified: POLICIES_REVIEWED, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${BASE}/policies/privacy`,  lastModified: POLICIES_REVIEWED, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${BASE}/policies/terms`,    lastModified: POLICIES_REVIEWED, changeFrequency: 'yearly', priority: 0.2 },
  ]

  return [...staticPages, ...productPages, ...collectionPages, ...regionPages, ...blogPages]
}
