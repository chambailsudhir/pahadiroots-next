import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { getSiteSettings } from '@/lib/getSiteSettings'
import { getHeroStats } from '@/lib/heroStats'
import { ContourLines, MountainMark } from '@/components/brand/BrandMotifs'

// SEO FIX: no canonical, no OG/Twitter override previously — page inherited
// the layout's generic OG image/description, so sharing this page's link
// looked identical to sharing the homepage.
export const metadata: Metadata = {
  title:       'Our Story — HimVeda by Pahadi Roots',
  description: 'How HimVeda by Pahadi Roots was born — our mission to connect mountain farming communities with people who value pure, natural food.',
  alternates:  { canonical: '/about' },
  openGraph: {
    title:       'Our Story — HimVeda by Pahadi Roots',
    description: 'How HimVeda by Pahadi Roots was born — our mission to connect mountain farming communities with people who value pure, natural food.',
    url:         'https://pahadiroots.com/about',
    type:        'website',
    // BUG FIX: no `images` here — this page's own openGraph object
    // replaces the layout's entirely, so this route had no og:image.
    images:      [{ url: '/logo.png', width: 1200, height: 630, alt: 'Our Story — HimVeda by Pahadi Roots' }],
  },
}

export const revalidate = 3600

interface FounderImage { url: string; caption: string | null }
interface TeamMember { id: string; name: string; role: string; bio: string | null; image_url: string | null }

