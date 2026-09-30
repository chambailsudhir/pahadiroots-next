import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Cormorant_Garamond, Inter } from 'next/font/google'
import { supabase } from '@/lib/supabase'
import { getSiteSettings, isEnabled } from '@/lib/getSiteSettings'
import OurStoryShell from '@/components/story/OurStoryShell'
import s from '@/components/story/OurStory.module.css'

// Scoped to this page only — loaded here so no other route pays for them.
const cormorant = Cormorant_Garamond({ subsets: ['latin'], weight: ['400', '500', '600'], style: ['normal', 'italic'], variable: '--font-cormorant', display: 'swap' })
const inter = Inter({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-inter', display: 'swap' })

const DESC = 'How HimVeda by Pahadi Roots began — bringing the food, craft and character of the Himalayas closer to home, with the people behind it at the heart of the story.'

export const metadata: Metadata = {
  title:       'Our Story — HimVeda by Pahadi Roots',
  description: DESC,
  alternates:  { canonical: '/our-stories' },
  openGraph: {
    title:       'Our Story — HimVeda by Pahadi Roots',
    description: DESC,
    url:         'https://www.pahadiroots.com/our-stories',
    type:        'website',
    images:      [{ url: '/our-story/hero.webp', width: 2000, height: 1500, alt: 'Snow-covered Himalayan peaks above forested slopes and a quiet valley' }],
  },
}

export const revalidate = 3600

interface FounderImage { url: string; caption: string | null }
interface TeamMember { id: string; name: string; role: string; bio: string | null; image_url: string | null }

const MANIFESTO = 'The Himalayas are not a backdrop for our products. They are the places, the people and the knowledge behind them.'

const CHAPTERS = [
  { img: 'morning', tag: 'Morning', t: 'Before the light reaches the valley', d: 'Days begin with the animals. Cows are milked by hand, close to where they graze, while the mountains are still cold.', alt: 'A woman milking a cow beside a stone house in the mountains' },
  { img: 'hands',   tag: 'Hands',   t: 'Patience, turned by hand',            d: 'Curd is churned slowly until the butter comes. There is no shortcut, and we have not tried to hurry the method.', alt: 'A woman churning curd in a traditional mountain kitchen' },
  { img: 'fire',    tag: 'Fire',    t: 'A fire that sets the pace',           d: 'Butter simmers over a wood fire, and the kitchen fills with the smell of ghee. The fire decides when it is ready.', alt: 'Butter simmering into ghee over a wood fire' },
  { img: 'bloom',   tag: 'Bloom',   t: 'A short summer, all at once',         d: 'When the snow pulls back, the meadows flower in a rush. The bees have only a few months to work them.', alt: 'Wildflowers blooming on a Himalayan slope with peaks behind' },
  { img: 'bees',    tag: 'Bees',    t: 'Following the flowers',               d: 'Colonies work across the valley with the bloom. What they gather is the taste of that place and that season.', alt: 'Honeybees at wooden hives among mountain flowers' },
  { img: 'harvest', tag: 'Harvest', t: 'Picked by hand, berry by berry',      d: 'Sea buckthorn is thorny and its berries are small. Harvest is slow work, done by hand in a short season.', alt: 'A woman picking sea buckthorn berries by hand' },
]

export default async function AboutPage() {
  const settings = await getSiteSettings()

  // Full kill-switch — admin's "Page is live at /our-stories" toggle. Off means
  // the route itself 404s (not just an empty section), and Header/Footer/
  // MobileMenu independently hide the "Our Story" link using this same key.
  if (settings.about_page_enabled === 'false') notFound()

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

  const gallery = founderImages && founderImages.length > 0 ? founderImages : null

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

  const quoteText = settings.about_quote_text || 'If it doesn\u2019t taste like what we had in the hills, it doesn\u2019t go on the site.'
  const quoteBy = settings.about_quote_attribution || 'The Founding Team'

  return (
    <div className={`${cormorant.variable} ${inter.variable}`}>
      <OurStoryShell>
        {/* ── 1. Hero — image first ── */}
        <header className={s.hero}>
          <div className={s.heroImg}>
            <Image src="/our-story/hero.webp" alt="Snow-covered Himalayan peaks rising above forested slopes and a quiet valley" fill priority sizes="100vw" style={{ objectPosition: '50% 32%' }} />
          </div>
          <div className={s.heroIn}>
            <div>
              <span className={s.eb}>Our Story</span>
              <h1>Born in the mountains.<br /><em>Made for the table.</em></h1>
              <p>HimVeda by Pahadi Roots began with a simple idea — bring the food, craft and character of the Himalayas closer to home, while keeping the people behind it at the heart of the story.</p>
            </div>
            <div className={s.meta} aria-hidden="true">Kangra<br />Himachal Pradesh<br />Himalayas</div>
          </div>
          <i className={s.cue} aria-hidden="true" />
        </header>

        {/* ── 2. Statement ── */}
        <section className={s.man} data-man aria-label="The idea behind HimVeda">
          <h2 aria-label={MANIFESTO}>
            {MANIFESTO.split(' ').map((w, i) => <span key={i} className={s.w} data-w aria-hidden="true">{w} </span>)}
          </h2>
          <p className={`${s.sub} ${s.r}`} data-r>Every jar we sell begins with a valley, a season and someone who knows how to work with both. Four of us started HimVeda to stay close to that.</p>
        </section>

        {/* ── 3. How it started — real founder photo ── */}
        <section className={s.founder} aria-labelledby="ab-started">
          <div className={s.fg}>
            <figure className={`${s.fp} ${s.r}`} data-r>
              <div className={s.ph}>
                <Image src="/our-story/founder.webp" alt="One of HimVeda’s four founders seated on a blue Triumph motorcycle beside a mountain road, with forested Himalayan peaks and clouds behind him" fill sizes="(max-width: 820px) 92vw, 55vw" />
              </div>
              <figcaption>One of our four founders, on the road somewhere in the Himalayas.</figcaption>
            </figure>
            <div className={s.r} data-r>
              <span className={s.eb}>How it started</span>
              <h2 id="ab-started">Somewhere between the road, the mountains and the people who call them home, the idea began to take shape.</h2>
              <p>HimVeda is our way of keeping that connection visible. Everything we list, we’ve either sourced ourselves or vetted with the people who grow, press, or harvest it.</p>
              <p>We’re not a big company pretending to be small. We’re still figuring a lot of this out.</p>
            </div>
          </div>
          <div className={`${s.proof} ${s.r}`} data-r>
            <div><b>Four</b><span>Founders</span></div>
            <div><b>Himachal</b><span>Where we’re based</span></div>
            <div><b>Direct</b><span>Sourced with the people who grow it</span></div>
          </div>
        </section>

        {/* ── 4. A day in the hills (toggle: show_life_in_mountains) ── */}
        {isEnabled(settings.show_life_in_mountains) && (
          <section className={s.sc} aria-labelledby="ab-day">
            <div className={s.scHead}>
              <span className={s.eb}>Stories from the mountains</span>
              <h2 id="ab-day">A day in the hills, told slowly.</h2>
              <p>Nothing here is staged for a camera. This is the rhythm of the people, animals and seasons behind every jar.</p>
            </div>
            <div className={s.sg}>
              <div className={s.stick}>
                <div className={s.frame}>
                  {CHAPTERS.map((c, i) => (
                    <Image key={c.img} data-f src={`/our-story/day-${c.img}.webp`} alt={c.alt} fill sizes="(max-width: 820px) 92vw, 55vw" className={`${s.frameImg} ${i === 0 ? s.on : ''}`} />
                  ))}
                </div>
              </div>
              <div>
                {CHAPTERS.map((c, i) => (
                  <article key={c.img} data-step className={`${s.st} ${i === 0 ? s.on : ''}`}>
                    <span className={s.num} aria-hidden="true">0{i + 1}</span>
                    <span className={s.eb}>{c.tag}</span>
                    <h3>{c.t}</h3>
                    <p>{c.d}</p>
                  </article>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* ── 5. Panorama ── */}
        <section className={s.pano}>
          <div className={s.panoBg} data-pano>
            <Image src="/our-story/pano.webp" alt="Panorama of snow-capped Himalayan peaks above green valleys with a tall pine in the foreground" fill sizes="100vw" />
          </div>
          <div className={`${s.tx} ${s.r}`} data-r>
            <span className={s.eb}>The land behind every taste</span>
            <p>The mountains are not just where our products come from. They are part of what makes them what they are.</p>
          </div>
        </section>

        {/* ── 6. Founding quote (admin-editable) ── */}
        <section className={s.quote}>
          <blockquote className={s.r} data-r>&ldquo;{quoteText}&rdquo;</blockquote>
          <cite className={s.r} data-r>— {quoteBy}</cite>
        </section>

        {/* ── 7. What we stand for (admin-editable) ── */}
        {values.length > 0 && (
          <section className={s.stand} aria-labelledby="ab-stand">
            <h2 id="ab-stand" className={s.r} data-r>What we<br />stand for</h2>
            <ol className={s.r} data-r>
              {values.map((v, i) => (
                <li key={v.title}>
                  <span>0{i + 1}</span>
                  <h3>{v.title}</h3>
                  <p>{v.body}</p>
                </li>
              ))}
            </ol>
          </section>
        )}

        {/* ENTITY-DISAMBIGUATION: plain, crawlable text stating this is an
            independent brand (counterpart to the Organization schema in
            layout.tsx). Kept short and factual. */}
        <p className={s.note}>
          {(settings.site_name || 'HimVeda by Pahadi Roots')} is an independently owned Himalayan food brand,
          based in Kangra, Himachal Pradesh. We are not affiliated with, and have no business
          relationship to, any other company using a similar &ldquo;Pahadi&rdquo;-prefixed brand name.
        </p>

        {/* ── Existing admin-managed sections (unchanged markup/classes) ── */}
        <div className={s.more}>
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
                  <video src={embed.src} poster={settings.about_video_poster || undefined} controls playsInline className="ab-video-el" />
                )}
              </div>
            </section>
          )}

          {gallery && (
            <section className="ab-gallery-wrap">
              <div className="ab-section-head">
                <h2>From the Mountains</h2>
                <p>A few honest glimpses of where your food actually comes from.</p>
              </div>
              <div className="ab-bento">
                {gallery.map((img, i) => (
                  <div key={i} className="ab-bento-item">
                    <Image src={img.url} alt={img.caption || 'HimVeda by Pahadi Roots'} fill sizes="(max-width: 860px) 50vw, 25vw" className="object-cover" />
                    {img.caption && (<div className="ab-bento-cap"><p>{img.caption}</p></div>)}
                  </div>
                ))}
              </div>
            </section>
          )}

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
                          <div className="absolute inset-0 flex items-center justify-center text-xl text-forest-700">{member.name?.[0] || '·'}</div>
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
        </div>

        {/* ── 8. Closing image + CTA ── */}
        <section className={s.end} aria-labelledby="ab-end">
          <div className={s.endImg}>
            <Image src="/our-story/close.webp" alt="Late light on snowy Himalayan slopes above a clear mountain river" fill sizes="100vw" />
          </div>
          <div className={`${s.tx} ${s.r}`} data-r>
            <span className={s.eb}>The story continues</span>
            <h2 id="ab-end">Every jar, every ingredient and every product begins somewhere in the mountains.</h2>
            <Link href="/products" className={s.btn}>EXPLORE THE PRODUCTS</Link>
          </div>
        </section>
      </OurStoryShell>
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

