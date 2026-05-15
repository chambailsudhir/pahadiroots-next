'use client'
import { formatPrice } from '@/lib/utils'

interface Props {
  subtotal: number
  freeShipMin: number
  isFreeShipping: boolean
  remainingForFreeShip: number
}

export default function ShippingProgress({ subtotal, freeShipMin, isFreeShipping, remainingForFreeShip }: Props) {
  if (freeShipMin <= 0) {
    return (
      <div className="cho-ship-tick">
        🚚 Free shipping on all orders!
      </div>
    )
  }
  const pct = Math.min(100, (subtotal / freeShipMin) * 100)
  return (
    <div className="cho-ship-tick">
      {isFreeShipping
        ? <span>🎉 Free shipping unlocked!</span>
        : <span>🚚 Add <strong>{formatPrice(remainingForFreeShip)}</strong> more for FREE shipping</span>}
      <div className="cho-ship-track">
        <div className="cho-ship-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
