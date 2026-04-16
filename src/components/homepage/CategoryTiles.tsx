// CategoryTiles.tsx
import Link from 'next/link'
import Image from 'next/image'
import type { Category } from '@/types'

interface Props { categories: Category[] }

export default function CategoryTiles({ categories }: Props) {
  const active = categories.filter(c => c.is_active).slice(0, 8)
  if (!active.length) return null

  return (
    <section className="py-10 sm:py-14 bg-stone-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <h2 className="text-2xl sm:text-3xl font-bold text-stone-900 mb-7">
          Shop by Category
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
          {active.map(cat => (
            <Link
              key={cat.id}
              href={`/collections/${cat.slug}`}
              className="group relative overflow-hidden rounded-2xl bg-white border border-stone-100 hover:border-forest-200 hover:shadow-md transition-all aspect-[4/3]"
            >
              {cat.image_url ? (
                <Image
                  src={cat.image_url}
                  alt={cat.name}
                  fill
                  sizes="(max-width: 640px) 50vw, 25vw"
                  className="object-cover group-hover:scale-105 transition-transform duration-300"
                />
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-forest-100 to-forest-50 flex items-center justify-center">
                  <span className="text-4xl">🌿</span>
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
              <div className="absolute bottom-3 left-3 right-3">
                <div className="text-white font-bold text-sm leading-tight">{cat.name}</div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}
