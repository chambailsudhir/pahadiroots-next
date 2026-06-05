'use client'

import { memo } from 'react'
import Image from 'next/image'
import { formatPrice } from '@/lib/utils'
import type { UpsellItem } from '@/types'
import styles from './UpsellSection.module.css'

interface Props {
  items: UpsellItem[]
  loading: boolean
  error?: boolean
  addedIds: string[]
  remainingForFreeShip: number
  isFreeShipping: boolean
  freeShipMin: number
  onAdd: (item: UpsellItem) => void
}

// Shimmer skeleton for individual upsell card
function UpsellShimmer() {
  return (
    <div className={styles.shimmer}>
      <div className={styles.shImg} />
      <div className={styles.shBody}>
        <div className={`${styles.shLine} ${styles.short}`} />
        <div className={styles.shLine} />
        <div className={`${styles.shLine} ${styles.medium}`} />
      </div>
      <div className={styles.shBtn} />
    </div>
  )
}

const UpsellSection = memo(function UpsellSection({
  items, loading, error, addedIds, remainingForFreeShip,
  isFreeShipping, freeShipMin, onAdd,
}: Props) {
  return (
    <div className={styles.card}>
      <div className={styles.head}>
        <h2 className={styles.title}>🛍 Customers Also Buy</h2>
        <span className={styles.sub}>
          {freeShipMin > 0 && !isFreeShipping
            ? `Add ${formatPrice(remainingForFreeShip)} more for free shipping`
            : 'Top picks for you'}
        </span>
      </div>

      <div className={styles.grid}>
        {loading
          ? [0, 1, 2, 3].map(i => <UpsellShimmer key={i} />)
          : error
            ? <p className={styles.errorMsg}>Couldn&apos;t load suggestions right now.</p>
          : items.slice(0, 4).length === 0
            ? <p className={styles.emptyMsg}>You&apos;re all caught up — no more suggestions right now!</p>
            : items.slice(0, 4).map(p => (
              <div
                key={p.id}
                className={`${styles.item}${addedIds.includes(p.id) ? ` ${styles.added}` : ''}`}
              >
                <div className={styles.imgWrap}>
                  {p.image
                    ? <Image src={p.image} alt={p.name} fill sizes="50px"
                        style={{ objectFit: 'cover', borderRadius: '8px' }} />
                    : <span className={styles.imgEmoji}>{p.emoji || '🌿'}</span>
                  }
                </div>
                <div className={styles.info}>
                  {p.badge && <div className={styles.badge}>{p.badge}</div>}
                  <div className={styles.name}>{p.name}</div>
                  <div className={styles.size}>{p.size}</div>
                  <div className={styles.priceRow}>
                    {p.mrp > p.price && <span className={styles.mrp}>{formatPrice(p.mrp)}</span>}
                    <span className={styles.price}>{formatPrice(p.price)}</span>
                  </div>
                </div>
                <button
                  className={`${styles.btn}${addedIds.includes(p.id) ? ` ${styles.added}` : ''}`}
                  onClick={() => onAdd(p)}
                  aria-label={`Add ${p.name} to cart`}
                  disabled={addedIds.includes(p.id)}
                >
                  {addedIds.includes(p.id) ? '✓' : '+ Add'}
                </button>
              </div>
            ))}
      </div>
    </div>
  )
})

export default UpsellSection
