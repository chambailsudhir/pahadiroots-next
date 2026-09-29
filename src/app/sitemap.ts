import { MetadataRoute } from 'next'
import { supabase } from '@/lib/supabase'

const BASE = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.pahadiroots.com'

// SEO blog engine: without an explicit revalidate window, Next can treat this
// route as fully static at build time — a new blog post published from the
// admin autopilot would never appear in sitemap.xml until the next deploy.
// 1 hour keeps Google's crawl reasonably fresh without hitting Supabase on
// every single sitemap request.
export const revalidate = 3600

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date()

  // Static pages
  // BUG FIX: /regions (the hub/listing page) was never included here — only
  // the individual /regions/{id} detail pages were submitted below, so the
  // index page itself was never in the sitemap Google receives.
  const staticPages: MetadataRoute.Sitemap = [
    { url: BASE,             lastModified: now, changeFrequency: 'daily',   priority: 1.0 },
    { url: `${BASE}/products`, lastModified: now, changeFrequency: 'daily', priority: 0.9 },
    { url: `${BASE}/regions`, lastModified: now, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${BASE}/our-stories`,  lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${BASE}/contact`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    // SEO blog engine: the listing page itself, separate from the per-post
    // entries below, so Google always has an entry point into the section
    // even in the rare case the posts query below fails.
    { url: `${BASE}/blog`,   lastModified: now, changeFrequency: 'weekly', priority: 0.7 },
    // SEO FIX: these 4 legal/policy pages existed, had real content, and
    // (as of this same fix pass) real per-page metadata — but were never
    // in the sitemap at all, so Google had no declared entry point to
    // them beyond whatever internal links happen to point there (mostly
    // just the footer). Low priority since they're not sales-driving
    // pages, but shipping/returns policy pages do get real search volume
    // for FMCG ("cash on delivery available", "return policy") and can
    // build trust signals when they rank.
    { url: `${BASE}/policies/shipping`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${BASE}/policies/returns`,  lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${BASE}/policies/privacy`,  lastModified: now, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${BASE}/policies/terms`,    lastModified: now, changeFrequency: 'yearly', priority: 0.2 },
  ]

  // Products
  let products = null
  try { const { data } = await supabase.from('products').select('slug, updated_at').eq('is_deleted', false).eq('status', 'active'); products = data } catch (e: unknown) { console.error('[sitemap] fetch failed:', e) }

  const productPages: MetadataRoute.Sitemap = (products || []).map(p => ({
    url:             `${BASE}/products/${p.slug}`,
    lastModified:    new Date(p.updated_at || now),
    changeFrequency: 'weekly' as const,
    priority:        0.8,
  }))

  // Collections
  let categories = null
  try { const { data } = await supabase.from('categories').select('slug').eq('is_active', true); categories = data } catch (e: unknown) { console.error('[sitemap] fetch failed:', e) }

  const collectionPages: MetadataRoute.Sitemap = (categories || []).map(c => ({
    url:             `${BASE}/collections/${c.slug}`,
    lastModified:    now,
    changeFrequency: 'daily' as const,
    priority:        0.75,
  }))

  // Regions
  // BUG FIX: this query had no is_active filter, while getStoreData() (which
  // drives /regions/[slug]'s generateStaticParams) filters is_active=true.
  // Any inactive state was getting a sitemap entry that would 404 when
  // Google crawled it. Now matches the same filter.
  //
  // BUG FIX (#7): previously selected only `id`, so lastModified was always
  // stamped `now` on every build regardless of whether the state actually
  // changed — meaningless for crawlers. Confirmed via live schema query
  // that states.updated_at exists, so it's now selected and used, matching
  // how products already do it below.
  let states = null
  try {
    const { data } = await supabase.from('states').select('id, updated_at').eq('is_active', true)
    states = data
  } catch (e: unknown) { console.error('[sitemap] fetch failed:', e) }

  const regionPages: MetadataRoute.Sitemap = (states || []).map(s => ({
    url:             `${BASE}/regions/${s.id}`,
    lastModified:    s.updated_at ? new Date(s.updated_at) : now,
    changeFrequency: 'weekly' as const,
    priority:        0.65,
  }))

  // Blog posts (SEO blog engine — 047_blog_seo_engine.sql)
  // Only is_published=true rows are ever eligible for the sitemap — the
  // editorial `status` column (draft/pending_review/scheduled) is kept in
  // sync with is_published by a DB trigger, so this one filter is always
  // correct regardless of how a post reached publication.
  let blogPosts = null
  try {
    const { data } = await supabase
      .from('blog_posts')
      .select('slug, updated_at, published_at')
      .eq('is_published', true)
    blogPosts = data
  } catch (e: unknown) { console.error('[sitemap] blog fetch failed:', e) }

  const blogPages: MetadataRoute.Sitemap = (blogPosts || []).map(p => ({
    url:             `${BASE}/blog/${p.slug}`,
    lastModified:    new Date(p.updated_at || p.published_at || now),
    changeFrequency: 'monthly' as const,
    priority:        0.6,
  }))

  return [...staticPages, ...productPages, ...collectionPages, ...regionPages, ...blogPages]
}
