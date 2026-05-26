'use client'
// ─────────────────────────────────────────────────────────────
// DangerZoneSection — DPDP-compliant account deletion
//
// Flow:
//  1. User clicks "Delete my account"
//  2. Modal explains consequences (data anonymisation, no recovery)
//  3. User must type "DELETE" to unlock the confirm button
//  4. Calls DELETE /api/account/delete with { confirm: "DELETE" }
//  5. On success: clears local state + redirects to /
//
// ✅ No accidental deletion — 3-step confirmation
// ✅ Correctly handles 401 (session expired) mid-flow
// ✅ Matches CSS Module pattern used across account module
// ─────────────────────────────────────────────────────────────

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import ErrorBoundary from '@/components/ui/ErrorBoundary'
import { useUserStore } from '@/store/userStore'
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

  const [open,     setOpen]     = useState(false)
  const [step,     setStep]     = useState<1 | 2>(1)
  const [typed,    setTyped]    = useState('')
  const [deleting, setDeleting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function openModal() {
    setStep(1)
    setTyped('')
    setDeleting(false)
    setOpen(true)
    // Move focus into modal after paint
    setTimeout(() => inputRef.current?.focus(), 80)
  }

  function closeModal() {
    if (deleting) return   // don't close mid-delete
    setOpen(false)
    setStep(1)
    setTyped('')
  }

  async function handleDelete() {
    if (typed !== 'DELETE' || deleting) return
    setDeleting(true)

    try {
      const res = await fetch('/api/account/delete', {
        method:  'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ confirm: 'DELETE' }),
        signal:  AbortSignal.timeout(15_000),
      })

      if (res.status === 401) {
        markExpired?.()
        closeModal()
        return
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data as { error?: string }).error || 'Deletion failed')
      }

      // Clear all local auth state
      storeLogout()
      setOpen(false)

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
          <div className={styles.panelTitle}>Privacy &amp; Data</div>
        </div>

        {/* Data rights info */}
        <div className={styles.card}>
          <div className={styles.cardSectionTitle}>Your Data Rights</div>
          <p className={styles.dangerInfoText}>
            Under India&apos;s <strong>Digital Personal Data Protection Act 2023 (DPDP)</strong>,
            you have the right to request erasure of your personal data. When you delete your
            account we will:
          </p>
          <ul className={styles.dangerList}>
            <li>Remove your name, phone number, email, and address from your profile</li>
            <li>Anonymise personal details in past orders (required for accounting records)</li>
            <li>Delete all saved delivery addresses</li>
            <li>Permanently close your login — this cannot be undone</li>
          </ul>
          <p className={styles.dangerInfoNote}>
            Order records themselves are retained for 7 years as required by GST regulations,
            but will contain no information that identifies you personally.
          </p>
          {userEmail && (
            <p className={styles.dangerInfoNote}>
              A confirmation will be sent to <strong>{userEmail}</strong>.
            </p>
          )}
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

      {/* ── Confirmation Modal ──────────────────────────────── */}
      {open && (
        <div
          className={styles.modalOverlay}
          role="dialog"
          aria-modal="true"
          aria-labelledby="del-modal-title"
          onClick={e => { if (e.target === e.currentTarget) closeModal() }}
        >
          <div className={styles.modalBox}>
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
                  This will <strong>permanently delete</strong> your Pahadi Roots account and
                  anonymise all personal data stored by us, in line with India&apos;s DPDP Act 2023.
                </p>
                <ul className={styles.dangerModalList}>
                  <li>You will be logged out immediately</li>
                  <li>Your address book will be wiped</li>
                  <li>Order history will be anonymised (not deleted — required by law)</li>
                  <li>You can create a new account at any time</li>
                </ul>
                <div className={styles.modalFooter}>
                  <button className={styles.btnDangerOutline} onClick={() => setStep(2)}>
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
                  <input
                    ref={inputRef}
                    type="text"
                    className={styles.dangerConfirmInput}
                    placeholder="Type DELETE to confirm"
                    value={typed}
                    onChange={e => setTyped(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleDelete() }}
                    disabled={deleting}
                    autoComplete="off"
                    spellCheck={false}
                    aria-label='Type DELETE to confirm account deletion'
                  />
                </div>
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
