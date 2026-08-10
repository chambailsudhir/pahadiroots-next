import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { getSiteSettings } from '@/lib/getSiteSettings'
import { getHeroStats } from '@/lib/heroStats'

export const metadata: Metadata = {
  title:       'Our Story — HimVeda by Pahadi Roots',
  description: 'How HimVeda by Pahadi Roots was born — our mission to connect mountain farming communities with people who value pure, natural food.',
}

export const revalidate = 3600

export default async function AboutPage() {
  const settings = await getSiteSettings()
  const heroStats = getHeroStats(settings)

  // Fetch team members if exists
  let team = null
  try {
    const { data } = await supabase
      .from('team_members')
      .select('id, name, role, bio, image_url, sort_order')
      .eq('is_active', true)
      .order('sort_order')
    team = data
  } catch (e: unknown) { console.error("[about] team fetch failed:", e); team = null }

  // Fetch founder images
  let founderImages = null
  try {
    const { data } = await supabase
      .from('founder_images')
      .select('url, caption')
      .order('sort_order')
      .limit(5)
    founderImages = data
  } catch (e: unknown) { console.error("[about] founderImages fetch failed:", e); founderImages = null }

  const heroImage = founderImages?.[0] || null
  const bentoImages = founderImages && founderImages.length > 0 ? founderImages : null

  return (
    <div>
      {/* ── Hero ── */}
      <div className="ab-hero">
        <ContourLines className="ab-hero-contours" />
        <div className="ab-hero-inner">
          <div className="ab-eyebrow">
            <MountainMark /> Our Story
          </div>
          <h1>
            Built on trust,<br />
            carried from <em>the mountains</em>
          </h1>
          <p className="ab-hero-sub">
            We started HimVeda by Pahadi Roots because people deserved to know
            where their food comes from — and the farmers who grow it deserved
            far more than what the middlemen ever paid them.
          </p>
        </div>

        {heroStats.length > 0 && (
          <div className="ab-stats">
            {heroStats.map(s => (
              <div key={s.key} className="ab-stat">
                <div className="ab-stat-num">{s.num}</div>
                <div className="ab-stat-lbl">{s.lbl}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Origin story ── */}
      <section className="ab-story-wrap">
        <div className="ab-story-grid">
          <div>
            <div className="ab-story-label">How It Started</div>
            <h2>Everything nature<br />made — nothing it didn&rsquo;t.</h2>
            <p className="ab-dropcap">
              HimVeda by Pahadi Roots was born from a simple realisation — the
              mountain farmers of Uttarakhand, Himachal Pradesh, and other
              Himalayan states were producing some of the purest, most
              extraordinary food in the world. Wild honey harvested from
              cliff-hanging hives. Cold-pressed mustard oil from centuries-old
              stone ghannies. Joha rice with an aroma that fills the entire
              kitchen.
            </p>
            <p>
              Yet most of this never reached anyone outside the villages. What
              little did reach the cities passed through so many hands that
              the farmer earned almost nothing — and the food lost its story
              somewhere along the way.
            </p>
            <p>
              We set out to fix that. No unnecessary middlemen. No fancy
              certifications the farmers cannot afford. Just direct
              relationships, fair prices, and honest products that carry the
              mountains in every spoonful.
            </p>
          </div>

          <div className="ab-note">
            {heroImage ? (
              <div className="ab-note-img">
                <Image
                  src={heroImage.url}
                  alt={heroImage.caption || 'HimVeda by Pahadi Roots'}
                  fill
                  sizes="(max-width: 860px) 90vw, 400px"
                  className="object-cover"
                />
              </div>
            ) : (
              <span className="ab-note-mark">&ldquo;</span>
            )}
            <p>
              We didn&rsquo;t want to build another label on a shelf. We
              wanted every jar to feel like it still had mountain air in it.
            </p>
            <div className="ab-note-sig">— The HimVeda Team</div>
          </div>
        </div>
      </section>

      {/* ── Values ── */}
      <section className="ab-values">
        <div className="ab-section-head">
          <h2>What We Stand For</h2>
          <p>The principles that decide every sourcing call we make.</p>
        </div>
        <div className="ab-value-grid">
          {VALUES.map(v => (
            <div key={v.title} className="ab-value-card">
              <div className="ab-value-badge">{v.icon}</div>
              <h3>{v.title}</h3>
              <p>{v.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Gallery ── */}
      {bentoImages && (
        <section className="ab-gallery-wrap">
          <div className="ab-section-head">
            <h2>From the Mountains</h2>
            <p>A few honest glimpses of where your food actually comes from.</p>
          </div>
          <div className="ab-bento">
            {bentoImages.map((img, i) => (
              <div key={i} className="ab-bento-item">
                <Image
                  src={img.url}
                  alt={img.caption || 'HimVeda by Pahadi Roots'}
                  fill
                  sizes="(max-width: 860px) 50vw, 25vw"
                  className="object-cover"
                />
                {img.caption && (
                  <div className="ab-bento-cap">
                    <p>{img.caption}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Team ── */}
      {team && team.length > 0 && (
        <section className="ab-team-wrap">
          <div className="ab-section-head">
            <h2>The Team</h2>
            <p>The people making sure nothing gets lost between farm and doorstep.</p>
          </div>
          <div className="ab-team-grid">
            {team.map(member => (
              <div key={member.id} className="ab-team-card">
                <div className="ab-team-ring">
                  <div>
                    {member.image_url ? (
                      <Image src={member.image_url} alt={member.name} fill sizes="74px" className="object-cover" />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-xl text-forest-700">
                        {member.name?.[0] || '·'}
                      </div>
                    )}
                  </div>
                </div>
                <h3>{member.name}</h3>
                <div className="ab-team-role">{member.role}</div>
                {member.bio && <p className="ab-bio line-clamp-3">{member.bio}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── CTA ── */}
      <section className="ab-cta">
        <ContourLines className="ab-cta-contours" />
        <h2>Ready to Taste the Mountains?</h2>
        <p>Every product has a story. Explore our full range of natural Himalayan products.</p>
        <Link href="/products" className="ab-cta-btn">
          Shop Now
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
          </svg>
        </Link>
      </section>
    </div>
  )
}

/* ── Signature motif: hand-drawn topographic contour lines,
   echoing the elevation maps of the terrain the brand sources from. ── */
function ContourLines({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 800 400" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M-20 320 Q 120 260 240 300 T 480 280 T 820 310" stroke="#e8b84b" strokeWidth="1" fill="none" />
      <path d="M-20 280 Q 140 210 260 250 T 520 230 T 820 260" stroke="#e8b84b" strokeWidth="1" fill="none" />
      <path d="M-20 235 Q 160 160 300 195 T 560 170 T 820 205" stroke="#e8b84b" strokeWidth="1" fill="none" />
      <path d="M-20 185 Q 180 100 320 140 T 600 105 T 820 150" stroke="#e8b84b" strokeWidth="1" fill="none" />
      <path d="M-20 130 Q 200 40 340 85 T 640 40 T 820 90" stroke="#e8b84b" strokeWidth="1" fill="none" />
      <path d="M-20 60 Q 220 -20 360 20 T 660 -20 T 820 15" stroke="#e8b84b" strokeWidth="1" fill="none" />
    </svg>
  )
}

function MountainMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 19l6-9 4 5.5L16 10l5 9H3z" />
      <circle cx="17" cy="6" r="2" />
    </svg>
  )
}

const ICON_PROPS = { viewBox: '0 0 24 24', fill: 'none', stroke: '#f5d98a', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

const VALUES = [
  {
    title: 'Direct from Farmers',
    body: 'We work directly with farming families across 20+ Himalayan states. No middlemen, no aggregators.',
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M8 12l2 2 6-6" />
        <circle cx="12" cy="12" r="9" />
      </svg>
    ),
  },
  {
    title: '100% Natural',
    body: 'No preservatives, no artificial colours or flavours. Products exactly as nature made them.',
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M12 21c-4-2-7-6-7-11a7 7 0 0114 0c0 5-3 9-7 11z" />
        <path d="M12 21V10" />
      </svg>
    ),
  },
  {
    title: 'Fair Pricing',
    body: 'Farmers receive prices that reflect the true value of their craft and knowledge.',
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M12 3v18M7 7h7a3 3 0 010 6H8" />
      </svg>
    ),
  },
  {
    title: 'Mountain to Doorstep',
    body: 'Products travel from mountain farms to your home in the shortest possible chain.',
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M3 19l6-9 4 5.5L16 10l5 9H3z" />
        <circle cx="19" cy="5" r="2" />
      </svg>
    ),
  },
  {
    title: 'Thoughtful Packaging',
    body: 'Minimal, recyclable packaging that protects the product and respects the environment.',
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M21 8l-9-5-9 5 9 5 9-5z" />
        <path d="M3 8v8l9 5 9-5V8" />
        <path d="M12 13v8" />
      </svg>
    ),
  },
  {
    title: 'Community First',
    body: 'Every purchase helps sustain traditional farming practices and mountain communities.',
    icon: (
      <svg {...ICON_PROPS}>
        <circle cx="9" cy="8" r="3" />
        <path d="M2 20c0-3.5 3-6 7-6s7 2.5 7 6" />
        <circle cx="18" cy="9" r="2.4" />
        <path d="M16 20c.2-2.6 2-4.6 4.5-5" />
      </svg>
    ),
  },
]
