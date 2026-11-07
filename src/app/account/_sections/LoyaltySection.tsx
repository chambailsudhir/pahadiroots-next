'use client'
// ─────────────────────────────────────────────────────────────
// LoyaltySection — Pahadi Coins dashboard
//  Shows: balance card, earn rules, transaction history, referral
// ─────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react'
import { useUserStore } from '@/store/userStore'
import { normalizeReferralCode, referralMessage } from '@/lib/referral'
import styles from '../styles/account.module.css'
import ErrorBoundary from '@/components/ui/ErrorBoundary'
import Icon, { AdminIcon } from '@/components/ui/Icon'

// BUG FIX (found in a fresh audit): the referral link below used to
// hardcode 'https://www.pahadiroots.com' in two places, independent of the
// NEXT_PUBLIC_SITE_URL env var that layout.tsx's metadataBase already
// reads for this exact purpose. Same shared value now used here too,
// so the two can't drift apart if the real domain is ever configured
// differently via that env var.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.pahadiroots.com'

interface Transaction {
  id:           string
  type:         'earn' | 'redeem' | 'expire' | 'referral' | 'bonus' | 'adjustment'
  points:       number
  balance_after: number
  note:         string | null
  created_at:   string
  order_id:     string | null
}

interface LoyaltyData {
  enabled:        boolean
  points:         number
  value_inr:      number
  points_value:   number
  min_redeem:     number
  max_redeem_pct: number
  earn_per_order?: number
  earn_step_rupees?: number
  earn_per_step?: number
  earn_max_per_order?: number | null
  referral_bonus?: number
  referral_min_order?: number
  referral_hold_days?: number
  expiry_days?: number
  can_apply_referral?: boolean
  label:          string
  referral_code:  string | null
}

/** Referral promise, built from the real settings: coins are paid after delivery + the return window, never at order time. */
export function referralCopy(bonus = 50, minOrder = 999, holdDays = 7): string {   // fallbacks = owner rule Nov 2026 (50 + 50, first order ₹999+)
  return `You and your friend each get ${bonus} bonus coins once your friend's first order with ₹${minOrder.toLocaleString('en-IN')} or more of products (delivery charges do not count) is delivered and ${holdDays} days have passed without a return.`
}

/** Owner decision (Nov 2026): 1 coin per ₹`step` of order value, at most `max` per order, paid on DELIVERY, taken back on return / refund. */
/** "Coins expire 4 months after you earn them." from loyalty_expiry_days (0 = never → no sentence). */
export function expiryCopy(days?: number): string {
  const d = typeof days === 'number' && Number.isFinite(days) && days >= 0 ? Math.floor(days) : 120
  if (d === 0) return ''
  const span = d === 365 || d === 366 ? '12 months' : d % 30 === 0 ? `${d / 30} ${d === 30 ? 'month' : 'months'}` : `${d} days`
  return ` Coins expire ${span} after you earn them.`
}

export function earnCopy(perStep: number | undefined, step?: number, max?: number | null, expiryDays?: number): string {
  // Owner rule (Nov 2026): `perStep` coins for every full ₹`step` of a delivered order, nothing below one step; `max` null = no limit.
  const p  = typeof perStep === 'number' && Number.isFinite(perStep) && perStep >= 0 ? Math.floor(perStep) : 5
  const st = typeof step === 'number' && Number.isFinite(step) && step >= 1 ? Math.floor(step) : 500
  const cap = typeof max === 'number' && Number.isFinite(max) && max > 0 ? `, up to ${Math.floor(max)} coins per order` : ''
  return `Earn ${p} ${p === 1 ? 'coin' : 'coins'} for every ₹${st.toLocaleString('en-IN')} of your order${cap}, once it is delivered (orders below ₹${st.toLocaleString('en-IN')} earn none; delivery charges and the COD fee do not count; coins are taken back if you return the order).${expiryCopy(expiryDays)}`
}

const TYPE_META: Record<string, { icon: string; color: string; label: string }> = {
  earn:       { icon: '⭐', color: '#2d7a3a', label: 'Earned'  },
  redeem:     { icon: '🎁', color: '#b05a00', label: 'Redeemed'},
  referral:   { icon: '🤝', color: '#1a6ab5', label: 'Referral'},
  bonus:      { icon: '🎉', color: '#8A2BE2', label: 'Bonus'   },
  expire:     { icon: '⏰', color: '#999',    label: 'Expired' },
  adjustment: { icon: '✏️', color: '#666',    label: 'Adjusted'},
}

