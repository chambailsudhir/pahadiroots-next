import { ImageResponse } from 'next/og'

export const size = { width: 32, height: 32 }
export const contentType = 'image/png'

// BUG FIX (root cause of the broken WhatsApp/Facebook share preview): this
// rendered a plain 🌿 emoji glyph, not the actual HimVeda brand mark. Emoji
// in next/og's ImageResponse is fetched from a remote Twemoji CDN at render
// time — it happened to succeed here, which is exactly the problem: this
// generic leaf is what showed up as the site's "logo" whenever a page had
// no og:image and a chat app fell back to the favicon (see page.tsx and
// siblings for the actual og:image fix). Replaced with the real gold
// leaf-sprig-over-V mark from logo.png, drawn as a plain SVG path so it
// renders identically every time with zero external/emoji-font dependency.
export default function Icon() {
  return new ImageResponse(
    (
      <div style={{
        width: '100%', height: '100%',
        background: '#1a3a1e',
        borderRadius: '8px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <svg width="22" height="22" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
          <path d="M18 24 L34 24 L50 60 L66 24 L82 24 L58 82 L42 82 Z" fill="#d4a544" />
          <path d="M50 42 C42 28 30 24 19 26 C23 37 34 46 47 46 C49 46 50 44 50 42 Z" fill="#d4a544" />
          <path d="M50 42 C58 28 70 24 81 26 C77 37 66 46 53 46 C51 46 50 44 50 42 Z" fill="#d4a544" />
        </svg>
      </div>
    ),
    { ...size }
  )
}
