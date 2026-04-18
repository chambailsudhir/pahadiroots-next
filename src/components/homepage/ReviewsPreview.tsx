// "What Our Community Says" — matches old site review cards
function Stars() {
  return (
    <div className="flex gap-0.5 mb-3">
      {[1,2,3,4,5].map(i => (
        <svg key={i} className="w-3.5 h-3.5 text-earth-400" fill="currentColor" viewBox="0 0 20 20">
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
        </svg>
      ))}
    </div>
  )
}

const REVIEWS = [
  {
    initial: 'P', name: 'Priya Sharma',   location: 'Mumbai · Verified Buyer',
    text: 'The Kumaoni wild honey is unlike anything I've had. Raw, dark, floral — I can literally taste the altitude. My whole family is hooked.',
  },
  {
    initial: 'R', name: 'Rahul Mehta',    location: 'Delhi · Verified Buyer',
    text: '5 Pahadi Roots has changed my pantry. The bilona ghee is a revelation — I feel good about what I\'m feeding my kids.',
  },
  {
    initial: 'A', name: 'Anita Joshi',    location: 'Bengaluru · Verified Buyer',
    text: 'The Kashmir saffron threads are pure gold. Ordered from big brands before but nothing compares. Fast delivery, beautiful packaging.',
  },
]

export default function ReviewsPreview() {
  return (
    <section className="py-12 sm:py-16 bg-stone-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

        {/* Section header */}
        <div className="text-center mb-9">
          <div className="inline-block text-xs font-bold uppercase tracking-widest text-forest-600 bg-forest-50 border border-forest-100 px-3 py-1 rounded-full mb-3">
            Happy Customers
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold text-stone-900 mb-2">
            What Our Community Says
          </h2>
          <p className="text-stone-500 text-sm">Real people, real mountains, real taste.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          {REVIEWS.map((r, i) => (
            <div key={i} className="bg-white rounded-2xl p-6 border border-stone-100 shadow-sm hover:shadow-md transition-shadow relative">
              {/* Quote mark */}
              <div className="absolute top-5 left-5 text-4xl font-black text-forest-100 leading-none select-none">"</div>
              <div className="relative">
                <Stars />
                <p className="text-sm text-stone-600 leading-relaxed mb-5 italic">"{r.text}"</p>
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-forest-700 flex items-center justify-center text-white text-sm font-bold shrink-0">
                    {r.initial}
                  </div>
                  <div>
                    <div className="text-sm font-bold text-stone-800">{r.name}</div>
                    <div className="text-[11px] text-stone-400">{r.location}</div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
