'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';

// ── 120 carefully chosen colours across the full spectrum ──────
const COLOUR_GRID = [
  // Row 1 — Whites & near-whites
  '#ffffff','#f8f9fa','#f5f0e8','#fdf6e3','#fff8f0','#fef9f0','#f0f4ff','#f0fff4','#f0f8ff','#fafafa',
  // Row 2 — Light greys
  '#e8e8e8','#d4d4d4','#c0c0c0','#a8a8a8','#909090','#787878','#606060','#484848','#303030','#1a1a1a',
  // Row 3 — Yellows & golds
  '#fff9c4','#fff176','#ffee58','#fdd835','#ffc107','#ffb300','#ff8f00','#ff6f00','#ffd700','#f5c518',
  // Row 4 — Oranges
  '#ffe0b2','#ffcc80','#ffb74d','#ffa726','#ff9800','#fb8c00','#f57c00','#e65100','#bf360c','#ff5722',
  // Row 5 — Reds & pinks
  '#ffcdd2','#ef9a9a','#e57373','#ef5350','#f44336','#e53935','#c62828','#ff1744','#ff4081','#f50057',
  // Row 6 — Pinks & purples
  '#f8bbd0','#f48fb1','#f06292','#ec407a','#e91e63','#c2185b','#ce93d8','#ba68c8','#ab47bc','#8e24aa',
  // Row 7 — Purples & deep purples
  '#e1bee7','#9c27b0','#7b1fa2','#6a1b9a','#b39ddb','#9575cd','#7e57c2','#673ab7','#512da8','#311b92',
  // Row 8 — Blues
  '#bbdefb','#90caf9','#64b5f6','#42a5f5','#2196f3','#1e88e5','#1565c0','#0d47a1','#82b1ff','#448aff',
  // Row 9 — Teals & cyans
  '#b2ebf2','#80deea','#4dd0e1','#26c6da','#00bcd4','#00acc1','#0097a7','#006064','#80cbc4','#4db6ac',
  // Row 10 — Greens
  '#c8e6c9','#a5d6a7','#81c784','#66bb6a','#4caf50','#43a047','#388e3c','#2e7d32','#3fb950','#00c853',
  // Row 11 — Light greens & limes
  '#f9fbe7','#f0f4c3','#e6ee9c','#dce775','#cddc39','#c0ca33','#afb42b','#9e9d24','#76ff03','#69f0ae',
  // Row 12 — Himalayan / brand palette
  '#1a5c2a','#2d6a1f','#3fb950','#86efac','#d4edda','#1b4332','#2d8a45','#52b788','#40916c','#74c69d',
];

function Portal({ children }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return null;
  return createPortal(children, document.body);
}

