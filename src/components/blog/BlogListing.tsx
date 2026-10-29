import Link from 'next/link'
import Image from 'next/image'
import { formatDate } from '@/lib/utils'
import { ContourLines, MountainMark } from '@/components/brand/BrandMotifs'
import Reveal from '@/components/story/Reveal'
import s from './blog.module.css'

export interface PostCard {
  id: string
  title: string
  slug: string
  excerpt: string | null
  cover_image: string | null
  published_at: string | null
  category: string | null
  reading_time_minutes: number | null
  author: string | null
}

const label = (c: string) => c.replace(/-/g, ' ')

function Meta({ post }: { post: PostCard }) {
  return (
    <div className={s.meta}>
      {post.category && <span>{label(post.category)}</span>}
      {post.published_at && <span>{formatDate(post.published_at)}</span>}
      {post.reading_time_minutes && <span>{post.reading_time_minutes} min read</span>}
    </div>
  )
}

function Fallback() {
  return <div className={s.fallback}><ContourLines className={s.contours} /><MountainMark /></div>
}

export default function BlogListing({ posts, categories, category }: { posts: PostCard[] | null; categories: string[]; category?: string }) {
  const featured = !category && posts && posts.length > 0 ? posts[0] : null
  const rest = featured ? posts!.slice(1) : (posts || [])
  const count = posts?.length ?? 0

  return (
    <div className={s.root}>
      <section className={s.hero}>
        <Image src="/our-story/hero.webp" alt="" fill priority sizes="100vw" className={s.heroImg} />
        <div className={s.heroIn}>
          <div>
            <span className={s.eb}>The Journal</span>
            <h1>Stories from the <em>Mountains</em></h1>
            <p>Health benefits, recipes and buying guides, written by the people who source it.</p>
          </div>
          {count > 0 && <div className={s.heroMeta}>{count} {count === 1 ? 'story' : 'stories'}<br />Himalayan journal</div>}
        </div>
      </section>

      <div className={s.body}>
        {categories.length > 0 && (
          <nav className={s.tabs} aria-label="Story categories">
            <Link href="/blog" className={`${s.tab}${!category ? ` ${s.tabOn}` : ''}`}>All stories</Link>
            {categories.map(c => (
              <Link key={c} href={`/blog?category=${encodeURIComponent(c)}`} className={`${s.tab}${category === c ? ` ${s.tabOn}` : ''}`}>{label(c)}</Link>
            ))}
          </nav>
        )}

        {!posts || posts.length === 0 ? (
          <div className={s.empty}>
            <span className={s.eb}>Coming soon</span>
            <h2>Stories are on their way</h2>
            <p>We&apos;re writing about the mountains. Check back soon.</p>
          </div>
        ) : (
          <>
            {featured && (
              <Reveal>
                <Link href={`/blog/${featured.slug}`} className={s.feat}>
                  <div className={s.fWrap}>
                    <div className={s.fImg}>
                      {featured.cover_image
                        ? <Image src={featured.cover_image} alt={featured.title} fill sizes="(max-width: 900px) 100vw, 720px" priority />
                        : <Fallback />}
                    </div>
                  </div>
                  <div className={s.fCopy}>
                    <span className={s.eb}>Latest story</span>
                    <h2>{featured.title}</h2>
                    {featured.excerpt && <p>{featured.excerpt}</p>}
                    <Meta post={featured} />
                    <span className={s.more}>Read the story</span>
                  </div>
                </Link>
              </Reveal>
            )}

            {rest.length > 0 && (
              <div className={s.grid}>
                {rest.map((post, i) => (
                  <Reveal key={post.id} delay={(i % 3) * 0.08}>
                    <Link href={`/blog/${post.slug}`} className={s.card}>
                      <div className={s.cImg}>
                        {post.cover_image
                          ? <Image src={post.cover_image} alt={post.title} fill sizes="(max-width: 600px) 100vw, (max-width: 900px) 50vw, 380px" />
                          : <Fallback />}
                      </div>
                      <Meta post={post} />
                      <h3>{post.title}</h3>
                      {post.excerpt && <p>{post.excerpt}</p>}
                      <span className={s.more}>Read the story</span>
                    </Link>
                  </Reveal>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <section className={s.cta}>
        <ContourLines className={s.ctaContours} />
        <div className={s.ctaIn}>
          <span className={s.eb} style={{ color: '#e6cf92' }}>From story to table</span>
          <h2>Taste what you read</h2>
          <p>Raw honey, bilona ghee and wild berries, sourced directly from the villages in these stories.</p>
          <Link href="/products" className={s.btn}>Shop the collection</Link>
        </div>
      </section>
    </div>
  )
}
