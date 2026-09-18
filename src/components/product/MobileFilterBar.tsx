'use client'

// BUG FIX (CRITICAL mobile UX — newly found during products-page audit):
// globals.css had `@media(max-width:768px){ aside{display:none!important} }`
// with no replacement of any kind — below 768px, customers could not filter
// by category, change sort order, or toggle "In Stock Only" at all. Every
// mobile visitor (the majority of traffic for an Indian D2C storefront) was
// stuck on "All Products, Newest First" with zero way to change that.
// This component is a bottom-sheet drawer, shown only on mobile via CSS,
// that reproduces the exact same links the desktop sidebar has — built from
// the same buildProductsUrl() helper so the two never drift out of sync.

import { useState } from 'react'
import Link from 'next/link'
import { buildProductsUrl, type ProductsUrlState } from '@/lib/buildProductsUrl'
import PriceRangeFilter from '@/components/product/PriceRangeFilter'

interface CategoryLite { id: number | string; slug: string; name: string }

interface Props {
  categories:   CategoryLite[]
  activeCatSlug: string
  activeStateId: string
  activeStateName: string | null
  sort:         string
  instock:      boolean
  count:        number
  sortOptions:  { value: string; label: string; icon: string }[]
  priceBounds:  { min: number; max: number }
  priceCurrent: { min: number; max: number }
  minPriceParam?: string
  maxPriceParam?: string
  /** Base route for generated links — defaults to /products. Pass e.g.
   *  '/new-arrivals' to reuse this exact drawer on other listing pages. */
  basePath?: string
  /** Label for the "Collections" section's catch-all link + heading override. */
  allLabel?: string
  clearAllHref?: string
}

