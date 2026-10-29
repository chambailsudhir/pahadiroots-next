import { Cormorant_Garamond, Inter } from 'next/font/google'

// Scoped to /blog only — same pairing as /our-stories, loaded here so no other route pays for them.
const cormorant = Cormorant_Garamond({ subsets: ['latin'], weight: ['400', '500', '600'], style: ['normal', 'italic'], variable: '--font-cormorant', display: 'swap' })
const inter = Inter({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-inter', display: 'swap' })

export default function BlogLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${cormorant.variable} ${inter.variable}`}>{children}</div>
}
