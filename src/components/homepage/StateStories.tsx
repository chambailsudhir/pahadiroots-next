import Link from 'next/link'
import Image from 'next/image'
import type { State } from '@/types'

interface Props { states: State[] }

export default function StateStories({ states }: Props) {
  if (!states.length) return null

  return (
    <section className="py-12 sm:py-16 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

        {/* Section header — exact old site copy */}
        <div className="text-center mb-9">
          <div className="inline-block text-xs font-bold uppercase tracking-widest text-earth-600 bg-earth-50 border border-earth-100 px-3 py-1 rounded-full mb-3">
            Explore by Region
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold text-stone-900 mb-2">
            Discover the Himalayas
          </h2>
          <p className="text-stone-500 text-sm max-w-md mx-auto">
            Each state carries centuries of mountain wisdom in its produce.
          </p>
        </div>

        {/* Horizontal scroll on mobile, grid on desktop */}
        <div className="flex gap-4 overflow-x-auto no-scrollbar pb-2 sm:pb-0 sm:grid sm:grid-cols-3 lg:grid-cols-4 sm:gap-4">
          {states.map((state, i) => (
            <Link
              key={state.id}
              href={`/regions/${state.slug}`}
              className="group relative overflow-hidden rounded-2xl bg-white border border-stone-100 hover:shadow-xl transition-all shrink-0 w-48 sm:w-auto"
              style={{ transitionDelay: `${i * 40}ms` }}
            >
              <div className="aspect-[3/4] relative">
                {state.image_url ? (
                  <Image
                    src={state.image_url}
                    alt={state.name}
                    fill
                    sizes="(max-width: 640px) 192px, 25vw"
                    className="object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                ) : (
                  <div className="absolute inset-0 bg-gradient-to-br from-forest-800 to-forest-600 flex items-center justify-center">
                    <span className="text-5xl">🏔️</span>
                  </div>
                )}
                {/* Dark gradient overlay */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

                {/* Content */}
                <div className="absolute bottom-0 left-0 right-0 p-4">
                  <div className="text-white font-bold text-sm mb-1">{state.name}</div>
                  {state.description && (
                    <div className="text-white/70 text-[11px] leading-relaxed line-clamp-2">
                      {state.description}
                    </div>
                  )}
                  {/* Explore arrow */}
                  <div className="mt-2 flex items-center gap-1 text-earth-300 text-[11px] font-semibold opacity-0 group-hover:opacity-100 translate-y-1 group-hover:translate-y-0 transition-all">
                    Explore
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                    </svg>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}
