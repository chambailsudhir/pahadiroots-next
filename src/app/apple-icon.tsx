import { ImageResponse } from 'next/og'

// SEO/PWA FIX: found while double-checking the manifest.ts/icon-192/icon-512
// work — there was no apple-icon.tsx, so "Add to Home Screen" on iOS falls
// back to a generic screenshot of the page instead of a branded icon.
// 180x180 is Apple's recommended apple-touch-icon size. Same visual style
// as icon.tsx/icon-192/icon-512 for consistent branding across platforms.
export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{
        width: '100%', height: '100%',
        background: '#1a3a1e',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '112px',
      }}>
        🌿
      </div>
    ),
    { ...size }
  )
}
