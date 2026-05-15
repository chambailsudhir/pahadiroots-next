'use client'

import { useState, useCallback } from 'react'
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
  Home:'🏠', Office:'🏢', Parents:'👨‍👩‍👦', Friends:'👫', Others:'📍',
}

// Free Indian pincode lookup — no API key required
async function lookupPincode(pin: string): Promise<{ city: string; state: string } | null> {
  if (!/^\d{6}$/.test(pin)) return null
  try {
    const res = await fetch(`https://api.postalpincode.in/pincode/${pin}`)
    const data = await res.json()
    if (!data?.[0]?.PostOffice?.length) return null
    const po = data[0].PostOffice[0]
    // Match returned state to full INDIA_STATES list
    const raw = po.State || ''
    const matched = INDIA_STATES.find(s =>
      s.toLowerCase() === raw.toLowerCase() ||
      s.toLowerCase().startsWith(raw.toLowerCase()) ||
      raw.toLowerCase().startsWith(s.toLowerCase().split(' ')[0])
    ) || raw
    return { city: po.District || po.Block || '', state: matched }
  } catch { return null }
}

interface Props {
  addr: OrderAddress
  email: string
  touched: Record<string, boolean>
  onChange: (field: keyof OrderAddress, value: string) => void
  onEmailChange: (v: string) => void
  onTouch: (field: string) => void
  // When a saved address is selected, label buttons are hidden (label comes from saved addr)
  // When null, user is entering a new address and can pick a label tag
  selectedSavedIdx: number | null
}