// Module-level cache of the last successful /api/v1/loyalty answer. AccountPage renders sections conditionally, so this
// component is destroyed and re-created on every tab switch; seeding state from the cache means a return visit paints at
// once and revalidates in the background. AUDIT E1-2: this used to be a boolean "already fetched" flag, so on remount the
// effect returned early and the skeleton never went away. Keyed by user id so another customer never sees these coins.
let loyaltyCache: { uid: string; data: LoyaltyData } | null = null
/** Test helper — forget the cached answer. */
export function __resetLoyaltyCache() { loyaltyCache = null }

interface LoyaltyProps {
  showToast?:   (msg: string, type?: 'success'|'error') => void
  markExpired?: () => void
}

export default function LoyaltySection({ showToast, markExpired }: LoyaltyProps) {
  const uid = useUserStore(s => s.user?.id ?? '')
  const cached = loyaltyCache && loyaltyCache.uid === uid ? loyaltyCache.data : null
  const [data,    setData]    = useState<LoyaltyData | null>(cached)
  const [txns,    setTxns]    = useState<Transaction[]>([])
  const [loading, setLoading] = useState(!cached)
  const [copied,  setCopied]  = useState(false)
  const [txnLoad, setTxnLoad] = useState(false)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [txnErr,  setTxnErr]  = useState<string | null>(null)
  const [txnPage,  setTxnPage]  = useState(1)
  const [hasMore,  setHasMore]  = useState(false)
  const [reloadTick, setReloadTick] = useState(0)
  const TXN_LIMIT = 20   // must match limit= param in loadHistory

  useEffect(() => {
    let mounted = true
    async function load() {
      try {
        const res  = await fetch('/api/v1/loyalty')
        const json = await res.json().catch(() => ({}))
        if (!mounted) return
        if (res.ok) {
          loyaltyCache = { uid, data: json }
          setData(json)
          setLoadErr(null)
        } else if (res.status === 401) {
          loyaltyCache = null
          markExpired?.()
        } else if (!loyaltyCache || loyaltyCache.uid !== uid) {
          // a failed BACKGROUND refresh keeps showing the cached numbers; only a first load shows the error
          const msg = json?.error || 'Could not load loyalty data.'
          setLoadErr(msg)
          showToast?.(msg, 'error')
        }
      } catch {
        if (!mounted) return
        if (!loyaltyCache || loyaltyCache.uid !== uid) {
          const msg = 'Could not load loyalty data — please try again.'
          setLoadErr(msg)
          showToast?.(msg, 'error')
        }
      } finally {
        if (mounted) setLoading(false)
      }
    }
    load()
    return () => { mounted = false }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, reloadTick])

  function retryLoad() {
    setLoadErr(null)
    setLoading(true)
    setReloadTick(t => t + 1)
  }

  async function loadHistory(page = 1) {
    if (txnLoad) return
    setTxnLoad(true)
    setTxnErr(null)
    try {
      const res  = await fetch(`/api/v1/loyalty/history?page=${page}&limit=${TXN_LIMIT}`)
      const json = await res.json().catch(() => ({}))
      if (res.status === 401) {
        markExpired?.()
      } else if (res.ok) {
        const fetched: Transaction[] = json.transactions ?? []
        setTxns(prev => page === 1 ? fetched : [...prev, ...fetched])
        setTxnPage(page)
        // Use total from API when available; fall back to a safe page-full heuristic.
        // Bug fix: was `fetched.length === 20` — when exactly 20 txns exist total,
        // this showed "Load more" and fired one extra empty fetch.
        if (typeof json.total === 'number') {
          const loaded = (page - 1) * TXN_LIMIT + fetched.length
          setHasMore(loaded < json.total)
        } else {
          // API doesn't return total — only show more if a full page came back
          // AND we actually got something new (avoids infinite loop on exact multiples)
          setHasMore(fetched.length === TXN_LIMIT && fetched.length > 0)
        }
      } else {
        const msg = json?.error || 'Could not load transaction history.'
        setTxnErr(msg)
        showToast?.(msg, 'error')
      }
    } catch {
      const msg = 'Could not load transaction history — please try again.'
      setTxnErr(msg)
      showToast?.(msg, 'error')
    } finally {
      setTxnLoad(false)
    }
  }

  const [friendCode, setFriendCode] = useState('')
  const [applying,   setApplying]   = useState(false)
  const [friendDone, setFriendDone] = useState(false)

  // A friend's code can be added by a NEW customer (no order yet). The database decides; show its reason verbatim.
  async function applyFriendCode() {
    const code = normalizeReferralCode(friendCode)
    if (!code) { showToast?.(referralMessage('invalid_code'), 'error'); return }
    setApplying(true)
    try {
      const res  = await fetch('/api/v1/referral', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) })
      const json = await res.json().catch(() => ({}))
      if (res.ok && json.applied) { setFriendDone(true); showToast?.('Referral code added — your coins arrive after your first order is delivered.', 'success') }
      else showToast?.(json.message || json.error || referralMessage(json.reason), 'error')
    } catch { showToast?.('Could not apply the code — please try again.', 'error') }
    finally { setApplying(false) }
  }

  const [copyFallback, setCopyFallback] = useState(false)
  const fallbackInputRef = useRef<HTMLInputElement>(null)

  function copyReferral() {
    if (!data?.referral_code) return
    const url = `${SITE_URL}?ref=${data.referral_code}`

    // navigator.clipboard is only available in secure contexts (HTTPS) and
    // may throw on older Android WebViews. Fall back to a visible read-only
    // input the user can copy manually.
    if (!navigator.clipboard) {
      setCopyFallback(true)
      requestAnimationFrame(() => fallbackInputRef.current?.select())
      return
    }

    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      showToast?.('Referral link copied!', 'success')
      setTimeout(() => setCopied(false), 2500)
    }).catch(() => {
      // Clipboard write failed (e.g. permissions denied) — show manual input
      setCopyFallback(true)
      requestAnimationFrame(() => fallbackInputRef.current?.select())
    })
  }

  if (loading) return (
    <div className={styles.secRoot}>
      <div className={styles.secTitle} role="heading" aria-level={1}><Icon name="coins" /> Pahadi Coins</div>
      <div className={styles.lySkeleton} aria-busy="true" />
    </div>
  )

  if (loadErr) return (
    <div className={styles.secRoot}>
      <div className={styles.secTitle} role="heading" aria-level={1}><Icon name="coins" /> Pahadi Coins</div>
      <p className={styles.secSub} style={{ color: '#c0392b' }} role="alert">{loadErr}</p>
      <button type="button" className={styles.btnSecondary} onClick={retryLoad}>Try again</button>
    </div>
  )

  if (!data?.enabled) return (
    <div className={styles.secRoot}>
      <div className={styles.secTitle} role="heading" aria-level={1}><Icon name="coins" /> Pahadi Coins</div>
      <p className={styles.secSub}>Loyalty programme coming soon — stay tuned!</p>
    </div>
  )

  const earnRate  = data.points_value   // ₹ per point when redeeming
  const pointsVal = data.value_inr      // current balance in ₹

  return (
    <ErrorBoundary section="Loyalty">
    <div className={styles.secRoot}>
      <div className={styles.secTitle} role="heading" aria-level={1}><Icon name="coins" /> Pahadi Coins</div>
      <p className={styles.secSub}>Earn coins on every delivered order. Redeem for discounts at checkout.</p>

      {/* ── Balance card ──────────────────────────────────────── */}
      <div className={styles.lyBalanceCard}>
        <div className={styles.lyBalanceLeft}>
          <div className={styles.lyBalanceBig}>{data.points.toLocaleString('en-IN')}</div>
          <div className={styles.lyBalanceLbl}>{data.label}</div>
          {pointsVal > 0 && (
            <div className={styles.lyBalanceVal}>≈ ₹{pointsVal} redeemable value</div>
          )}
        </div>
        <div className={styles.lyBalanceCoin} aria-hidden="true"><Icon name="coins" size="1em" /></div>
      </div>

      {/* ── How it works ──────────────────────────────────────── */}
      <div className={styles.lyHowGrid}>
        {[
          ...(data.earn_per_order === 0 ? [] : [{ icon: '🛍️', title: 'Shop & Earn',  desc: earnCopy(data.earn_per_step ?? 5, data.earn_step_rupees, data.earn_max_per_order, data.expiry_days) }]),
          { icon: '💸', title: 'Redeem',        desc: `1 coin = ₹${earnRate} off at checkout` },
          { icon: '🔒', title: 'Min Redeem',    desc: `Minimum ${data.min_redeem} coins per redemption` },
          { icon: '📊', title: 'Max Per Order', desc: `Redeem up to ${data.max_redeem_pct}% of order value` },
        ].map(it => (
          <div key={it.title} className={styles.lyHowCard}>
            <span className={styles.lyHowIcon}><AdminIcon value={it.icon} color="#1a3a1e" /></span>
            <strong className={styles.lyHowTitle}>{it.title}</strong>
            <p className={styles.lyHowDesc}>{it.desc}</p>
          </div>
        ))}
      </div>

      {/* ── Referral section ──────────────────────────────────── */}
      {data.referral_code && (
        <div className={styles.lyReferral}>
          <div className={styles.lyRefHeader}>
            <span className={styles.lyRefIcon}><Icon name="users" /></span>
            <div>
              <div className={styles.lyRefTitle}>Refer &amp; Earn</div>
              <div className={styles.lyRefSub}>{referralCopy(data.referral_bonus, data.referral_min_order, data.referral_hold_days)}</div>
            </div>
          </div>
          <div className={styles.lyRefRow}>
            <div className={styles.lyRefCode}>{data.referral_code}</div>
            <button className={`${styles.lyRefCopy}${copied ? ' ' + styles.lyRefCopied : ''}`} onClick={copyReferral} type="button">
              {copied ? '✓ Copied!' : 'Copy Link'}
            </button>
          </div>
          {data.can_apply_referral && !friendDone && (
            <div style={{ marginTop: '12px', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <label htmlFor="friend-referral-code" style={{ fontSize: '13px', color: '#444', flexBasis: '100%' }}>Have a friend&apos;s referral code?</label>
              <input
                id="friend-referral-code"
                type="text"
                value={friendCode}
                onChange={e => setFriendCode(e.target.value.toUpperCase())}
                maxLength={12}
                autoComplete="off"
                placeholder="e.g. 1A2B3C4D"
                style={{ flex: 1, minWidth: '140px', fontSize: '14px', padding: '8px 10px', borderRadius: '6px', border: '1px solid #767676', background: '#fff' }}
              />
              <button type="button" className={styles.lyRefCopy} onClick={applyFriendCode} disabled={applying || !friendCode.trim()}>
                {applying ? 'Adding…' : 'Add code'}
              </button>
            </div>
          )}
          {/* Fallback for browsers/contexts where clipboard API is unavailable */}
          {copyFallback && (
            <div style={{ marginTop: '8px', display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input
                ref={fallbackInputRef}
                type="text"
                readOnly
                value={`${SITE_URL}?ref=${data.referral_code}`}
                style={{ flex: 1, fontSize: '12px', padding: '6px 10px', borderRadius: '6px', border: '1px solid #d0d0d0', background: '#f9f9f9' }}
                onFocus={e => e.target.select()}
                aria-label="Referral link — select and copy manually"
              />
              <button
                type="button"
                className={styles.lyRefCopy}
                onClick={() => { setCopyFallback(false) }}
                aria-label="Dismiss"
              >
                ✕
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Transaction history ───────────────────────────────── */}
      <div className={styles.lyHistory}>
        <div className={styles.lyHistHeader}>
          <strong className={styles.lyHistTitle}>Transaction History</strong>
          {txns.length === 0 && !txnLoad && (
            <button className={styles.lyHistLoad} onClick={() => loadHistory(1)} type="button">
              Load History
            </button>
          )}
        </div>

        {txnLoad && <div className={styles.lySkeleton} aria-busy="true" style={{ height: 60 }} />}

        {txnErr && !txnLoad && (
          <p className={styles.lyEmpty} style={{ color: '#c0392b' }}>
            {txnErr}{' '}
            <button type="button" className={styles.lyHistLoad} onClick={() => loadHistory(txnPage)}>
              Retry
            </button>
          </p>
        )}

        {txns.length > 0 && (
          <>
            <div className={styles.lyTxnList}>
              {txns.map(t => {
                const meta = TYPE_META[t.type] ?? TYPE_META.adjustment
                const isPositive = t.points > 0
                const date = new Date(t.created_at).toLocaleDateString('en-IN', {
                  day: 'numeric', month: 'short', year: 'numeric',
                })
                return (
                  <div key={t.id} className={styles.lyTxnRow}>
                    <span className={styles.lyTxnIcon}><AdminIcon value={meta.icon} color={meta.color} /></span>
                    <div className={styles.lyTxnInfo}>
                      <div className={styles.lyTxnNote}>{t.note || meta.label}</div>
                      <div className={styles.lyTxnDate}>{date} · Balance: {t.balance_after}</div>
                    </div>
                    <div className={styles.lyTxnPts} style={{ color: meta.color }}>
                      {isPositive ? '+' : ''}{t.points}
                    </div>
                  </div>
                )
              })}
            </div>
            {/* Load more — mirrors the pattern used in OrdersSection */}
            {hasMore && !txnLoad && (
              <div style={{ textAlign: 'center', marginTop: '12px' }}>
                <button
                  type="button"
                  className={styles.lyHistLoad}
                  onClick={() => loadHistory(txnPage + 1)}
                >
                  Load more
                </button>
              </div>
            )}
          </>
        )}

        {txns.length === 0 && !txnLoad && !txnErr && (
          <p className={styles.lyEmpty}>No transactions yet — start earning coins on your next order!</p>
        )}
      </div>
    </div>
    </ErrorBoundary>
  )
}
