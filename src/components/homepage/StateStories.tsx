import Link from 'next/link'
import Image from 'next/image'
import type { State } from '@/types'

interface Props { states: State[] }

export default function StateStories({ states }: Props) {
  if (!states.length) return null

  return (
    <section className="py-12 sm:py-16 bg-stone-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-9">
          <p className="text-xs font-bold uppercase tracking-widest text-earth-600 mb-2">
            Explore the Mountains
          </p>
          <h2 className="text-2xl sm:text-3xl font-bold text-stone-900">Shop by Region</h2>
          <p className="text-stone-500 text-sm mt-2 max-w-md mx-auto">
            Each region brings unique flavours and traditions from the Himalayas
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
          {states.map(state => (
            <Link
              key={state.id}
              href={`/regions/${state.slug}`}
              className="group relative overflow-hidden rounded-2xl bg-white border border-stone-100 hover:shadow-lg transition-all"
            >
              <div className="aspect-[3/4] relative">
                {state.image_url ? (
                  <Image
                    src={state.image_url}
                    alt={state.name}
                    fill
                    sizes="(max-width: 640px) 50vw, 25vw"
                    className="object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                ) : (
                  <div className="absolute inset-0 bg-gradient-to-br from-forest-200 to-earth-200 flex items-center justify-center">
                    <span className="text-5xl">🏔️</span>
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />
                <div className="absolute bottom-4 left-3 right-3">
                  <div className="text-white font-bold text-sm">{state.name}</div>
                  {state.description && (
                    <div className="text-white/70 text-[11px] mt-0.5 line-clamp-2 leading-relaxed">
                      {state.description}
                    </div>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}
