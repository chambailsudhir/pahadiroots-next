import Link from 'next/link'
import Image from 'next/image'
import type { SiteSettings } from '@/types'
import {
  GOLD, CREAM, COMPANY, PRODUCTS, getFooterData,
  ProductIcon, ContactIcon, SocialRow, FssaiCard, LeafMark, Botanical, TrustIcon,
} from './FooterShared'

/**
 * Footer B — "Mountain Edge".
 *
 * Built 1:1 from the supplied design (2167px reference width). Dimensions are
 * the pixel values measured on that design, converted to container-query
 * units (`u()`), so the layout scales proportionally with the viewport.
 * Text sizes have a readable floor (`uf()`), and below 1000px the footer
 * switches to a stacked layout.
 *
 * Assets (public/): footer-mountain-edge.jpg — the exact torn-edge mountain
 * photo from the design.
 */
const REF = 2167
const u = (n: number) => `${+(n / (REF / 100)).toFixed(3)}cqw`
const uf = (n: number, min: number) => `max(${min}px,${u(n)})`
const BG = '#042211'

interface Props { settings: SiteSettings }

export default function FooterB({ settings }: Props) {
  const d = getFooterData(settings)
  const company = COMPANY.filter(([label]) => label !== 'Our Story' || d.showOurStory)
  const addrParts = d.address.split(/,\s*(?=Distt)/)

  return (
    <footer className="hvb" data-footer="B">
      <div className="hvb-edge">
        <Image src="/footer-mountain-edge.jpg" alt="" width={2167} height={248} sizes="100vw" style={{ width: '100%', height: 'auto', display: 'block' }} />
      </div>

      <Botanical side="right" className="hvb-bot hvb-bot-r" />
      <Botanical side="left" className="hvb-bot hvb-bot-l" />

      <div className="hvb-in">
        <LeafMark className="hvb-leaf" />

        <div className="hvb-cols">
          <div className="hvb-col hvb-brand">
            <div className="hvb-tt">
              <h2 className="hvb-title">HimVeda by Pahadi Roots</h2>
              <div className="hvb-tag"><i /><span>HIMALAYAN NATURAL STORE</span><i /></div>
            </div>
            <p className="hvb-lead">Born in the mountains, delivered to your doorstep. Pure Himalayan natural products, sourced with love from farming communities across 10 Himalayan states.</p>
          </div>

          <div className="hvb-col hvb-c1">
            <div className="hvb-h">Quick Selects</div>
            <ul>
              {PRODUCTS.map(([icon, label, href]) => (
                <li key={label}><Link href={href} className="hvb-link hvb-prod"><ProductIcon kind={icon} /><span>{label}</span></Link></li>
              ))}
            </ul>
          </div>

          <div className="hvb-col hvb-c2">
            <div className="hvb-h">Company</div>
            <ul>
              {company.map(([label, href]) => (
                <li key={label}><Link href={href} className="hvb-link hvb-co"><span>{label}</span><b aria-hidden="true">›</b></Link></li>
              ))}
            </ul>
          </div>

          <div className="hvb-col hvb-c3">
            <div className="hvb-h">Connect With Us</div>
            <a className="hvb-link hvb-ct" href="https://www.pahadiroots.com"><ContactIcon kind="globe" bg={BG} /><span>pahadiroots.com</span></a>
            <a className="hvb-link hvb-ct" href={`mailto:${d.email}`}><ContactIcon kind="mail" bg={BG} /><span>{d.email}</span></a>
            <a className="hvb-link hvb-ct" href={`tel:${d.phone.replace(/\s/g, '')}`}><ContactIcon kind="phone" bg={BG} /><span>{d.phone}</span></a>
            <div className="hvb-ct hvb-addr"><ContactIcon kind="pin" bg={BG} /><span>{addrParts.map((p, i) => <span key={i}>{i > 0 && <br />}{i < addrParts.length - 1 ? p + ',' : p}</span>)}</span></div>
          </div>
        </div>

        <div className="hvb-rule" />

        <div className="hvb-bottom">
          <div className="hvb-socials"><SocialRow d={d} /></div>
          {d.fssai && <FssaiCard license={d.fssai} />}
          <div className="hvb-trust">
            <div><TrustIcon kind="leaf" /><span>Pure &amp; Natural</span></div>
            <div><TrustIcon kind="mountain" /><span className="w1">Sourced from Himalayan Regions</span></div>
            <div><TrustIcon kind="hand" /><span className="w2">Supports Local Communities</span></div>
            <div><TrustIcon kind="sprout" /><span>Sustainable &amp; Ethical</span></div>
          </div>
        </div>

        <div className="hvb-copy">© {new Date().getFullYear()} <strong>HimVeda by Pahadi Roots</strong> · Himachal Pradesh, India</div>
      </div>

      <style>{`
.hvb{background:${BG};color:${CREAM};font-family:var(--font-lato),Lato,sans-serif;position:relative;overflow:hidden}
.hvb *{box-sizing:border-box}
.hvb ul{list-style:none;margin:0;padding:0}
.hvb a{text-decoration:none;color:inherit}
.hvb-edge{position:relative;line-height:0;background:${BG}}
.hvb-edge::after{content:'';position:absolute;left:0;right:0;bottom:0;height:12px;background:linear-gradient(to bottom,transparent,${BG})}
.hvb-in{max-width:2300px;margin:0 auto;container-type:inline-size;position:relative;padding-bottom:${u(33)}}
.hvb-bot{position:absolute;opacity:.14;pointer-events:none;width:min(8.6vw,190px)}
.hvb-bot-r{right:0;bottom:0}
.hvb-bot-l{left:0;bottom:${u(40)}}

.hvb-leaf{position:absolute;left:${u(225)};top:${u(-40)};width:${u(60)};height:${u(49)};z-index:2}
.hvb-cols{display:grid;grid-template-columns:${u(580)} ${u(337)} ${u(410)} 1fr;padding:${u(12)} 0 0 ${u(96)};position:relative;z-index:1}
.hvb-col{position:relative;min-width:0}

.hvb-tt{width:fit-content}
.hvb-title{font-family:var(--font-playfair),Georgia,serif;font-weight:700;font-size:${u(41.5)};line-height:1.2;margin:0;color:#fff;white-space:nowrap;width:fit-content;letter-spacing:-.01em}
.hvb-tag{display:flex;align-items:center;gap:${u(12)};margin-top:${u(14)};width:100%;color:${GOLD};font-weight:700;font-size:${u(17)};letter-spacing:${u(4)};line-height:1.2}
.hvb-tag i{flex:1;height:1px;background:${GOLD}}
.hvb-tag span{white-space:nowrap}
.hvb-lead{margin:${u(21)} 0 0;width:${u(505)};font-size:${uf(20.5, 14.5)};line-height:1.55;color:#eee8d7}

.hvb-c1,.hvb-c2,.hvb-c3{padding-top:${u(10)}}
.hvb-c1{padding-right:${u(32)}}
.hvb-c2{padding-left:${u(62)};padding-right:${u(38)}}
.hvb-c3{padding-left:${u(50)};padding-right:${u(220)}}
.hvb-c2::before,.hvb-c3::before{content:'';position:absolute;left:0;top:${u(40)};bottom:0;width:1px;background:rgba(215,166,58,.4)}
.hvb-h{color:${GOLD};text-transform:uppercase;font-weight:800;font-size:${uf(18.5, 12)};letter-spacing:${u(3.6)};line-height:1.2;padding-bottom:${u(10)};margin-bottom:${u(23)};border-bottom:1px solid rgba(215,166,58,.4)}
.hvb-link{color:#ece6d6;font-size:${uf(20, 14.5)};transition:color .2s}
.hvb-link:hover{color:#fff}
.hvb-prod{display:flex;align-items:center;gap:${u(26)};height:${u(28)};margin-bottom:${u(10.8)};padding-left:${u(5)}}
.hvb-co{display:flex;align-items:center;justify-content:space-between;height:${u(28)};margin-bottom:${u(10.8)}}
.hvb-co b{font-weight:400;font-size:${uf(24, 18)};color:${CREAM};line-height:1}
.hvb-ct{display:flex;align-items:center;gap:${u(30)};margin-bottom:${u(16)};min-height:${u(32)}}
.hvb-ct:last-child{margin-bottom:0}
.hvb-addr{color:#ece6d6;font-size:${uf(20, 14.5)};line-height:${u(26)}}
.hv-ico{width:${u(30)};height:${u(30)};min-width:20px;min-height:20px;flex:none}

.hvb-rule{margin:${u(23)} ${u(226)} 0 ${u(96)};border-top:1px solid rgba(215,166,58,.45);position:relative;z-index:1}
.hvb-bottom{display:flex;align-items:flex-start;padding:${u(8)} 0 0 ${u(96)};position:relative;z-index:1}
.hvb-socials{display:flex;gap:${u(27)}}
.hv-soc{width:${u(60)};height:${u(60)};min-width:34px;min-height:34px;border-radius:50%;border:1.5px solid ${GOLD};display:inline-flex;align-items:center;justify-content:center;transition:background .2s}
.hv-soc svg{width:${u(30)};height:${u(30)};min-width:18px;min-height:18px}
.hv-soc:hover{background:rgba(215,166,58,.18)}
.hv-fssai{display:flex;align-items:center;background:#fff;border-radius:${u(9)};width:${u(342)};height:${u(78)};min-width:236px;padding:0 ${u(16)};gap:${u(18)};margin:${u(4)} 0 0 ${u(86)};color:#14301e;flex:none}
.hv-fssai img{width:${u(90)}!important;min-width:54px;flex:none;height:auto!important}
.hv-fssai-txt{border-left:1px solid #d9d9d9;padding-left:${u(16)};display:flex;flex-direction:column;gap:${u(3)}}
.hv-fssai-txt strong{font-size:${uf(18.5, 13)};line-height:1.2}
.hv-fssai-txt span{font-size:${uf(16, 11)};color:#52645a;line-height:1.2}
.hvb-trust{display:flex;align-items:center;gap:${u(50)};margin:${u(12)} ${u(229)} 0 auto}
.hvb-trust>div{display:flex;align-items:center;gap:${u(18)}}
.hvb-trust span{font-size:${uf(17, 13)};color:#ece6d6;line-height:1.35}
.hvb-trust .w1{max-width:${u(150)}}
.hvb-trust .w2{max-width:${u(120)}}
.hv-trust-ico{width:${u(40)};height:${u(40)};min-width:26px;min-height:26px;flex:none}
.hvb-copy{padding:${u(10)} 0 0 ${u(96)};font-size:${uf(17, 12.5)};color:rgba(241,235,219,.62);position:relative;z-index:1}
.hvb-copy strong{color:${CREAM}}

/* stacked layout */
@media(max-width:1000px){
  .hvb-in{container-type:normal;padding-bottom:30px}
  .hvb-leaf{position:relative;left:70px;top:-6px;width:44px;height:auto;display:block}
  .hvb-cols{grid-template-columns:1fr 1fr;padding:6px 24px 0;gap:30px 28px}
  .hvb-brand{grid-column:1/-1}
  .hvb-title{font-size:30px;white-space:normal}
  .hvb-tag{font-size:11.5px;letter-spacing:3px;gap:10px;margin-top:12px}
  .hvb-lead{width:auto;font-size:15.5px;line-height:1.65;margin-top:16px}
  .hvb-c1,.hvb-c2,.hvb-c3{padding:0}
  .hvb-c3{grid-column:1/-1}
  .hvb-c2::before,.hvb-c3::before{display:none}
  .hvb-h{font-size:12.5px;letter-spacing:3px;padding-bottom:10px;margin-bottom:16px}
  .hvb-link,.hvb-addr{font-size:15.5px}
  .hvb-prod{gap:14px;height:auto;margin-bottom:14px;padding:0}
  .hvb-co{height:auto;margin-bottom:14px}.hvb-co b{font-size:20px}
  .hvb-ct{gap:14px;margin-bottom:16px}.hvb-addr{line-height:1.5}
  .hv-ico{width:26px;height:26px}
  .hvb-rule{margin:28px 24px 0}
  .hvb-bottom{flex-wrap:wrap;gap:20px;padding:24px 24px 0}
  .hvb-socials{gap:12px;width:100%}.hv-soc{width:46px;height:46px}.hv-soc svg{width:22px;height:22px}
  .hv-fssai{margin:0;width:auto;height:68px;gap:12px;padding:0 16px;border-radius:8px}
  .hv-fssai img{width:62px!important}.hv-fssai-txt{padding-left:12px}.hv-fssai-txt strong{font-size:14px}.hv-fssai-txt span{font-size:12px}
  .hvb-trust{margin:0;width:100%;display:grid;grid-template-columns:1fr 1fr;gap:16px 18px}
  .hvb-trust>div{gap:12px}.hvb-trust span{font-size:13.5px}.hvb-trust .w1,.hvb-trust .w2{max-width:none}
  .hv-trust-ico{width:30px;height:30px}
  .hvb-copy{padding:22px 24px 0;font-size:13px}
  .hvb-bot{display:none}
}
@media(max-width:520px){.hvb-cols{grid-template-columns:1fr}.hvb-trust{grid-template-columns:1fr}}
`}</style>
    </footer>
  )
}
