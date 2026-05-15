'use client'

// Uses .skeleton class from globals.css (shimmer animation already defined)
export default function CartSkeleton() {
  return (
    <div className="csk-wrap">
      {/* Ship bar */}
      <div className="csk-ship-bar" />

      {/* Steps */}
      <div className="csk-steps-bar">
        {[0,1,2].map(i => (
          <div key={i} className="csk-step-group">
            <div className="skeleton csk-circle" />
            <div className="skeleton csk-step-txt" />
            {i < 2 && <div className="csk-step-dash" />}
          </div>
        ))}
      </div>

      <div className="csk-layout">
        {/* Left */}
        <div className="csk-left">

          {/* Items card */}
          <div className="csk-card">
            <div className="csk-card-head">
              <div className="skeleton csk-head-txt" />
            </div>
            {[0,1].map(i => (
              <div key={i} className="csk-item-row">
                <div className="skeleton csk-item-img" />
                <div className="csk-item-body">
                  <div className="skeleton csk-item-name" />
                  <div className="skeleton csk-item-size" />
                  <div className="csk-badges-row">
                    <div className="skeleton csk-badge" />
                    <div className="skeleton csk-badge" />
                  </div>
                  <div className="csk-item-foot">
                    <div className="skeleton csk-qty-ctrl" />
                    <div className="skeleton csk-price-col" />
                    <div className="skeleton csk-del-btn" />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Upsell card */}
          <div className="csk-card">
            <div className="csk-card-head">
              <div className="skeleton csk-head-txt w60" />
            </div>
            <div className="csk-upsell-grid">
              {[0,1,2,3].map(i => (
                <div key={i} className="csk-upsell-item">
                  <div className="skeleton csk-upsell-img" />
                  <div className="csk-upsell-info">
                    <div className="skeleton csk-upsell-badge" />
                    <div className="skeleton csk-upsell-name" />
                    <div className="skeleton csk-upsell-price" />
                  </div>
                  <div className="skeleton csk-upsell-btn" />
                </div>
              ))}
            </div>
          </div>

          {/* Trust card */}
          <div className="csk-card csk-trust-card">
            {[0,1,2,3].map(i => (
              <div key={i} className="csk-trust-item">
                <div className="skeleton csk-trust-icon" />
                <div className="skeleton csk-trust-txt" />
              </div>
            ))}
          </div>
        </div>

        {/* Right */}
        <div className="csk-right">
          <div className="csk-card csk-summary">
            <div className="csk-pad">
              {/* Coupon */}
              <div className="csk-coupon-row">
                <div className="skeleton csk-coupon-input" />
                <div className="skeleton csk-coupon-btn" />
              </div>
              {/* Prices */}
              <div className="csk-prices">
                {[120,100,80].map((w,i) => (
                  <div key={i} className="csk-price-row">
                    <div className="skeleton" style={{ height:12, width:w, borderRadius:5 }} />
                    <div className="skeleton" style={{ height:12, width:55, borderRadius:5 }} />
                  </div>
                ))}
                <div className="csk-divider" />
                <div className="csk-price-row">
                  <div className="skeleton" style={{ height:18, width:60, borderRadius:5 }} />
                  <div className="skeleton" style={{ height:18, width:70, borderRadius:5 }} />
                </div>
              </div>
              {/* CTA */}
              <div className="skeleton csk-cta" />
            </div>
          </div>
        </div>
      </div>

      <style>{`
        .csk-wrap{max-width:1380px;margin:0 auto;background:#f5f0e8;}
        .csk-ship-bar{height:40px;background:#e8e2d8;animation:cho-sk-pulse 1.5s ease-in-out infinite;}
        .csk-steps-bar{display:flex;align-items:center;justify-content:center;
          padding:13px 16px;background:#fff;border-bottom:1px solid #e2dbd0;gap:8px;}
        .csk-step-group{display:flex;align-items:center;gap:6px;}
        .csk-circle{width:22px;height:22px;border-radius:50%;}
        .csk-step-txt{width:40px;height:12px;border-radius:5px;}
        .csk-step-dash{width:44px;height:2px;background:#e2dbd0;}
        .csk-layout{display:grid;grid-template-columns:1fr 374px;align-items:start;}
        @media(max-width:960px){.csk-layout{grid-template-columns:1fr;}}
        .csk-left{padding:24px 28px;display:flex;flex-direction:column;gap:18px;}
        @media(max-width:640px){.csk-left{padding:16px;}}
        .csk-card{background:#fff;border-radius:14px;border:1px solid #e2dbd0;
          overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.06);}
        .csk-card-head{padding:16px 20px 12px;border-bottom:1px solid #f5f0e8;}
        .csk-head-txt{height:16px;width:180px;border-radius:6px;}
        .csk-head-txt.w60{width:60%;}
        .csk-item-row{display:flex;gap:16px;padding:16px 20px;
          border-bottom:1px solid #f5f0e8;}
        .csk-item-img{width:120px;height:120px;border-radius:12px;flex-shrink:0;}
        .csk-item-body{flex:1;display:flex;flex-direction:column;gap:8px;}
        .csk-item-name{height:17px;width:70%;border-radius:6px;}
        .csk-item-size{height:11px;width:30%;border-radius:5px;}
        .csk-badges-row{display:flex;gap:6px;}
        .csk-badge{height:20px;width:72px;border-radius:20px;}
        .csk-item-foot{display:flex;align-items:center;justify-content:space-between;
          margin-top:4px;gap:10px;}
        .csk-qty-ctrl{height:36px;width:100px;border-radius:30px;}
        .csk-price-col{height:40px;width:70px;border-radius:8px;}
        .csk-del-btn{height:32px;width:80px;border-radius:8px;}
        .csk-upsell-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:14px 20px;}
        @media(max-width:540px){.csk-upsell-grid{grid-template-columns:1fr;}}
        .csk-upsell-item{display:flex;gap:10px;align-items:center;
          border:1px solid #e2dbd0;border-radius:12px;padding:10px;background:#f5f0e8;}
        .csk-upsell-img{width:50px;height:50px;border-radius:8px;flex-shrink:0;}
        .csk-upsell-info{flex:1;display:flex;flex-direction:column;gap:5px;}
        .csk-upsell-badge{height:10px;width:50px;border-radius:4px;}
        .csk-upsell-name{height:13px;width:85%;border-radius:5px;}
        .csk-upsell-price{height:13px;width:50px;border-radius:5px;}
        .csk-upsell-btn{height:32px;width:55px;border-radius:8px;flex-shrink:0;}
        .csk-trust-card{display:grid;grid-template-columns:1fr 1fr;}
        .csk-trust-item{display:flex;flex-direction:column;align-items:center;gap:8px;
          padding:20px;border-right:1px solid #f5f0e8;border-bottom:1px solid #f5f0e8;}
        .csk-trust-item:nth-child(2n){border-right:none;}
        .csk-trust-item:nth-child(3),.csk-trust-item:nth-child(4){border-bottom:none;}
        .csk-trust-icon{width:28px;height:28px;border-radius:50%;}
        .csk-trust-txt{height:12px;width:80%;border-radius:5px;}
        .csk-right{background:#fff;border-left:1px solid #e2dbd0;}
        @media(max-width:960px){.csk-right{border-left:none;border-top:1px solid #e2dbd0;}}
        .csk-summary{}
        .csk-pad{padding:18px 22px;display:flex;flex-direction:column;gap:14px;}
        .csk-coupon-row{display:flex;gap:7px;}
        .csk-coupon-input{flex:1;height:42px;border-radius:8px;}
        .csk-coupon-btn{width:72px;height:42px;border-radius:8px;}
        .csk-prices{display:flex;flex-direction:column;gap:9px;}
        .csk-price-row{display:flex;justify-content:space-between;align-items:center;}
        .csk-divider{height:1px;background:#e2dbd0;margin:4px 0;}
        .csk-cta{height:50px;border-radius:13px;background:#2d5233;opacity:.3;}
        @keyframes cho-sk-pulse{0%,100%{opacity:1}50%{opacity:.45}}
        .csk-wrap .skeleton{animation:cho-sk-pulse 1.5s ease-in-out infinite;}
      `}</style>
    </div>
  )
}
