'use client'

export default function CheckoutSkeleton() {
  return (
    <div className="csk-root">
      {/* Shipping bar skeleton */}
      <div className="csk-topbar" />

      {/* Nav skeleton */}
      <div className="csk-nav">
        <div className="csk-nav-inner">
          <div className="csk-pill" style={{ width: 60 }} />
          <div className="csk-line-thin" style={{ width: 40 }} />
          <div className="csk-pill" style={{ width: 80 }} />
          <div className="csk-line-thin" style={{ width: 40 }} />
          <div className="csk-pill" style={{ width: 100 }} />
        </div>
      </div>

      <div className="csk-page">
        <div className="csk-grid">
          {/* Left skeleton */}
          <div className="csk-left">
            {/* Section 1 */}
            <div className="csk-card">
              <div className="csk-card-head">
                <div className="csk-circle" />
                <div>
                  <div className="csk-block" style={{ width: 160, height: 20, marginBottom: 6 }} />
                  <div className="csk-block" style={{ width: 220, height: 12 }} />
                </div>
              </div>
              <div className="csk-card-body">
                <div className="csk-block" style={{ width: 120, height: 10, marginBottom: 12 }} />
                {[1,2,3].map(i => (
                  <div key={i} className="csk-block" style={{ height: 52, marginBottom: 8, borderRadius: 12 }} />
                ))}
                <div className="csk-row" style={{ marginTop: 18 }}>
                  <div className="csk-block" style={{ flex: 1, height: 48, borderRadius: 12 }} />
                  <div className="csk-block" style={{ flex: 1, height: 48, borderRadius: 12 }} />
                </div>
                <div className="csk-block" style={{ height: 72, marginTop: 12, borderRadius: 12 }} />
                <div className="csk-row" style={{ marginTop: 12 }}>
                  <div className="csk-block" style={{ flex: 1, height: 48, borderRadius: 12 }} />
                  <div className="csk-block" style={{ flex: 1, height: 48, borderRadius: 12 }} />
                </div>
              </div>
            </div>
            {/* Section 2 */}
            <div className="csk-card">
              <div className="csk-card-head">
                <div className="csk-circle" />
                <div>
                  <div className="csk-block" style={{ width: 150, height: 20, marginBottom: 6 }} />
                  <div className="csk-block" style={{ width: 180, height: 12 }} />
                </div>
              </div>
              <div className="csk-card-body">
                <div className="csk-block" style={{ height: 60, borderRadius: 14, marginBottom: 10 }} />
                <div className="csk-block" style={{ height: 60, borderRadius: 14 }} />
              </div>
            </div>
            {/* Trust grid */}
            <div className="csk-trust-grid">
              {[1,2,3,4].map(i => (
                <div key={i} className="csk-block" style={{ height: 72, borderRadius: 14 }} />
              ))}
            </div>
          </div>

          {/* Right skeleton */}
          <div className="csk-sidebar">
            <div className="csk-card-head" style={{ padding: '20px 24px' }}>
              <div className="csk-block" style={{ width: 120, height: 18 }} />
              <div className="csk-pill" style={{ width: 60 }} />
            </div>
            <div style={{ padding: '18px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              {[1,2,3].map(i => (
                <div key={i} className="csk-row">
                  <div className="csk-block" style={{ width: 60, height: 60, borderRadius: 12, flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div className="csk-block" style={{ width: '70%', height: 14, marginBottom: 6 }} />
                    <div className="csk-block" style={{ width: '40%', height: 11 }} />
                  </div>
                  <div className="csk-block" style={{ width: 40, height: 14, flexShrink: 0 }} />
                </div>
              ))}
            </div>
            <div style={{ padding: '0 24px' }}>
              <div className="csk-block" style={{ height: 1 }} />
            </div>
            <div style={{ padding: '14px 24px' }}>
              <div className="csk-block" style={{ height: 44, borderRadius: 12 }} />
            </div>
            <div style={{ padding: '0 24px' }}>
              <div className="csk-block" style={{ height: 1, marginBottom: 16 }} />
              {[80, 60, 70, 60].map((w, i) => (
                <div key={i} className="csk-row" style={{ marginBottom: 10 }}>
                  <div className="csk-block" style={{ width: `${w}%`, height: 12 }} />
                  <div className="csk-block" style={{ width: 40, height: 12 }} />
                </div>
              ))}
              <div className="csk-row" style={{ marginTop: 16 }}>
                <div className="csk-block" style={{ width: 60, height: 16 }} />
                <div className="csk-block" style={{ width: 80, height: 28 }} />
              </div>
            </div>
            <div style={{ padding: '16px 24px' }}>
              <div className="csk-block" style={{ height: 54, borderRadius: 16 }} />
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes csk-shimmer {
          0%   { background-position: -600px 0; }
          100% { background-position:  600px 0; }
        }
        .csk-block, .csk-circle, .csk-pill {
          background: linear-gradient(90deg, #EDE8E0 25%, #F5F2EC 50%, #EDE8E0 75%);
          background-size: 600px 100%;
          animation: csk-shimmer 1.4s ease-in-out infinite;
          border-radius: 6px;
        }
        .csk-circle { width: 36px; height: 36px; border-radius: 50%; flex-shrink: 0; }
        .csk-pill   { height: 22px; border-radius: 20px; }
        .csk-line-thin { height: 1px; background: #E8E0D5; flex-shrink: 0; }

        .csk-root { min-height: 100vh; background: #F7F2EB; }
        .csk-topbar { height: 36px; background: #1C2B1E; }
        .csk-nav {
          background: #FDFAF5;
          border-bottom: 1px solid #E8E0D5;
          padding: 12px 40px;
        }
        .csk-nav-inner { display: flex; align-items: center; gap: 8px; }
        @media (max-width: 640px) { .csk-nav { padding: 12px 16px; } }

        .csk-page { padding: 0; }
        .csk-grid {
          max-width: 1440px;
          margin: 0 auto;
          display: grid;
          grid-template-columns: 1fr 420px;
          min-height: calc(100vh - 90px);
        }
        @media (max-width: 1200px) { .csk-grid { grid-template-columns: 1fr 380px; } }
        @media (max-width: 960px)  { .csk-grid { grid-template-columns: 1fr; } }

        .csk-left {
          padding: 40px 48px 60px;
          display: flex;
          flex-direction: column;
          gap: 28px;
        }
        @media (max-width: 640px) { .csk-left { padding: 20px 16px 40px; } }

        .csk-card {
          background: #fff;
          border-radius: 20px;
          overflow: hidden;
          border: 1px solid rgba(220,210,195,.6);
        }
        .csk-card-head {
          display: flex;
          align-items: center;
          gap: 16px;
          padding: 24px 28px 20px;
          border-bottom: 1px solid #F2EDE5;
          background: #FEFCF9;
        }
        .csk-card-body {
          padding: 20px 28px 24px;
        }
        .csk-row { display: flex; align-items: center; gap: 12px; }

        .csk-trust-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }

        .csk-sidebar {
          background: #fff;
          border-left: 1px solid #E8E0D5;
        }
      `}</style>
    </div>
  )
}
