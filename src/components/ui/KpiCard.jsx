'use client';

export default function KpiCard({ label, value, sub, trend, accentColor = '#1a5c2a', onClick }) {
  const trendColor = trend > 0 ? '#3fb950' : trend < 0 ? '#f85149' : 'var(--tx2,#6e9a75)';
  const trendText  = trend != null
    ? `${trend >= 0 ? '↑ +' : '↓ '}${Math.abs(trend)}% vs prev`
    : sub;

  return (
    <div
      onClick={onClick}
      className={`rounded-xl p-4 flex flex-col gap-1 ${onClick ? 'cursor-pointer hover:brightness-110 transition' : ''}`}
      style={{
        background: 'var(--bg2,#161b22)',
        border: `1px solid ${accentColor}55`,
        boxShadow: `inset 3px 0 0 0 ${accentColor}`,
      }}
    >
      <div className="text-[10px] font-bold tracking-widest uppercase" style={{ color: 'var(--tx2,#6e9a75)' }}>
        {label}
      </div>
      <div className="text-[26px] font-bold tabular-nums leading-tight" style={{ color: 'var(--tx,#ffffff)' }}>
        {value ?? '—'}
      </div>
      {trendText && (
        <div className="text-[11px]" style={{ color: trend != null ? trendColor : 'var(--tx2,#6e9a75)' }}>
          {trendText}
        </div>
      )}
      <div className="h-[2px] rounded-full mt-2 -mx-4 -mb-4" style={{ background: accentColor }} />
    </div>
  );
}
