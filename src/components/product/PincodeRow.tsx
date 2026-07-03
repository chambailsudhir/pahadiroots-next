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

interface Props { waNumber: string }

export default function PincodeRow({ waNumber }: Props) {
  const [pin, setPin]           = useState('')
  const [error, setError]       = useState('')
  const [estimate, setEstimate] = useState<DeliveryEstimate | null>(null)
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
        }}
        onKeyDown={handleKeyDown}
        aria-label="PIN code"
        aria-describedby={error ? 'pincode-error' : estimate ? 'pincode-estimate' : undefined}
      />
      <button
        className="pdp-pincode-btn"
        type="button"
        onClick={handleCheck}
        aria-label="Check delivery for entered PIN code"
      >
        Check
      </button>
      <span className="pdp-vendor-chip">VENDOR : 5 PAHADI ROOTS</span>
      {error && (
        <span
          id="pincode-error"
          role="alert"
          style={{ fontSize: '11px', color: '#c0392b', marginLeft: '4px', flexBasis: '100%' }}
        >
          {error}
        </span>
      )}
      {estimate && (
        <span
          id="pincode-estimate"
          role="status"
          style={{ fontSize: '12px', marginLeft: '4px', flexBasis: '100%' }}
        >
          Estimated delivery: <strong>{estimate.etaLabel}</strong>{' '}
          <span style={{ color: '#666' }}>(approximate — based on region)</span>
          {' · '}
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
