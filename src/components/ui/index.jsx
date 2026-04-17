'use client';

export function Loader({ text = 'Loading…' }) {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="flex items-center gap-3 text-sm" style={{ color: 'var(--tx2,#6e9a75)' }}>
        <div className="w-5 h-5 border-2 border-[#30363d] border-t-[#1a5c2a] rounded-full animate-spin" />
        {text}
      </div>
    </div>
  );
}

export function ErrorMsg({ error, onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-3">
      <div className="text-sm rounded-xl px-5 py-3"
        style={{ color: '#f85149', background: 'rgba(248,81,73,0.1)', border: '1px solid rgba(248,81,73,0.3)' }}>
        ⚠️ {error}
      </div>
      {onRetry && (
        <button onClick={onRetry} className="text-[11px] underline transition"
          style={{ color: 'var(--tx2,#6e9a75)' }}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Card({ title, children, action, id }) {
  return (
    <div id={id} className="rounded-xl overflow-hidden"
      style={{ background: 'var(--bg2,#161b22)', border: '1px solid var(--bd,#1a5c2a)' }}>
      {title && (
        <div className="px-4 py-3 flex items-center justify-between"
          style={{ borderBottom: '1px solid var(--bd,#1a5c2a)' }}>
          <h3 className="text-[13px] font-bold" style={{ color: 'var(--tx,#ffffff)' }}>{title}</h3>
          {action}
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  );
}

export function Badge({ children, type = 'default' }) {
  const styles = {
    default: { bg: 'rgba(139,148,158,0.15)', color: '#8b949e' },
    green:   { bg: 'rgba(63,185,80,0.15)',   color: '#3fb950' },
    red:     { bg: 'rgba(248,81,73,0.15)',    color: '#f85149' },
    yellow:  { bg: 'rgba(210,153,34,0.15)',   color: '#d29922' },
    blue:    { bg: 'rgba(88,166,255,0.15)',   color: '#58a6ff' },
    purple:  { bg: 'rgba(137,87,229,0.15)',   color: '#8957e5' },
  };
  const s = styles[type] || styles.default;
  return (
    <span className="inline-block px-2 py-0.5 rounded-full text-[10.5px] font-semibold"
      style={{ background: s.bg, color: s.color }}>
      {children}
    </span>
  );
}

export function StatusBadge({ status }) {
  const map = {
    pending:   { type: 'yellow', label: 'Pending'   },
    confirmed: { type: 'blue',   label: 'Confirmed' },
    packed:    { type: 'purple', label: 'Packed'    },
    shipped:   { type: 'blue',   label: 'Shipped'   },
    delivered: { type: 'green',  label: 'Delivered' },
    cancelled: { type: 'red',    label: 'Cancelled' },
  };
  const s = map[status] || { type: 'default', label: status };
  return <Badge type={s.type}>{s.label}</Badge>;
}
