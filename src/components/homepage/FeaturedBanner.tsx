import Image from 'next/image'
import Link from 'next/link'
import { catSlug } from '@/lib/utils'
import { getCatalogMeta } from '@/lib/storeData'

interface Props { slug: string }

export default async function FeaturedBanner({ slug }: Props) {
  // PERF + CORRECTNESS FIX (audit): this used to run its own Supabase query on
  // every homepage hit, with no is_active filter (so a deactivated category
  // could still be promoted, and its "Shop Now" link 404'd). The shared,
  // cached catalog meta already holds exactly the ACTIVE categories, so the
  // featured category is simply looked up there — zero extra queries, and an
  // inactive/missing slug naturally renders nothing.
  let cat: { id: number; name: string; slug: string; description?: string | null; image_url?: string | null } | null = null
  try {
    const wanted = slug.trim().toLowerCase()
    const meta = await getCatalogMeta()
    cat = (meta.categories as any[]).find(c => String(c.slug || '').toLowerCase() === wanted) ?? null
  } catch { cat = null }

  if (!cat) return null

  return (
    <section style={{ padding: '24px 40px', background: 'var(--pm-surface, #fff)' }}>
      <div style={{ maxWidth: 1300, margin: '0 auto' }}>
        <Link href={`/collections/${catSlug(cat)}`} className="group" style={{ display: 'block' }}>
          <div style={{
            position: 'relative', overflow: 'hidden', borderRadius: 20,
            background: 'linear-gradient(135deg,#071a09,#1a3a1e)',
            height: 220, display: 'flex', alignItems: 'center',
            boxShadow: '0 12px 40px rgba(0,0,0,.2)',
          }}>
            {/* BUG FIX (P2): this rendered the category image via a raw
                CSS backgroundImage — the full-resolution original loads
                with no resizing/compression, the exact problem already
                fixed for CategoryTiles.tsx's thumbnails (see the comment
                there). This banner is large and always above the fold, so
                the unoptimized-image cost here is bigger, not smaller. */}
            {cat.image_url && (
              <Image
                src={cat.image_url}
                alt=""
                fill
                sizes="(max-width:960px) 100vw, 1300px"
                quality={70}
                style={{ objectFit: 'cover', objectPosition: 'center', opacity: .3 }}
              />
            )}
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg,rgba(7,26,9,.85) 40%,transparent 100%)' }} />
            <div style={{ position: 'relative', padding: '0 48px' }}>
              <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 3, color: 'var(--gd2)', textTransform: 'uppercase', marginBottom: 8 }}>
                ✦ Featured Collection
              </div>
              <h3 style={{ fontFamily: 'var(--font-playfair), "Playfair Display", Georgia, serif', fontSize: 'clamp(22px,3vw,36px)', fontWeight: 900, color: '#fff', marginBottom: 10 }}>
                {cat.name}
              </h3>
              {cat.description && (
                <p style={{ fontSize: 13, color: 'rgba(255,255,255,.65)', maxWidth: 400, marginBottom: 20, lineHeight: 1.6 }}>
                  {cat.description}
                </p>
              )}
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                background: 'var(--gd)', color: '#1a0800',
                fontWeight: 800, fontSize: 14, padding: '10px 24px', borderRadius: 24,
                transition: 'background .2s',
              }}>
                Shop Now
                <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                </svg>
              </span>
            </div>
          </div>
        </Link>
      </div>
    </section>
  )
}
