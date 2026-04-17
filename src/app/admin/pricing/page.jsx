'use client';
import Link from 'next/link';

const CARDS = [
  {
    href: '/admin/pricing/new',
    icon: '✨',
    color: '#378ADD',
    tint: 'rgba(55,138,221,0.08)',
    badge: '#E6F1FB', badgeText: '#185FA5',
    title: 'New Product',
    sub: 'Pricing a product not yet in your catalogue',
    bullets: [
      'Enter purchase cost manually',
      'Walk through all 6 cost stages',
      'Get suggested MRP instantly',
      'Copy values to add to catalogue',
    ],
    cta: 'Start pricing',
  },
  {
    href: '/admin/pricing/existing',
    icon: '🔍',
    color: '#1D9E75',
    tint: 'rgba(29,158,117,0.08)',
    badge: '#E1F5EE', badgeText: '#0F6E56',
    title: 'Existing Product',
    sub: 'Re-price a product already in your catalogue',
    bullets: [
      'Search and select from catalogue',
      'Cost & GST auto-filled from DB',
      'See all linked variants',
      'Push updated price directly to DB',
    ],
    cta: 'Search product',
  },
  {
    href: '/admin/pricing/bulk',
    icon: '📦',
    color: '#C8820A',
    tint: 'rgba(200,130,10,0.08)',
    badge: '#FAEEDA', badgeText: '#854F0B',
    title: 'Bulk Purchase Calculator',
    sub: 'Bought in bulk? Calculate full unit economics',
    bullets: [
      'Total units + total invoice amount',
      'Split packaging, warehouse & COD per unit',
      'Handles wastage / processing loss',
      'Push per-unit cost to pricing calculator',
    ],
    cta: 'Open bulk calc',
  },
];

export default function PricingHubPage() {
  return (
    <div className="space-y-6 max-w-5xl" style={{ color: 'var(--tx,#e6edf3)' }}>

      {/* Header */}
      <div>
        <h1 className="text-[22px] font-bold">Pricing Engine</h1>
        <p className="text-[13px] mt-1" style={{ color: 'var(--tx2,#8b949e)' }}>
          Full unit economics — from purchase cost to MRP. Choose where to start:
        </p>
      </div>

      {/* 3 cards */}
      <div className="grid grid-cols-3 gap-4">
        {CARDS.map(c => (
          <Link key={c.href} href={c.href}
            className="rounded-2xl p-5 flex flex-col gap-4 transition-colors"
            style={{ background: 'var(--bg2,#161b22)', border: `1px solid var(--bd,#30363d)`, borderLeft: `4px solid ${c.color}` }}
            onMouseEnter={e => e.currentTarget.style.background = c.tint}
            onMouseLeave={e => e.currentTarget.style.background = 'var(--bg2,#161b22)'}>
            <div>
              <div className="text-[34px] mb-3">{c.icon}</div>
              <div className="text-[16px] font-bold" style={{ color: 'var(--tx,#e6edf3)' }}>{c.title}</div>
              <div className="text-[12px] mt-1" style={{ color: 'var(--tx2,#8b949e)' }}>{c.sub}</div>
            </div>
            <ul className="space-y-1.5 flex-1">
              {c.bullets.map((b, i) => (
                <li key={i} className="flex items-start gap-2 text-[12px]">
                  <span className="mt-0.5 flex-none w-3.5 h-3.5 text-[8px] font-bold rounded-full flex items-center justify-center"
                    style={{ background: c.badge, color: c.badgeText }}>✓</span>
                  <span style={{ color: 'var(--tx2,#8b949e)' }}>{b}</span>
                </li>
              ))}
            </ul>
            <div className="text-[12px] font-bold" style={{ color: c.color }}>
              {c.cta} →
            </div>
          </Link>
        ))}
      </div>

      {/* Tip */}
      <div className="rounded-xl p-4 flex items-start gap-3"
        style={{ background: 'var(--bg2,#161b22)', border: '1px solid var(--bd,#30363d)' }}>
        <span className="text-[20px] flex-none">💡</span>
        <div>
          <div className="text-[13px] font-semibold">Bought stock in bulk? Start with Bulk Purchase Calculator.</div>
          <div className="text-[12px] mt-1" style={{ color: 'var(--tx2,#8b949e)' }}>
            Example: Bought 100 bottles of juice for ₹3,000 total. The bulk calc splits every cost — product, packaging,
            warehouse rent, COD — per unit. Then push that per-unit result into New Product or Existing Product to set your final MRP.
          </div>
        </div>
      </div>
    </div>
  );
}
