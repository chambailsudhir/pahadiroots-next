// "Our Promise / Why 5 Pahadi Roots" — exact match to old site section
export default function WhySection() {
  const pillars = [
    {
      num: '01',
      title: 'Lab Tested Purity',
      body: 'Every batch tested for heavy metals, pesticides & adulterants. Certificate with every order.',
      color: 'from-forest-50 to-forest-100',
      icon: (
        <svg viewBox="0 0 80 80" className="w-16 h-16">
          <circle cx="40" cy="40" r="38" fill="#d1fae5" />
          <rect x="34" y="56" width="12" height="4" rx="2" fill="#065f46" />
          <rect x="37" y="44" width="6" height="14" rx="1.5" fill="#047857" />
          <rect x="37" y="28" width="5" height="18" rx="1.5" fill="#047857" />
          <rect x="37" y="26" width="18" height="5" rx="1.5" fill="#065f46" />
          <rect x="38" y="20" width="5" height="10" rx="2" fill="#059669" />
          <circle cx="40" cy="18" r="4" fill="#065f46" />
          <circle cx="40" cy="18" r="2" fill="#bfdbfe" opacity=".9" />
          <circle cx="58" cy="22" r="10" fill="#fcd34d" opacity=".95" />
          <circle cx="58" cy="22" r="7" fill="white" opacity=".9" />
          <polyline points="54,22 57,26 63,17" stroke="#065f46" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="48" y="34" width="22" height="8" rx="2.5" fill="#065f46" opacity=".85" />
          <text x="59" y="40" fontSize="5" fontWeight="700" fill="white" textAnchor="middle">CERTIFIED</text>
        </svg>
      ),
    },
    {
      num: '02',
      title: 'Direct from Farmers',
      body: 'Zero middlemen. 200+ farming families across 12 Himalayan states — fair wages, always.',
      color: 'from-earth-50 to-earth-100',
      icon: (
        <svg viewBox="0 0 80 80" className="w-16 h-16">
          <circle cx="40" cy="40" r="38" fill="#fef3c7" />
          <polygon points="0,50 13,28 27,40 40,22 53,37 67,26 80,44 80,80 0,80" fill="#065f46" opacity=".35" />
          <polygon points="0,58 11,38 25,48 40,30 55,46 69,35 80,52 80,80 0,80" fill="#064e3b" />
          <path d="M25,72 Q40,36 55,72" stroke="#d97706" strokeWidth="2.5" fill="none" strokeLinecap="round" />
          <polygon points="55,67 58,73 52,73" fill="#d97706" />
          <circle cx="40" cy="42" r="9" fill="white" opacity=".9" />
          <line x1="35" y1="37" x2="45" y2="47" stroke="#ef4444" strokeWidth="2" />
          <circle cx="40" cy="40" r="3" fill="#9ca3af" />
        </svg>
      ),
    },
    {
      num: '03',
      title: 'Eco Packaging',
      body: 'Glass jars, recycled cardboard, zero single-use plastic. Packaging as clean as our products.',
      color: 'from-blue-50 to-blue-100',
      icon: (
        <svg viewBox="0 0 80 80" className="w-16 h-16">
          <circle cx="40" cy="40" r="38" fill="#dbeafe" />
          <circle cx="40" cy="44" r="26" fill="#2563eb" opacity=".4" />
          <circle cx="40" cy="44" r="26" fill="none" stroke="#60a5fa" strokeWidth="1.5" />
          <path d="M25,32 Q28,26 35,28 Q38,32 36,38 Q31,40 27,37 Z" fill="#22c55e" opacity=".85" />
          <path d="M38,30 Q44,24 50,28 Q53,34 49,39 Q44,41 39,37 Z" fill="#22c55e" opacity=".85" />
          <path d="M30,42 Q35,38 39,41 Q40,48 36,52 Q30,50 30,42 Z" fill="#22c55e" opacity=".85" />
          <path d="M44,43 Q50,39 56,43 Q57,51 51,55 Q45,53 44,46 Z" fill="#22c55e" opacity=".85" />
          <line x1="40" y1="18" x2="40" y2="8" stroke="#16a34a" strokeWidth="3" strokeLinecap="round" />
          <path d="M40,14 Q30,8 32,2 Q38,8 40,14Z" fill="#22c55e" />
          <path d="M40,12 Q50,6 48,0 Q42,6 40,12Z" fill="#4ade80" />
          <circle cx="62" cy="16" r="8" fill="#fcd34d" opacity=".9" />
          <text x="58" y="20" fontSize="6" fontWeight="700" fill="#92400e">ECO</text>
        </svg>
      ),
    },
    {
      num: '04',
      title: 'Give-Back Program',
      body: '5% of every order funds Himalayan forest restoration and village school programs.',
      color: 'from-purple-50 to-purple-100',
      icon: (
        <svg viewBox="0 0 80 80" className="w-16 h-16">
          <circle cx="40" cy="40" r="38" fill="#ede9fe" />
          <polygon points="0,50 13,28 27,40 40,22 53,37 67,26 80,44 80,80 0,80" fill="#4c1d95" opacity=".3" />
          <polygon points="0,58 11,38 25,48 40,30 55,46 69,35 80,52 80,80 0,80" fill="#3b0764" />
          <path d="M0,72 Q11,65 22,70 Q33,75 44,68 Q55,61 66,66 Q72,69 80,64" stroke="#7dd3fc" strokeWidth="6" fill="none" strokeLinecap="round" />
          <circle cx="62" cy="14" r="8" fill="#fde68a" opacity=".85" />
          <circle cx="16" cy="20" r="8" fill="#fcd34d" opacity=".88" />
          <text x="12" y="24" fontSize="7" fontWeight="700" fill="#92400e">5%</text>
        </svg>
      ),
    },
  ]

  return (
    <section className="py-14 sm:py-18" style={{ background: 'linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 50%, #f0fdf4 100%)' }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

        {/* Section header */}
        <div className="text-center mb-12">
          <div className="inline-block text-xs font-bold uppercase tracking-widest text-forest-600 bg-forest-50 border border-forest-100 px-3 py-1 rounded-full mb-3">
            Our Promise
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold text-stone-900 mb-2">
            Why 5 Pahadi Roots
          </h2>
          <p className="text-stone-500 text-sm max-w-md mx-auto">
            Four pillars that define everything we do — mountain to doorstep.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {pillars.map((p, i) => (
            <div
              key={p.num}
              className={`relative rounded-2xl bg-gradient-to-br ${p.color} border border-white p-6 text-center shadow-sm hover:shadow-md transition-shadow`}
            >
              {/* Number badge */}
              <div className="absolute top-4 left-4 text-xs font-black text-stone-300">
                {p.num}
              </div>
              {/* Icon */}
              <div className="flex justify-center mb-4 mt-2">
                {p.icon}
              </div>
              <h3 className="text-sm font-bold text-stone-900 mb-2">{p.title}</h3>
              <p className="text-xs text-stone-500 leading-relaxed">{p.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
