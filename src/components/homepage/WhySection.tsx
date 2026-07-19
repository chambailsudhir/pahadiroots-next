// "Why HimVeda by Pahadi Roots" — exact SVG match to old site
import type { SiteSettings } from '@/types'
import { getStatesCovered } from '@/lib/heroStats'

interface Props { settings: SiteSettings }

export default function WhySection({ settings }: Props) {
  // BUG FIX: was settings.states_covered — a key that doesn't exist on
  // the admin side at all. The real admin-managed key is
  // stat_himalayan_states (confirmed directly against the pahadi-admin
  // repo) — same shared helper HeroBanner.tsx and AnnouncementBar.tsx use.
  const statesCovered = getStatesCovered(settings)
  return (
    <section className="why-bg">
      <div className="ct">
        <div className="chip">Our Promise</div>
        <h2 className="sh2">Why HimVeda by Pahadi Roots</h2>
        <p className="ssub">Four pillars that define everything we do — mountain to doorstep.</p>
      </div>
      <div className="pgr">

        {/* PILLAR 1 — Lab Tested Purity */}
        <div className="pillar">
          <div className="pnum">01</div>
          <svg viewBox="0 0 148 148" xmlns="http://www.w3.org/2000/svg" style={{width:110,height:110,marginBottom:10}}>
            <defs><radialGradient id="lt1" cx="45%" cy="35%" r="65%"><stop offset="0%" stopColor="#f0f8e8"/><stop offset="100%" stopColor="#4a9858"/></radialGradient></defs>
            <circle cx="74" cy="74" r="74" fill="url(#lt1)"/>
            <rect x="54" y="112" width="40" height="6" rx="3" fill="#1a4828"/>
            <rect x="68" y="90" width="12" height="24" rx="2" fill="#2a6840"/>
            <rect x="68" y="58" width="8" height="36" rx="2" fill="#2a6840"/>
            <rect x="68" y="56" width="30" height="8" rx="2" fill="#1a4828"/>
            <rect x="70" y="44" width="8" height="16" rx="3" fill="#3a7850"/>
            <circle cx="74" cy="42" r="6" fill="#1a4828"/>
            <circle cx="74" cy="42" r="3" fill="#88c8f8" opacity=".8"/>
            <rect x="40" y="86" width="28" height="8" rx="1" fill="#c8e8f8" opacity=".9"/>
            <circle cx="52" cy="90" r="4" fill="#50a840" opacity=".7"/>
            <circle cx="108" cy="44" r="18" fill="#f0c840" opacity=".95"/>
            <circle cx="108" cy="44" r="14" fill="white" opacity=".9"/>
            <polyline points="100,44 106,50 118,36" stroke="#1a4828" strokeWidth="3.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
            <rect x="88" y="66" width="40" height="12" rx="3" fill="#1a4828" opacity=".85"/>
            <text x="108" y="75" fontSize="7" fontWeight="700" fill="white" textAnchor="middle">CERTIFIED</text>
            <circle cx="30" cy="44" r="4" fill="#c8920a" opacity=".5"/>
            <circle cx="22" cy="58" r="3" fill="#c8920a" opacity=".4"/>
            <circle cx="28" cy="30" r="11" fill="#f0c840" opacity=".88"/>
            <text x="22" y="35" fontSize="9" fontWeight="700" fill="#7a6000">LAB</text>
          </svg>
          <div className="pt">Lab Tested Purity</div>
          <p className="pd">Every batch tested for heavy metals, pesticides &amp; adulterants. Certificate with every order.</p>
        </div>

        {/* PILLAR 2 — Direct from Farmers */}
        <div className="pillar">
          <div className="pnum">02</div>
          <svg viewBox="0 0 148 148" xmlns="http://www.w3.org/2000/svg" style={{width:110,height:110,marginBottom:10}}>
            <defs><radialGradient id="fd2" cx="45%" cy="35%" r="65%"><stop offset="0%" stopColor="#d8f0d8"/><stop offset="100%" stopColor="#4a9858"/></radialGradient></defs>
            <circle cx="74" cy="74" r="74" fill="url(#fd2)"/>
            <polygon points="0,90 24,52 50,72 74,42 98,68 124,48 148,80 148,148 0,148" fill="#2a6840" opacity=".4"/>
            <polygon points="0,106 20,72 46,88 74,58 102,84 128,66 148,96 148,148 0,148" fill="#1a4828"/>
            <polygon points="74,58 66,72 82,72" fill="white" opacity=".9"/>
            <polygon points="24,52 18,62 30,62" fill="white" opacity=".7"/>
            <rect x="8" y="100" width="20" height="16" rx="2" fill="#e8c870"/>
            <polygon points="4,102 18,88 32,102" fill="#c84820"/>
            <line x1="30" y1="100" x2="32" y2="84" stroke="#c8920a" strokeWidth="2"/>
            <ellipse cx="32" cy="81" rx="4" ry="8" fill="#c8920a"/>
            <line x1="40" y1="102" x2="42" y2="86" stroke="#c8920a" strokeWidth="2"/>
            <ellipse cx="42" cy="83" rx="4" ry="8" fill="#d4a030"/>
            <path d="M46,92 Q74,64 102,92" stroke="#c8920a" strokeWidth="3" fill="none" strokeLinecap="round"/>
            <polygon points="100,86 107,93 98,96" fill="#c8920a"/>
            <circle cx="74" cy="80" r="13" fill="white" opacity=".9"/>
            <line x1="66" y1="72" x2="82" y2="88" stroke="#e84848" strokeWidth="2.5"/>
            <circle cx="74" cy="76" r="4" fill="#888"/>
            <path d="M69,84 Q74,81 79,84" stroke="#888" strokeWidth="1.5" fill="none"/>
            <rect x="108" y="100" width="26" height="22" rx="2" fill="#e8c870"/>
            <polygon points="104,102 121,86 138,102" fill="#c84820"/>
            <rect x="116" y="108" width="10" height="14" rx="1" fill="#c8a050"/>
            <rect x="109" y="102" width="8" height="8" rx="1" fill="#88c8f8"/>
            <circle cx="116" cy="26" r="13" fill="#f0c840" opacity=".9"/>
            <text x="108" y="30" fontSize="7" fontWeight="700" fill="#7a6000">FARM</text>
            <text x="108" y="39" fontSize="7" fill="#7a6000">→HOME</text>
          </svg>
          <div className="pt">Direct from Farmers</div>
          {/* BUG FIX: this hardcoded "200+ farming families across 12
              Himalayan states" as plain text. Two separate problems,
              both now fixed:
                1. States count: HeroBanner.tsx/AnnouncementBar.tsx read
                   the real admin-managed stat_himalayan_states setting;
                   this hardcoded a different, conflicting number (12).
                2. Farmer count: previously flagged as "needs a real
                   number, can't guess between HeroBanner's 500+ and this
                   200+" — resolved by checking the admin panel directly:
                   stat_farmer_families defaults to '500', confirming
                   HeroBanner was right and this hardcoded 200 was the
                   stale one. Now reads the same real setting. */}
          <p className="pd">Zero middlemen. {settings.stat_farmer_families || '100'}+ farming families across {statesCovered} Himalayan states — fair wages, always.</p>
        </div>

        {/* PILLAR 3 — Eco Packaging */}
        <div className="pillar">
          <div className="pnum">03</div>
          <svg viewBox="0 0 148 148" xmlns="http://www.w3.org/2000/svg" style={{width:110,height:110,marginBottom:10}}>
            <defs><radialGradient id="ed3" cx="45%" cy="42%" r="65%"><stop offset="0%" stopColor="#c8e8f8"/><stop offset="100%" stopColor="#5890c0"/></radialGradient></defs>
            <circle cx="74" cy="74" r="74" fill="url(#ed3)"/>
            <circle cx="74" cy="80" r="46" fill="#2878b8" opacity=".7"/>
            <circle cx="74" cy="80" r="46" fill="none" stroke="#60a8e0" strokeWidth="2"/>
            <path d="M46,60 Q52,50 64,52 Q70,58 66,68 Q58,72 50,68 Z" fill="#50a840" opacity=".85"/>
            <path d="M70,56 Q80,48 92,52 Q96,62 90,70 Q80,74 72,68 Z" fill="#50a840" opacity=".85"/>
            <path d="M54,76 Q62,70 70,74 Q72,84 66,90 Q56,88 54,76 Z" fill="#50a840" opacity=".85"/>
            <path d="M80,78 Q90,72 100,78 Q102,90 94,96 Q84,94 80,84 Z" fill="#50a840" opacity=".85"/>
            <path d="M60,96 Q68,92 74,98 Q72,108 64,108 Q58,104 60,96 Z" fill="#50a840" opacity=".7"/>
            <ellipse cx="60" cy="64" rx="12" ry="8" fill="white" opacity=".15" transform="rotate(-30,60,64)"/>
            <line x1="74" y1="34" x2="74" y2="18" stroke="#38b040" strokeWidth="3.5" strokeLinecap="round"/>
            <path d="M74,28 Q58,20 60,8 Q70,16 74,28Z" fill="#50c850"/>
            <path d="M74,24 Q90,16 88,4 Q78,12 74,24Z" fill="#60d860"/>
            <circle cx="74" cy="80" r="54" fill="none" stroke="#38b040" strokeWidth="1.5" strokeDasharray="8,5" opacity=".5"/>
            <circle cx="116" cy="30" r="13" fill="#f0c840" opacity=".9"/>
            <text x="110" y="35" fontSize="9" fontWeight="700" fill="#7a6000">ECO</text>
            <text x="22" y="42" fontSize="13" fill="#4070a8" opacity=".5">✦</text>
          </svg>
          <div className="pt">Eco Packaging</div>
          <p className="pd">Glass jars, recycled cardboard, zero single-use plastic. Packaging as clean as our products.</p>
        </div>

        {/* PILLAR 4 — Give-Back Program */}
        <div className="pillar">
          <div className="pnum">04</div>
          <svg viewBox="0 0 148 148" xmlns="http://www.w3.org/2000/svg" style={{width:110,height:110,marginBottom:10}}>
            <defs><radialGradient id="gb3" cx="45%" cy="35%" r="65%"><stop offset="0%" stopColor="#c8e8f8"/><stop offset="100%" stopColor="#5888b8"/></radialGradient></defs>
            <circle cx="74" cy="74" r="74" fill="url(#gb3)"/>
            <polygon points="0,90 24,52 50,72 74,42 98,68 124,48 148,80 148,148 0,148" fill="#4a7850" opacity=".4"/>
            <polygon points="0,106 20,72 46,88 74,58 102,84 128,66 148,96 148,148 0,148" fill="#2a5838"/>
            <polygon points="74,58 66,72 82,72" fill="white" opacity=".9"/>
            <polygon points="128,66 121,77 135,77" fill="white" opacity=".8"/>
            <polygon points="20,72 14,82 26,82" fill="white" opacity=".75"/>
            <path d="M0,130 Q20,120 40,128 Q60,136 80,124 Q100,112 120,120 Q134,126 148,118" stroke="#60b8e8" strokeWidth="8" fill="none" strokeLinecap="round"/>
            <path d="M0,130 Q20,120 40,128 Q60,136 80,124 Q100,112 120,120 Q134,126 148,118" stroke="#88cef8" strokeWidth="4" fill="none" strokeLinecap="round" opacity=".5"/>
            <rect x="54" y="100" width="22" height="18" rx="2" fill="#e8c870"/>
            <polygon points="50,102 65,90 80,102" fill="#c84820"/>
            <rect x="61" y="108" width="8" height="10" rx="1" fill="#c8a050"/>
            <rect x="55" y="103" width="7" height="7" rx="1" fill="#88c8f8"/>
            <polygon points="100,118 94,102 106,102" fill="#1a4020"/>
            <polygon points="100,106 93,92 107,92" fill="#1a4020"/>
            <polygon points="100,96 94,82 106,82" fill="#225030"/>
            <circle cx="112" cy="26" r="13" fill="#fde080" opacity=".85"/>
            <circle cx="30" cy="38" r="13" fill="#f0c840" opacity=".88"/>
            <text x="24" y="43" fontSize="10" fontWeight="700" fill="#7a6000">5%</text>
          </svg>
          <div className="pt">Give-Back Program</div>
          <p className="pd">5% of every order funds Himalayan forest restoration and village school programs.</p>
        </div>

      </div>
    </section>
  )
}
