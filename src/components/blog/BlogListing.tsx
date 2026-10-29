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
  const parts = [
    post.published_at ? formatDate(post.published_at) : null,
    post.reading_time_minutes ? `${post.reading_time_minutes} min read` : null,
  ].filter(Boolean) as string[]
  return (
    <div className={s.meta}>
      {parts.map((p, i) => <span key={p} style={{ display: 'contents' }}>{i > 0 && <i aria-hidden />}<span>{p}</span></span>)}
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
  const latest = posts?.find(p => p.published_at)?.published_at
  const issue = latest ? new Date(latest).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) : null

  return (
    <div className={s.root}>
      <section className={s.mast}>
        <ContourLines className={s.mastContours} />
        <div className={s.mastIn}>
          <div className={s.dateline}>
            <span>HimVeda Journal</span><i aria-hidden />
            {issue && <><span>{issue}</span><i aria-hidden /></>}
            <span>{count} {count === 1 ? 'story' : 'stories'}</span>
          </div>
          <h1>The Pahadi <em>Journal</em></h1>
          <p className={s.mastSub}>Short, honest reads on Himalayan honey, ghee and wild harvests, from the people who source them.</p>
        </div>
      </section>

      <div className={s.body}>
        {categories.length > 0 && (
          <nav className={s.chips} aria-label="Story categories">
            <Link href="/blog" className={`${s.chip}${!category ? ` ${s.chipOn}` : ''}`}>All stories</Link>
            {categories.map(c => (
              <Link key={c} href={`/blog?category=${encodeURIComponent(c)}`} className={`${s.chip}${category === c ? ` ${s.chipOn}` : ''}`}>{label(c)}</Link>
            ))}
          </nav>
        )}

        {!posts || posts.length === 0 ? (
          <div className={s.empty}>
            <span className={s.kicker}>Coming soon</span>
            <h2>Stories are on their way</h2>
            <p>We&apos;re writing about the mountains. Check back soon.</p>
          </div>
        ) : (
          <>
            {featured && (
              <Reveal>
                <Link href={`/blog/${featured.slug}`} className={s.feat}>
                  <div className={s.fMedia}>
                    <span className={s.badge}>Latest</span>
                    {featured.cover_image
                      ? <Image src={featured.cover_image} alt={featured.title} fill sizes="(max-width: 900px) 100vw, 640px" priority />
                      : <Fallback />}
                  </div>
                  <div className={s.fBody}>
                    {featured.category && <span className={s.cat}>{label(featured.category)}</span>}
                    <h2>{featured.title}</h2>
                    {featured.excerpt && <p>{featured.excerpt}</p>}
                    <Meta post={featured} />
                    <span className={s.read}>Read story</span>
                  </div>
                </Link>
              </Reveal>
            )}

            {rest.length > 0 && (
              <div className={s.grid}>
                {rest.map((post, i) => (
                  <Reveal key={post.id} delay={(i % 3) * 0.08}>
                    <Link href={`/blog/${post.slug}`} className={s.card}>
                      <div className={s.cMedia}>
                        {post.category && <span className={s.chipOver}>{label(post.category)}</span>}
                        {post.cover_image
                          ? <Image src={post.cover_image} alt={post.title} fill sizes="(max-width: 600px) 100vw, (max-width: 900px) 50vw, 380px" />
                          : <Fallback />}
                      </div>
                      <div className={s.cBody}>
                        <Meta post={post} />
                        <h3>{post.title}</h3>
                        {post.excerpt && <p>{post.excerpt}</p>}
                        <span className={s.read}>Read story</span>
                      </div>
                    </Link>
                  </Reveal>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div className={s.shopWrap}>
        <section className={s.shop}>
          <ContourLines className={s.shopC} />
          <div>
            <span className={s.kicker} style={{ color: '#f5d98a' }}>From story to table</span>
            <h2>Taste what you read</h2>
            <p>Raw honey, bilona ghee and wild berries, sourced directly from the villages in these stories.</p>
          </div>
          <div className={s.shopLinks}>
            <Link href="/collections/himalayan-honey" className={s.pill}>Shop honey</Link>
            <Link href="/collections/himalayan-ghee" className={s.pill}>Shop ghee</Link>
            <Link href="/products" className={s.pill}>All products</Link>
          </div>
        </section>
      </div>
    </div>
  )
}
