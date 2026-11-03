// Where "new order / order cancelled" e-mails to the shop owner go.
// The admin-editable setting `admin_notify_email` wins; if it was never filled in (it is not even a row in production today, so the owner
// received NO new-order e-mails), fall back to the ADMIN_EMAIL environment variable that the contact form already uses.
// (Nov 2026: ADMIN_EMAIL is chambail.sudhir@gmail.com until the shop gets its own mail domain; change the env var then.)
export function adminNotifyAddress(settings: { admin_notify_email?: string | null } | null | undefined): string {
  const a = (settings?.admin_notify_email ?? '').trim()
  if (a.includes('@')) return a
  const e = (process.env.ADMIN_EMAIL ?? '').trim()
  return e.includes('@') ? e : ''
}
