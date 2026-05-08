import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { supabase } from '@/lib/supabase'

export const metadata: Metadata = {
  title:       'Shop by Region — Pahadi Roots',
  description: 'Explore authentic Himalayan products sourced from different mountain states of India.',
}

export const revalidate = 21600 // 6 hours

interface RegionState {
  id:          string
  name:        string
  description: string | null
  image_path:  string | null
  is_active:   boolean
}

async function fetchStates(): Promise<RegionState[]> {
  try {
    const { data, error } = await supabase
      .from('states')
      .select('id, name, description, image_path, is_active')
      .eq('is_active', true)
      .order('name')
    return error ? [] : (data ?? [])
  } catch {
    return []
  }
}

export default async function RegionsPage() {
  const states = await fetchStates()

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14">
      {/* Page header */}
      <div className="text-center mb-10 sm:mb-14">
        <p className="text-xs tracking-widest font-semibold text-forest-600 uppercase mb-2">
          Explore by Region
        </p>
        <h1 className="text-3xl sm:text-4xl font-bold text-stone-900 mb-3">
          Shop by Mountain State
        </h1>
        <p className="text-stone-500 max-w-xl mx-auto text-sm sm:text-base leading-relaxed">
          Each region of the Himalayas has its own unique terroir. Discover products
          sourced directly from farming communities across India's mountain states.
        </p>
      </div>

      {states.length === 0 ? (
        <div className="text-center py-20">
          <div className="text-5xl mb-4">🏔️</div>
          <p className="text-stone-400">Regions coming soon. Check back shortly.</p>
          <Link
            href="/products"
            className="mt-4 inline-block text-forest-700 font-semibold text-sm hover:underline"
          >
            Browse all products →
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6">
          {states.map(state => (
            <Link
              key={state.id}
              href={`/regions/${state.id}`}
              className="group relative overflow-hidden rounded-2xl bg-stone-100 aspect-[4/3] flex items-end hover:shadow-xl transition-shadow duration-300"
            >
              {/* Background image */}
              {state.image_path ? (
                <Image
                  src={state.image_path}
                  alt={state.name}
                  fill
                  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                  className="object-cover group-hover:scale-105 transition-transform duration-500"
                />
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-forest-800 to-forest-950" />
              )}

              {/* Gradient overlay */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />

              {/* Text */}
              <div className="relative p-5 sm:p-6 w-full">
                <h2 className="text-xl sm:text-2xl font-bold text-white mb-1 group-hover:text-forest-200 transition-colors">
                  {state.name}
                </h2>
                {state.description && (
                  <p className="text-white/70 text-xs sm:text-sm line-clamp-2 leading-relaxed">
                    {state.description}
                  </p>
                )}
                <span className="mt-3 inline-block text-forest-300 text-xs font-semibold tracking-wide group-hover:text-forest-200 transition-colors">
                  Shop now →
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
