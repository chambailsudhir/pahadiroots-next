import { ImageResponse } from 'next/og'

// See src/app/icon-192/route.tsx for why this exists — same reasoning,
// larger size for high-DPI Android home-screen icons and PWA splash use.
export const runtime = 'edge'

export function GET() {
  return new ImageResponse(
    (
      <div style={{
        width: '100%', height: '100%',
        background: '#1a3a1e',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '320px',
      }}>
        🌿
      </div>
    ),
    { width: 512, height: 512 }
  )
}
