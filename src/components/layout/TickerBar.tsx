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

  // Admin's Ticker Bar section lets the store owner pick a background/text
  // color (ticker_bg_color / ticker_text_color); falls back to the original
  // gold strip if unset so existing stores don't change appearance.
  const bg   = settings.ticker_bg_color   || '#c8920a'
  const text = settings.ticker_text_color || '#1a1a1a'

  return (
    <div className="ticker-wrap" style={{ background: bg }}>
      <div className="ticker-track">
        {doubled.map((item, idx) => (
          <span key={idx} className="ticker-item" style={{ color: text }}>{item}</span>
        ))}
      </div>
    </div>
  )
}
