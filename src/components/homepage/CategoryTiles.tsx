import Link from 'next/link'
import Image from 'next/image'
import type { Category } from '@/types'

interface Props { categories: Category[] }

// Emoji fallbacks per category name keyword
function getCatEmoji(name: string): string {
  const n = name.toLowerCase()
  if (n.includes('honey')) return '🍯'
  if (n.includes('ghee')) return '🥛'
  if (n.includes('spice') || n.includes('herb')) return '🌿'
  if (n.includes('tea')) return '🍵'
  if (n.includes('grain') || n.includes('rice') || n.includes('millet')) return '🌾'
  if (n.includes('dry') || n.includes('fruit') || n.includes('nut')) return '🌰'
  if (n.includes('oil')) return '🫙'
  if (n.includes('juice') || n.includes('squash')) return '🧃'
  if (n.includes('shilajit') || n.includes('resin')) return '🪨'
  if (n.includes('saffron')) return '🌸'
  if (n.includes('pickle') || n.includes('sauce')) return '🫙'
  if (n.includes('coffee')) return '☕'
  return '🏔️'
}

export default function CategoryTiles({ categories }: Props) {
  const active = categories.filter(c => c.is_active).slice(0, 8)
  if (!active.length) return null

  return (
    <section className="py-12 sm:py-16 bg-stone-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

        {/* Section header — matches old site */}
        <div className="text-center mb-9">
          <div className="inline-block text-xs font-bold uppercase tracking-widest text-earth-600 bg-earth-50 border border-earth-100 px-3 py-1 rounded-full mb-3">
            Browse Collections
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold text-stone-900 mb-2">
            What the Mountains Offer
          </h2>
          <p className="text-stone-500 text-sm max-w-md mx-auto">
            Every category tells a story of altitude, tradition, and purity.
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
          {active.map((cat, i) => (
            <Link
              key={cat.id}
              href={`/collections/${cat.slug}`}
              className="group relative overflow-hidden rounded-2xl bg-white border border-stone-100 hover:border-forest-200 hover:shadow-lg transition-all"
              style={{ transitionDelay: `${i * 50}ms` }}
            >
              <div className="aspect-[4/3] relative">
                {cat.image_url ? (
                  <Image
                    src={cat.image_url}
                    alt={cat.name}
                    fill
                    sizes="(max-width: 640px) 50vw, 25vw"
                    className="object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                ) : (
                  <div className="absolute inset-0 bg-gradient-to-br from-forest-100 to-earth-50 flex items-center justify-center">
                    <span className="text-5xl">{getCatEmoji(cat.name)}</span>
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />
                <div className="absolute bottom-3 left-3 right-3">
                  <div className="text-white font-bold text-sm leading-tight">{cat.name}</div>
                  {cat.description && (
                    <div className="text-white/70 text-[11px] mt-0.5 line-clamp-1">
                      {cat.description}
                    </div>
                  )}
                </div>
                {/* Hover arrow */}
                <div className="absolute top-2.5 right-2.5 w-7 h-7 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                  </svg>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}
