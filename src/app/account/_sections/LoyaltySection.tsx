'use client'
// ─────────────────────────────────────────────────────────────
// LoyaltySection — Pahadi Coins dashboard
//  Shows: balance card, earn rules, transaction history, referral
// ─────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react'
import styles from '../styles/account.module.css'

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

export default function LoyaltySection({ showToast }: { showToast?: (msg: string, type?: 'success'|'error') => void }) {
  const [data,    setData]    = useState<LoyaltyData | null>(null)
  const [txns,    setTxns]    = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [copied,  setCopied]  = useState(false)
  const [txnLoad, setTxnLoad] = useState(false)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [txnErr,  setTxnErr]  = useState<string | null>(null)

  useEffect(() => {
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

  async function loadHistory() {
    if (txnLoad) return
    setTxnLoad(true)
    setTxnErr(null)
    try {
      const res  = await fetch('/api/v1/loyalty/history?page=1&limit=20')
      const json = await res.json()
      if (res.ok) {
        setTxns(json.transactions ?? [])
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

  function copyReferral() {
    if (!data?.referral_code) return
    navigator.clipboard.writeText(`https://pahadiroots.com?ref=${data.referral_code}`).then(() => {
      setCopied(true)
      showToast?.('Referral link copied!', 'success')
      setTimeout(() => setCopied(false), 2500)
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
        </div>
      )}

      {/* ── Transaction history ───────────────────────────────── */}
      <div className={styles.lyHistory}>
        <div className={styles.lyHistHeader}>
          <strong className={styles.lyHistTitle}>Transaction History</strong>
          {txns.length === 0 && !txnLoad && (
            <button className={styles.lyHistLoad} onClick={loadHistory} type="button">
              Load History
            </button>
          )}
        </div>

        {txnLoad && <div className={styles.lySkeleton} aria-busy="true" style={{ height: 60 }} />}

        {txnErr && !txnLoad && (
          <p className={styles.lyEmpty} style={{ color: '#c0392b' }}>
            {txnErr}{' '}
            <button type="button" className={styles.lyHistLoad} onClick={loadHistory}>
              Retry
            </button>
          </p>
        )}

        {txns.length > 0 && (
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
        )}

        {txns.length === 0 && !txnLoad && (
          <p className={styles.lyEmpty}>No transactions yet — start earning coins on your next order!</p>
        )}
      </div>
    </div>
  )
}
