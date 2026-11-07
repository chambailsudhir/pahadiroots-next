'use client'
// ─────────────────────────────────────────────────────────────
// DangerZoneSection — DPDP-compliant account deletion
//
// Flow:
//  1. User clicks "Delete my account"
//  2. Modal explains consequences (what is erased, what is kept for GST, no recovery)
//  3. User must type "DELETE" to unlock the confirm button
//  4. Calls DELETE /api/account/delete with { confirm: "DELETE" }
//  5. On success: clears local state + redirects to /
//
// ✅ No accidental deletion — 3-step confirmation
// ✅ Correctly handles 401 (session expired) mid-flow
// ✅ Matches CSS Module pattern used across account module
// ─────────────────────────────────────────────────────────────

import { ga4AccountAction } from '@/lib/analytics/ga4'
import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import ErrorBoundary from '@/components/ui/ErrorBoundary'
import { useUserStore } from '@/store/userStore'
import { clearClientPII } from '@/lib/clientLogout'
import styles from '../styles/account.module.css'

interface Props {
  userEmail:   string
  onLogout:    () => void
  showToast:   (msg: string, type?: 'success' | 'error') => void
  markExpired?: () => void
}

export default function DangerZoneSection({ userEmail, onLogout, showToast, markExpired }: Props) {
  const router = useRouter()
  const storeLogout = useUserStore(s => s.logout)

  const [open,        setOpen]        = useState(false)
  const [step,        setStep]        = useState<1 | 2>(1)
  const [typed,       setTyped]       = useState('')
  const [password,    setPassword]    = useState('')
  const [delError,    setDelError]    = useState('')
  const [delCode,     setDelCode]     = useState('')
  const [deleted,     setDeleted]     = useState(false)
  const [deleting,    setDeleting]    = useState(false)
  const [downloading, setDownloading] = useState(false)
  const inputRef    = useRef<HTMLInputElement>(null)
  const modalBoxRef = useRef<HTMLDivElement>(null)

  // closeModal is declared before handleModalKeyDown so the reference is
  // explicit and not relying on function-hoisting.
  const closeModal = useCallback(() => {
    if (deleting) return   // don't close mid-delete
    setOpen(false)
    setStep(1)
    setTyped('')
    setPassword('')
    setDelError('')
    setDelCode('')
  }, [deleting])

  // ── Focus trap: intercept Tab/Shift+Tab so keyboard focus stays inside the modal
  const handleModalKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') { closeModal(); return }
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

    // The box itself (tabIndex=-1) holds focus right after opening: from there Shift+Tab / Tab must stay inside too.
    const active  = document.activeElement
    const outside = active === modal || !focusable.includes(active as HTMLElement)
    if (e.shiftKey) {
      if (active === first || outside) { e.preventDefault(); last.focus() }
    } else {
      if (active === last || outside) { e.preventDefault(); first.focus() }
    }
  }, [closeModal])

  async function downloadMyData() {
    setDownloading(true)
    try {
      const res = await fetch('/api/account/data-export', {
        method: 'GET',
        credentials: 'include',
        headers: { 'x-origin': window.location.origin },
      })
      if (res.status === 429) {
        showToast('You have already requested a data export recently. Please try again in 24 hours.', 'error')
        return
      }
      if (!res.ok) {
        showToast('Could not generate your data export — please try again.', 'error')
        return
      }
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = 'pahadiroots-my-data.json'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      showToast('Your data has been downloaded.', 'success')
      ga4AccountAction('data_exported')
    } catch (e: unknown) {
      // BUG FIX [ERROR HANDLING]: previously bare `catch {}` with no logging.
      console.error('[DangerZoneSection] data export download failed:', e)
      showToast('Something went wrong — please try again.', 'error')
    } finally {
      setDownloading(false)
    }
  }

  function openModal() {
    setStep(1)
    setTyped('')
    setPassword('')
    setDelError('')
    setDelCode('')
    setDeleting(false)
    setOpen(true)
    // BUG FIX: this only ever focused inputRef, but that input doesn't
    // exist until step 2 (it's conditionally rendered) — so at step 1,
    // nothing inside the modal received focus at all. Since the Tab-trap
    // in handleModalKeyDown only fires for keydown events bubbling from
    // inside the modal, a keyboard user whose focus never moved into it
    // could Tab straight into background content instead of being
    // trapped — the modal would visually cover the page but not actually
    // contain keyboard focus. Focusing the modal box itself (tabIndex=-1
    // added below) guarantees something inside the modal is focused
    // immediately, regardless of which step is currently showing.
    requestAnimationFrame(() => requestAnimationFrame(() => modalBoxRef.current?.focus()))
  }

  async function handleDelete() {
    if (deleting) return
    if (typed !== 'DELETE') {
      // Enter in a field used to return silently — say why nothing happened.
      setDelError('Type DELETE (in capital letters) in the box to confirm.')
      requestAnimationFrame(() => inputRef.current?.focus())
      return
    }
    setDeleting(true)
    setDelError('')

    try {
      const res = await fetch('/api/account/delete', {
        method:  'DELETE',
        headers: { 'Content-Type': 'application/json' },
        // AUDIT ACC-023: the current password is sent for re-authentication (email accounts).
        body:    JSON.stringify({ confirm: 'DELETE', ...(password ? { password } : {}) }),
        signal:  AbortSignal.timeout(15_000),
      })

      if (res.status === 401) {
        markExpired?.()
        closeModal()
        return
      }

      // 403 = re-authentication problem (wrong/missing password, or Google sign-in too old).
      // Show it INSIDE the dialog and keep the session — never treat it as "logged out".
      if (res.status === 403) {
        const data = await res.json().catch(() => ({})) as { error?: string; code?: string }
        setDeleting(false)
        setDelCode(data.code || '')
        setDelError(
          (data.error || 'Please confirm your identity to continue.') +
          (data.code === 'reauth_failed' ? ' If you only ever signed in with Google, leave the password blank, or sign out and sign in with Google again, then retry.' : ''),
        )
        if (data.code === 'password_required' || data.code === 'reauth_failed') {
          requestAnimationFrame(() => document.getElementById('del-password')?.focus())
        }
        return
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data as { error?: string }).error || 'Deletion failed')
      }

      // Clear all local auth state
      ga4AccountAction('account_deleted')
      clearClientPII()   // AUDIT ACC-040: name/phone/address caches must not outlive the account
      storeLogout()
      setOpen(false)
      setDeleted(true)   // block the (now signed-out) account UI until the redirect

      // Give the user a clear, final acknowledgment before redirect
      showToast('Your account has been deleted. Goodbye!', 'success')
      setTimeout(() => router.push('/'), 1800)

    } catch (e: unknown) {
      setDeleting(false)
      showToast(
        e instanceof Error ? e.message : 'Account deletion failed — please contact support',
        'error',
      )
    }
  }

  return (
    <ErrorBoundary section="Account Deletion">
      <div className={styles.panelSection}>
        <div className={styles.panelHeader}>
          <div className={styles.panelTitle} role="heading" aria-level={1}>Privacy &amp; Data</div>
        </div>

        {/* Data rights info */}
        <div className={styles.card}>
          <div className={styles.cardSectionTitle}>Your Data Rights</div>
          <p className={styles.dangerInfoText}>
            Under India&apos;s <strong>Digital Personal Data Protection Act 2023 (DPDP)</strong>,
            you have the right to request erasure of your personal data. When you delete your
            account we will <strong>erase</strong>:
          </p>
          <ul className={styles.dangerList}>
            <li>Your name, phone number, e-mail, GSTIN and profile address, and all saved delivery addresses</li>
            <li>Your wishlist, abandoned carts and back-in-stock alerts</li>
            <li>Order notes, notes on Pahadi Coins entries, return photos and your comments on returns</li>
            <li>The phone number, e-mail and any other details stored with the delivery address of your past orders</li>
            <li>Your login — this cannot be undone</li>
          </ul>
          <p className={styles.dangerInfoText}>
            <strong>What we must keep:</strong> for completed orders, GST law requires us to keep the invoice details —
            the <strong>recipient name and delivery address</strong> (and the GSTIN, if it was a business order) —
            for <strong>up to 6 years</strong>. We keep nothing else on those orders, and never use it for marketing.
          </p>
          <p className={styles.dangerInfoNote}>
            Orders that are still in progress (not yet delivered or cancelled, or with a return or refund open) must be
            completed first — your account cannot be deleted until then. Product reviews you wrote stay on the
            product page but become anonymous.
          </p>
          {userEmail && (
            <p className={styles.dangerInfoNote}>
              A confirmation will be sent to <strong>{userEmail}</strong>.
            </p>
          )}
        </div>

        {/* DPDP §16 — Right to Access / Data Portability */}
        <div className={styles.card}>
          <div className={styles.cardSectionTitle}>Download My Data</div>
          <p className={styles.dangerInfoText}>
            Under <strong>DPDP Act 2023 §16</strong>, you have the right to access a copy
            of all personal data we hold about you — your profile, addresses, and order history.
          </p>
          <div className={styles.dangerRow}>
            <div>
              <div className={styles.dangerRowTitle}>Export your data</div>
              <div className={styles.dangerRowSub}>
                Downloads a JSON file containing your profile, saved addresses, and order history.
              </div>
            </div>
            <button
              className={styles.btnSecondary}
              onClick={downloadMyData}
              disabled={downloading}
              aria-busy={downloading}
            >
              {downloading ? 'Preparing…' : 'Download'}
            </button>
          </div>
        </div>

        {/* Danger zone action */}
        <div className={`${styles.card} ${styles.dangerCard}`}>
          <div className={`${styles.cardSectionTitle} ${styles.dangerSectionTitle}`}>
            Danger Zone
          </div>
          <div className={styles.dangerRow}>
            <div>
              <div className={styles.dangerRowTitle}>Delete my account</div>
              <div className={styles.dangerRowSub}>
                Permanently erase all personal data. This action is irreversible.
              </div>
            </div>
            <button className={styles.btnDanger} onClick={openModal}>
              Delete Account
            </button>
          </div>
        </div>
      </div>

      {deleted && (
        <div role="status" aria-live="polite"
          style={{ position: 'fixed', inset: 0, zIndex: 9990, background: 'rgba(255,255,255,.96)', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 24, fontWeight: 700, color: '#1a3a1e' }}>
          Your account has been deleted. Redirecting…
        </div>
      )}

      {/* ── Confirmation Modal ──────────────────────────────── */}
      {open && (
        <div
          className={styles.modalOverlay}
          role="dialog"
          aria-modal="true"
          aria-labelledby="del-modal-title"
          onClick={e => { if (e.target === e.currentTarget) closeModal() }}
          onKeyDown={handleModalKeyDown}
        >
          <div ref={modalBoxRef} className={styles.modalBox} tabIndex={-1}>
            <div className={styles.modalHeader}>
              <h2 id="del-modal-title" className={styles.modalTitle}>
                {step === 1 ? '⚠️ Delete your account?' : '🗑️ Confirm permanent deletion'}
              </h2>
              <button
                className={styles.modalCloseBtn}
                onClick={closeModal}
                disabled={deleting}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            {step === 1 && (
              <>
                <p className={styles.modalDesc}>
                  This will <strong>permanently delete</strong> your HimVeda by Pahadi Roots account and
                  erase your personal data, in line with India&apos;s DPDP Act 2023. We keep only what GST law requires.
                </p>
                <ul className={styles.dangerModalList}>
                  <li>You will be logged out immediately</li>
                  <li>Your profile, address book, wishlist and phone/e-mail on past orders will be erased</li>
                  <li>Completed orders keep only the recipient name and delivery address (and GSTIN for business orders) for up to 6 years, as GST law requires</li>
                  <li>Orders still in progress must be delivered or cancelled first</li>
                  <li>Your reviews stay but become anonymous</li>
                  <li>You can create a new account at any time</li>
                </ul>
                <div className={styles.modalFooter}>
                  <button
                    className={styles.btnDangerOutline}
                    onClick={() => {
                      setStep(2)
                      // BUG FIX: this button itself gets unmounted the
                      // moment step becomes 2 (step 1's whole block is
                      // replaced by step 2's) — in some browsers, focus
                      // on an element that's removed from the DOM falls
                      // back to <body>, which would throw focus out of
                      // the modal. Explicitly move it to the new text
                      // input once it mounts.
                      requestAnimationFrame(() => requestAnimationFrame(() => inputRef.current?.focus()))
                    }}
                  >
                    Continue →
                  </button>
                  <button className={styles.btnSecondary} onClick={closeModal}>
                    Cancel
                  </button>
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <p className={styles.modalDesc}>
                  Type <strong>DELETE</strong> in the box below to permanently erase your account.
                </p>
                <div className={styles.dangerConfirmWrap}>
                  <label htmlFor="del-password" style={{ display: 'block', fontSize: 13, fontWeight: 700, margin: '0 0 6px' }}>
                    Your password <span style={{ fontWeight: 400, color: '#666' }}>(leave blank if you signed in with Google)</span>
                  </label>
                  <input
                    id="del-password"
                    type="password"
                    className={styles.dangerConfirmInput}
                    value={password}
                    onChange={e => { setPassword(e.target.value); setDelError('') }}
                    onKeyDown={e => { if (e.key === 'Enter') handleDelete() }}
                    disabled={deleting}
                    autoComplete="current-password"
                    style={{ marginBottom: 12 }}
                  />
                  <input
                    ref={inputRef}
                    type="text"
                    className={styles.dangerConfirmInput}
                    placeholder="Type DELETE to confirm"
                    value={typed}
                    onChange={e => { setTyped(e.target.value); if (delError) setDelError('') }}
                    onKeyDown={e => { if (e.key === 'Enter') handleDelete() }}
                    disabled={deleting}
                    autoComplete="off"
                    spellCheck={false}
                    aria-label='Type DELETE to confirm account deletion'
                  />
                </div>
                {delError && (
                  <p role="alert" style={{ color: '#b3261e', fontSize: 14, fontWeight: 600, margin: '10px 0 0' }}>{delError}</p>
                )}
                {delCode === 'reauth_required' && (
                  <button type="button" className={styles.btnSecondary} style={{ marginTop: 10 }} onClick={() => { closeModal(); onLogout() }}>
                    Sign out and sign in again
                  </button>
                )}
                <div className={styles.modalFooter}>
                  <button
                    className={styles.btnDanger}
                    onClick={handleDelete}
                    disabled={typed !== 'DELETE' || deleting}
                    aria-disabled={typed !== 'DELETE' || deleting}
                  >
                    {deleting ? 'Deleting…' : 'Permanently Delete Account'}
                  </button>
                  <button
                    className={styles.btnSecondary}
                    onClick={closeModal}
                    disabled={deleting}
                  >
                    Cancel
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
