'use client'

export default function CheckoutSkeleton() {
  return (
    <div className="cho-sk-wrap">
      {/* Steps skeleton */}
      <div className="cho-sk-steps">
        {[80,80,80].map((w,i) => (
          <div key={i} className="cho-sk-step-group">
            <div className="cho-sk-circle" />
            <div className="cho-sk-line" style={{ width: w }} />
            {i < 2 && <div className="cho-sk-dash" />}
          </div>
        ))}
      </div>

      <div className="cho-sk-layout">
        {/* Left — address + payment */}
        <div className="cho-sk-left">

          {/* Address card */}
          <div className="cho-sk-card">
            <div className="cho-sk-card-head">
              <div className="cho-sk-circle sm" />
              <div className="cho-sk-line" style={{ width: 140 }} />
            </div>
            {/* Saved addresses */}
            <div className="cho-sk-pad">
              {[1,2].map(i => (
                <div key={i} className="cho-sk-addr-row">
                  <div className="cho-sk-circle sm" />
                  <div style={{ flex:1 }}>
                    <div className="cho-sk-line" style={{ width: 80, marginBottom: 5 }} />
                    <div className="cho-sk-line" style={{ width: '70%', height: 10 }} />
                  </div>
                </div>
              ))}
            </div>
            {/* Label buttons */}
            <div className="cho-sk-pad cho-sk-labels">
              {[60,52,68,60,52].map((w,i) => (
                <div key={i} className="cho-sk-label-btn" style={{ width: w }} />
              ))}
            </div>
            {/* Form fields */}
            <div className="cho-sk-pad">
              <div className="cho-sk-form-row">
                <div className="cho-sk-field">
                  <div className="cho-sk-line short" />
                  <div className="cho-sk-input" />
                </div>
                <div className="cho-sk-field">
                  <div className="cho-sk-line short" />
                  <div className="cho-sk-input" />
                </div>
              </div>
              <div className="cho-sk-field">
                <div className="cho-sk-line short" />
                <div className="cho-sk-input tall" />
              </div>
              <div className="cho-sk-field">
                <div className="cho-sk-line short" />
                <div className="cho-sk-input" />
              </div>
              <div className="cho-sk-form-row">
                {[0,1].map(i => (
                  <div key={i} className="cho-sk-field">
                    <div className="cho-sk-line short" />
                    <div className="cho-sk-input" />
                  </div>
                ))}
              </div>
              <div className="cho-sk-form-row">
                {[0,1].map(i => (
                  <div key={i} className="cho-sk-field">
                    <div className="cho-sk-line short" />
                    <div className="cho-sk-input" />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Payment card */}
          <div className="cho-sk-card">
            <div className="cho-sk-card-head">
              <div className="cho-sk-circle sm" />
              <div className="cho-sk-line" style={{ width: 130 }} />
            </div>
            <div className="cho-sk-pad">
              {[1,2].map(i => (
                <div key={i} className="cho-sk-pay-opt">
                  <div className="cho-sk-circle sm" />
                  <div style={{ flex:1 }}>
                    <div className="cho-sk-line" style={{ width: 140, marginBottom: 8 }} />
                    <div className="cho-sk-logos-row">
                      {[40,44,60,44,52].map((w,j) => (
                        <div key={j} className="cho-sk-logo-chip" style={{ width: w }} />
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Promise card */}
          <div className="cho-sk-card">
            <div className="cho-sk-promise-grid">
              {[0,1,2,3].map(i => (
                <div key={i} className="cho-sk-promise-item">
                  <div className="cho-sk-line" style={{ width: '80%', marginBottom: 4 }} />
                  <div className="cho-sk-line" style={{ width: '50%', height: 10 }} />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right — order summary */}
        <div className="cho-sk-right">
          <div className="cho-sk-card">
            {/* Items */}
            <div className="cho-sk-pad">
              {[0,1].map(i => (
                <div key={i} className="cho-sk-sum-item">
                  <div className="cho-sk-thumb" />
                  <div style={{ flex:1 }}>
                    <div className="cho-sk-line" style={{ width: '70%', marginBottom: 5 }} />
                    <div className="cho-sk-line" style={{ width: '40%', height: 10 }} />
                  </div>
                  <div className="cho-sk-line" style={{ width: 40 }} />
                </div>
              ))}
            </div>
            {/* Coupon */}
            <div className="cho-sk-pad">
              <div className="cho-sk-coupon-row">
                <div className="cho-sk-input" style={{ flex:1 }} />
                <div className="cho-sk-btn" />
              </div>
            </div>
            {/* Prices */}
            <div className="cho-sk-pad">
              {[0,1,2].map(i => (
                <div key={i} className="cho-sk-price-row">
                  <div className="cho-sk-line" style={{ width: 80 + i*20 }} />
                  <div className="cho-sk-line" style={{ width: 50 }} />
                </div>
              ))}
              <div className="cho-sk-divider" />
              <div className="cho-sk-price-row total">
                <div className="cho-sk-line" style={{ width: 50, height: 20 }} />
                <div className="cho-sk-line" style={{ width: 70, height: 20 }} />
              </div>
            </div>
            {/* CTA */}
            <div className="cho-sk-pad">
              <div className="cho-sk-cta-btn" />
              <div className="cho-sk-line" style={{ width: '60%', margin: '10px auto 0', height: 10 }} />
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes cho-sk-pulse {
          0%,100%{opacity:1}50%{opacity:.45}
        }
        .cho-sk-wrap{max-width:1380px;margin:0 auto;background:#f5f0e8;min-height:80vh;}
        .cho-sk-wrap *{animation:cho-sk-pulse 1.5s ease-in-out infinite;}
        .cho-sk-steps{display:flex;align-items:center;justify-content:center;padding:13px 16px;background:#fff;border-bottom:1px solid #e2dbd0;gap:8px;}
        .cho-sk-step-group{display:flex;align-items:center;gap:6px;}
        .cho-sk-circle{width:22px;height:22px;border-radius:50%;background:#e8e2d8;flex-shrink:0;}
        .cho-sk-circle.sm{width:22px;height:22px;}
        .cho-sk-line{height:13px;background:#e8e2d8;border-radius:6px;}
        .cho-sk-line.short{width:80px;height:10px;margin-bottom:5px;}
        .cho-sk-dash{width:44px;height:2px;background:#e8e2d8;}
        .cho-sk-layout{display:grid;grid-template-columns:1fr 390px;align-items:start;}
        @media(max-width:960px){.cho-sk-layout{grid-template-columns:1fr;}}
        .cho-sk-left{padding:24px 28px;display:flex;flex-direction:column;gap:18px;}
        .cho-sk-right{background:#fff;border-left:1px solid #e2dbd0;padding:0;}
        @media(max-width:960px){.cho-sk-right{border-left:none;border-top:1px solid #e2dbd0;}}
        .cho-sk-card{background:#fff;border-radius:14px;box-shadow:0 2px 8px rgba(0,0,0,.06);border:1px solid #e2dbd0;overflow:hidden;}
        .cho-sk-card-head{display:flex;align-items:center;gap:12px;padding:16px 20px;border-bottom:1px solid #f5f0e8;}
        .cho-sk-pad{padding:14px 20px;display:flex;flex-direction:column;gap:10px;}
        .cho-sk-addr-row{display:flex;align-items:flex-start;gap:10px;padding:10px 14px;border:1.5px solid #e8e2d8;border-radius:11px;background:#fafaf8;}
        .cho-sk-labels{flex-direction:row;flex-wrap:wrap;}
        .cho-sk-label-btn{height:30px;background:#e8e2d8;border-radius:20px;flex-shrink:0;}
        .cho-sk-form-row{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
        @media(max-width:580px){.cho-sk-form-row{grid-template-columns:1fr;}}
        .cho-sk-field{display:flex;flex-direction:column;gap:5px;}
        .cho-sk-input{height:44px;background:#f5f0e8;border-radius:10px;border:1.5px solid #e2dbd0;}
        .cho-sk-input.tall{height:66px;}
        .cho-sk-pay-opt{display:flex;align-items:flex-start;gap:12px;padding:13px 15px;border:1.5px solid #e2dbd0;border-radius:12px;background:#fafaf8;}
        .cho-sk-logos-row{display:flex;gap:5px;flex-wrap:wrap;}
        .cho-sk-logo-chip{height:22px;background:#e8e2d8;border-radius:5px;}
        .cho-sk-promise-grid{display:grid;grid-template-columns:1fr 1fr;}
        .cho-sk-promise-item{padding:14px 18px;border-right:1px solid #f5f0e8;border-bottom:1px solid #f5f0e8;display:flex;flex-direction:column;gap:5px;}
        .cho-sk-promise-item:nth-child(2n){border-right:none;}
        .cho-sk-promise-item:nth-child(3),.cho-sk-promise-item:nth-child(4){border-bottom:none;}
        .cho-sk-sum-item{display:flex;align-items:center;gap:9px;}
        .cho-sk-thumb{width:50px;height:50px;border-radius:8px;background:#e8e2d8;flex-shrink:0;}
        .cho-sk-coupon-row{display:flex;gap:7px;}
        .cho-sk-btn{width:72px;height:42px;background:#e8e2d8;border-radius:8px;flex-shrink:0;}
        .cho-sk-price-row{display:flex;justify-content:space-between;align-items:center;}
        .cho-sk-price-row.total .cho-sk-line{background:#c8bfb2;}
        .cho-sk-divider{height:1px;background:#e2dbd0;margin:4px 0;}
        .cho-sk-cta-btn{height:50px;background:#2d5233;border-radius:13px;opacity:.35;}
      `}</style>
    </div>
  )
}
