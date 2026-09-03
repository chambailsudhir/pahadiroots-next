import { ImageResponse } from 'next/og'

// SEO/PWA FIX: no manifest.json existed, and manifest icons need real
// dedicated sizes (192/512) — the favicon-sized icon.tsx (32x32) upscales
// blurry if reused directly. Same visual style as icon.tsx (dark green +
// leaf) so branding is consistent, just rendered at the size PWA install
// prompts / Android home-screen icons actually need.
export const runtime = 'edge'

export function GET() {
  return new ImageResponse(
    (
      <div style={{
        width: '100%', height: '100%',
        background: '#1a3a1e',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '120px',
      }}>
        🌿
      </div>
    ),
    { width: 192, height: 192 }
  )
}
