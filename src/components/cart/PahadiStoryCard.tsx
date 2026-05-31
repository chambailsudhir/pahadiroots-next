'use client'

import { memo } from 'react'

// Issue 11 — Product storytelling: farmer story, sourcing journey, certifications
// These values can later be driven from site_settings keys like:
//   story_headline, story_body, certifications_list
// For now uses the brand story — swap strings via admin settings when ready.

// Static arrays outside component — not recreated on every render
const CERTS = [
  { icon:'✅', label:'100% Natural',      sub:'No pesticides'       },
  { icon:'🏔', label:'Himalayan Source',  sub:'High altitude farms' },
  { icon:'🤝', label:'Farmer Direct',     sub:'No middlemen'        },
  { icon:'🧪', label:'No Chemicals',      sub:'Traditional methods' },
  { icon:'📦', label:'Small Batch',       sub:'Limited, fresh stock'},
  { icon:'💚', label:'Eco Packaged',      sub:'Minimal plastic'     },
] as const

const STEPS = [
  { icon:'🌱', step:'Grown',     desc:'High altitude farms'  },
  { icon:'🧺', step:'Harvested', desc:'Traditional methods'  },
  { icon:'🔍', step:'Inspected', desc:'Quality checked'      },
  { icon:'📦', step:'Packed',    desc:'Small batch'          },
  { icon:'🚚', step:'Delivered', desc:'To your door'         },
] as const

interface Props {
  headline?: string
  body?: string
}

const PahadiStoryCard = memo(function PahadiStoryCard({
  headline = 'From Himalayan Farms to Your Doorstep',
  body = 'Every product you order supports small-batch Pahadi farmers practicing traditional, chemical-free agriculture. We source directly — no middlemen, fair prices, and the freshest possible produce.',
}: Props) {
  return (
    <div className="ps-card">
      <div className="ps-header">
        <span className="ps-leaf">🌿</span>
        <div className="ps-headline">{headline}</div>
      </div>

      <p className="ps-body">{body}</p>

      {/* Certifications */}
      <div className="ps-certs">
        {CERTS.map(c => (
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
          {STEPS.map((s, i) => (
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
        .ps-card{
          background:linear-gradient(160deg,#1a3a1e 0%,#2d5233 60%,#1e4a24 100%);
          border-radius:16px;overflow:hidden;padding:22px;color:#fff;
          box-shadow:0 8px 32px rgba(26,58,30,.3),inset 0 1px 0 rgba(255,255,255,.07);
          position:relative;
        }
        /* Subtle top gold shimmer */
        .ps-card::before{
          content:'';position:absolute;top:0;left:0;right:0;height:2px;
          background:linear-gradient(90deg,transparent 5%,#c9a240 40%,#e8c060 60%,transparent 95%);
          opacity:.7;
        }
        .ps-header{display:flex;align-items:center;gap:13px;margin-bottom:14px;}
        .ps-leaf{font-size:30px;flex-shrink:0;filter:drop-shadow(0 2px 6px rgba(0,0,0,.3));}
        .ps-headline{
          font-family:var(--font-playfair,'Playfair Display',serif);
          font-size:16px;font-weight:700;line-height:1.35;color:#fff;letter-spacing:.1px;
        }
        .ps-body{
          font-size:12.5px;color:rgba(255,255,255,.72);line-height:1.7;
          margin:0 0 18px;border-top:1px solid rgba(255,255,255,.1);padding-top:14px;
        }
        .ps-certs{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:18px;}
        @media(max-width:540px){.ps-certs{grid-template-columns:1fr 1fr;}}
        .ps-cert{
          display:flex;align-items:center;gap:8px;
          background:rgba(255,255,255,.07);border-radius:11px;padding:9px 11px;
          border:1px solid rgba(255,255,255,.1);transition:background .2s;
          backdrop-filter:blur(4px);
        }
        .ps-cert:hover{background:rgba(255,255,255,.14);}
        .ps-cert-icon{font-size:18px;flex-shrink:0;}
        .ps-cert-label{font-size:11px;font-weight:700;color:#fff;line-height:1.2;}
        .ps-cert-sub{font-size:9.5px;color:rgba(255,255,255,.5);margin-top:1px;}
        .ps-journey{border-top:1px solid rgba(255,255,255,.1);padding-top:15px;}
        .ps-journey-title{
          font-size:10px;font-weight:800;color:rgba(201,162,64,.85);
          text-transform:uppercase;letter-spacing:.8px;margin-bottom:12px;
        }
        .ps-steps{
          display:flex;align-items:flex-start;flex-wrap:nowrap;overflow-x:auto;
          scrollbar-width:none;-ms-overflow-style:none;gap:0;
        }
        .ps-steps::-webkit-scrollbar{display:none;}
        .ps-step-wrap{display:flex;align-items:center;flex-shrink:0;}
        .ps-step{text-align:center;min-width:64px;}
        .ps-step-icon{
          font-size:20px;margin-bottom:5px;
          filter:drop-shadow(0 2px 4px rgba(0,0,0,.25));
        }
        .ps-step-label{font-size:10.5px;font-weight:700;color:#fff;letter-spacing:.1px;}
        .ps-step-desc{font-size:9px;color:rgba(255,255,255,.45);margin-top:2px;}
        .ps-step-arrow{
          font-size:13px;color:rgba(201,162,64,.5);
          padding:0 4px;margin-top:-18px;flex-shrink:0;
        }
      `}</style>
    </div>
  )
})

export default PahadiStoryCard