export default async function AboutPage() {
  const settings = await getSiteSettings()

  // Full kill-switch — admin's "Page is live at /about" toggle. Off means
  // the route itself 404s (not just an empty section), and Header/Footer/
  // MobileMenu independently hide the "Our Story" link using this same key.
  if (settings.about_page_enabled === 'false') notFound()

  const heroStats = getHeroStats(settings)

  let team: TeamMember[] | null = null
  try {
    const { data } = await supabase
      .from('team_members')
      .select('id, name, role, bio, image_url, sort_order')
      .eq('is_active', true)
      .order('sort_order')
    team = data
  } catch (e: unknown) { console.error("[about] team fetch failed:", e); team = null }

  let founderImages: FounderImage[] | null = null
  try {
    const { data } = await supabase
      .from('founder_images')
      .select('url, caption')
      .order('sort_order')
    founderImages = data
  } catch (e: unknown) { console.error("[about] founderImages fetch failed:", e); founderImages = null }

  // Admin's own copy documents this contract: image 0 = hero background,
  // image 1 = the origin-story side photo. The full set also powers the
  // "From the Mountains" gallery grid below.
  const heroBg    = founderImages?.[0] || null
  const storyImg  = founderImages?.[1] || null
  const gallery   = founderImages && founderImages.length > 0 ? founderImages : null

  const values = [1, 2, 3, 4, 5, 6]
    .map(i => ({
      icon:   settings[`about_value_${i}_icon`]  || '',
      title:  settings[`about_value_${i}_title`] || '',
      body:   settings[`about_value_${i}_body`]  || '',
      hidden: settings[`about_value_${i}_hide`] === 'true',
    }))
    .filter(v => !v.hidden && v.title)

  const videoUrl = settings.about_video_url?.trim()
  const showVideo = !!videoUrl && settings.about_video_hide !== 'true'
  const embed = videoUrl ? toEmbed(videoUrl) : null

  return (
    <div>
      {/* ── Hero ── */}
      <div className="ab-hero">
        {heroBg && (
          <div className="ab-hero-bg">
            <Image
              src={heroBg.url}
              alt={heroBg.caption || 'HimVeda by Pahadi Roots'}
              fill
              priority
              sizes="100vw"
              className="object-cover"
            />
          </div>
        )}
        <div className="ab-hero-scrim" />
        <ContourLines className="ab-hero-contours" />
        <div className="ab-hero-inner">
          <div className="ab-eyebrow">
            <MountainMark /> {settings.about_hero_eyebrow}
          </div>
          <h1>
            {settings.about_hero_title_1}<br />
            <em>{settings.about_hero_title_2}</em>
          </h1>
          <p className="ab-hero-sub">{settings.about_hero_subtitle}</p>
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
            <div className="ab-story-label">{settings.about_story_eyebrow}</div>
            <h2>{settings.about_story_heading}</h2>
            <p className="ab-dropcap">{settings.about_story_p1}</p>
            {settings.about_story_p2 && <p>{settings.about_story_p2}</p>}
            {settings.about_story_p3 && <p>{settings.about_story_p3}</p>}
          </div>

          <div className="ab-note">
            {storyImg ? (
              <div className="ab-note-img">
                <Image
                  src={storyImg.url}
                  alt={storyImg.caption || 'HimVeda by Pahadi Roots'}
                  fill
                  sizes="(max-width: 860px) 90vw, 400px"
                  className="object-cover"
                />
              </div>
            ) : (
              <span className="ab-note-mark">&ldquo;</span>
            )}
            <p>{settings.about_quote_text}</p>
            <div className="ab-note-sig">— {settings.about_quote_attribution}</div>
          </div>
        </div>
      </section>

      {/* ── Values ── */}
      {values.length > 0 && (
        <section className="ab-values">
          <div className="ab-section-head">
            <h2>What We Stand For</h2>
            <p>The principles that decide every sourcing call we make.</p>
          </div>
          <div className="ab-value-grid">
            {values.map(v => (
              <div key={v.title} className="ab-value-card">
                <div className="ab-value-badge">{VALUE_ICONS[v.icon] || VALUE_ICONS.leaf}</div>
                <h3>{v.title}</h3>
                <p>{v.body}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Farmer connection video ── */}
      {showVideo && embed && (
        <section className="ab-video-wrap">
          <div className="ab-section-head">
            <h2>{settings.about_video_heading}</h2>
            <p>{settings.about_video_caption}</p>
          </div>
          <div className="ab-video-frame">
            {embed.kind === 'iframe' ? (
              <iframe
                src={embed.src}
                title={settings.about_video_heading || 'Meet the Farmers'}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="ab-video-el"
              />
            ) : (
              <video
                src={embed.src}
                poster={settings.about_video_poster || undefined}
                controls
                playsInline
                className="ab-video-el"
              />
            )}
          </div>
        </section>
      )}

      {/* ── Gallery ── */}
      {gallery && (
        <section className="ab-gallery-wrap">
          <div className="ab-section-head">
            <h2>From the Mountains</h2>
            <p>A few honest glimpses of where your food actually comes from.</p>
          </div>
          <div className="ab-bento">
            {gallery.map((img, i) => (
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
        <h2>{settings.about_cta_heading}</h2>
        <p>{settings.about_cta_subtext}</p>
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

/* ── Turn a pasted YouTube/Vimeo link or a direct video file URL
   (Supabase Storage upload) into something we can render. ── */
function toEmbed(raw: string): { kind: 'iframe' | 'video'; src: string } | null {
  const url = raw.trim()
  if (!url) return null

  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{6,})/)
  if (yt) return { kind: 'iframe', src: `https://www.youtube.com/embed/${yt[1]}` }

  const vimeo = url.match(/vimeo\.com\/(\d+)/)
  if (vimeo) return { kind: 'iframe', src: `https://player.vimeo.com/video/${vimeo[1]}` }

  return { kind: 'video', src: url }
}

/* Icon key -> SVG, must stay in sync with the admin's VALUE_ICONS list
   (pahadi-admin src/app/admin/team/page.jsx). An icon key with no match
   here falls back to the leaf icon rather than rendering nothing. */
const IP = { viewBox: '0 0 24 24', fill: 'none', stroke: '#f5d98a', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

const VALUE_ICONS: Record<string, React.ReactNode> = {
  handshake: (
    <svg {...IP}><path d="M8 12l2 2 6-6" /><circle cx="12" cy="12" r="9" /></svg>
  ),
  leaf: (
    <svg {...IP}><path d="M12 21c-4-2-7-6-7-11a7 7 0 0114 0c0 5-3 9-7 11z" /><path d="M12 21V10" /></svg>
  ),
  scale: (
    <svg {...IP}><path d="M12 3v18M7 7h7a3 3 0 010 6H8" /></svg>
  ),
  peak: (
    <svg {...IP}><path d="M3 19l6-9 4 5.5L16 10l5 9H3z" /><circle cx="19" cy="5" r="2" /></svg>
  ),
  package: (
    <svg {...IP}><path d="M21 8l-9-5-9 5 9 5 9-5z" /><path d="M3 8v8l9 5 9-5V8" /><path d="M12 13v8" /></svg>
  ),
  heart: (
    <svg {...IP}><circle cx="9" cy="8" r="3" /><path d="M2 20c0-3.5 3-6 7-6s7 2.5 7 6" /><circle cx="18" cy="9" r="2.4" /><path d="M16 20c.2-2.6 2-4.6 4.5-5" /></svg>
  ),
}
