import Link from 'next/link'
import Image from 'next/image'
import type { Category } from '@/types'

interface Props { categories: Category[] }

function getCatEmoji(name: string): string {
  const n = name.toLowerCase()
  if (n.includes('honey'))                         return '🍯'
  if (n.includes('ghee'))                          return '🥛'
  if (n.includes('spice') || n.includes('herb'))   return '🌿'
  if (n.includes('tea'))                           return '🍵'
  if (n.includes('grain') || n.includes('rice') || n.includes('millet')) return '🌾'
  if (n.includes('dry') || n.includes('fruit') || n.includes('nut'))     return '🌰'
  if (n.includes('oil'))                           return '🫙'
  if (n.includes('juice') || n.includes('squash')) return '🧃'
  if (n.includes('shilajit') || n.includes('resin')) return '🪨'
  if (n.includes('saffron'))                       return '🌸'
  if (n.includes('pickle') || n.includes('sauce')) return '🫙'
  if (n.includes('coffee'))                        return '☕'
  return '🏔️'
}

export default function CategoryTiles({ categories }: Props) {
  const active = categories.filter(c => c.is_active).slice(0, 8)
  if (!active.length) return null

  return (
    <section style={{ background: 'linear-gradient(180deg,#f9f4ec,#f2e8d0)', padding: '40px 40px 52px' }}>

      {/* Section header */}
      <div style={{ textAlign: 'center', marginBottom: '32px' }}>
        <div style={{
          display: 'inline-block', fontSize: '11px', fontWeight: 800,
          textTransform: 'uppercase', letterSpacing: '2px', color: '#c8920a',
          background: 'rgba(200,146,10,.1)', border: '1px solid rgba(200,146,10,.25)',
          padding: '4px 14px', borderRadius: '20px', marginBottom: '12px',
          fontFamily: 'var(--font-lato,Lato,sans-serif)',
        }}>Browse Collections</div>
        <h2 style={{
          fontFamily: 'var(--font-playfair,"Playfair Display",Georgia,serif)',
          fontSize: 'clamp(26px,3.5vw,44px)', fontWeight: 700, color: '#1a3a1e',
          marginBottom: '8px', lineHeight: 1.2,
        }}>What the Mountains Offer</h2>
        <p style={{ fontSize: '14px', color: '#7a7a7a', maxWidth: '440px', margin: '0 auto', lineHeight: 1.6 }}>
          Every category tells a story of altitude, tradition, and purity.
        </p>
      </div>

      {/* 4-column grid */}
      <div className="pr-cat-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '18px', maxWidth: '1200px', margin: '0 auto' }}>
        {active.map((cat) => (
          <Link key={cat.id} href={`/collections/${cat.slug}`} className="pr-cat-card" style={{
            background: '#fff', borderRadius: '20px', overflow: 'hidden', textAlign: 'center',
            display: 'flex', flexDirection: 'column', alignItems: 'stretch',
            border: '1.5px solid rgba(0,0,0,.06)', boxShadow: '0 2px 12px rgba(0,0,0,.06)',
            textDecoration: 'none', transition: 'all .3s', cursor: 'pointer',
          }}>
            {/* Image + emoji area */}
            <div style={{
              position: 'relative', width: '100%', aspectRatio: '4/3',
              overflow: 'hidden', background: '#f5f0e8',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              {cat.image_url && (
                <Image src={cat.image_url} alt={cat.name} fill
                  sizes="(max-width:640px) 50vw, 25vw"
                  style={{ objectFit: 'cover', objectPosition: 'center', transition: 'transform .4s ease' }}
                />
              )}
              <span style={{
                fontSize: '52px', position: 'absolute', top: '50%', left: '50%',
                transform: 'translate(-50%,-50%)', zIndex: cat.image_url ? 0 : 1,
                pointerEvents: 'none', display: 'block',
              }}>{getCatEmoji(cat.name)}</span>
            </div>

            {/* Text */}
            <div style={{ padding: '14px 12px 16px' }}>
              <div style={{
                fontFamily: 'var(--font-playfair,"Playfair Display",Georgia,serif)',
                fontSize: '14px', fontWeight: 700, color: '#1a3a1e',
                lineHeight: 1.3, marginBottom: '4px', whiteSpace: 'normal',
              }}>{cat.name}</div>
              <div style={{ fontSize: '11.5px', color: '#7a7a7a', lineHeight: 1.3 }}>
                {cat.description || '\u00a0'}
              </div>
            </div>
          </Link>
        ))}
      </div>

      <style>{`
        .pr-cat-card:hover { transform:translateY(-5px) !important; box-shadow:0 14px 36px rgba(0,0,0,.12) !important; border-color:#c8920a !important; }
        .pr-cat-card:hover img { transform:scale(1.05) !important; }
        @media(max-width:960px){ .pr-cat-grid { grid-template-columns:repeat(3,1fr) !important; } }
        @media(max-width:640px){ .pr-cat-grid { grid-template-columns:repeat(2,1fr) !important; gap:12px !important; } }
        @media(max-width:360px){ .pr-cat-grid { grid-template-columns:repeat(2,1fr) !important; gap:8px !important; } }
      `}</style>
    </section>
  )
}