export default function MobileFilterBar({
  categories, activeCatSlug, activeStateId, activeStateName, sort, instock, count, sortOptions,
  priceBounds, priceCurrent, minPriceParam, maxPriceParam, basePath = '/products',
  allLabel = '🌿 All Products', clearAllHref,
}: Props) {
  const [open, setOpen] = useState(false)
  const urlState: ProductsUrlState = { sort, category: activeCatSlug, state: activeStateId, instock, minPrice: minPriceParam, maxPrice: maxPriceParam }
  const url = (overrides: Parameters<typeof buildProductsUrl>[1]) => buildProductsUrl(urlState, overrides, basePath)

  const activeCount =
    (activeCatSlug ? 1 : 0) + (activeStateId ? 1 : 0) + (instock ? 1 : 0) + (sort !== 'newest' ? 1 : 0)
    + (minPriceParam || maxPriceParam ? 1 : 0)

  return (
    <div className="mfb-root">
      {/* Floating trigger bar — fixed at bottom of viewport, mobile only */}
      <button
        type="button"
        className="mfb-trigger"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span>⚙️ Filters &amp; Sort</span>
        {activeCount > 0 && <span className="mfb-trigger-badge">{activeCount}</span>}
      </button>

      {open && (
        <div className="mfb-overlay" role="presentation" onClick={() => setOpen(false)}>
          <div
            className="mfb-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Filter and sort products"
            onClick={e => e.stopPropagation()}
          >
            <div className="mfb-sheet-header">
              <span className="mfb-sheet-title">Filters &amp; Sort</span>
              <button type="button" className="mfb-close" onClick={() => setOpen(false)} aria-label="Close">✕</button>
            </div>

            <div className="mfb-sheet-body">
              <div className="mfb-section-label">Sort By</div>
              <div className="mfb-link-list">
                {sortOptions.map(opt => (
                  <Link
                    key={opt.value}
                    href={url({ sort: opt.value })}
                    className={`mfb-link${sort === opt.value ? ' active-soft' : ''}`}
                    onClick={() => setOpen(false)}
                  >
                    {opt.icon} {opt.label}
                  </Link>
                ))}
              </div>

              <div className="mfb-section-label">Price Range</div>
              {priceBounds.max > priceBounds.min && (
                <PriceRangeFilter
                  key={`${priceCurrent.min}-${priceCurrent.max}`}
                  bounds={priceBounds}
                  current={priceCurrent}
                  urlState={urlState}
                  basePath={basePath}
                />
              )}

              <div className="mfb-section-label">Collections</div>
              <div className="mfb-link-list">
                <Link
                  href={url({ category: undefined, state: undefined })}
                  className={`mfb-link${!activeCatSlug && !activeStateId ? ' active' : ''}`}
                  onClick={() => setOpen(false)}
                >
                  {allLabel}
                </Link>
                {categories.map(cat => (
                  <Link
                    key={cat.id}
                    href={url({ category: cat.slug, state: undefined })}
                    className={`mfb-link${activeCatSlug === cat.slug ? ' active' : ''}`}
                    onClick={() => setOpen(false)}
                  >
                    {cat.name}
                  </Link>
                ))}
              </div>

              <div className="mfb-section-label">Availability</div>
              <Link
                href={url({ instock: instock ? 'false' : 'true' })}
                className={`mfb-link mfb-checkbox-link${instock ? ' active' : ''}`}
                onClick={() => setOpen(false)}
              >
                <span className="mfb-checkbox">{instock && '✓'}</span>
                In Stock Only
              </Link>

              <div className="mfb-sheet-footer">
                <span>{count} products</span>
                {activeCount > 0 && (
                  <Link href={clearAllHref ?? basePath} onClick={() => setOpen(false)}>Clear all</Link>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .mfb-root { display: none; }
        @media (max-width: 768px) {
          .mfb-root { display: block; }
        }
        .mfb-trigger {
          position: fixed; left: 50%; transform: translateX(-50%); bottom: 18px; z-index: 40;
          display: flex; align-items: center; gap: 8px;
          background: #1a3a1e; color: #fff; border: none; border-radius: 30px;
          padding: 13px 26px; font-size: 14px; font-weight: 700;
          box-shadow: 0 8px 24px rgba(26,58,30,.35); cursor: pointer;
        }
        /* BUG FIX (found on re-check after adding the global mobile bottom
           nav): this trigger was pinned at a flat bottom:18px, which now
           sits inside the new 56px-tall bottom nav bar's footprint,
           overlapping its icons. Lifted to clear the bar + safe area on
           the same breakpoint the bar itself uses (900px). */
        @media (max-width: 900px) {
          .mfb-trigger { bottom: calc(56px + env(safe-area-inset-bottom, 0px) + 14px); }
        }
        .mfb-trigger-badge {
          background: #c8920a; color: #fff; border-radius: 50%;
          width: 20px; height: 20px; display: flex; align-items: center; justify-content: center;
          font-size: 11px; font-weight: 800;
        }
        .mfb-overlay {
          position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 50;
          display: flex; align-items: flex-end;
        }
        .mfb-sheet {
          background: #fff; width: 100%; max-height: 80vh; overflow-y: auto;
          border-radius: 20px 20px 0 0; padding: 0 0 20px;
        }
        .mfb-sheet-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 16px 20px; border-bottom: 1px solid rgba(0,0,0,.06);
          position: sticky; top: 0; background: #fff; border-radius: 20px 20px 0 0;
        }
        .mfb-sheet-title { font-size: 16px; font-weight: 800; color: #1a3a1e; }
        .mfb-close {
          background: #f5f0e8; border: none; border-radius: 50%; width: 30px; height: 30px;
          font-size: 14px; cursor: pointer;
        }
        .mfb-sheet-body { padding: 16px 20px 0; }
        .mfb-section-label {
          font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 2px;
          color: #a07830; margin: 18px 0 8px;
        }
        .mfb-link-list { display: flex; flex-direction: column; gap: 4px; }
        .mfb-link {
          display: block; font-size: 14px; padding: 10px 12px; border-radius: 10px;
          text-decoration: none; font-weight: 500; color: #444; background: transparent;
        }
        .mfb-link.active { background: #1a3a1e; color: #fff; font-weight: 700; }
        .mfb-link.active-soft { background: #f0f7f1; color: #1a3a1e; font-weight: 700; }
        .mfb-checkbox-link { display: flex; align-items: center; gap: 10px; }
        .mfb-checkbox {
          width: 18px; height: 18px; border: 2px solid #999; border-radius: 4px;
          display: flex; align-items: center; justify-content: center; flex-shrink: 0;
          font-size: 11px; color: #fff;
        }
        .mfb-checkbox-link.active .mfb-checkbox { border-color: #fff; background: #1a3a1e; }
        .mfb-sheet-footer {
          display: flex; align-items: center; justify-content: space-between;
          margin-top: 20px; padding-top: 16px; border-top: 1px solid rgba(0,0,0,.06);
          font-size: 13px; color: #7a7a7a;
        }
        .mfb-sheet-footer a { color: #c8920a; font-weight: 700; text-decoration: underline; }
      `}</style>
    </div>
  )
}
