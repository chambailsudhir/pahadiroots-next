// lib/server/emailShell.ts — the brand frame shared by transactional e-mails (same look as the order confirmation).
//
// Why (Nov 2026 audit, e-mail content review of the stored production messages): the order-cancelled e-mail was a bare
// paragraph — no brand header, no footer, no way to reach support — while the confirmation was fully branded. A customer who
// cancels is exactly the one who may need a human, so every e-mail now ends with the same footer (site + WhatsApp).
// Inline styles + a table-free single column keep it safe in Gmail / Outlook / Apple Mail. Callers pass already-escaped HTML.
import 'server-only'
import { esc } from '@/lib/server/htmlEscape'

/**
 * ONE place for "our public origin" in e-mails (links, logo). A trailing slash would give `https://x//email-logo.png`; a non-https or
 * localhost value (a preview build, a mis-set env) would give a broken / blocked image in the customer's inbox - so only a clean https
 * origin is accepted, everything else falls back to the canonical production host.
 */
export function emailSiteUrl(): string {
  const raw = (process.env.NEXT_PUBLIC_SITE_URL || '').trim().replace(/\/+$/, '')
  return /^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(raw) && !/localhost|127\.0\.0\.1/i.test(raw) ? raw : 'https://www.pahadiroots.com'
}
const SITE_URL = emailSiteUrl
export const SUPPORT_WHATSAPP_URL = 'https://wa.me/919899984895'

/**
 * THE brand header for every customer e-mail (order confirmation, sign-up, password reset, cancellation, review request, account
 * deletion ...): the real HimVeda logo (dark-green "Him", gold "Veda", leaf mark, "by Pahadi Roots" script) on a light cream band, with
 * the brand tagline underneath. One definition so the mails can never drift apart again (sign-up / reset / deletion used a plain text
 * header with a leaf emoji; the order mail used a text imitation of the logo).
 *
 * The logo is a PNG with a transparent background (public/email-logo.png, 480 px wide for a 240 px display = sharp on retina), so the
 * band must be LIGHT. Outlook blocks images until "show images": the alt text is styled (Georgia, dark green) so the brand name is still
 * readable then. `bgcolor` + `background-color` (no shorthand / gradient) so it also renders in Outlook.
 */
const EMAIL_SITE = emailSiteUrl
export const BRAND_LOGO_PATH = '/email-logo.png'
export function brandHeaderRow(): string {
  return `<tr><td align="center" bgcolor="#fffdf9" style="background-color:#fffdf9;border-radius:18px 18px 0 0;padding:22px 28px 14px;border-bottom:3px solid #c8962a">
    <a href="${EMAIL_SITE()}" target="_blank" style="text-decoration:none"><img src="${EMAIL_SITE()}${BRAND_LOGO_PATH}" width="240" height="90" alt="HimVeda by Pahadi Roots" style="display:block;margin:0 auto;border:0;outline:none;width:240px;height:auto;max-width:100%;font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:700;color:#1a3a1e"></a>
    <div style="font-family:Georgia,'Times New Roman',serif;font-size:10px;letter-spacing:3px;color:#1a3a1e;margin-top:8px;text-transform:uppercase">Pure Himalayan &middot; Natural &middot; Authentic</div>
  </td></tr>`
}

export function brandedEmail(opts: { heading: string; bodyHtml: string; cta?: { label: string; href: string } }): string {
  // TABLE layout with `bgcolor` + `background-color` on the cells and a "bulletproof" button (a coloured table cell holding the link):
  // Outlook ignores div backgrounds / gradients / border-radius, which made the header and the button invisible there (Nov 2026).
  const cta = opts.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 0"><tr><td align="center" bgcolor="#2d6a4f" style="background-color:#2d6a4f;border-radius:24px"><a href="${esc(opts.cta.href)}" target="_blank" style="display:inline-block;background-color:#2d6a4f;color:#ffffff;text-decoration:none;font-family:Arial,sans-serif;font-weight:700;font-size:15px;line-height:20px;padding:13px 28px;border-radius:24px;border:1px solid #2d6a4f">${esc(opts.cta.label)}</a></td></tr></table>`
    : ''
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only"></head>
<body style="margin:0;padding:0;background-color:#f7f3ee;font-family:'Helvetica Neue',Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f7f3ee" style="background-color:#f7f3ee"><tr><td align="center" style="padding:24px 16px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px">
  ${brandHeaderRow()}
  <tr><td bgcolor="#ffffff" style="background-color:#ffffff;padding:28px 32px;border-left:1px solid #eeeeee;border-right:1px solid #eeeeee">
    <h1 style="font-family:Georgia,serif;font-size:22px;color:#1a3a1e;margin:0 0 12px">${esc(opts.heading)}</h1>
    <div style="color:#555555;font-size:15px;line-height:1.6">${opts.bodyHtml}</div>
    ${cta}
  </td></tr>
  <tr><td align="center" bgcolor="#1a3a1e" style="background-color:#1a3a1e;border-radius:0 0 16px 16px;padding:18px 32px">
    <div style="color:#b9c7bb;font-size:12px;line-height:1.8">
      Questions? Message us on <a href="${SUPPORT_WHATSAPP_URL}" style="color:#e8b84b;text-decoration:none">WhatsApp</a><br>
      <a href="${esc(SITE_URL())}" style="color:#e8b84b;text-decoration:none">pahadiroots.com</a> &middot; Pure Himalayan Goodness
    </div>
  </td></tr>
</table>
</td></tr></table>
</body></html>`
}
