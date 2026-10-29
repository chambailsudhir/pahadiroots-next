import Link from 'next/link'
import Image from 'next/image'
import { formatDate } from '@/lib/utils'
import { ContourLines, MountainMark } from '@/components/brand/BrandMotifs'
import ProductCard from '@/components/product/ProductCard'
import Reveal from '@/components/story/Reveal'
import ReadingProgress from './ReadingProgress'
import type { TocItem } from '@/lib/blogToc'
import type { Product } from '@/types'
import s from './blog.module.css'

export interface ArticleData {
  title: string
  excerpt: string | null
  category: string | null
  tags: string[] | null
  author: string | null
  published_at: string | null
  reading_time_minutes: number | null
  faq: { question: string; answer: string }[] | null
}

export interface MoreStory { title: string; slug: string; cover_image: string | null; reading_time_minutes: number | null }

const label = (c: string) => c.replace(/-/g, ' ')

function ShareRow({ title, url }: { title: string; url: string }) {
  const t = encodeURIComponent(title)
  const u = encodeURIComponent(url)
  return (
    <div className={s.share}>
      <span className={s.shareL}>Share</span>
      <a href={`https://wa.me/?text=${t}%20${u}`} target="_blank" rel="noopener noreferrer" aria-label="Share on WhatsApp" className={s.shareB}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347M12.05 21.785h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26C2.167 6.443 6.601 2.01 12.053 2.01c2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884" /></svg>
      </a>
      <a href={`https://twitter.com/intent/tweet?text=${t}&url=${u}`} target="_blank" rel="noopener noreferrer" aria-label="Share on X" className={s.shareB}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.9 2H22l-7.6 8.7L23.3 22H16.7l-5.2-6.8L5.5 22H2.4l8.2-9.3L1.7 2h6.8l4.7 6.3L18.9 2zm-1.2 18h1.7L7.4 4H5.6l12.1 16z"/></svg>
      </a>
      <a href={`mailto:?subject=${t}&body=${u}`} aria-label="Share by email" className={s.shareB}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M22 6l-10 7L2 6"/><rect x="2" y="4" width="20" height="16" rx="2"/></svg>
      </a>
    </div>
  )
}

export default function BlogArticle({
  post, html, toc, coverImage, canonicalUrl, relatedProducts, moreStories,
}: {
  post: ArticleData
  html: string
  toc: TocItem[]
  coverImage: string | null
  canonicalUrl: string
  relatedProducts: Product[]
  moreStories: MoreStory[]
}) {
  const authorName = post.author || 'HimVeda Team'
  const initial = authorName.trim()[0]?.toUpperCase() || 'H'

  return (
    <div className={s.root}>
      <ReadingProgress targetId="story-body" />

      <header className={s.aHero}>
        {coverImage
          ? <Image src={coverImage} alt="" fill priority sizes="100vw" className={s.aHeroImg} />
          : <div className={s.fallback} style={{ position: 'absolute', inset: 0 }}><ContourLines className={s.contours} /></div>}
        <nav className={s.crumbs} aria-label="Breadcrumb">
          <Link href="/">Home</Link><span aria-hidden>/</span><Link href="/blog">Journal</Link>
        </nav>
        <div className={s.aHeroIn}>
          {post.category && <span className={s.eb}>{label(post.category)}</span>}
          <h1>{post.title}</h1>
          <div className={s.byline}>
            <div className={s.avatar}>{initial}</div>
            <div>
              <div className={s.bName}>{authorName}</div>
              <div className={s.bMeta}>
                {post.published_at && formatDate(post.published_at)}
                {post.reading_time_minutes && <> · {post.reading_time_minutes} min read</>}
              </div>
            </div>
          </div>
        </div>
      </header>

      <article className={s.article} id="story-body">
        {post.excerpt && <p className={s.lead}>{post.excerpt}</p>}

        {toc.length >= 3 && (
          <nav className={s.toc} aria-label="In this story">
            <span className={s.eb}>In this story</span>
            <ol>{toc.map(t => <li key={t.id}><a href={`#${t.id}`}>{t.text}</a></li>)}</ol>
          </nav>
        )}

        <ShareRow title={post.title} url={canonicalUrl} />

        {html && <div className={s.prose} dangerouslySetInnerHTML={{ __html: html }} />}

        {post.tags && post.tags.length > 0 && (
          <div className={s.tags}>{post.tags.map(t => <span key={t} className={s.tag}>#{t}</span>)}</div>
        )}

        <div className={s.author}>
          <div className={s.avatar} style={{ background: 'var(--forest)', color: 'var(--gold2)', width: 52, height: 52 }}>{initial}</div>
          <div>
            <b>{authorName}</b>
            <span>Written from the villages and valleys we source from, for people who want to know where their food comes from.</span>
          </div>
        </div>

        {post.faq && post.faq.length > 0 && (
          <section className={s.faq}>
            <span className={s.eb}>Good to know</span>
            <h2>Frequently asked questions</h2>
            {post.faq.map((f, i) => (
              <details key={i} className={s.faqItem}>
                <summary>{f.question}</summary>
                <p>{f.answer}</p>
              </details>
            ))}
          </section>
        )}

        <div className={s.endShare}><ShareRow title={post.title} url={canonicalUrl} /></div>
      </article>

      {relatedProducts.length > 0 && (
        <section className={s.prodBand}>
          <ContourLines className={s.ctaContours} />
          <div className={s.prodIn}>
            <div className={s.prodHead}>
              <span className={s.eb} style={{ color: '#e6cf92' }}>From this story</span>
              <h2>{relatedProducts.length > 1 ? 'Taste the story' : 'Taste the story'}</h2>
            </div>
            <div className={s.prodGrid}>
              {relatedProducts.map(p => <ProductCard key={p.id} product={p} />)}
            </div>
          </div>
        </section>
      )}

      {moreStories.length > 0 && (
        <section className={s.moreWrap}>
          <div className={s.moreHead}>
            <span className={s.eb}>Keep reading</span>
            <h2>More stories</h2>
          </div>
          <div className={s.grid}>
            {moreStories.map((m, i) => (
              <Reveal key={m.slug} delay={i * 0.08}>
                <Link href={`/blog/${m.slug}`} className={s.card}>
                  <div className={s.cImg}>
                    {m.cover_image
                      ? <Image src={m.cover_image} alt={m.title} fill sizes="(max-width: 600px) 100vw, (max-width: 900px) 50vw, 380px" />
                      : <div className={s.fallback}><ContourLines className={s.contours} /><MountainMark /></div>}
                  </div>
                  {m.reading_time_minutes && <div className={s.meta}><span>{m.reading_time_minutes} min read</span></div>}
                  <h3>{m.title}</h3>
                  <span className={s.more}>Read the story</span>
                </Link>
              </Reveal>
            ))}
          </div>
          <div className={s.moreAll}><Link href="/blog" className={s.more}>Browse all stories</Link></div>
        </section>
      )}
    </div>
  )
}
