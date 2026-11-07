'use client'
// "Add ₹X more to earn N Pahadi Coins" (Nov 2026, owner request). Coins come in full ₹500 steps (no coins below ₹500), so a small
// top-up can unlock the next 5 coins. Shown to signed-in customers only (a guest has no account to keep coins in) and only while
// coins are switched on. The amount is the goods value (total − shipping − COD fee, coinBaseValue), the same figure the delivery trigger pays coins on.
import { useUserStore } from '@/store/userStore'
import { coinNudge } from '@/lib/loyaltyCoins'
import { formatPrice } from '@/lib/utils'

export default function CoinNudge({ total, settings, style }: {
  total: number
  settings: Record<string, string | undefined>
  style?: React.CSSProperties
}) {
  const isSignedIn = useUserStore(s => !!s.user)
  if (!isSignedIn || settings.loyalty_enabled !== 'true') return null
  const n = coinNudge(total, settings)
  if (!n) return null
  const label = settings.loyalty_points_label || 'Pahadi Coins'
  return (
    <div data-testid="coin-nudge" style={{ background: '#fbf6e6', border: '1px solid #ecd98a', color: '#6b4a00', borderRadius: 10,
      padding: '8px 12px', fontSize: 13, lineHeight: 1.4, ...style }}>
      <span aria-hidden="true">🪙 </span>
      Add <strong>{formatPrice(n.addRupees)}</strong> more to earn <strong>{n.coins}{n.more ? ' more' : ''} {label}</strong> on delivery
    </div>
  )
}
