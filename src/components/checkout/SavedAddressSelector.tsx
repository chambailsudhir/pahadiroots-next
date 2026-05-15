'use client'

const LABEL_ICONS: Record<string, string> = {
  Home: '🏠', Office: '🏢', Parents: '👨‍👩‍👦', Friends: '👫', Others: '📍',
}

function matchState(stored: string | undefined | null, states: string[]): string {
  if (!stored) return 'Uttarakhand'
  const s = stored.trim()
  const exact = states.find(st => st === s)
  if (exact) return exact
  const ci = states.find(st => st.toLowerCase() === s.toLowerCase())
  if (ci) return ci
  const lower = s.toLowerCase()
  const prefix = states.find(st =>
    st.toLowerCase().startsWith(lower) || lower.startsWith(st.toLowerCase())
  )
  if (prefix) return prefix
  const word = lower.split(' ')[0]
  const contains = states.find(st => st.toLowerCase().includes(word) && word.length > 3)
  if (contains) return contains
  return s
}

interface Props {
  addresses: any[]
  selectedIdx: number | null
  onSelect: (addr: any, idx: number) => void
  indiaStates: string[]
}

export default function SavedAddressSelector({ addresses, selectedIdx, onSelect, indiaStates }: Props) {
  if (!addresses.length) return null
  return (
    <div className="sas-wrap">
      <div className="sas-label">📂 SAVED ADDRESSES</div>
      <div className="sas-list">
        {addresses.map((a: any, i: number) => (
          <div
            key={`${i}-${a.label}`}
            className={`sas-item${selectedIdx === i ? ' selected' : ''}`}
            onClick={() => onSelect(a, i)}
            role="button"
            tabIndex={0}
            onKeyDown={e => e.key === 'Enter' && onSelect(a, i)}
            aria-pressed={selectedIdx === i}
          >
            <div className="sas-check">{selectedIdx === i ? '✓' : ''}</div>
            <div className="sas-info">
              <div className="sas-tag">{LABEL_ICONS[a.label] || '📍'} {a.label}</div>
              <div className="sas-text">
                {[a.name, a.addr || a.flat, a.city,
                  matchState(a.state, indiaStates),
                  a.pin || a.pincode]
                  .filter(Boolean).join(', ')}
              </div>
            </div>
          </div>
        ))}
      </div>
      <style>{`
        .sas-wrap{padding:14px 20px 0;}
        .sas-label{font-size:11px;font-weight:700;color:#7a7565;text-transform:uppercase;
          letter-spacing:.6px;margin-bottom:8px;font-family:inherit;}
        .sas-list{display:flex;flex-direction:column;gap:7px;margin-bottom:10px;}
        .sas-item{display:flex;align-items:flex-start;gap:10px;padding:10px 14px;
          border:1.5px solid #e2dbd0;border-radius:11px;cursor:pointer;
          transition:all .18s;background:#fafaf8;}
        .sas-item:hover,.sas-item:focus{border-color:#1a3a1e;background:#e8f5e9;outline:none;}
        .sas-item.selected{border-color:#1a3a1e;background:#e8f5e9;}
        .sas-check{width:19px;height:19px;border-radius:50%;background:#eee;
          display:flex;align-items:center;justify-content:center;font-size:10px;
          font-weight:700;flex-shrink:0;transition:all .18s;}
        .sas-item.selected .sas-check{background:#1a3a1e;color:#fff;}
        .sas-tag{font-size:12px;font-weight:700;color:#1a3a1e;font-family:inherit;}
        .sas-text{font-size:11.5px;color:#7a7565;line-height:1.4;margin-top:2px;font-family:inherit;}
      `}</style>
    </div>
  )
}
