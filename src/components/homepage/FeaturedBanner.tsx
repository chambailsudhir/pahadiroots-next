import Link from 'next/link'
import { supabase } from '@/lib/supabase'

interface Props { slug: string }

export default async function FeaturedBanner({ slug }: Props) {
  let cat = null
  try {
    const { data } = await supabase
      .from('categories')
      .select('id, name, slug, description, image_url')
      .eq('slug', slug)
      .single()
    cat = data
  } catch { cat = null }

  if (!cat) return null

  return (
    <section className="py-6 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        <Link href={`/collections/${cat.slug}`} className="group block">
          <div className="relative overflow-hidden rounded-2xl bg-forest-800 h-44 sm:h-56">
            {cat.image_url && (
              <div
                className="absolute inset-0 bg-cover bg-center opacity-30 group-hover:opacity-40 transition-opacity"
                style={{ backgroundImage: `url(${cat.image_url})` }}
              />
            )}
            <div className="absolute inset-0 bg-gradient-to-r from-forest-900/80 to-transparent" />
            <div className="relative h-full flex items-center px-8 sm:px-12">
              <div>
                <div className="text-forest-300 text-xs font-bold uppercase tracking-widest mb-2">
                  Featured Collection
                </div>
                <h3 className="text-white text-2xl sm:text-3xl font-bold mb-3">{cat.name}</h3>
                {cat.description && (
                  <p className="text-white/70 text-sm max-w-sm mb-4 line-clamp-2">{cat.description}</p>
                )}
                <span className="inline-flex items-center gap-2 bg-earth-500 group-hover:bg-earth-600 text-white text-sm font-bold px-5 py-2 rounded-xl transition-colors">
                  Shop Now
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                  </svg>
                </span>
              </div>
            </div>
          </div>
        </Link>
      </div>
    </section>
  )
}
