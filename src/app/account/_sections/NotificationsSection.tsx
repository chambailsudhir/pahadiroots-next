'use client'
// ─────────────────────────────────────────────────────────────
// NotificationsSection — manage email / WhatsApp / SMS prefs
//
// ✅ Fetches current prefs from /api/account/notifications on mount
// ✅ Optimistic toggle with rollback on API error
// ✅ Single PATCH per toggle (debounced via in-flight guard)
// ✅ Matches CSS Module pattern used across account module
// ─────────────────────────────────────────────────────────────

import { useState, useEffect, useRef, useCallback } from 'react'
import ErrorBoundary from '@/components/ui/ErrorBoundary'
import styles from '../styles/account.module.css'

interface NotifPrefs {
  notif_email_orders:    boolean
  notif_whatsapp_orders: boolean
  notif_sms_orders:      boolean
  notif_email_marketing: boolean
}

const DEFAULTS: NotifPrefs = {
  notif_email_orders:    true,
  notif_whatsapp_orders: true,
  notif_sms_orders:      true,
  notif_email_marketing: false,
}

interface Props {
  showToast: (msg: string, type?: 'success' | 'error') => void
  markExpired?: () => void
}

export default function NotificationsSection({ showToast, markExpired }: Props) {
  const [prefs,   setPrefs]   = useState<NotifPrefs>(DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState<Partial<Record<keyof NotifPrefs, boolean>>>({})

  // Guard against in-flight saves being clobbered
  const inFlight = useRef<Partial<Record<keyof NotifPrefs, boolean>>>({})

  // ── Fetch on mount ────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    fetch('/api/account/notifications', { signal: AbortSignal.timeout(10_000) })
      .then(r => r.json())
      .then(data => {
        if (cancelled) return
        if (data?.prefs) setPrefs(data.prefs as NotifPrefs)
      })
      .catch((e: unknown) => {
        // BUG FIX [ERROR HANDLING]: previously no logging — if the notification
        // prefs load fails (API down, auth expired), ops had no visibility.
        console.error('[NotificationsSection] prefs load failed:', e)
        if (!cancelled) showToast('Could not load notification preferences', 'error')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Toggle a single preference ────────────────────────────
  const toggle = useCallback(async (key: keyof NotifPrefs) => {
    if (inFlight.current[key]) return   // debounce: ignore rapid double-click
    const prev    = prefs[key]
    const next    = !prev

    // Optimistic update
    setPrefs(p => ({ ...p, [key]: next }))
    setSaving(s => ({ ...s, [key]: true }))
    inFlight.current[key] = true

    try {
      const res = await fetch('/api/account/notifications', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ [key]: next }),
        signal:  AbortSignal.timeout(10_000),
      })
      if (res.status === 401) {
        markExpired?.()
        setPrefs(p => ({ ...p, [key]: prev }))   // rollback
        return
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data as { error?: string }).error || 'Save failed')
      }
      showToast('✅ Preferences saved', 'success')
    } catch (e: unknown) {
      // Rollback on error
      setPrefs(p => ({ ...p, [key]: prev }))
      showToast(e instanceof Error ? e.message : 'Failed to save preferences', 'error')
    } finally {
      setSaving(s => ({ ...s, [key]: false }))
      inFlight.current[key] = false
    }
  }, [prefs, markExpired, showToast])

  if (loading) {
    return (
      <div className={styles.panelSection}>
        <div className={styles.panelHeader}>
          <div className={styles.panelTitle}>Notifications</div>
        </div>
        <div className={styles.card}>
          <div className={styles.notifSkeleton}>
            {[1, 2, 3, 4].map(i => (
              <div key={i} className={styles.notifSkRow}>
                <div className={styles.notifSkText} />
                <div className={styles.notifSkToggle} />
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <ErrorBoundary section="Notifications">
      <div className={styles.panelSection}>
        <div className={styles.panelHeader}>
          <div className={styles.panelTitle}>Notifications</div>
        </div>

        {/* Transactional — order updates */}
        <div className={styles.card}>
          <div className={styles.cardSectionTitle}>Order Updates</div>
          <p className={styles.notifCardDesc}>
            Stay informed about your shipments, deliveries, and order status changes.
          </p>

          <NotifRow
            label="Email"
            sublabel="Confirmation, shipping & delivery emails"
            icon="✉️"
            checked={prefs.notif_email_orders}
            busy={!!saving.notif_email_orders}
            onChange={() => toggle('notif_email_orders')}
          />
          <NotifRow
            label="WhatsApp"
            sublabel="Order updates directly on WhatsApp"
            icon="💬"
            checked={prefs.notif_whatsapp_orders}
            busy={!!saving.notif_whatsapp_orders}
            onChange={() => toggle('notif_whatsapp_orders')}
          />
          <NotifRow
            label="SMS"
            sublabel="Text messages for key order milestones"
            icon="📱"
            checked={prefs.notif_sms_orders}
            busy={!!saving.notif_sms_orders}
            onChange={() => toggle('notif_sms_orders')}
            last
          />
        </div>

        {/* Marketing */}
        <div className={styles.card}>
          <div className={styles.cardSectionTitle}>Marketing & Promotions</div>
          <p className={styles.notifCardDesc}>
            Offers, new arrivals, and stories from the Pahadi hills.
            You can opt out at any time.
          </p>

          <NotifRow
            label="Promotional Emails"
            sublabel="Sales, new collections, and seasonal offers"
            icon="🏷️"
            checked={prefs.notif_email_marketing}
            busy={!!saving.notif_email_marketing}
            onChange={() => toggle('notif_email_marketing')}
            last
          />
        </div>

        <p className={styles.notifLegal}>
          Transactional messages (order confirmations, payment receipts) are always sent
          regardless of these preferences — they are required to fulfil your order.
          Your data is processed in compliance with India&apos;s{' '}
          <strong>Digital Personal Data Protection Act 2023</strong>.
        </p>
      </div>
    </ErrorBoundary>
  )
}

// ── Reusable toggle row ───────────────────────────────────────
interface RowProps {
  label:    string
  sublabel: string
  icon:     string
  checked:  boolean
  busy:     boolean
  onChange: () => void
  last?:    boolean
}

function NotifRow({ label, sublabel, icon, checked, busy, onChange, last }: RowProps) {
  return (
    <div className={`${styles.notifRow}${last ? ' ' + styles.notifRowLast : ''}`}>
      <span className={styles.notifRowIcon} aria-hidden="true">{icon}</span>
      <div className={styles.notifRowText}>
        {/* Plain span — the button below carries its own aria-label for screen readers.
            htmlFor on a <button> is invalid HTML and mis-announces the control. */}
        <span className={styles.notifRowLabel}>{label}</span>
        <span className={styles.notifRowSub}>{sublabel}</span>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        aria-label={`${checked ? 'Disable' : 'Enable'} ${label} notifications`}
        className={`${styles.notifToggle}${checked ? ' ' + styles.notifToggleOn : ''}`}
        onClick={onChange}
        disabled={busy}
      >
        <span className={styles.notifToggleThumb} />
        {busy && <span className={styles.notifToggleSpin} />}
      </button>
    </div>
  )
}
