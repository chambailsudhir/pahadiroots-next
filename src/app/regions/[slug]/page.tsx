import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import ProductCard from '@/components/product/ProductCard'
import type { Product } from '@/types'

export const revalidate = 21600 // 6hr

interface Props { params: { slug: string } }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const state = await fetchState(params.slug)
  if (!state) return { title: 'Region Not Found' }
  return {
    title:       `${state.name} Products — Shop Authentic Himalayan Products`,
    description: state.description?.slice(0, 155) || `Explore pure natural products from ${state.name}, sourced directly from mountain farming communities.`,
  }
}

export default async function RegionPage({ params }: Props) {
  const state = await fetchState(params.slug)
  if (!state) notFound()

  let products = null
  try {
    const { data } = await supabase
      .from('products')
      .select(`
        id, name, slug, emoji, price, mrp, available_stock, gst_rate,
        image_url, unit_label, badges_bestseller, badges_new,
        category_id, is_deleted, status,
        categories:categories(id, name, slug),
        product_variants(id, price, mrp, size, available_stock, is_active)
      `)
      .eq('state_id', state.id)
      .eq('is_deleted', false)
      .eq('status', 'active')
      .order('badges_bestseller', { ascending: false })
      .limit(24)
    products = data
  } catch { products = null }

  const stateProducts = (products as unknown as Product[]) || []

  return (
    <div>
      {/* Hero */}
      <div className="relative h-64 sm:h-80 bg-forest-900 overflow-hidden">
        {state.image_url && (
          <Image src={state.image_url} alt={state.name} fill sizes="100vw" className="object-cover opacity-50" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-forest-950/80 to-transparent" />
        <div className="absolute inset-0 flex flex-col justify-end px-6 sm:px-12 lg:px-20 pb-8">
          <div className="flex items-center gap-2 text-xs text-forest-300 mb-2">
            <Link href="/" className="hover:text-white">Home</Link>
            <span>/</span>
            <span className="text-white">Regions</span>
            <span>/</span>
            <span className="text-white">{state.name}</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-white">{state.name}</h1>
          {state.region && (
            <p className="text-forest-300 text-sm mt-1">{state.region}</p>
          )}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">

        {/* Story */}
        {state.description && (
          <div className="max-w-2xl mb-10">
            <h2 className="text-lg font-bold text-stone-900 mb-3">About {state.name}</h2>
            <p className="text-stone-600 leading-relaxed text-sm">{state.description}</p>
          </div>
        )}

        {/* Products */}
        <div>
          <h2 className="text-xl font-bold text-stone-900 mb-6">
            Products from {state.name}
            <span className="ml-2 text-sm font-normal text-stone-400">({stateProducts.length})</span>
          </h2>

          {stateProducts.length === 0 ? (
            <div className="text-center py-16">
              <div className="text-4xl mb-3">🏔️</div>
              <p className="text-stone-400">Products from this region coming soon.</p>
              <Link href="/products" className="mt-4 inline-block text-forest-700 text-sm font-semibold hover:underline">
                Browse all products →
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-5">
              {stateProducts.map((p, i) => (
                <ProductCard key={p.id} product={p} priority={i < 4} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

async function fetchState(slug: string) {
  try {
    const { data, error } = await supabase
      .from('states')
      .select('id, name, slug, description, image_url, region')
      .eq('slug', slug)
      .single()
    return error ? null : data
  } catch { return null }
}

export async function generateStaticParams() {
  let data = null
  try { const r = await supabase.from('states').select('slug'); data = r.data } catch {}
  return (data || []).map((s: any) => ({ slug: s.slug }))
}
