'use client'

import { memo } from 'react'

// Issue 11 — Product storytelling: farmer story, sourcing journey, certifications
// These values can later be driven from site_settings keys like:
//   story_headline, story_body, story_farmer_region, certifications_list
// For now uses the brand story — swap strings via admin settings when ready.

interface Props {
  farmerRegion?: string  // e.g. "Uttarakhand & Himachal Pradesh"
  headline?: string
  body?: string
}

const PahadiStoryCard = memo(function PahadiStoryCard({
  farmerRegion = 'Uttarakhand & Himachal Pradesh',
  headline = 'From Himalayan Farms to Your Doorstep',
  body = 'Every product you order supports small-batch Pahadi farmers practicing traditional, chemical-free agriculture. We source directly — no middlemen, fair prices, and the freshest possible produce.',
}: Props) {
  return (
    <div className="ps-card">
      <div className="ps-header">
        <span className="ps-leaf">🌿</span>
        <div>
          <div className="ps-headline">{headline}</div>
          <div className="ps-region">📍 {farmerRegion}</div>
        </div>
      </div>

      <p className="ps-body">{body}</p>

      {/* Certifications */}
      <div className="ps-certs">
        {[
          { icon:'✅', label:'100% Natural', sub:'No pesticides' },
          { icon:'🏔', label:'Himalayan Source', sub:'High altitude farms' },
          { icon:'🤝', label:'Farmer Direct', sub:'No middlemen' },
          { icon:'🧪', label:'No Chemicals', sub:'Traditional methods' },
          { icon:'📦', label:'Small Batch', sub:'Limited, fresh stock' },
          { icon:'💚', label:'Eco Packaged', sub:'Minimal plastic' },
        ].map(c => (
          <div key={c.label} className="ps-cert">
            <span className="ps-cert-icon">{c.icon}</span>
            <div>
              <div className="ps-cert-label">{c.label}</div>
              <div className="ps-cert-sub">{c.sub}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Sourcing journey */}
      <div className="ps-journey">
        <div className="ps-journey-title">Our Sourcing Journey</div>
        <div className="ps-steps">
          {[
            { icon:'🌱', step:'Grown', desc:'High altitude farms' },
            { icon:'🧺', step:'Harvested', desc:'Traditional methods' },
            { icon:'🔍', step:'Inspected', desc:'Quality checked' },
            { icon:'📦', step:'Packed', desc:'Small batch' },
            { icon:'🚚', step:'Delivered', desc:'To your door' },
          ].map((s, i) => (
            <div key={s.step} className="ps-step-wrap">
              <div className="ps-step">
                <div className="ps-step-icon">{s.icon}</div>
                <div className="ps-step-label">{s.step}</div>
                <div className="ps-step-desc">{s.desc}</div>
              </div>
              {i < 4 && <div className="ps-step-arrow">→</div>}
            </div>
          ))}
        </div>
      </div>

      <style>{`
        .ps-card{background:linear-gradient(135deg,#1a3a1e,#2d5233);
          border-radius:14px;overflow:hidden;padding:20px;color:#fff;}
        .ps-header{display:flex;align-items:flex-start;gap:12px;margin-bottom:12px;}
        .ps-leaf{font-size:28px;flex-shrink:0;margin-top:2px;}
        .ps-headline{font-family:var(--font-playfair,'Playfair Display',serif);
          font-size:15px;font-weight:700;line-height:1.3;color:#fff;}
        .ps-region{font-size:11px;color:rgba(255,255,255,.65);margin-top:3px;}
        .ps-body{font-size:12px;color:rgba(255,255,255,.78);line-height:1.6;
          margin:0 0 16px;border-top:1px solid rgba(255,255,255,.12);padding-top:12px;}
        /* Certifications */
        .ps-certs{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:16px;}
        @media(max-width:540px){.ps-certs{grid-template-columns:1fr 1fr;}}
        .ps-cert{display:flex;align-items:center;gap:7px;
          background:rgba(255,255,255,.08);border-radius:10px;padding:8px 10px;
          border:1px solid rgba(255,255,255,.1);transition:background .2s;}
        .ps-cert:hover{background:rgba(255,255,255,.14);}
        .ps-cert-icon{font-size:18px;flex-shrink:0;}
        .ps-cert-label{font-size:11px;font-weight:700;color:#fff;line-height:1.2;}
        .ps-cert-sub{font-size:10px;color:rgba(255,255,255,.55);}
        /* Journey */
        .ps-journey{border-top:1px solid rgba(255,255,255,.12);padding-top:14px;}
        .ps-journey-title{font-size:11px;font-weight:700;color:rgba(255,255,255,.55);
          text-transform:uppercase;letter-spacing:.6px;margin-bottom:10px;}
        .ps-steps{display:flex;align-items:flex-start;gap:0;flex-wrap:nowrap;overflow-x:auto;
          scrollbar-width:none;-ms-overflow-style:none;}
        .ps-steps::-webkit-scrollbar{display:none;}
        .ps-step-wrap{display:flex;align-items:center;flex-shrink:0;}
        .ps-step{text-align:center;min-width:60px;}
        .ps-step-icon{font-size:20px;margin-bottom:4px;}
        .ps-step-label{font-size:10px;font-weight:700;color:#fff;}
        .ps-step-desc{font-size:9px;color:rgba(255,255,255,.5);margin-top:1px;}
        .ps-step-arrow{font-size:14px;color:rgba(255,255,255,.3);padding:0 4px;
          margin-top:-16px;flex-shrink:0;}
      `}</style>
    </div>
  )
})

export default PahadiStoryCard
