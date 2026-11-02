// lib/server/emailShell.ts — the brand frame shared by transactional e-mails (same look as the order confirmation).
//
// Why (Nov 2026 audit, e-mail content review of the stored production messages): the order-cancelled e-mail was a bare
// paragraph — no brand header, no footer, no way to reach support — while the confirmation was fully branded. A customer who
// cancels is exactly the one who may need a human, so every e-mail now ends with the same footer (site + WhatsApp).
// Inline styles + a table-free single column keep it safe in Gmail / Outlook / Apple Mail. Callers pass already-escaped HTML.
import 'server-only'
import { esc } from '@/lib/server/htmlEscape'

const SITE_URL = () => process.env.NEXT_PUBLIC_SITE_URL || 'https://www.pahadiroots.com'
export const SUPPORT_WHATSAPP_URL = 'https://wa.me/919899984895'

export function brandedEmail(opts: { heading: string; bodyHtml: string; cta?: { label: string; href: string } }): string {
  const cta = opts.cta
    ? `<p style="margin:20px 0 0"><a href="${esc(opts.cta.href)}" style="display:inline-block;background:#2d6a4f;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 24px;border-radius:24px">${esc(opts.cta.label)}</a></p>`
    : ''
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f7f3ee;font-family:'Helvetica Neue',Arial,sans-serif">
<div style="max-width:580px;margin:0 auto;padding:24px 16px">
  <div style="background:#1a3a1e;border-radius:16px 16px 0 0;padding:24px 32px;text-align:center">
    <div style="font-family:Georgia,serif;font-size:22px;font-weight:900;color:#ffffff;margin-bottom:3px">HimVeda by Pahadi Roots</div>
    <div style="font-size:11px;color:#b9c7bb;letter-spacing:2px;text-transform:uppercase">Himalayan Natural Store</div>
  </div>
  <div style="background:#ffffff;padding:28px 32px;border-left:1px solid #eeeeee;border-right:1px solid #eeeeee">
    <h1 style="font-family:Georgia,serif;font-size:22px;color:#1a3a1e;margin:0 0 12px">${esc(opts.heading)}</h1>
    <div style="color:#555555;font-size:15px;line-height:1.6">${opts.bodyHtml}</div>
    ${cta}
  </div>
  <div style="background:#1a3a1e;border-radius:0 0 16px 16px;padding:18px 32px;text-align:center">
    <div style="color:#b9c7bb;font-size:12px;line-height:1.8">
      Questions? Message us on <a href="${SUPPORT_WHATSAPP_URL}" style="color:#e8b84b;text-decoration:none">WhatsApp</a><br>
      <a href="${esc(SITE_URL())}" style="color:#e8b84b;text-decoration:none">pahadiroots.com</a> &middot; Pure Himalayan Goodness
    </div>
  </div>
</div>
</body></html>`
}
