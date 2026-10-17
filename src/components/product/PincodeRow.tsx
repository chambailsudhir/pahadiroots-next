'use client'

// ─────────────────────────────────────────────────────────────────────────────
// components/product/PincodeRow.tsx
//
// BUG FIX (3.5): Previously PincodeRow was a server-component inline function
// in page.tsx with a "Check" button that had no onClick, no state, and did
// nothing — `waNumber` was destructured but never used.
//
// BUG FIX (MEDIUM – audit finding #6): the "Check" button used to always open
// WhatsApp with a pre-filled message — a conversion-flow interruption with no
// on-page response at all. Now it shows an inline, clearly-labelled delivery
// ESTIMATE immediately (see lib/pincodeZones.ts for why this is an estimate,
// not a real-time courier lookup) and keeps WhatsApp as a secondary action for
// customers who want an exact date, instead of the only action.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useRef } from 'react'
import { estimateDelivery, type DeliveryEstimate } from '@/lib/pincodeZones'
import { isPincodeBlocked, formatServiceableStates } from '@/lib/serviceability'

interface Props {
  waNumber: string
  /** Admin → Settings "Blocked PIN codes" (prefix list) — same rule checkout/payment enforce. */
  blockedPincodes?: string
  /** Admin → Settings "Serviceable states" — when set, delivery is limited to these states. */
  serviceableStates?: string
  /** Delivery windows exactly as stated on the Shipping Policy page (single source of truth). */
  deliveryWindows?: string
}

export default function PincodeRow({ waNumber, blockedPincodes = '', serviceableStates = '', deliveryWindows }: Props) {
  const [pin, setPin]           = useState('')
  const [error, setError]       = useState('')
  const [estimate, setEstimate] = useState<DeliveryEstimate | null>(null)
  const [blocked, setBlocked]   = useState(false)
  const inputRef                = useRef<HTMLInputElement>(null)

  function handleCheck() {
    const clean = pin.replace(/\D/g, '')
    const result = estimateDelivery(clean)
    if (!result) {
      setError('Please enter a valid 6-digit PIN code')
      setEstimate(null)
      inputRef.current?.focus()
      return
    }
    setError('')
    // PDP audit P2-3: honour the admin's blocked PIN list before promising anything.
    if (isPincodeBlocked(clean, blockedPincodes)) {
      setBlocked(true)
      setEstimate(null)
      return
    }
    setBlocked(false)
    setEstimate(result)
  }

  function handleWhatsAppConfirm() {
    const clean = pin.replace(/\D/g, '')
    const msg = encodeURIComponent(
      `Hi! I'd like to confirm the exact delivery date for PIN code ${clean}. Please let me know.`
    )
    window.open(`https://wa.me/${waNumber}?text=${msg}`, '_blank', 'noopener,noreferrer')
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') handleCheck()
  }

  return (
    <div className="pdp-pincode-row" role="group" aria-label="Check delivery by PIN code">
      <span aria-hidden="true">📍</span>
      <span className="pdp-pincode-label">Check delivery:</span>
      <input
        ref={inputRef}
        className="pdp-pincode-input"
        type="text"
        inputMode="numeric"
        placeholder="Enter PIN"
        maxLength={6}
        value={pin}
        onChange={e => {
          setPin(e.target.value.replace(/\D/g, ''))
          if (error) setError('')
          if (estimate) setEstimate(null)
          if (blocked) setBlocked(false)
        }}
        onKeyDown={handleKeyDown}
        aria-label="PIN code"
        aria-describedby={error ? 'pincode-error' : (estimate || blocked) ? 'pincode-estimate' : undefined}
      />
      <button
        className="pdp-pincode-btn"
        type="button"
        onClick={handleCheck}
        aria-label="Check delivery for entered PIN code"
      >
        Check
      </button>
      {error && (
        <span
          id="pincode-error"
          role="alert"
          style={{ fontSize: '11px', color: '#c0392b', marginLeft: '4px', flexBasis: '100%' }}
        >
          {error}
        </span>
      )}
      {blocked && (
        <span
          id="pincode-estimate"
          role="status"
          style={{ fontSize: '12px', marginLeft: '4px', flexBasis: '100%', color: '#c0392b' }}
        >
          Sorry, we do not deliver to PIN code {pin.replace(/\D/g, '')} yet.
        </span>
      )}
      {estimate && (
        <span
          id="pincode-estimate"
          role="status"
          style={{ fontSize: '12px', marginLeft: '4px', flexBasis: '100%' }}
        >
          {/* PDP audit P1-6: the old per-zone "2-4 / 4-6 / 5-8 business days" tiers contradicted the Shipping
              Policy (metro 3–5, non-metro/remote 7–12 business days after dispatch). Show the policy's windows. */}
          Delivering to <strong>{estimate.zoneLabel}</strong>: {deliveryWindows ?? 'see the Shipping Policy for delivery times'}.{' '}
          {formatServiceableStates(serviceableStates).length > 0 && (
            <span style={{ color: '#555' }}>
              We currently deliver to {formatServiceableStates(serviceableStates).join(', ')}; your state is confirmed at checkout.{' '}
            </span>
          )}
          <button
            type="button"
            onClick={handleWhatsAppConfirm}
            style={{ background: 'none', border: 'none', padding: 0, color: '#075e54', textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}
          >
            Confirm exact date on WhatsApp
          </button>
        </span>
      )}
    </div>
  )
}
