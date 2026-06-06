'use client'

/**
 * CartSkeleton — full-page loading placeholder shown while the cart hydrates.
 *
 * Accessibility fix applied (this round):
 *
 *   A1. Loading state not communicated to screen readers (WCAG 1.3.1 / 4.1.3).
 *       The skeleton rendered shimmer divs with no indication to assistive
 *       technology that content was loading. A screen reader user would either
 *       encounter a silent void (no interactive elements) or hear raw shimmer
 *       div content with no explanation.
 *       Fix:
 *         • role="status" on the root — a polite live region that announces
 *           its initial content on mount without interrupting ongoing SR output.
 *         • aria-label="Loading cart" — gives the region a descriptive name.
 *         • aria-busy="true" — signals to AT that the region's content is
 *           actively changing, suppressing premature reading of partial content.
 *         • All shimmer children marked aria-hidden="true" — skeleton shapes
 *           have no semantic meaning; the parent role="status" communicates
 *           the loading state and nothing more needs to be announced.
 *
 * Prior bug-fix already present (kept for reference):
 *   • PRICE_WIDTHS constant moved to module level — static data was being
 *     re-allocated inside the component function on every render.
 */

import styles from './CartSkeleton.module.css'

const PRICE_WIDTHS = [120, 100, 80] as const

export default function CartSkeleton() {
  return (
    /*
     * A1: role="status" + aria-label + aria-busy communicate the loading state.
     * All inner shimmer elements are aria-hidden — they are visual placeholders
     * only and add no information for screen reader users.
     */
    <div
      className={styles.wrap}
      role="status"
      aria-label="Loading cart"
      aria-busy="true"
    >
      {/* Ship bar */}
      <div className={styles.shipBar} aria-hidden="true" />

      {/* Steps */}
      <div className={styles.stepsBar} aria-hidden="true">
        {[0, 1, 2].map(i => (
          <div key={i} className={styles.stepGroup}>
            <div className={`skeleton ${styles.circle}`} />
            <div className={`skeleton ${styles.stepTxt}`} />
            {i < 2 && <div className={styles.stepDash} />}
          </div>
        ))}
      </div>

      <div className={styles.layout} aria-hidden="true">
        {/* Left */}
        <div className={styles.left}>

          {/* Items card */}
          <div className={styles.card}>
            <div className={styles.cardHead}>
              <div className={`skeleton ${styles.headTxt}`} />
            </div>
            {[0, 1].map(i => (
              <div key={i} className={styles.itemRow}>
                <div className={`skeleton ${styles.itemImg}`} />
                <div className={styles.itemBody}>
                  <div className={`skeleton ${styles.itemName}`} />
                  <div className={`skeleton ${styles.itemSize}`} />
                  <div className={styles.badgesRow}>
                    <div className={`skeleton ${styles.badge}`} />
                    <div className={`skeleton ${styles.badge}`} />
                  </div>
                  <div className={styles.itemFoot}>
                    <div className={`skeleton ${styles.qtyCtrl}`} />
                    <div className={`skeleton ${styles.priceCol}`} />
                    <div className={`skeleton ${styles.delBtn}`} />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Upsell card */}
          <div className={styles.card}>
            <div className={styles.cardHead}>
              <div className={`skeleton ${styles.headTxt} ${styles.w60}`} />
            </div>
            <div className={styles.upsellGrid}>
              {[0, 1, 2, 3].map(i => (
                <div key={i} className={styles.upsellItem}>
                  <div className={`skeleton ${styles.upsellImg}`} />
                  <div className={styles.upsellInfo}>
                    <div className={`skeleton ${styles.upsellBadge}`} />
                    <div className={`skeleton ${styles.upsellName}`} />
                    <div className={`skeleton ${styles.upsellPrice}`} />
                  </div>
                  <div className={`skeleton ${styles.upsellBtn}`} />
                </div>
              ))}
            </div>
          </div>

          {/* Trust card */}
          <div className={`${styles.card} ${styles.trustCard}`}>
            {[0, 1, 2, 3].map(i => (
              <div key={i} className={styles.trustItem}>
                <div className={`skeleton ${styles.trustIcon}`} />
                <div className={`skeleton ${styles.trustTxt}`} />
              </div>
            ))}
          </div>
        </div>

        {/* Right */}
        <div className={styles.right}>
          <div className={styles.card}>
            <div className={styles.pad}>
              {/* Coupon */}
              <div className={styles.couponRow}>
                <div className={`skeleton ${styles.couponInput}`} />
                <div className={`skeleton ${styles.couponBtn}`} />
              </div>
              {/* Prices */}
              <div className={styles.prices}>
                {PRICE_WIDTHS.map((w, i) => (
                  <div key={i} className={styles.priceRow}>
                    <div className={`skeleton ${styles.priceSkelLeft}`} style={{ width: w }} />
                    <div className={`skeleton ${styles.priceSkelRight}`} />
                  </div>
                ))}
                <div className={styles.divider} />
                <div className={styles.priceRow}>
                  <div className={`skeleton ${styles.totalLeft}`} />
                  <div className={`skeleton ${styles.totalRight}`} />
                </div>
              </div>
              {/* CTA */}
              <div className={`skeleton ${styles.cta}`} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
