'use client'

/**
 * UpsellSection — "Customers Also Buy" grid of product suggestions.
 *
 * Bug-fixes applied:
 *
 *   1. items.slice(0, 4) called twice in one ternary (Minor).
 *      The original ternary ran items.slice(0, 4) once to check .length === 0
 *      and again immediately after to call .map() on the non-empty case:
 *
 *        items.slice(0, 4).length === 0
 *          ? <empty>
 *          : items.slice(0, 4).map(...)   ← second slice, same result
 *
 *      Fix: derive `visibleItems` once before the JSX. This removes the
 *      redundant allocation and makes the intent clear.
 *
 *   2. Add-to-cart button missing type="button" (Minor).
 *      Consistent with the rest of the codebase; defensive against future
 *      <form> wrappers.
 */

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
  // Bug-fix 1: compute once — previously items.slice(0, 4) appeared twice in
  // the ternary below (once for .length === 0 and once for .map()), allocating
  // a second array with the same contents.
  const visibleItems = items.slice(0, 4)

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
            : visibleItems.length === 0
              ? <p className={styles.emptyMsg}>You&apos;re all caught up — no more suggestions right now!</p>
              : visibleItems.map(p => (
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
                  {/* Bug-fix 2: type="button" added — consistent with the rest of
                      the codebase and defensive against future <form> wrappers. */}
                  <button
                    type="button"
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
