import type { SiteSettings } from '@/types'

interface Props { settings: SiteSettings }

export default function TickerBar({ settings }: Props) {
  if (settings.ticker_hide === 'true') return null

  const items = [1, 2, 3, 4, 5]
    .filter(i => settings[`ticker_${i}_hide`] !== 'true')
    .map(i => settings[`ticker_${i}_text`])
    .filter(Boolean)

  if (!items.length) return null

  const doubled = [...items, ...items]

  return (
    <div className="ticker-wrap">
      <div className="ticker-track">
        {doubled.map((item, idx) => (
          <span key={idx} className="ticker-item">{item}</span>
        ))}
      </div>
    </div>
  )
}
