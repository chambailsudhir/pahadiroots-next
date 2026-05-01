'use client';
import { useState } from 'react';

export default function Topbar({ title, dateRange, onDateChange, onRefresh, alerts = [] }) {
  const [showAlerts, setShowAlerts] = useState(false);

  const RANGES = [
    { label: 'Today',   days: 1  },
    { label: '7 days',  days: 7  },
    { label: '30 days', days: 30 },
    { label: '90 days', days: 90 },
  ];

  return (
    <header className="h-[52px] flex items-center justify-between px-5 flex-shrink-0"
      style={{ background: 'var(--bg,#0d1117)', borderBottom: '1px solid var(--bd,#1a5c2a)' }}>

      <div className="text-[14px] font-bold" style={{ color: 'var(--tx,#ffffff)' }}>{title}</div>

      <div className="flex items-center gap-2">
        {/* Date Range Buttons */}
        {onDateChange && (
          <div className="flex gap-1">
            {RANGES.map(r => (
              <button
                key={r.days}
                onClick={() => onDateChange(r.days)}
                className="px-3 py-1 rounded-md text-[11px] transition"
                style={dateRange === r.days
                  ? { background: 'var(--accent,#1a5c2a)', color: '#ffffff', fontWeight: 700, border: '1px solid var(--accent,#1a5c2a)' }
                  : { background: 'transparent', color: 'var(--tx2,#6e9a75)', border: '1px solid var(--bd,#1a5c2a)' }}
              >
                {r.label}
              </button>
            ))}
          </div>
        )}

        {/* Alerts */}
        <div className="relative">
          <button onClick={() => setShowAlerts(s => !s)}
            className="relative p-1.5 transition"
            style={{ color: 'var(--tx2,#6e9a75)' }}>
            🔔
            {alerts.length > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-[#f85149] text-[var(--tx)] text-[9px] font-bold rounded-full flex items-center justify-center">
                {alerts.length}
              </span>
            )}
          </button>
          {showAlerts && alerts.length > 0 && (
            <div className="absolute right-0 top-9 w-72 rounded-xl shadow-2xl z-50"
              style={{ background: 'var(--bg2,#161b22)', border: '1px solid var(--bd,#1a5c2a)' }}>
              <div className="px-4 py-3 text-[12px] font-bold" style={{ borderBottom: '1px solid var(--bd,#1a5c2a)', color: 'var(--tx,#ffffff)' }}>
                Alerts ({alerts.length})
              </div>
              {alerts.map((a, i) => (
                <div key={i} className="px-4 py-3 flex gap-2.5 text-[12px]"
                  style={{ borderBottom: i < alerts.length - 1 ? '1px solid var(--bd,#1a5c2a)' : 'none',
                    background: a.type === 'red' ? 'rgba(248,81,73,0.08)' : a.type === 'green' ? 'rgba(45,138,69,0.08)' : 'rgba(210,153,34,0.08)' }}>
                  <span className="text-base flex-shrink-0">{a.icon}</span>
                  <span style={{ color: 'var(--tx2,#6e9a75)' }}>{a.msg}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Refresh */}
        {onRefresh && (
          <button onClick={onRefresh}
            className="px-3 py-1.5 rounded-lg text-[11.5px] transition"
            style={{ background: 'var(--bg2,#161b22)', border: '1px solid var(--bd,#1a5c2a)', color: 'var(--tx2,#6e9a75)' }}>
            ↻ Refresh
          </button>
        )}

        <a href="https://pahadiroots.com" target="_blank" rel="noreferrer"
          className="px-3 py-1.5 rounded-lg text-[11.5px] transition"
          style={{ background: 'var(--bg2,#161b22)', border: '1px solid var(--bd,#1a5c2a)', color: 'var(--tx2,#6e9a75)' }}>
          🌐 Live Site
        </a>
      </div>
    </header>
  );
}
