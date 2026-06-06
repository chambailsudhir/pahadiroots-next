'use client'

import Link from 'next/link'
import { memo, useEffect, useRef, useState } from 'react'
import { formatPrice } from '@/lib/utils'
import styles from './CartUIComponents.module.css'

// ─── Sticky mobile CTA ────────────────────────────────────────────────────────
interface StickyProps {
  total: number
  /**
   * Pre-shipping subtotal — used exclusively for the min-order gate.
   *
   * Bug fixed: the original component used `total` (post-shipping) for both
   * the displayed amount AND the min-order comparison. This caused a logical
   * inconsistency with CartSummary, which correctly compares against the
   * pre-shipping subtotal. Example:
   *
   *   subtotal  ₹450  |  shipping ₹99  |  total ₹549  |  minOrderAmt ₹500
   *   StickyCartCTA (old): ₹549 ≥ ₹500 → checkout ENABLED   ✗
   *   CartSummary:         ₹450 < ₹500 → checkout BLOCKED    ✓
   *
   * With orderSubtotal, both components now compare the same value. The prop
   * is optional (defaults to total) so any existing usages of StickyCartCTA
   * outside CartPage continue to work without changes.
   */
  orderSubtotal?: number
  totalQty: number
  minOrderAmt?: number
}

export const StickyCartCTA = memo(function StickyCartCTA({
  total,
  orderSubtotal,
  totalQty,
  minOrderAmt = 0,
}: StickyProps) {
  // Fix: use orderSubtotal for the min-order gate; fall back to total when the
  // prop is absent so existing call-sites outside CartPage are unaffected.
  const belowMinOrder = minOrderAmt > 0 && (orderSubtotal ?? total) < minOrderAmt

  // Track whether the sticky bar is visually active (mobile viewport).
  // On desktop the wrapper has the `inert` attribute so neither keyboard users
  // nor screen readers can reach it — no aria-hidden needed.
  const [isMobile, setIsMobile] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 960px)')
    const update = (e: MediaQueryListEvent | MediaQueryList) => setIsMobile(e.matches)
    update(mq)
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  // Apply inert + aria-hidden imperatively — React doesn't support them natively yet.
  // aria-hidden ensures VoiceOver on older Safari (where inert isn't fully supported)
  // doesn't announce the duplicate "Checkout" button to screen reader users on desktop.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    if (isMobile) {
      el.removeAttribute('inert')
      el.removeAttribute('aria-hidden')
    } else {
      el.setAttribute('inert', '')
      el.setAttribute('aria-hidden', 'true')
    }
  }, [isMobile])

  return (
    <div ref={wrapRef} className={styles.sccWrap}>
      <div>
        <div className={styles.sccTotal}>{formatPrice(total)}</div>
        <div className={styles.sccSub}>{totalQty} item{totalQty > 1 ? 's' : ''} · Incl. taxes</div>
      </div>
      {belowMinOrder ? (
        <>
          {/* sr-only text tells screen readers *why* checkout is blocked —
              title attributes are not announced on touch devices. */}
          <span id="scc-min-warn" className="sr-only">
            Minimum order is ₹{minOrderAmt}. Add more items to proceed.
          </span>
          <button
            className={`${styles.sccBtn} ${styles.sccBtnDisabled}`}
            disabled
            aria-describedby="scc-min-warn"
          >🔒 Checkout</button>
        </>
      ) : (
        <Link href="/checkout" className={styles.sccBtn}>🔒 Checkout</Link>
      )}
    </div>
  )
})

// ─── Empty cart state ─────────────────────────────────────────────────────────
export const EmptyCart = memo(function EmptyCart() {
  return (
    <div className={styles.ecEmpty}>
      <div className={styles.ecIcon}>🛒</div>
      <h1 className={styles.ecTitle}>Your cart is empty</h1>
      <p className={styles.ecSub}>
        Discover natural Himalayan goodness crafted by mountain farmers.
      </p>
      <p className={styles.ecTagline}>
        &quot;From high-altitude farms, with care.&quot;
      </p>
      <Link href="/products" className={styles.ecBtn}>Browse Products →</Link>
    </div>
  )
})
