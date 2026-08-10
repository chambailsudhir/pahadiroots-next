'use client'
import { useState, useRef, useEffect, useCallback } from 'react'
import Link from 'next/link'
import OrderCard      from '../_components/OrderCard'
import OrdersSkeleton from '../_components/OrdersSkeleton'
import ErrorBoundary  from '@/components/ui/ErrorBoundary'
import { formatCurrency } from '@/lib/account/utils'
import { RETURN_REASONS, canReplace } from '@/lib/account/constants'
import type { useOrders } from '../hooks/useOrders'
import type { Order }     from '../hooks/useOrders'
import styles from '../styles/account.module.css'

type Orders = ReturnType<typeof useOrders>

// Builds a wa.me deep link pre-filled with order/reason/photo context, so
// the customer can forward their return request to support over WhatsApp
// as a secondary channel — common practice for COD-heavy Indian D2C brands
// that monitor WhatsApp closely. wa.me needs digits only (no +, spaces, or
// dashes), hence the strip.
function buildWhatsAppShareUrl(
  rawNumber: string,
  info: { orderNum: string; reason: string; resolution: 'refund' | 'replace'; photoUrls: string[] },
): string {
  const digits = rawNumber.replace(/\D/g, '')
  const reasonLabel = RETURN_REASONS.find(r => r.code === info.reason)?.label || info.reason
  const lines = [
    `Hi, I've requested a ${info.resolution === 'replace' ? 'replacement' : 'return'} for order ${info.orderNum}.`,
    `Reason: ${reasonLabel}`,
  ]
  if (info.photoUrls.length > 0) {
    lines.push('', 'Photos:', ...info.photoUrls)
  }
  return `https://wa.me/${digits}?text=${encodeURIComponent(lines.join('\n'))}`
}

interface Props {
  orders:    Orders
  showToast: (msg: string, type?: 'success' | 'error') => void
}

