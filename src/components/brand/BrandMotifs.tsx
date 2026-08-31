// Shared visual motifs for the HimVeda brand's editorial pages (About, Blog).
// Originally defined inline in about/page.tsx — extracted here so new
// editorial pages reuse the same signature elements (the topographic
// contour lines that echo the elevation maps of the terrain the brand
// sources from) instead of each page inventing its own decoration.

export function ContourLines({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 800 400" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M-20 320 Q 120 260 240 300 T 480 280 T 820 310" stroke="#e8b84b" strokeWidth="1" fill="none" />
      <path d="M-20 280 Q 140 210 260 250 T 520 230 T 820 260" stroke="#e8b84b" strokeWidth="1" fill="none" />
      <path d="M-20 235 Q 160 160 300 195 T 560 170 T 820 205" stroke="#e8b84b" strokeWidth="1" fill="none" />
      <path d="M-20 185 Q 180 100 320 140 T 600 105 T 820 150" stroke="#e8b84b" strokeWidth="1" fill="none" />
      <path d="M-20 130 Q 200 40 340 85 T 640 40 T 820 90" stroke="#e8b84b" strokeWidth="1" fill="none" />
      <path d="M-20 60 Q 220 -20 360 20 T 660 -20 T 820 15" stroke="#e8b84b" strokeWidth="1" fill="none" />
    </svg>
  )
}

export function MountainMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 19l6-9 4 5.5L16 10l5 9H3z" />
      <circle cx="17" cy="6" r="2" />
    </svg>
  )
}