export default function AddressForm({ addr, email, touched, onChange, onEmailChange, onTouch, selectedSavedIdx }: Props) {
  const [pincodeLoading, setPincodeLoading] = useState(false)
  const [pincodeMsg,     setPincodeMsg]     = useState('')

  const fieldErr = useCallback((field: keyof OrderAddress): string => {
    if (!touched[field]) return ''
    const val = addr[field]?.toString().trim()
    if (!val) return 'Required'
    if (field === 'phone'   && !/^[6-9]\d{9}$/.test(addr.phone))  return 'Invalid mobile number'
    if (field === 'pincode' && !/^\d{6}$/.test(addr.pincode))      return 'Invalid pincode'
    return ''
  }, [addr, touched])

  // Pincode autofill — fires on 6-digit completion
  async function handlePincodeChange(val: string) {
    const clean = val.replace(/\D/g, '').slice(0, 6)
    onChange('pincode', clean)
    if (clean.length === 6) {
      setPincodeLoading(true)
      setPincodeMsg('')
      const result = await lookupPincode(clean)
      if (result) {
        if (!addr.city)  onChange('city',  result.city)
        if (addr.state === 'Uttarakhand' || !addr.state) onChange('state', result.state)
        setPincodeMsg(`✓ ${result.city}, ${result.state}`)
      } else {
        setPincodeMsg('')
      }
      setPincodeLoading(false)
    } else {
      setPincodeMsg('')
    }
  }

  return (
    <div className="af-wrap">
      {/* Address label selector — only shown when typing a NEW address.
          When a saved address card is selected, the label comes from that card.
          This prevents the confusing state where "Office" button appears active
          while "Home" saved address card is selected. */}
      {selectedSavedIdx === null && (
        <div className="af-label-section">
          <div className="af-label-heading">Tag this address as</div>
          <div className="af-label-row">
            {LABEL_OPTIONS.map(lbl => (
              <button
                key={lbl}
                type="button"
                className={`af-label-btn${addr.label === lbl ? ' active' : ''}`}
                onClick={() => onChange('label', lbl)}
                aria-pressed={addr.label === lbl}
              >
                {LABEL_ICONS[lbl]} {lbl}
              </button>
            ))}
          </div>
        </div>
      )}
      {/* When a saved address is selected, show its label as read-only badge */}
      {selectedSavedIdx !== null && addr.label && (
        <div className="af-selected-label">
          {LABEL_ICONS[addr.label] || '📍'} Delivering to: <strong>{addr.label}</strong>
          <span className="af-selected-label-hint"> · Select a different address above to change</span>
        </div>
      )}

      {/* Form fields */}
      <div className="af-form">
        <div className="af-row">
          {/* Name */}
          <div className={`af-field${fieldErr('name') ? ' err' : ''}`}>
            <label className="af-lbl" htmlFor="af-name">Full Name *</label>
            <input id="af-name" className="af-input" type="text"
              autoComplete="name" value={addr.name}
              onChange={e => onChange('name', e.target.value)}
              onBlur={() => onTouch('name')}
              placeholder="Ravi Kumar"
            />
            {fieldErr('name') && <span className="af-err" role="alert">{fieldErr('name')}</span>}
          </div>
          {/* Phone */}
          <div className={`af-field${fieldErr('phone') ? ' err' : ''}`}>
            <label className="af-lbl" htmlFor="af-phone">Mobile Number *</label>
            <div className="af-phone-wrap">
              <span className="af-phone-pre">+91</span>
              <input id="af-phone" className="af-input af-phone-input"
                type="tel" autoComplete="tel-national" inputMode="numeric"
                value={addr.phone}
                onChange={e => onChange('phone', e.target.value.replace(/\D/g,''))}
                onBlur={() => onTouch('phone')}
                placeholder="9876543210" maxLength={10}
              />
            </div>
            {fieldErr('phone') && <span className="af-err" role="alert">{fieldErr('phone')}</span>}
          </div>
        </div>

        {/* Address */}
        <div className={`af-field af-full${fieldErr('flat') ? ' err' : ''}`}>
          <label className="af-lbl" htmlFor="af-flat">House / Flat, Street, Colony *</label>
          <textarea id="af-flat" className="af-input af-textarea"
            autoComplete="street-address" value={addr.flat}
            onChange={e => onChange('flat', e.target.value)}
            onBlur={() => onTouch('flat')}
            placeholder="Flat 101, Shivalik Apartments, Civil Lines" rows={2}
          />
          {fieldErr('flat') && <span className="af-err" role="alert">{fieldErr('flat')}</span>}
        </div>

        {/* Area */}
        <div className="af-field af-full">
          <label className="af-lbl" htmlFor="af-area">Area / Landmark <span className="af-opt">(optional)</span></label>
          <input id="af-area" className="af-input" type="text"
            value={addr.area}
            onChange={e => onChange('area', e.target.value)}
            placeholder="Near ISBT, Rajpur Road"
          />
        </div>

        <div className="af-row">
          {/* City */}
          <div className={`af-field${fieldErr('city') ? ' err' : ''}`}>
            <label className="af-lbl" htmlFor="af-city">City *</label>
            <input id="af-city" className="af-input" type="text"
              autoComplete="address-level2" value={addr.city}
              onChange={e => onChange('city', e.target.value)}
              onBlur={() => onTouch('city')}
              placeholder="Dehradun"
            />
            {fieldErr('city') && <span className="af-err" role="alert">{fieldErr('city')}</span>}
          </div>
          {/* State */}
          <div className="af-field">
            <label className="af-lbl" htmlFor="af-state">State *</label>
            <select id="af-state" className="af-input"
              autoComplete="address-level1" value={addr.state}
              onChange={e => onChange('state', e.target.value)}
            >
              {INDIA_STATES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        <div className="af-row">
          {/* Pincode — with autofill */}
          <div className={`af-field${fieldErr('pincode') ? ' err' : ''}`}>
            <label className="af-lbl" htmlFor="af-pincode">
              Pincode *
              {pincodeLoading && <span className="af-pin-loading"> ↻ Looking up…</span>}
              {pincodeMsg && !pincodeLoading && <span className="af-pin-ok"> {pincodeMsg}</span>}
            </label>
            <input id="af-pincode" className="af-input" type="text"
              autoComplete="postal-code" inputMode="numeric"
              value={addr.pincode}
              onChange={e => handlePincodeChange(e.target.value)}
              onBlur={() => onTouch('pincode')}
              placeholder="248001" maxLength={6}
            />
            {fieldErr('pincode') && <span className="af-err" role="alert">{fieldErr('pincode')}</span>}
          </div>
          {/* Email */}
          <div className="af-field">
            <label className="af-lbl" htmlFor="af-email">Email <span className="af-opt">(optional, for invoice)</span></label>
            <input id="af-email" className="af-input" type="email"
              autoComplete="email" value={email}
              onChange={e => onEmailChange(e.target.value)}
              placeholder="you@email.com"
            />
          </div>
        </div>
      </div>

      <style>{`
        .af-wrap{}
        .af-label-section{padding:12px 20px 0;}
        .af-label-heading{font-size:11px;font-weight:700;color:#7a7565;text-transform:uppercase;
          letter-spacing:.6px;margin-bottom:8px;font-family:inherit;}
        .af-label-row{display:flex;gap:7px;flex-wrap:wrap;}
        .af-label-btn{border:1.5px solid #e2dbd0;background:#f5f0e8;color:#7a7565;
          font-size:12px;font-weight:600;padding:5px 13px;border-radius:20px;
          cursor:pointer;transition:all .18s;font-family:inherit;}
        .af-label-btn:hover{border-color:#1a3a1e;color:#1a3a1e;}
        .af-label-btn.active{border-color:#1a3a1e;background:#e8f5e9;color:#1a3a1e;}
        .af-form{padding:14px 20px;display:flex;flex-direction:column;gap:12px;}
        .af-row{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
        @media(max-width:580px){.af-row{grid-template-columns:1fr;}}
        .af-field{display:flex;flex-direction:column;gap:4px;}
        .af-full{grid-column:1/-1;}
        .af-lbl{font-size:11px;font-weight:700;color:#7a7565;text-transform:uppercase;
          letter-spacing:.6px;font-family:inherit;}
        .af-opt{font-size:10px;font-weight:400;text-transform:none;letter-spacing:0;color:#9a9488;}
        .af-input{padding:11px 13px;border:1.5px solid #e2dbd0;border-radius:10px;
          font-size:14px;color:#1a1a1a;outline:none;transition:all .2s;
          background:#fff;width:100%;box-sizing:border-box;font-family:inherit;}
        .af-input:focus{border-color:#1a3a1e;box-shadow:0 0 0 3px rgba(26,58,30,.07);}
        .af-field.err .af-input,.af-field.err .af-phone-wrap{border-color:#c0392b!important;}
        .af-err{font-size:11px;color:#c0392b;font-family:inherit;}
        .af-textarea{resize:vertical;min-height:66px;}
        .af-phone-wrap{display:flex;border:1.5px solid #e2dbd0;border-radius:10px;
          overflow:hidden;transition:all .2s;}
        .af-phone-wrap:focus-within{border-color:#1a3a1e;box-shadow:0 0 0 3px rgba(26,58,30,.07);}
        .af-phone-pre{background:#f5f0e8;padding:11px;font-size:13px;font-weight:700;
          color:#7a7565;border-right:1px solid #e2dbd0;white-space:nowrap;
          display:flex;align-items:center;font-family:inherit;}
        .af-phone-input{border:none!important;box-shadow:none!important;
          border-radius:0!important;flex:1;min-width:0;}
        .af-pin-loading{font-size:10px;color:#7a7565;font-weight:400;text-transform:none;letter-spacing:0;}
        .af-pin-ok{font-size:10px;color:#2d6a4f;font-weight:600;text-transform:none;letter-spacing:0;}
        .af-selected-label{padding:10px 20px;font-size:12px;color:#2d5233;
          background:#e8f5e9;border-bottom:1px solid #c8e6c9;font-family:inherit;}
        .af-selected-label-hint{font-size:11px;color:#7a9a7a;font-weight:400;}
      `}</style>
    </div>
  )
}