export default function OrdersSection({ orders, showToast }: Props) {
  const [returnModal, setReturnModal] = useState<{ orderId: string; orderNum: string; items: Order['items'] } | null>(null)
  const [returnReason,    setReturnReason]    = useState('')
  const [returnOtherText, setReturnOtherText] = useState('')
  const [submitting,      setSubmitting]      = useState(false)
  // Item picker — only shown when the order has more than one item. Index
  // into returnModal.items; null means "whole order" (preserves the
  // original behavior for single-item orders).
  const [selectedItemIdx, setSelectedItemIdx] = useState<number | null>(null)
  // Refund/Replace toggle — only shown when canReplace(returnReason). Always
  // resets to 'refund' when the reason changes to something that doesn't
  // qualify, so the toggle can never silently stay on 'replace' for a
  // disqualifying reason (server re-validates this too, but the UI should
  // never even offer an inconsistent state).
  const [resolution, setResolution] = useState<'refund' | 'replace'>('refund')
  // Photo evidence (damaged/wrong item) — admin-toggleable via
  // orders.settings.return_photo_upload_enabled (see useOrders.ts).
  // Uploaded immediately on selection (not deferred to submit) so the
  // customer sees each photo succeed/fail individually, matching the
  // upload-then-preview pattern most shopping apps use.
  const [uploadedPhotos, setUploadedPhotos] = useState<Array<{ url: string; name: string }>>([])
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const MAX_PHOTOS = 4
  // Post-submit success view (within the same modal) so the WhatsApp
  // share option — which needs the order/reason/photo context — has
  // somewhere to live without a second round-trip or a separate modal.
  const [submittedInfo, setSubmittedInfo] = useState<{ orderNum: string; reason: string; resolution: 'refund' | 'replace'; photoUrls: string[] } | null>(null)

  // Focus management for keyboard-accessible modal
  const firstRadioRef  = useRef<HTMLInputElement>(null)
  const triggerBtnRef  = useRef<HTMLButtonElement | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const modalBoxRef    = useRef<HTMLDivElement>(null)

  // Move focus into modal when it opens; restore to trigger when it closes
  useEffect(() => {
    if (returnModal) {
      firstRadioRef.current?.focus()
    }
  }, [returnModal])

  // closeReturnModal is declared before handleReturnModalKeyDown so the
  // reference is explicit. It reads `submitting` so it is a useCallback
  // with [submitting] in its dep array — prevents stale closure.
  const closeReturnModal = useCallback(() => {
    if (submitting) return
    setReturnModal(null)
    setReturnReason('')
    setReturnOtherText('')
    setSelectedItemIdx(null)
    setResolution('refund')
    setUploadedPhotos([])
    setSubmittedInfo(null)
    // Restore focus to the button that opened the modal
    triggerBtnRef.current?.focus()
    triggerBtnRef.current = null
  }, [submitting])

  // ESC closes the modal; Tab/Shift+Tab are trapped inside.
  // Uses onKeyDown on the modal div (same pattern as DangerZoneSection) so the
  // handler is scoped to the modal element and requires no global listener cleanup.
  const handleReturnModalKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') { closeReturnModal(); return }
    if (e.key !== 'Tab') return

    const modal = modalBoxRef.current
    if (!modal) return

    const focusable = Array.from(
      modal.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter(el => !el.closest('[disabled]'))

    if (focusable.length === 0) { e.preventDefault(); return }
    const first = focusable[0]
    const last  = focusable[focusable.length - 1]

    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus() }
    } else {
      if (document.activeElement === last) { e.preventDefault(); first.focus() }
    }
  }, [closeReturnModal])

  function openReturnModal(orderNum: string, triggerBtn?: HTMLButtonElement | null) {
    // orderNum may be the actual order_number or the id — find the order to get both
    const order = orders.filtered.find(
      (o: Order) => o.order_number === orderNum || String(o.id) === String(orderNum)
    )
    if (!order) return
    triggerBtnRef.current = triggerBtn ?? null
    setReturnReason('')
    setReturnOtherText('')
    // Item picker only shows (and only matters) when the order has more
    // than one item — single-item orders keep the original whole-order
    // behavior (no item fields sent, unchanged from before this feature).
    setSelectedItemIdx(null)
    setResolution('refund')
    setUploadedPhotos([])
    setSubmittedInfo(null)
    setReturnModal({ orderId: String(order.id), orderNum: order.order_number || orderNum, items: order.items || [] })
  }

  // Multi-item order + no item picked yet = can't submit (ambiguous which
  // item this is for). Single-item orders never hit this — the picker is
  // hidden and the request stays whole-order, same as before this feature.
  const needsItemSelection = (returnModal?.items?.length ?? 0) > 1 && selectedItemIdx === null
  const selectedItem = returnModal && selectedItemIdx !== null ? returnModal.items[selectedItemIdx] : null
  const replaceAvailable = !!returnReason && canReplace(returnReason)

  async function handlePhotoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || [])
    e.target.value = '' // allow re-selecting the same file after a removal
    if (!returnModal || files.length === 0) return
    const remaining = MAX_PHOTOS - uploadedPhotos.length
    if (remaining <= 0) {
      showToast(`You can attach up to ${MAX_PHOTOS} photos`, 'error')
      return
    }
    const toUpload = files.slice(0, remaining)
    setUploadingPhoto(true)
    try {
      for (const file of toUpload) {
        // Client-side checks mirror the server's — a fast, friendly reject
        // before spending a round-trip, not a substitute for the server
        // re-validating everything (which it does).
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
          showToast(`${file.name}: only JPEG, PNG, or WebP images are allowed`, 'error')
          continue
        }
        if (file.size > 5 * 1024 * 1024) {
          showToast(`${file.name}: photos must be under 5MB`, 'error')
          continue
        }
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
        const urlRes = await fetch(`/api/orders/${returnModal.orderId}/return/upload-url`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ fileName: safeName, fileType: file.type }),
        })
        const urlData = await urlRes.json()
        if (!urlRes.ok) {
          showToast(urlData.error || `${file.name}: upload failed`, 'error')
          continue
        }
        const putRes = await fetch(urlData.signedURL, {
          method:  'PUT',
          headers: { 'Content-Type': file.type },
          body:    file,
        })
        if (!putRes.ok) {
          showToast(`${file.name}: upload failed`, 'error')
          continue
        }
        setUploadedPhotos(prev => [...prev, { url: urlData.publicUrl, name: file.name }])
      }
    } catch (e: unknown) {
      console.error('[OrdersSection] photo upload failed:', e)
      showToast('Photo upload failed — please try again', 'error')
    } finally {
      setUploadingPhoto(false)
    }
  }

  async function submitReturn() {
    if (!returnModal || !returnReason) return
    // If "Other" is selected, require the free-text explanation
    if (returnReason === 'other' && !returnOtherText.trim()) return
    if (needsItemSelection) return
    setSubmitting(true)
    try {
      const finalResolution = replaceAvailable ? resolution : 'refund'
      const res = await fetch(`/api/orders/${returnModal.orderId}/return`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          reason:        returnReason,
          other_detail:  returnReason === 'other' ? returnOtherText.trim() : undefined,
          order_item_id: selectedItem?.id ?? undefined,
          variant_id:    selectedItem?.variant_id ?? undefined,
          product_id:    selectedItem?.product_id ?? undefined,
          resolution:    finalResolution,
          photo_urls:    uploadedPhotos.length > 0 ? uploadedPhotos.map(p => p.url) : undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        showToast(data.error || 'Return request failed', 'error')
      } else {
        showToast(data.message || '✅ Return request submitted!')
        // Switch to the success/share view instead of closing outright —
        // the WhatsApp share option lives here, since it needs the order
        // number, reason, and photo URLs that are about to be cleared.
        setSubmittedInfo({
          orderNum:   returnModal.orderNum,
          reason:     returnReason,
          resolution: finalResolution,
          photoUrls:  uploadedPhotos.map(p => p.url),
        })
        orders.refresh()
      }
    } catch (e: unknown) {
      // BUG FIX [ERROR HANDLING]: previously bare `catch {}` with no logging.
      console.error('[OrdersSection] return submit failed:', e)
      showToast('Network error — please try again', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ErrorBoundary section="Orders" onRetry={orders.refresh}>
      <div className={styles.panelSection}>
        <div className={styles.panelHeader}>
          <div className={styles.panelTitle}>My Orders</div>
          {orders.stats && (
            <div className={styles.panelCount}>{orders.totalCount} orders</div>
          )}
        </div>

        {/* Summary strip */}
        {orders.stats && orders.stats.total > 0 && (
          <div className={styles.orderSummaryStrip}>
            {[
              { n: orders.stats.delivered, l: 'Delivered',   cls: styles.ossDelivered },
              { n: orders.stats.active,    l: 'In Transit',  cls: styles.ossActive    },
              { n: orders.stats.cancelled, l: 'Cancelled',   cls: styles.ossCancelled },
              { n: orders.stats.spent,     l: 'Total Spent', cls: styles.ossSpent, fmt: true },
            ].map(({ n, l, cls, fmt }) => (
              <div key={l} className={`${styles.ossItem} ${cls}`}>
                <span className={styles.ossNum}>{fmt ? formatCurrency(n) : n}</span>
                <span className={styles.ossLbl}>{l}</span>
              </div>
            ))}
          </div>
        )}

        <div className={styles.card}>
          {(orders.loading && orders.orders === null) ? <OrdersSkeleton /> : (
            <>
              {/* Toolbar */}
              <div className={styles.ordersToolbar}>
                <div className={styles.searchWrap}>
                  <span className={styles.searchIcon}>🔍</span>
                  <label htmlFor="order-search" className="sr-only">Search orders</label>
                  <input
                    id="order-search"
                    aria-label="Search orders by order number or product"
                    className={styles.ordersSearch}
                    type="text"
                    placeholder="Search by order # or product…"
                    value={orders.search}
                    onChange={e => orders.setSearch(e.target.value)}
                  />
                  {orders.search && (
                    <button type="button" className={styles.searchClear} onClick={() => orders.setSearch('')}>✕</button>
                  )}
                </div>
                <div className={styles.filterRow} role="group" aria-label="Filter orders by status">
                  {([
                    { key: 'all'       as const, label: 'All'       },
                    { key: 'active'    as const, label: 'Active'    },
                    { key: 'delivered' as const, label: 'Delivered' },
                    { key: 'returns'   as const, label: 'Returns'   },
                    { key: 'cancelled' as const, label: 'Cancelled' },
                  ]).map(f => (
                    <button
                      key={f.key}
                      className={`${styles.filterBtn}${orders.filter === f.key ? ' ' + styles.filterBtnActive : ''}`}
                      onClick={() => orders.setFilter(f.key)}
                    >{f.label}</button>
                  ))}
                </div>
              </div>

              {/* Order list */}
              {orders.filtered.length === 0 ? (
                <div className={styles.emptyState}>
                  <div className={styles.emptyIcon}>{!orders.orders?.length ? '🛍️' : '🔍'}</div>
                  <div className={styles.emptyTitle}>{!orders.orders?.length ? 'No orders yet' : 'Nothing found'}</div>
                  <p className={styles.emptySub}>
                    {!orders.orders?.length
                      ? 'Discover our Himalayan natural products.'
                      : 'Try adjusting your search or filter.'}
                  </p>
                  {!orders.orders?.length && <Link href="/products" className={styles.btnPrimary}>Shop Now →</Link>}
                  {!!orders.orders?.length && (
                    <button className={styles.btnSecondary} onClick={() => { orders.setFilter('all'); orders.setSearch('') }}>
                      Clear Filters
                    </button>
                  )}
                </div>
              ) : (
                <>
                  {orders.filtered.map((o: Order) => (
                    <OrderCard
                      key={o.id}
                      order={o}
                      canReturn={orders.canReturn}
                      onReturnClick={openReturnModal}
                    />
                  ))}

                  {/* Load More */}
                  {orders.hasMore && (
                    <div style={{ textAlign: 'center', marginTop: '16px' }}>
                      <button
                        className={styles.btnSecondary}
                        onClick={orders.loadMore}
                        disabled={orders.loadingMore}
                      >
                        {orders.loadingMore ? 'Loading…' : `Load More (${orders.totalCount - orders.filtered.length} remaining)`}
                      </button>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Return Request Modal ── */}
      {returnModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="return-modal-title"
          className={styles.modalOverlay}
          onClick={e => { if (e.target === e.currentTarget) closeReturnModal() }}
          onKeyDown={handleReturnModalKeyDown}
        >
          <div ref={modalBoxRef} className={styles.modalBox}>
            <div className={styles.modalHeader}>
              <h3 id="return-modal-title" className={styles.modalTitle}>
                {resolution === 'replace' ? 'Replace' : 'Return'} Order {returnModal.orderNum}
              </h3>
              <button
                ref={closeButtonRef}
                onClick={closeReturnModal}
                disabled={submitting}
                className={styles.modalCloseBtn}
                aria-label="Close return modal"
              >✕</button>
            </div>

            {submittedInfo ? (
              // ── Post-submit success + share view ──────────────────────
              <div className={styles.returnSuccessWrap}>
                <div className={styles.returnSuccessIcon}>✅</div>
                <p className={styles.modalDesc}>
                  Your {submittedInfo.resolution === 'replace' ? 'replacement' : 'return'} request for order{' '}
                  <strong>{submittedInfo.orderNum}</strong> has been submitted. Our team will reach out within 24–48 hours.
                </p>
                {orders.settings?.whatsapp_number && (
                  <a
                    className={styles.btnWhatsapp}
                    href={buildWhatsAppShareUrl(orders.settings.whatsapp_number, submittedInfo)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    💬 Share details on WhatsApp
                  </a>
                )}
                <div className={styles.modalFooter}>
                  <button onClick={closeReturnModal} className={styles.btnPrimary}>Done</button>
                </div>
              </div>
            ) : (
              <>
            <p className={styles.modalDesc}>
              Please select the reason for your return. Our team will contact you within 24–48 hours to arrange a pickup.
            </p>

            {/* Item picker — only shown when the order has >1 item */}
            {returnModal.items.length > 1 && (
              <div className={styles.modalItemPicker}>
                <div className={styles.fLbl}>Which item?</div>
                {returnModal.items.map((it, idx) => (
                  <label key={`${it.id ?? idx}`} className={styles.modalItemOption}>
                    <input
                      type="radio"
                      name="return-item"
                      checked={selectedItemIdx === idx}
                      onChange={() => setSelectedItemIdx(idx)}
                      className={styles.modalReasonRadio}
                    />
                    {it.name || 'Product'}{it.variant ? ` (${it.variant})` : ''} × {it.qty || 1}
                  </label>
                ))}
              </div>
            )}

            <div className={styles.modalReasons}>
              {RETURN_REASONS.map((reason, index) => (
                <label key={reason.code} className={styles.modalReason}>
                  <input
                    ref={index === 0 ? firstRadioRef : undefined}
                    type="radio"
                    name="return-reason"
                    value={reason.code}
                    checked={returnReason === reason.code}
                    onChange={() => {
                      setReturnReason(reason.code)
                      // Reset to Refund whenever the newly-selected reason
                      // doesn't qualify for replacement, so the toggle can
                      // never be left silently pointing at 'replace' for a
                      // disqualifying reason (server re-validates this too).
                      if (!canReplace(reason.code)) setResolution('refund')
                    }}
                    className={styles.modalReasonRadio}
                  />
                  {reason.label}
                </label>
              ))}
            </div>

            {/* Refund/Replace toggle — only for qualifying reasons (mirrors
                admin's canReplace() — damaged/wrong_item/not_as_described/
                missing_parts only, never changed_mind/other). */}
            {replaceAvailable && (
              <div className={styles.modalResolutionRow} role="radiogroup" aria-label="Refund or replacement">
                <button
                  type="button"
                  className={`${styles.modalResolutionBtn} ${resolution === 'refund' ? styles.modalResolutionBtnActive : ''}`}
                  aria-pressed={resolution === 'refund'}
                  onClick={() => setResolution('refund')}
                >
                  💰 Refund
                </button>
                <button
                  type="button"
                  className={`${styles.modalResolutionBtn} ${resolution === 'replace' ? styles.modalResolutionBtnActive : ''}`}
                  aria-pressed={resolution === 'replace'}
                  onClick={() => setResolution('replace')}
                >
                  📦 Replace
                </button>
              </div>
            )}

            {/* Photo evidence — admin-toggleable (site_settings.
                return_photo_upload_enabled). Optional but recommended for
                damaged/wrong-item claims — speeds up approval, same as
                Amazon/Flipkart-style platforms. */}
            {orders.settings?.return_photo_upload_enabled === 'true' && (
              <div className={styles.returnPhotoWrap}>
                <label htmlFor="return-photo-input" className={styles.fLbl}>
                  Add photos (optional, up to {MAX_PHOTOS})
                </label>
                {uploadedPhotos.length > 0 && (
                  <div className={styles.returnPhotoPreviewRow}>
                    {uploadedPhotos.map((p, idx) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <div key={p.url} className={styles.returnPhotoThumb}>
                        <img src={p.url} alt={p.name} />
                        <button
                          type="button"
                          className={styles.returnPhotoRemove}
                          aria-label={`Remove ${p.name}`}
                          onClick={() => setUploadedPhotos(prev => prev.filter((_, i) => i !== idx))}
                        >✕</button>
                      </div>
                    ))}
                  </div>
                )}
                {uploadedPhotos.length < MAX_PHOTOS && (
                  <>
                    <input
                      id="return-photo-input"
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      multiple
                      onChange={handlePhotoSelect}
                      disabled={uploadingPhoto}
                      className={styles.returnPhotoInput}
                    />
                    {uploadingPhoto && <div className={styles.returnPhotoUploading}>Uploading…</div>}
                  </>
                )}
              </div>
            )}

            {/* Free-text explanation — required when "Other" is selected */}
            {returnReason === 'other' && (
              <div className={styles.returnOtherWrap}>
                <label htmlFor="return-other-text" className={styles.fLbl}>
                  Please describe your reason *
                </label>
                <textarea
                  id="return-other-text"
                  className={styles.returnOtherTextarea}
                  value={returnOtherText}
                  onChange={e => setReturnOtherText(e.target.value)}
                  placeholder="Briefly describe why you'd like to return this item…"
                  maxLength={500}
                  rows={3}
                  autoFocus
                />
                <div className={styles.returnOtherCount}>
                  {returnOtherText.length}/500
                </div>
              </div>
            )}

            <div className={styles.modalFooter}>
              <button
                onClick={closeReturnModal}
                disabled={submitting}
                className={styles.btnSecondary}
              >
                Cancel
              </button>
              <button
                onClick={submitReturn}
                disabled={
                  !returnReason ||
                  (returnReason === 'other' && !returnOtherText.trim()) ||
                  needsItemSelection ||
                  submitting ||
                  uploadingPhoto
                }
                className={styles.btnPrimary}
              >
                {submitting
                  ? 'Submitting…'
                  : needsItemSelection
                    ? 'Select an item first'
                    : `Submit ${resolution === 'replace' ? 'Replacement' : 'Return'} Request`}
              </button>
            </div>
              </>
            )}
          </div>
        </div>
      )}
    </ErrorBoundary>
  )
}
