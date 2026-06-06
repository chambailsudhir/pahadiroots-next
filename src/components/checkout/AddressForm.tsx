'use client'

import { useState, useCallback, useRef } from 'react'
import type { OrderAddress } from '@/types'

const INDIA_STATES = [
  'Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat',
  'Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh',
  'Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab',
  'Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh',
  'Uttarakhand','West Bengal','Andaman and Nicobar Islands','Chandigarh',
  'Dadra and Nagar Haveli and Daman and Diu','Delhi','Jammu and Kashmir',
  'Ladakh','Lakshadweep','Puducherry',
]

const LABEL_OPTIONS = ['Home', 'Office', 'Parents', 'Friends', 'Others'] as const
const LABEL_ICONS: Record<string, string> = {
  Home: '🏠', Office: '🏢', Parents: '👨‍👩‍👦', Friends: '👫', Others: '📍',
}

// Cache pincode results to avoid repeat API calls
const pincodeCache = new Map<string, { city: string; state: string } | null>()

async function lookupPincode(pin: string, signal?: AbortSignal): Promise<{ city: string; state: string } | null> {
  if (!/^\d{6}$/.test(pin)) return null
  if (pincodeCache.has(pin)) return pincodeCache.get(pin)!
  try {
    const res = await fetch(`https://api.postalpincode.in/pincode/${pin}`, { signal })
    const data = await res.json()
    if (!data?.[0]?.PostOffice?.length) { pincodeCache.set(pin, null); return null }
    const po = data[0].PostOffice[0]
    const raw = po.State || ''
    const matched = INDIA_STATES.find(s =>
      s.toLowerCase() === raw.toLowerCase() ||
      s.toLowerCase().startsWith(raw.toLowerCase()) ||
      raw.toLowerCase().startsWith(s.toLowerCase().split(' ')[0])
    ) || raw
    const result = { city: po.District || po.Block || '', state: matched }
    pincodeCache.set(pin, result)
    return result
  } catch { pincodeCache.set(pin, null); return null }
}

interface Props {
  addr: OrderAddress
  email: string
  touched: Record<string, boolean>
  onChange: (field: keyof OrderAddress, value: string) => void
  onEmailChange: (v: string) => void
  onTouch: (field: string) => void
  selectedSavedIdx: number | null
}