export default function ColourPicker({ value, onChange, label }) {
  const [open, setOpen]     = useState(false);
  const [hex,  setHex]      = useState(value || '#ffffff');
  const btnRef              = useRef();
  const [pos, setPos]       = useState({ top: 0, left: 0 });

  // Sync hex when value changes externally
  useEffect(() => { setHex(value || '#ffffff'); }, [value]);

  const openPicker = useCallback(() => {
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    // Position panel: prefer below, but flip up if too close to bottom
    const panelH = 420;
    const spaceBelow = window.innerHeight - r.bottom - 8;
    const top = spaceBelow >= panelH ? r.bottom + 6 : r.top - panelH - 6;
    // Prefer aligning left, but don't go off right edge
    const panelW = 312;
    const left = Math.min(r.left, window.innerWidth - panelW - 8);
    setPos({ top: top + window.scrollY, left });
    setOpen(true);
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = e => {
      if (btnRef.current?.contains(e.target)) return;
      // Don't close if clicking inside the portal panel
      if (e.target.closest('[data-colour-panel]')) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  function commit(colour) {
    const c = colour || '#ffffff';
    setHex(c);
    onChange(c);
  }

  function handleHexInput(v) {
    setHex(v);
    if (/^#[0-9a-fA-F]{6}$/.test(v)) onChange(v);
  }

  const display = value || '#ffffff';

  return (
    <>
      {/* Trigger button */}
      <div>
        <div className="text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--tx2)' }}>
          {label} Colour
        </div>
        <button ref={btnRef} onClick={openPicker}
          className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition"
          style={{ background: 'var(--bg)', border: '1px solid var(--bd)', color: 'var(--tx)', whiteSpace: 'nowrap' }}>
          <span className="w-4 h-4 rounded border flex-shrink-0"
            style={{ background: display, borderColor: 'rgba(255,255,255,0.25)' }} />
          <span className="font-mono text-[10px]" style={{ color: 'var(--tx2)' }}>{display}</span>
          <span className="text-[9px] opacity-40">▾</span>
        </button>
      </div>

      {/* Portal panel — renders at body level, never clipped */}
      {open && (
        <Portal>
          <div data-colour-panel=""
            style={{
              position: 'absolute',
              top: pos.top,
              left: pos.left,
              zIndex: 99999,
              width: 312,
              borderRadius: 14,
              boxShadow: '0 8px 40px rgba(0,0,0,0.55)',
              background: 'var(--bg2,#161b22)',
              border: '1px solid var(--bd,#30363d)',
              padding: 14,
            }}>

            {/* Header */}
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-bold" style={{ color: 'var(--tx,#e6edf3)' }}>
                🎨 {label} Colour
              </span>
              <button onClick={() => setOpen(false)}
                className="text-[13px] w-5 h-5 flex items-center justify-center rounded"
                style={{ color: 'var(--tx2)', background: 'var(--bd)' }}>✕</button>
            </div>

            {/* Colour grid — 10 cols × 12 rows = 120 colours */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: 4, marginBottom: 12 }}>
              {COLOUR_GRID.map(c => (
                <button key={c} onClick={() => commit(c)}
                  title={c}
                  style={{
                    width: '100%',
                    aspectRatio: '1',
                    borderRadius: 5,
                    background: c,
                    border: value === c ? '2.5px solid var(--accent,#3fb950)' : '1.5px solid rgba(255,255,255,0.1)',
                    cursor: 'pointer',
                    transition: 'transform 0.1s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.25)'}
                  onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
                />
              ))}
            </div>

            {/* Divider */}
            <div style={{ height: 1, background: 'var(--bd,#30363d)', marginBottom: 10 }} />

            {/* Custom colour row */}
            <div className="text-[9px] font-bold uppercase tracking-widest mb-2"
              style={{ color: 'var(--tx2,#8b949e)' }}>Custom colour</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {/* Native colour wheel */}
              <input type="color" value={hex.match(/^#[0-9a-fA-F]{6}$/) ? hex : '#ffffff'}
                onChange={e => commit(e.target.value)}
                style={{ width: 36, height: 36, border: 'none', padding: 0, borderRadius: 6, cursor: 'pointer', background: 'none' }} />
              {/* Hex input */}
              <input value={hex} onChange={e => handleHexInput(e.target.value)}
                placeholder="#ffffff" maxLength={7}
                className="flex-1 rounded-lg px-2.5 py-1.5 text-[12px] font-mono outline-none"
                style={{ background: 'var(--bg,#0d1117)', border: '1px solid var(--bd,#30363d)', color: 'var(--tx,#e6edf3)' }} />
              {/* Preview swatch */}
              <span style={{ width: 32, height: 32, borderRadius: 6, background: hex, border: '1px solid rgba(255,255,255,0.15)', flexShrink: 0, display: 'block' }} />
            </div>

            {/* Reset + Apply row */}
            <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
              <button onClick={() => { onChange(''); setHex('#ffffff'); setOpen(false); }}
                style={{ flex: 1, padding: '6px 0', borderRadius: 8, fontSize: 11,
                  color: 'var(--tx2)', border: '1px solid var(--bd)', background: 'transparent', cursor: 'pointer' }}>
                Reset
              </button>
              <button onClick={() => setOpen(false)}
                style={{ flex: 2, padding: '6px 0', borderRadius: 8, fontSize: 11, fontWeight: 700,
                  color: 'var(--accent,#3fb950)', border: '1px solid color-mix(in srgb, var(--accent,#3fb950) 35%, transparent)',
                  background: 'color-mix(in srgb, var(--accent,#3fb950) 12%, transparent)', cursor: 'pointer' }}>
                ✓ Apply
              </button>
            </div>
          </div>
        </Portal>
      )}
    </>
  );
}
