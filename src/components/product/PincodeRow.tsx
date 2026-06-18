'use client'

// ─────────────────────────────────────────────────────────────────────────────
// components/product/PincodeRow.tsx
//
// BUG FIX (3.5): Previously PincodeRow was a server-component inline function
// in page.tsx with a "Check" button that had no onClick, no state, and did
// nothing — `waNumber` was destructured but never used.
//
// Fix: Extract as a real client component. Validates the 6-digit PIN,
// opens WhatsApp with a pre-filled delivery-check message to the support
// number. This matches the WhatsApp-first support pattern already used in
// the Returns accordion.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useRef } from 'react'

interface Props { waNumber: string }

export default function PincodeRow({ waNumber }: Props) {
  const [pin, setPin]       = useState('')
  const [error, setError]   = useState('')
  const inputRef            = useRef<HTMLInputElement>(null)

  function handleCheck() {
    const clean = pin.replace(/\D/g, '')
    if (clean.length !== 6) {
      setError('Please enter a valid 6-digit PIN code')
      inputRef.current?.focus()
      return
    }
    setError('')
    const msg = encodeURIComponent(
      `Hi! I'd like to check delivery availability for PIN code ${clean}. Please let me know if you deliver to my area.`
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
        }}
        onKeyDown={handleKeyDown}
        aria-label="PIN code"
        aria-describedby={error ? 'pincode-error' : undefined}
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
    </div>
  )
}