export default function AddressForm({ addr, email, touched, onChange, onEmailChange, onTouch, selectedSavedIdx }: Props) {
  const [pincodeLoading, setPincodeLoading] = useState(false)
  const [pincodeMsg,     setPincodeMsg]     = useState('')
  const pinAbortRef = useRef<AbortController | null>(null)

  const fieldErr = useCallback((field: keyof OrderAddress): string => {
    if (!touched[field]) return ''
    const val = addr[field]?.toString().trim()
    if (!val) return 'Required'
    if (field === 'phone'   && !/^[6-9]\d{9}$/.test(addr.phone))  return 'Invalid mobile number'
    if (field === 'pincode' && !/^\d{6}$/.test(addr.pincode))      return 'Invalid pincode'
    return ''
  }, [addr, touched])

  async function handlePincodeChange(val: string) {
    const clean = val.replace(/\D/g, '').slice(0, 6)
    onChange('pincode', clean)
    setPincodeMsg('')
    if (clean.length !== 6) { setPincodeLoading(false); return }

    // Cancel previous in-flight request
    if (pinAbortRef.current) pinAbortRef.current.abort()
    const ctrl = new AbortController()
    pinAbortRef.current = ctrl

    setPincodeLoading(true)
    const result = await lookupPincode(clean, ctrl.signal)
    if (ctrl.signal.aborted) return
    if (result) {
      onChange('city', result.city)
      onChange('state', result.state)
      setPincodeMsg(`${result.city}, ${result.state}`)
    }
    setPincodeLoading(false)
  }

  return (
    <div className="af-root">
      {/* Label tag pills */}
      {selectedSavedIdx === null && (
        <div className="af-tags-wrap">
          <span className="af-tags-label">Save as</span>
          <div className="af-tags">
            {LABEL_OPTIONS.map(lbl => (
              <button key={lbl} type="button"
                className={`af-tag${addr.label === lbl ? ' af-tag--on' : ''}`}
                onClick={() => onChange('label', lbl)}
                aria-pressed={addr.label === lbl}>
                {LABEL_ICONS[lbl]} {lbl}
              </button>
            ))}
          </div>
        </div>
      )}

      {selectedSavedIdx !== null && addr.label && (
        <div className="af-addr-badge">
          <span>{LABEL_ICONS[addr.label] || '📍'}</span>
          <span>Delivering to <strong>{addr.label}</strong></span>
          <span className="af-addr-hint">Select a different address above to change</span>
        </div>
      )}

      <div className="af-form">
        {/* Row 1: Name + Phone */}
        <div className="af-row">
          <div className={`af-group${fieldErr('name') ? ' af-group--err' : ''}`}>
            <label className="af-label" htmlFor="af-name">Full Name</label>
            <input id="af-name" className="af-input" type="text"
              autoComplete="name" value={addr.name}
              required
              aria-required="true"
              aria-invalid={!!fieldErr('name')}
              aria-describedby={fieldErr('name') ? 'af-name-err' : undefined}
              onChange={e => onChange('name', e.target.value)}
              onBlur={() => onTouch('name')}
              placeholder="Ravi Kumar"
            />
            {fieldErr('name') && <span id="af-name-err" className="af-err" role="alert">{fieldErr('name')}</span>}
          </div>
          <div className={`af-group${fieldErr('phone') ? ' af-group--err' : ''}`}>
            <label className="af-label" htmlFor="af-phone">Mobile Number</label>
            <div className="af-phone">
              <span className="af-phone-pre">+91</span>
              <input id="af-phone" className="af-input af-phone-field"
                type="tel" autoComplete="tel-national" inputMode="numeric"
                value={addr.phone}
                required
                aria-required="true"
                aria-invalid={!!fieldErr('phone')}
                aria-describedby={fieldErr('phone') ? 'af-phone-err' : undefined}
                onChange={e => onChange('phone', e.target.value.replace(/\D/g, ''))}
                onBlur={() => onTouch('phone')}
                placeholder="9876543210" maxLength={10}
              />
            </div>
            {fieldErr('phone') && <span id="af-phone-err" className="af-err" role="alert">{fieldErr('phone')}</span>}
          </div>
        </div>

        {/* Row 2: Street address */}
        <div className={`af-group${fieldErr('flat') ? ' af-group--err' : ''}`}>
          <label className="af-label" htmlFor="af-flat">House / Flat, Street, Colony</label>
          <textarea id="af-flat" className="af-input af-textarea"
            autoComplete="street-address" value={addr.flat}
            required
            aria-required="true"
            aria-invalid={!!fieldErr('flat')}
            aria-describedby={fieldErr('flat') ? 'af-flat-err' : undefined}
            onChange={e => onChange('flat', e.target.value)}
            onBlur={() => onTouch('flat')}
            placeholder="Flat 4B, Green Valley Apartments, Mall Road"
            rows={2}
          />
          {fieldErr('flat') && <span id="af-flat-err" className="af-err" role="alert">{fieldErr('flat')}</span>}
        </div>

        {/* Row 3: Landmark */}
        <div className="af-group">
          <label className="af-label" htmlFor="af-area">
            Area / Landmark <span className="af-optional">optional</span>
          </label>
          <input id="af-area" className="af-input" type="text"
            value={addr.area}
            onChange={e => onChange('area', e.target.value)}
            placeholder="Near Civil Hospital, ISBT Road"
          />
        </div>

        {/* Row 4: City + State */}
        <div className="af-row">
          <div className={`af-group${fieldErr('city') ? ' af-group--err' : ''}`}>
            <label className="af-label" htmlFor="af-city">City</label>
            <input id="af-city" className="af-input" type="text"
              autoComplete="address-level2" value={addr.city}
              required
              aria-required="true"
              aria-invalid={!!fieldErr('city')}
              aria-describedby={fieldErr('city') ? 'af-city-err' : undefined}
              onChange={e => onChange('city', e.target.value)}
              onBlur={() => onTouch('city')}
              placeholder="Dehradun"
            />
            {fieldErr('city') && <span id="af-city-err" className="af-err" role="alert">{fieldErr('city')}</span>}
          </div>
          <div className="af-group">
            <label className="af-label" htmlFor="af-state">State</label>
            <select id="af-state" className="af-input af-select"
              autoComplete="address-level1" value={addr.state}
              onChange={e => onChange('state', e.target.value)}>
              {INDIA_STATES.map(st => <option key={st} value={st}>{st}</option>)}
            </select>
          </div>
        </div>

        {/* Row 5: Pincode + Email */}
        <div className="af-row">
          <div className={`af-group${fieldErr('pincode') ? ' af-group--err' : ''}`}>
            {/*
             * Label + status are in a flex row so the spinner/city name appears
             * visually inline after "Pincode" — matching the original design.
             *
             * The status lives in a SIBLING <div> with id="af-pin-status", NOT
             * inside the <label>. This is the core fix:
             *   - Before: status was a child of <label> → every state change caused
             *     AT to re-read the full label ("Pincode ↻ Pincode" / "Pincode ✓ …")
             *   - After: status is an aria-live region with its own id → AT announces
             *     only the status change ("Looking up pincode" / "Dehradun, Uttarakhand")
             *     without touching the label text at all.
             *
             * aria-describedby on the input references "af-pin-status" so that when
             * the user focuses the field after a successful lookup they hear the
             * resolved city + state as supplementary context.
             *
             * aria-atomic="true" → the whole region is announced as one unit on change,
             * preventing partial reads mid-update.
             */}
            <div className="af-label-row">
              <label className="af-label" htmlFor="af-pincode">Pincode</label>
              <div
                id="af-pin-status"
                className="af-pin-status"
                aria-live="polite"
                aria-atomic="true"
              >
                {pincodeLoading && (
                  <span className="af-pin-spin" aria-label="Looking up pincode">↻</span>
                )}
                {pincodeMsg && !pincodeLoading && (
                  // aria-label gives SR a clean sentence without the ✓ glyph name
                  <span className="af-pin-ok" aria-label={`Found: ${pincodeMsg}`}>✓ {pincodeMsg}</span>
                )}
              </div>
            </div>
            <input id="af-pincode" className="af-input" type="text"
              autoComplete="postal-code" inputMode="numeric"
              value={addr.pincode}
              required
              aria-required="true"
              aria-invalid={!!fieldErr('pincode')}
              aria-describedby={[
                fieldErr('pincode')              ? 'af-pincode-err' : '',
                pincodeMsg && !pincodeLoading    ? 'af-pin-status'  : '',
              ].filter(Boolean).join(' ') || undefined}
              onChange={e => handlePincodeChange(e.target.value)}
              onBlur={() => onTouch('pincode')}
              placeholder="248001" maxLength={6}
            />
            {fieldErr('pincode') && (
              <span id="af-pincode-err" className="af-err" role="alert">{fieldErr('pincode')}</span>
            )}
          </div>
          <div className="af-group">
            <label className="af-label" htmlFor="af-email">
              Email <span className="af-optional">for invoice</span>
            </label>
            <input id="af-email" className="af-input" type="email"
              autoComplete="email" value={email}
              onChange={e => onEmailChange(e.target.value)}
              placeholder="you@email.com"
            />
          </div>
        </div>
      </div>

      <style>{`
        /* Tags */
        .af-tags-wrap {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 16px 28px 12px;
          flex-wrap: wrap;
        }
        @media (max-width: 640px) { .af-tags-wrap { padding: 14px 20px 10px; } }
        .af-tags-label {
          font-family: 'DM Sans', sans-serif;
          font-size: 11px;
          font-weight: 500;
          color: #9A9080;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          white-space: nowrap;
        }
        .af-tags { display: flex; gap: 6px; flex-wrap: wrap; }
        .af-tag {
          font-family: 'DM Sans', sans-serif;
          font-size: 12px;
          font-weight: 500;
          padding: 5px 12px;
          border-radius: 20px;
          border: 1.5px solid #E0D8CE;
          background: #FDFAF6;
          color: #7A7060;
          cursor: pointer;
          transition: all .18s;
          white-space: nowrap;
        }
        .af-tag:hover { border-color: #2C4A2E; color: #2C4A2E; background: #EEF6EC; }
        .af-tag--on  { border-color: #2C4A2E; color: #2C4A2E; background: #EEF6EC; font-weight: 600; }

        /* Delivering badge */
        .af-addr-badge {
          display: flex;
          align-items: center;
          gap: 8px;
          margin: 12px 28px 0;
          padding: 10px 14px;
          background: #EEF6EC;
          border-radius: 10px;
          border: 1px solid #C8E0BC;
          font-family: 'DM Sans', sans-serif;
          font-size: 12px;
          color: #3A6030;
          flex-wrap: wrap;
        }
        @media (max-width: 640px) { .af-addr-badge { margin: 10px 20px 0; } }
        .af-addr-badge strong { font-weight: 600; }
        .af-addr-hint { font-size: 11px; color: #7A9A70; font-weight: 400; }

        /* Form */
        .af-form {
          padding: 16px 28px 24px;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        @media (max-width: 640px) { .af-form { padding: 14px 20px 20px; gap: 12px; } }
        .af-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 14px;
        }
        @media (max-width: 560px) { .af-row { grid-template-columns: 1fr; } }

        .af-group {
          display: flex;
          flex-direction: column;
          gap: 5px;
        }
        .af-group--err .af-input,
        .af-group--err .af-phone { border-color: #D04030 !important; }

        /* Flex row that places the label and the inline pin-status side by side.
           Keeps the visual design identical to the original (status beside label text)
           while decoupling them in the DOM for correct screen reader behaviour. */
        .af-label-row {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-bottom: 0;
        }
        .af-label-row .af-label {
          margin-bottom: 0;
        }

        .af-label {
          font-family: 'DM Sans', sans-serif;
          font-size: 11px;
          font-weight: 600;
          color: #5A5248;
          text-transform: uppercase;
          letter-spacing: 0.07em;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .af-optional {
          font-size: 10px;
          font-weight: 400;
          text-transform: none;
          letter-spacing: 0;
          color: #A09888;
          background: #F2ECE4;
          padding: 1px 6px;
          border-radius: 4px;
        }

        .af-input {
          font-family: 'DM Sans', sans-serif;
          font-size: 14px;
          font-weight: 400;
          color: #1C2B1E;
          padding: 12px 14px;
          border: 1.5px solid #DDD5C8;
          border-radius: 12px;
          background: #FDFAF6;
          outline: none;
          width: 100%;
          box-sizing: border-box;
          transition: border-color .2s, box-shadow .2s, background .2s;
          -webkit-appearance: none;
        }
        .af-input::placeholder { color: #B8B0A5; }
        .af-input:focus {
          border-color: #2C4A2E;
          background: #FFFFFF;
          box-shadow: 0 0 0 3px rgba(44,74,46,.09), 0 1px 3px rgba(0,0,0,.04);
        }

        .af-textarea {
          resize: vertical;
          min-height: 72px;
          line-height: 1.5;
        }
        .af-select { cursor: pointer; }

        /* Phone compound input */
        .af-phone {
          display: flex;
          border: 1.5px solid #DDD5C8;
          border-radius: 12px;
          overflow: hidden;
          background: #FDFAF6;
          transition: border-color .2s, box-shadow .2s;
        }
        .af-phone:focus-within {
          border-color: #2C4A2E;
          background: #FFF;
          box-shadow: 0 0 0 3px rgba(44,74,46,.09);
        }
        .af-phone-pre {
          font-family: 'DM Sans', sans-serif;
          font-size: 13px;
          font-weight: 600;
          color: #6A6258;
          padding: 12px 12px 12px 14px;
          background: #F5F0E8;
          border-right: 1.5px solid #E0D8CE;
          white-space: nowrap;
          display: flex;
          align-items: center;
          flex-shrink: 0;
        }
        .af-phone-field {
          border: none !important;
          border-radius: 0 !important;
          background: transparent !important;
          box-shadow: none !important;
          flex: 1;
          min-width: 0;
        }

        /* Pincode feedback — sits in .af-label-row as a flex sibling of the label.
           min-width:0 prevents the region from pushing the label off-screen when
           a long city+state string appears. */
        .af-pin-status {
          display: flex;
          align-items: center;
          min-width: 0;
          font-size: 10px;
        }
        .af-pin-spin {
          display: inline-block;
          animation: pin-spin .6s linear infinite;
          font-style: normal;
          color: #9A9080;
        }
        @keyframes pin-spin { to { transform: rotate(360deg); } }
        .af-pin-ok {
          font-size: 10px;
          color: #3A7A30;
          font-weight: 500;
          text-transform: none;
          letter-spacing: 0;
          font-style: normal;
        }

        /* Errors */
        .af-err {
          font-family: 'DM Sans', sans-serif;
          font-size: 11px;
          color: #D04030;
          font-weight: 500;
        }
      `}</style>
    </div>
  )
}
