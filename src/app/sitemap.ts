import { MetadataRoute } from 'next'
import { supabase } from '@/lib/supabase'

const BASE = process.env.NEXT_PUBLIC_SITE_URL || 'https://pahadiroots.com'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date()

  // Static pages
  const staticPages: MetadataRoute.Sitemap = [
    { url: BASE,             lastModified: now, changeFrequency: 'daily',   priority: 1.0 },
    { url: `${BASE}/products`, lastModified: now, changeFrequency: 'daily', priority: 0.9 },
    { url: `${BASE}/about`,  lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${BASE}/contact`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
  ]

  // Products
  let products = null
  try { const { data } = await supabase.from('products').select('slug, updated_at').eq('is_deleted', false).eq('status', 'active'); products = data } catch {}

  const productPages: MetadataRoute.Sitemap = (products || []).map(p => ({
    url:             `${BASE}/products/${p.slug}`,
    lastModified:    new Date(p.updated_at || now),
    changeFrequency: 'weekly' as const,
    priority:        0.8,
  }))

  // Collections
  let categories = null
  try { const { data } = await supabase.from('categories').select('slug').eq('is_active', true); categories = data } catch {}

  const collectionPages: MetadataRoute.Sitemap = (categories || []).map(c => ({
    url:             `${BASE}/collections/${c.slug}`,
    lastModified:    now,
    changeFrequency: 'daily' as const,
    priority:        0.75,
  }))

  // Regions
  let states = null
  try { const { data } = await supabase.from('states').select('id'); states = data } catch {}

  const regionPages: MetadataRoute.Sitemap = (states || []).map(s => ({
    url:             `${BASE}/regions/${s.id}`,
    lastModified:    now,
    changeFrequency: 'weekly' as const,
    priority:        0.65,
  }))

  return [...staticPages, ...productPages, ...collectionPages, ...regionPages]
}
