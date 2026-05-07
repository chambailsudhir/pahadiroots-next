'use client'
export default function OrdersSkeleton() {
  return (
    <div className="skeleton-wrap">
      {[1,2,3].map(i => (
        <div key={i} className="sk-card">
          <div className="sk-stripe" />
          <div className="sk-inner">
            <div className="sk-row">
              <div className="sk-block" style={{ width: '140px', height: '16px' }} />
              <div className="sk-block" style={{ width: '80px', height: '24px', borderRadius: '8px' }} />
            </div>
            <div className="sk-row" style={{ marginTop: '16px', gap: '8px' }}>
              {[1,2].map(j => <div key={j} className="sk-img" />)}
            </div>
            <div className="sk-block" style={{ width: '60%', height: '14px', marginTop: '12px' }} />
            <div className="sk-row" style={{ marginTop: '16px', gap: '8px' }}>
              {[1,2,3].map(j => <div key={j} className="sk-block" style={{ width: '90px', height: '32px', borderRadius: '9px' }} />)}
            </div>
          </div>
        </div>
      ))}
      <style>{`
        .skeleton-wrap { display: flex; flex-direction: column; gap: 16px; }
        .sk-card { border: 1px solid #ede9e3; border-radius: 16px; overflow: hidden; background: #fdfcfa; }
        .sk-stripe { height: 4px; background: linear-gradient(90deg, #e8e3db 25%, #f5f0ea 50%, #e8e3db 75%); background-size: 200% 100%; animation: sk-shine 1.5s infinite; }
        .sk-inner { padding: 20px 24px; }
        .sk-row { display: flex; justify-content: space-between; align-items: center; }
        .sk-block { background: #e8e3db; border-radius: 6px; animation: sk-shine 1.5s infinite; background-size: 200% 100%; background-image: linear-gradient(90deg, #e8e3db 25%, #f0ece4 50%, #e8e3db 75%); }
        .sk-img { width: 56px; height: 56px; border-radius: 10px; background-image: linear-gradient(90deg, #e8e3db 25%, #f0ece4 50%, #e8e3db 75%); background-size: 200% 100%; animation: sk-shine 1.5s infinite; }
        @keyframes sk-shine { to { background-position: -200% 0; } }
      `}</style>
    </div>
  )
}
