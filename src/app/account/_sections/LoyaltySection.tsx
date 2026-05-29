'use client'
// ─────────────────────────────────────────────────────────────
// LoyaltySection — Pahadi Coins dashboard
//  Shows: balance card, earn rules, transaction history, referral
// ─────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react'
import styles from '../styles/account.module.css'
import ErrorBoundary from '@/components/ui/ErrorBoundary'

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
  label:          string
  referral_code:  string | null
}

const TYPE_META: Record<string, { icon: string; color: string; label: string }> = {
  earn:       { icon: '⭐', color: '#2d7a3a', label: 'Earned'  },
  redeem:     { icon: '🎁', color: '#b05a00', label: 'Redeemed'},
  referral:   { icon: '🤝', color: '#1a6ab5', label: 'Referral'},
  bonus:      { icon: '🎉', color: '#8A2BE2', label: 'Bonus'   },
  expire:     { icon: '⏰', color: '#999',    label: 'Expired' },
  adjustment: { icon: '✏️', color: '#666',    label: 'Adjusted'},
}

// Module-level flag: survives unmount/remount when the user switches tabs.
// AccountPage renders sections conditionally, so the component is destroyed and
// re-created on every tab switch. A module-level boolean means we fetch once per
// page-session rather than once per mount.
let loyaltyDataFetched = false

export default function LoyaltySection({ showToast }: { showToast?: (msg: string, type?: 'success'|'error') => void }) {
  const [data,    setData]    = useState<LoyaltyData | null>(null)
  const [txns,    setTxns]    = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [copied,  setCopied]  = useState(false)
  const [txnLoad, setTxnLoad] = useState(false)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [txnErr,  setTxnErr]  = useState<string | null>(null)
  const [txnPage,  setTxnPage]  = useState(1)
  const [hasMore,  setHasMore]  = useState(false)
  const TXN_LIMIT = 20   // must match limit= param in loadHistory

  // Guard: skip fetch if data was already loaded this page session.
  // loyaltyDataFetched is module-level so it persists across tab-switch remounts.
  useEffect(() => {
    if (loyaltyDataFetched) return
    loyaltyDataFetched = true
    let mounted = true
    async function load() {
      try {
        const res  = await fetch('/api/v1/loyalty')
        const json = await res.json()
        if (!mounted) return
        if (res.ok) {
          setData(json)
        } else {
          const msg = json?.error || 'Could not load loyalty data.'
          setLoadErr(msg)
          showToast?.(msg, 'error')
        }
      } catch {
        if (!mounted) return
        const msg = 'Could not load loyalty data — please try again.'
        setLoadErr(msg)
        showToast?.(msg, 'error')
      } finally {
        if (mounted) setLoading(false)
      }
    }
    load()
    return () => { mounted = false }
  }, [])

  async function loadHistory(page = 1) {
    if (txnLoad) return
    setTxnLoad(true)
    setTxnErr(null)
    try {
      const res  = await fetch(`/api/v1/loyalty/history?page=${page}&limit=${TXN_LIMIT}`)
      const json = await res.json()
      if (res.ok) {
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

  const [copyFallback, setCopyFallback] = useState(false)
  const fallbackInputRef = useRef<HTMLInputElement>(null)

  function copyReferral() {
    if (!data?.referral_code) return
    const url = `https://pahadiroots.com?ref=${data.referral_code}`

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
      <div className={styles.secTitle}>🪙 Pahadi Coins</div>
      <div className={styles.lySkeleton} aria-busy="true" />
    </div>
  )

  if (loadErr) return (
    <div className={styles.secRoot}>
      <div className={styles.secTitle}>🪙 Pahadi Coins</div>
      <p className={styles.secSub} style={{ color: '#c0392b' }}>{loadErr}</p>
    </div>
  )

  if (!data?.enabled) return (
    <div className={styles.secRoot}>
      <div className={styles.secTitle}>🪙 Pahadi Coins</div>
      <p className={styles.secSub}>Loyalty programme coming soon — stay tuned!</p>
    </div>
  )

  const earnRate  = data.points_value   // ₹ per point when redeeming
  const pointsVal = data.value_inr      // current balance in ₹

  return (
    <ErrorBoundary section="Loyalty">
    <div className={styles.secRoot}>
      <div className={styles.secTitle}>🪙 Pahadi Coins</div>
      <p className={styles.secSub}>Earn coins on every order. Redeem for discounts at checkout.</p>

      {/* ── Balance card ──────────────────────────────────────── */}
      <div className={styles.lyBalanceCard}>
        <div className={styles.lyBalanceLeft}>
          <div className={styles.lyBalanceBig}>{data.points.toLocaleString('en-IN')}</div>
          <div className={styles.lyBalanceLbl}>{data.label}</div>
          {pointsVal > 0 && (
            <div className={styles.lyBalanceVal}>≈ ₹{pointsVal} redeemable value</div>
          )}
        </div>
        <div className={styles.lyBalanceCoin} aria-hidden="true">🪙</div>
      </div>

      {/* ── How it works ──────────────────────────────────────── */}
      <div className={styles.lyHowGrid}>
        {[
          { icon: '🛍️', title: 'Shop & Earn',  desc: `Earn 1 coin per ₹1 spent on every order` },
          { icon: '💸', title: 'Redeem',        desc: `1 coin = ₹${earnRate} off at checkout` },
          { icon: '🔒', title: 'Min Redeem',    desc: `Minimum ${data.min_redeem} coins per redemption` },
          { icon: '📊', title: 'Max Per Order', desc: `Redeem up to ${data.max_redeem_pct}% of order value` },
        ].map(it => (
          <div key={it.title} className={styles.lyHowCard}>
            <span className={styles.lyHowIcon}>{it.icon}</span>
            <strong className={styles.lyHowTitle}>{it.title}</strong>
            <p className={styles.lyHowDesc}>{it.desc}</p>
          </div>
        ))}
      </div>

      {/* ── Referral section ──────────────────────────────────── */}
      {data.referral_code && (
        <div className={styles.lyReferral}>
          <div className={styles.lyRefHeader}>
            <span className={styles.lyRefIcon}>🤝</span>
            <div>
              <div className={styles.lyRefTitle}>Refer &amp; Earn</div>
              <div className={styles.lyRefSub}>Both you and your friend earn 100 bonus coins when they place their first order.</div>
            </div>
          </div>
          <div className={styles.lyRefRow}>
            <div className={styles.lyRefCode}>{data.referral_code}</div>
            <button className={`${styles.lyRefCopy}${copied ? ' ' + styles.lyRefCopied : ''}`} onClick={copyReferral} type="button">
              {copied ? '✓ Copied!' : 'Copy Link'}
            </button>
          </div>
          {/* Fallback for browsers/contexts where clipboard API is unavailable */}
          {copyFallback && (
            <div style={{ marginTop: '8px', display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input
                ref={fallbackInputRef}
                type="text"
                readOnly
                value={`https://pahadiroots.com?ref=${data.referral_code}`}
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
                    <span className={styles.lyTxnIcon}>{meta.icon}</span>
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
