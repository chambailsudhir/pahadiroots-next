// ReviewsPreview.tsx
const REVIEWS = [
  { name: 'Priya Sharma', location: 'Delhi', rating: 5, text: 'The wild honey is absolutely pure — you can taste the difference from store-bought. My family loves it!', product: 'Himalayan Wild Honey' },
  { name: 'Rahul Verma', location: 'Mumbai', rating: 5, text: 'Ordered the Himalayan pink salt and turmeric. Superb quality. The packaging is premium too.', product: 'Himalayan Spice Pack' },
  { name: 'Ananya Gupta', location: 'Bangalore', rating: 5, text: 'Love the story behind each product. Fast delivery and exactly as described. Will order again!', product: 'Cold Pressed Mustard Oil' },
  { name: 'Vikram Singh', location: 'Jaipur', rating: 5, text: 'The Joha rice has such a distinct aroma — nothing like this available locally. Worth every rupee.', product: 'Joha Rice (Assam)' },
]

function Stars({ count }: { count: number }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <svg key={i} className={`w-3.5 h-3.5 ${i < count ? 'text-earth-400' : 'text-stone-200'}`} fill="currentColor" viewBox="0 0 20 20">
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
        </svg>
      ))}
    </div>
  )
}

export default function ReviewsPreview() {
  return (
    <section className="py-12 sm:py-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-9">
          <p className="text-xs font-bold uppercase tracking-widest text-earth-600 mb-2">What Customers Say</p>
          <h2 className="text-2xl sm:text-3xl font-bold text-stone-900">
            ⭐ 4.9/5 from 1,000+ reviews
          </h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {REVIEWS.map((r, i) => (
            <div key={i} className="bg-stone-50 rounded-2xl p-5 border border-stone-100">
              <Stars count={r.rating} />
              <p className="text-sm text-stone-700 mt-3 leading-relaxed line-clamp-3">"{r.text}"</p>
              <div className="mt-4 pt-3 border-t border-stone-200">
                <div className="text-sm font-semibold text-stone-800">{r.name}</div>
                <div className="text-[11px] text-stone-400">{r.location} · {r.product}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
