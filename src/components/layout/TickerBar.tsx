import type { SiteSettings } from '@/types'

interface Props {
  settings: SiteSettings
}

export default function TickerBar({ settings }: Props) {
  if (settings.ticker_hide === 'true') return null

  const items = [1, 2, 3, 4, 5]
    .filter(i => settings[`ticker_${i}_hide`] !== 'true')
    .map(i => settings[`ticker_${i}_text`])
    .filter(Boolean)

  if (!items.length) return null

  // Duplicate for seamless loop
  const doubled = [...items, ...items]

  return (
    <div className="bg-earth-500 text-white overflow-hidden py-2 relative">
      <div className="ticker-track">
        {doubled.map((item, idx) => (
          <span key={idx} className="inline-flex items-center whitespace-nowrap text-xs font-medium px-8">
            {item}
            <span className="mx-6 opacity-40">•</span>
          </span>
        ))}
      </div>
    </div>
  )
}
