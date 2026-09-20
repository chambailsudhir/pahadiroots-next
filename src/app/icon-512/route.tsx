import { ImageResponse } from 'next/og'

// See src/app/icon-192/route.tsx for why this exists — same reasoning,
// larger size for high-DPI Android home-screen icons and PWA splash use.
export const runtime = 'edge'

// BUG FIX: same as icon.tsx — this rendered a plain 🌿 emoji instead of the
// real HimVeda brand mark (gold leaf-sprig-over-V, drawn as a plain SVG
// path so it renders identically every time with no emoji/font dependency).
export function GET() {
  return new ImageResponse(
    (
      <div style={{
        width: '100%', height: '100%',
        background: '#1a3a1e',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <svg width="370" height="370" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
          <path d="M18 24 L34 24 L50 60 L66 24 L82 24 L58 82 L42 82 Z" fill="#d4a544" />
          <path d="M50 42 C42 28 30 24 19 26 C23 37 34 46 47 46 C49 46 50 44 50 42 Z" fill="#d4a544" />
          <path d="M50 42 C58 28 70 24 81 26 C77 37 66 46 53 46 C51 46 50 44 50 42 Z" fill="#d4a544" />
        </svg>
      </div>
    ),
    { width: 512, height: 512 }
  )
}
