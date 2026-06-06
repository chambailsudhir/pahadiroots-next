'use client'

import type { SavedAddress } from '@/types'

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

export default function SavedAddressSelector({ addresses, selectedIdx, onSelect, indiaStates }: Props) {
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
      <style>{`
        .sas-root { padding: 20px 28px 8px; }
        @media (max-width: 640px) { .sas-root { padding: 16px 20px 6px; } }
        .sas-label {
          font-family: 'DM Sans', sans-serif;
          font-size: 10px;
          font-weight: 600;
          color: #9A9080;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          margin: 0 0 10px;
        }
        .sas-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 4px; }
        .sas-card {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          padding: 12px 16px;
          border: 1.5px solid #E0D8CE;
          border-radius: 14px;
          cursor: pointer;
          background: #FDFAF6;
          transition: all .2s ease;
          outline: none;
        }
        .sas-card:hover { border-color: #2C4A2E; background: #EEF6EC; }
        .sas-card:focus-visible { box-shadow: 0 0 0 3px rgba(44,74,46,.15); }
        .sas-card--on {
          border-color: #2C4A2E;
          background: #EEF6EC;
          box-shadow: 0 0 0 1px #2C4A2E inset;
        }
        .sas-check {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          border: 1.5px solid #CCC8C0;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          transition: all .2s;
          margin-top: 1px;
        }
        .sas-card--on .sas-check {
          background: #2C4A2E;
          border-color: #2C4A2E;
          color: #FFFFFF;
        }
        .sas-body { flex: 1; min-width: 0; }
        .sas-tag {
          display: flex;
          align-items: center;
          gap: 5px;
          font-family: 'DM Sans', sans-serif;
          font-size: 12px;
          font-weight: 600;
          color: #2C4A2E;
          margin-bottom: 3px;
        }
        .sas-addr {
          font-family: 'DM Sans', sans-serif;
          font-size: 12px;
          color: #7A7060;
          line-height: 1.5;
        }
      `}</style>
    </div>
  )
}
