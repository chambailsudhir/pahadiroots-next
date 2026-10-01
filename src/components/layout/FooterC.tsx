import Link from 'next/link'
import type { SiteSettings } from '@/types'
import {
  GOLD, CREAM, COMPANY, PRODUCTS, getFooterData,
  ProductIcon, ContactIcon, SocialRow, FssaiCard, LeafMark, Botanical, Sprig,
} from './FooterShared'

/**
 * Footer C — "Himalayan Landscape".
 *
 * Built 1:1 from the supplied design (1672px reference width). Every
 * dimension below is the pixel value measured on that design, converted to
 * container-query units (`u()`), so the footer scales proportionally with the
 * viewport exactly like the artwork. Below 820px it switches to a stacked
 * mobile layout.
 *
 * Assets (public/): footer-landscape.jpg (hero photo, text removed so the
 * live text overlays it), footer-botanical-br.jpg (bottom-right line art).
 */
const REF = 1672
const u = (n: number) => `${+(n / (REF / 100)).toFixed(3)}cqw`
const BG = '#072314'

interface Props { settings: SiteSettings }

export default function FooterC({ settings }: Props) {
  const d = getFooterData(settings)
  const company = COMPANY.filter(([label]) => label !== 'Our Story' || d.showOurStory)
  // Default address wraps after "PO Sakoh," exactly like the design.
  const addrParts = d.address.split(/,\s*(?=Distt)/)

  return (
    <footer className="hvc" data-footer="C">
      <section className="hvc-hero">
        <div className="hvc-in hvc-hero-in">
          <LeafMark className="hvc-leaf" />
          <div className="hvc-brand">
            <div className="hvc-tt">
              <h2 className="hvc-title">HimVeda by Pahadi Roots</h2>
              <div className="hvc-tag"><i /><span>HIMALAYAN NATURAL STORE</span><i /></div>
            </div>
            <p className="hvc-lead">Born in the mountains, delivered to your doorstep. Pure Himalayan natural products, sourced with love from farming communities across 10 Himalayan states.</p>
          </div>
        </div>
      </section>

      <div className="hvc-body">
        <Botanical side="right" className="hvc-bot hvc-bot-r" />
        <Botanical side="left" className="hvc-bot hvc-bot-l" />
        <div className="hvc-art" aria-hidden="true" />

        <div className="hvc-in hvc-main">
          <div className="hvc-cols">
            <div className="hvc-col hvc-c1">
              <div className="hvc-h">Quick Selects</div>
              <ul>
                {PRODUCTS.map(([icon, label, href]) => (
                  <li key={label}><Link href={href} className="hvc-link hvc-prod"><ProductIcon kind={icon} /><span>{label}</span></Link></li>
                ))}
              </ul>
            </div>

            <div className="hvc-col hvc-c2">
              <div className="hvc-h">Company</div>
              <ul>
                {company.map(([label, href]) => (
                  <li key={label}><Link href={href} className="hvc-link hvc-co"><span>{label}</span><b aria-hidden="true">›</b></Link></li>
                ))}
              </ul>
            </div>

            <div className="hvc-col hvc-c3">
              <div className="hvc-h">Connect With Us</div>
              <a className="hvc-link hvc-ct" href="https://www.pahadiroots.com"><ContactIcon kind="globe" bg={BG} /><span>pahadiroots.com</span></a>
              <a className="hvc-link hvc-ct" href={`mailto:${d.email}`}><ContactIcon kind="mail" bg={BG} /><span>{d.email}</span></a>
              <a className="hvc-link hvc-ct" href={`tel:${d.phone.replace(/\s/g, '')}`}><ContactIcon kind="phone" bg={BG} /><span>{d.phone}</span></a>
              <div className="hvc-ct hvc-addr"><ContactIcon kind="pin" bg={BG} /><span>{addrParts.map((p, i) => <span key={i}>{i > 0 && <br />}{i < addrParts.length - 1 ? p + ',' : p}</span>)}</span></div>
            </div>
          </div>

          <div className="hvc-rule"><Sprig /></div>

          <div className="hvc-bottom">
            <div className="hvc-socials"><SocialRow d={d} /></div>
            {d.fssai && <><span className="hvc-vr" /><FssaiCard license={d.fssai} /></>}
          </div>

          <div className="hvc-copy">© {new Date().getFullYear()} <strong>HimVeda by Pahadi Roots</strong> · Himachal Pradesh, India</div>
        </div>
      </div>

      <style>{`
.hvc{background:${BG};color:${CREAM};font-family:var(--font-lato),Lato,sans-serif;position:relative;overflow:hidden}
.hvc *{box-sizing:border-box}
.hvc ul{list-style:none;margin:0;padding:0}
.hvc a{text-decoration:none;color:inherit}
.hvc-in{max-width:1920px;margin:0 auto;container-type:inline-size;position:relative}

/* hero */
.hvc-hero{height:min(21.84vw,419px);background:${BG} url(/footer-landscape.jpg) center bottom/cover no-repeat}
.hvc-hero-in{height:100%}
.hvc-leaf{position:absolute;left:${u(250)};top:${u(85)};width:${u(66)};height:${u(52)}}
.hvc-brand{position:absolute;left:${u(165)};top:${u(134)}}
.hvc-tt{width:fit-content}
.hvc-title{font-family:var(--font-playfair),Georgia,serif;font-weight:700;font-size:${u(44)};line-height:1.2;margin:0;color:#fff;white-space:nowrap;width:fit-content;letter-spacing:-.01em}
.hvc-tag{width:100%;display:flex;align-items:center;gap:${u(12)};margin-top:${u(10)};color:${GOLD};font-weight:700;font-size:${u(15)};letter-spacing:${u(5)};line-height:1.2}
.hvc-tag i{flex:1;height:1px;background:${GOLD};min-width:${u(20)}}
.hvc-tag span{white-space:nowrap}
.hvc-lead{margin:${u(18)} 0 0;width:${u(625)};font-size:${u(20.5)};line-height:${u(29)};color:#eee8d7}

/* body */
.hvc-body{position:relative;background:${BG}}
.hvc-main{padding-bottom:${u(45)}}
.hvc-art{position:absolute;right:0;bottom:0;width:min(40.2vw,772px);height:min(11.72vw,225px);background:url(/footer-botanical-br.jpg) right bottom/100% 100% no-repeat;opacity:.9;pointer-events:none;
  -webkit-mask-image:linear-gradient(to right,transparent 0,#000 38%),linear-gradient(to bottom,transparent 0,#000 40%);-webkit-mask-composite:source-in;
  mask-image:linear-gradient(to right,transparent 0,#000 38%),linear-gradient(to bottom,transparent 0,#000 40%);mask-composite:intersect}
.hvc-bot{position:absolute;opacity:.16;pointer-events:none;width:min(8.6vw,165px)}
.hvc-bot-r{right:0;top:${u(250)}}
.hvc-bot-l{left:0;top:${u(150)}}

.hvc-cols{display:grid;grid-template-columns:418fr 492fr 597fr;padding:${u(47)} 0 0 ${u(165)};position:relative;z-index:1}
.hvc-col{position:relative}
.hvc-c1{padding-right:${u(56)}}
.hvc-c2,.hvc-c3{border-left:1px solid rgba(215,166,58,.38)}
.hvc-c2{padding-left:${u(75)};padding-right:${u(58)}}
.hvc-c3{padding-left:${u(61)};padding-right:${u(120)}}
.hvc-h{color:${GOLD};text-transform:uppercase;font-weight:800;font-size:${u(18.5)};letter-spacing:${u(4)};line-height:1.2;padding-bottom:${u(7)};margin-bottom:${u(26)};border-bottom:1px solid rgba(215,166,58,.38)}
.hvc-link{color:#ece6d6;font-size:${u(21.5)};transition:color .2s}
.hvc-link:hover{color:#fff}
.hvc-prod{display:flex;align-items:center;gap:${u(31)};height:${u(30)};margin-bottom:${u(14)};padding-left:${u(3)}}
.hvc-co{display:flex;align-items:center;justify-content:space-between;height:${u(28)};margin-bottom:${u(14.5)}}
.hvc-co b{font-weight:400;font-size:${u(26)};color:${CREAM};line-height:1}
.hvc-ct{display:flex;align-items:center;gap:${u(28)};margin-bottom:${u(24)};min-height:${u(32)}}
.hvc-ct:last-child{margin-bottom:0}
.hvc-addr{line-height:${u(28)};color:#ece6d6;font-size:${u(21.5)}}
.hv-ico{width:${u(31)};height:${u(31)};flex:none}
.hvc-ct .hv-ico{width:${u(32)};height:${u(32)}}

.hvc-rule{position:relative;margin:${u(39)} ${u(82)} 0 ${u(80)};border-top:1px solid rgba(215,166,58,.5);height:0;z-index:1}
.hvc-rule svg{position:absolute;left:50%;top:${u(-11)};width:${u(30)};height:auto;transform:translateX(-50%);background:${BG};padding:0 ${u(8)};box-sizing:content-box}

.hvc-bottom{display:flex;align-items:center;padding:${u(25)} 0 0 ${u(88)};position:relative;z-index:1}
.hvc-socials{display:flex;gap:${u(23)}}
.hv-soc{width:${u(54)};height:${u(54)};border-radius:50%;border:1.5px solid ${GOLD};display:inline-flex;align-items:center;justify-content:center;transition:background .2s}
.hv-soc svg{width:${u(27)};height:${u(27)}}
.hv-soc:hover{background:rgba(215,166,58,.18)}
.hvc-vr{width:1px;height:${u(62)};background:rgba(215,166,58,.4);margin:0 ${u(41)} 0 ${u(39)}}
.hv-fssai{display:flex;align-items:center;background:#fff;border-radius:${u(8)};width:${u(295)};height:${u(72)};padding:0 ${u(18)};gap:${u(14)};color:#14301e}
.hv-fssai img{width:${u(77)}!important;flex:none;height:auto!important}
.hv-fssai-txt{border-left:1px solid #d9d9d9;padding-left:${u(13)};display:flex;flex-direction:column;gap:${u(2)}}
.hv-fssai-txt strong{font-size:${u(16.5)};line-height:1.2}
.hv-fssai-txt span{font-size:${u(14)};color:#52645a;line-height:1.2}
.hvc-copy{padding:${u(21)} 0 0 ${u(80)};font-size:${u(16)};color:rgba(241,235,219,.62);position:relative;z-index:1}
.hvc-copy strong{color:${CREAM}}

/* mobile */
@media(max-width:820px){
  .hvc-in{container-type:normal}
  .hvc-hero{height:auto;background-size:auto 100%;background-position:78% bottom;position:relative}
  .hvc-hero::before{content:'';position:absolute;inset:0;background:linear-gradient(180deg,rgba(7,35,20,.94) 0%,rgba(7,35,20,.84) 52%,rgba(7,35,20,.05) 100%)}
  .hvc-hero-in{padding:44px 22px 190px}
  .hvc-leaf{position:relative;left:46px;top:auto;width:44px;height:auto;display:block;margin-bottom:6px}
  .hvc-brand{position:relative;left:auto;top:auto}
  .hvc-tt{width:fit-content}
.hvc-title{font-size:30px;white-space:normal}
  .hvc-tag{font-size:11.5px;letter-spacing:3px;gap:10px;margin-top:12px}
  .hvc-lead{width:auto;font-size:15.5px;line-height:1.65;margin-top:16px}
  .hvc-cols{grid-template-columns:1fr;padding:32px 22px 0;gap:30px}
  .hvc-c1,.hvc-c2,.hvc-c3{padding:0;border-left:0}
  .hvc-h{font-size:12.5px;letter-spacing:3px;padding-bottom:10px;margin-bottom:16px}
  .hvc-link,.hvc-addr{font-size:16px}
  .hvc-prod{gap:16px;height:auto;margin-bottom:14px;padding:0}
  .hvc-co{height:auto;margin-bottom:14px}.hvc-co b{font-size:20px}
  .hvc-ct{gap:14px;margin-bottom:16px}.hvc-ct:last-child{margin-bottom:0}
.hvc-addr{line-height:1.5}
  .hv-ico,.hvc-ct .hv-ico{width:26px;height:26px}
  .hvc-rule{margin:30px 22px 0}.hvc-rule svg{width:34px;top:-12px;padding:0 8px}
  .hvc-bottom{flex-wrap:wrap;gap:20px;padding:26px 22px 0}
  .hvc-socials{gap:12px}.hv-soc{width:46px;height:46px}.hv-soc svg{width:22px;height:22px}
  .hvc-vr{display:none}
  .hv-fssai{width:auto;min-width:260px;height:68px;padding:0 16px;gap:12px;border-radius:8px}
  .hv-fssai img{width:62px!important}.hv-fssai-txt{padding-left:12px}.hv-fssai-txt strong{font-size:14px}.hv-fssai-txt span{font-size:12px}
  .hvc-copy{padding:24px 22px 0;font-size:13px}
  .hvc-main{padding-bottom:34px}
  .hvc-art{width:300px;height:90px}.hvc-bot{display:none}
}
`}</style>
    </footer>
  )
}
