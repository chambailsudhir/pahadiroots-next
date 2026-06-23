'use client'

import { memo } from 'react'
import type { SavedAddress } from '@/types'
import './SavedAddressSelector.css'  // PERF FIX: extracted from inline <style>

const LABEL_ICONS: Record<string, string> = {
  Home: '🏠', Office: '🏢', Parents: '👨‍👩‍👦', Friends: '👫', Others: '📍',
}

function matchState(stored: string | undefined | null, states: string[]): string {
  if (!stored) return 'Uttarakhand'
  const s = stored.trim()
  const exact = states.find(st => st === s); if (exact) return exact
  const ci    = states.find(st => st.toLowerCase() === s.toLowerCase()); if (ci) return ci
  const lower = s.toLowerCase()
  const prefix = states.find(st => st.toLowerCase().startsWith(lower) || lower.startsWith(st.toLowerCase()))
  if (prefix) return prefix
  const word = lower.split(' ')[0]
  const has  = states.find(st => st.toLowerCase().includes(word) && word.length > 3)
  return has || s
}

interface Props {
  addresses: SavedAddress[]
  selectedIdx: number | null
  onSelect: (addr: SavedAddress, idx: number) => void
  indiaStates: string[]
}

// PERF FIX: memo — addresses and selectedIdx rarely change once the page loads.
const SavedAddressSelector = memo(function SavedAddressSelector({ addresses, selectedIdx, onSelect, indiaStates }: Props) {
  if (!addresses.length) return null
  return (
    <div className="sas-root">
      <p className="sas-label">Saved Addresses</p>
      <div className="sas-list">
        {addresses.map((a, i) => (
          <div
            key={`${i}-${a.label}`}
            className={`sas-card${selectedIdx === i ? ' sas-card--on' : ''}`}
            onClick={() => onSelect(a, i)}
            role="button"
            tabIndex={0}
            onKeyDown={e => e.key === 'Enter' && onSelect(a, i)}
            aria-pressed={selectedIdx === i}
          >
            <div className="sas-check">
              {selectedIdx === i
                ? <svg width="11" height="8" viewBox="0 0 11 8" fill="none"><path d="M1 4L4 7L10 1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                : null}
            </div>
            <div className="sas-body">
              <div className="sas-tag">
                <span>{LABEL_ICONS[a.label ?? ''] || '📍'}</span>
                <span>{a.label}</span>
              </div>
              <div className="sas-addr">
                {[a.name, a.addr || a.flat, a.city,
                  matchState(a.state, indiaStates), a.pin || a.pincode]
                  .filter(Boolean).join(', ')}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
})

export default SavedAddressSelector
