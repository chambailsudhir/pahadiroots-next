import { MetadataRoute } from 'next'
import { supabase } from '@/lib/supabase'

const BASE = process.env.NEXT_PUBLIC_SITE_URL || 'https://pahadiroots.com'

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
    { url: `${BASE}/about`,  lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${BASE}/contact`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
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

  return [...staticPages, ...productPages, ...collectionPages, ...regionPages]
}
