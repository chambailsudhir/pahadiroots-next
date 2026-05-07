import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

export const metadata: Metadata = {
  title:       'Our Story — Pahadi Roots',
  description: 'How Pahadi Roots was born — our mission to connect mountain farming communities with people who value pure, natural food.',
}

export const revalidate = 3600

export default async function AboutPage() {
  // Fetch team members if exists
  let team = null
  try {
    const { data } = await supabase
      .from('team_members')
      .select('id, name, role, bio, image_url, sort_order')
      .eq('is_active', true)
      .order('sort_order')
    team = data
  } catch { team = null }

  // Fetch founder images
  let founderImages = null
  try {
    const { data } = await supabase
      .from('founder_images')
      .select('url, caption')
      .order('sort_order')
      .limit(4)
    founderImages = data
  } catch { founderImages = null }

  return (
    <div>
      {/* Hero */}
      <div className="relative bg-forest-950 overflow-hidden">
        <div className="absolute inset-0 opacity-20" style={{
          backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' fill-rule=\'evenodd\'%3E%3Cg fill=\'%23ffffff\' fill-opacity=\'0.4\'%3E%3Cpath d=\'M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z\'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")',
        }} />
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-20 text-center relative">
          <div className="text-5xl mb-5">🏔️</div>
          <h1 className="text-3xl sm:text-5xl font-bold text-white mb-4 leading-tight">
            Stories from<br />
            <span className="text-earth-300">The Mountains</span>
          </h1>
          <p className="text-forest-200 text-lg max-w-xl mx-auto leading-relaxed">
            We started Pahadi Roots because we believed people deserved to know where their food comes from — and the farmers deserved more than what middlemen paid them.
          </p>
        </div>
      </div>

      {/* Origin story */}
      <section className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="prose prose-stone max-w-none">
          <h2 className="text-2xl font-bold text-stone-900 mb-5">How It Started</h2>
          <p className="text-stone-600 leading-relaxed mb-4">
            Pahadi Roots was born from a simple realisation — the mountain farmers of Uttarakhand, Himachal Pradesh, and other Himalayan states were producing some of the purest, most extraordinary food in the world. Wild honey harvested from cliff-hanging hives. Cold-pressed mustard oil from centuries-old stone ghannies. Joha rice with an aroma that fills the entire kitchen.
          </p>
          <p className="text-stone-600 leading-relaxed mb-4">
            Yet most of this never reached anyone outside the villages. What little did reach cities passed through so many hands that the farmer earned almost nothing — and the food lost its story along the way.
          </p>
          <p className="text-stone-600 leading-relaxed">
            We set out to fix that. No unnecessary middlemen. No fancy certifications that the farmers cannot afford. Just direct relationships, fair prices, and honest products that carry the mountains in every spoonful.
          </p>
        </div>
      </section>

      {/* Values */}
      <section className="bg-stone-50 py-14">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl font-bold text-stone-900 mb-8 text-center">What We Stand For</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {[
              { icon: '🤝', title: 'Direct from Farmers',     body: 'We work directly with farming families across 20+ Himalayan states. No middlemen, no aggregators.' },
              { icon: '🌿', title: '100% Natural',            body: 'No preservatives, no artificial colours or flavours. Products exactly as nature made them.' },
              { icon: '⚖️',  title: 'Fair Pricing',           body: 'Farmers receive prices that reflect the true value of their craft and knowledge.' },
              { icon: '🏔️', title: 'Mountain to Doorstep',   body: 'Products travel from mountain farms to your home in the shortest possible chain.' },
              { icon: '📦', title: 'Thoughtful Packaging',    body: 'Minimal, recyclable packaging that protects the product and respects the environment.' },
              { icon: '💚', title: 'Community First',         body: 'Every purchase helps sustain traditional farming practices and mountain communities.' },
            ].map(v => (
              <div key={v.title} className="bg-white rounded-2xl p-5 border border-stone-100">
                <div className="text-3xl mb-3">{v.icon}</div>
                <h3 className="text-sm font-bold text-stone-900 mb-2">{v.title}</h3>
                <p className="text-sm text-stone-500 leading-relaxed">{v.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Founder images */}
      {founderImages && founderImages.length > 0 && (
        <section className="py-14">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-2xl font-bold text-stone-900 mb-7 text-center">From the Mountains</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {founderImages.map((img, i) => (
                <div key={i} className="relative aspect-square rounded-2xl overflow-hidden group">
                  <Image
                    src={img.url}
                    alt={img.caption || 'Pahadi Roots'}
                    fill
                    sizes="(max-width: 640px) 50vw, 25vw"
                    className="object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                  {img.caption && (
                    <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/60 to-transparent p-3">
                      <p className="text-white text-[11px] font-medium line-clamp-2">{img.caption}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Team */}
      {team && team.length > 0 && (
        <section className="bg-stone-50 py-14">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-2xl font-bold text-stone-900 mb-7 text-center">The Team</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {team.map(member => (
                <div key={member.id} className="bg-white rounded-2xl p-5 border border-stone-100 flex items-start gap-4">
                  <div className="relative w-14 h-14 rounded-full overflow-hidden bg-forest-100 shrink-0">
                    {member.image_url ? (
                      <Image src={member.image_url} alt={member.name} fill sizes="56px" className="object-cover" />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-2xl">👤</div>
                    )}
                  </div>
                  <div>
                    <div className="text-sm font-bold text-stone-900">{member.name}</div>
                    <div className="text-xs text-forest-700 font-medium mb-1">{member.role}</div>
                    {member.bio && (
                      <p className="text-xs text-stone-500 leading-relaxed line-clamp-3">{member.bio}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* CTA */}
      <section className="py-14">
        <div className="max-w-2xl mx-auto px-4 text-center">
          <h2 className="text-2xl font-bold text-stone-900 mb-3">Ready to Taste the Mountains?</h2>
          <p className="text-stone-500 text-sm mb-7">
            Every product has a story. Explore our full range of natural Himalayan products.
          </p>
          <Link
            href="/products"
            className="inline-flex items-center gap-2 bg-forest-700 hover:bg-forest-800 text-white font-bold px-8 py-3.5 rounded-xl text-sm transition-colors"
          >
            Shop Now
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
            </svg>
          </Link>
        </div>
      </section>
    </div>
  )
}
