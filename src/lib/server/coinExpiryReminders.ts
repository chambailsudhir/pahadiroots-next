// "Your Pahadi Coins expire soon" e-mails (owner request, Nov 2026) — sent ~15 days before a batch of coins expires.
//
// Run from the daily expire-pending-orders sweep, after the expiry step. Safety rules (same shape as reviewRequests.ts):
//   * Candidates come from the database (loyalty_expiry_reminder_candidates, db_migration_v40): registered customers with an e-mail
//     address and order e-mails on, whose next batch expires within REMINDER_DAYS, not yet reminded for that date and not reminded
//     at all in the last 7 days. The dates use the same FIFO ledger walk as the expiry itself, so the e-mail never promises a date
//     the cron does not keep.
//   * Each (customer, expiry date) is CLAIMED first (unique row in loyalty_expiry_reminders) and only the winner sends; a send that
//     neither went out nor was dead-lettered releases the claim so the next run retries.
//   * Never throws; honours `loyalty_enabled` and `loyalty_expiry_reminder_enabled`; bounded by a batch limit and a time budget.
import 'server-only'
import type { getServiceClient } from '@/lib/supabase'
import { sendTransactionalEmail } from '@/lib/server/email'
import { brandedEmail, emailSiteUrl } from '@/lib/server/emailShell'
import { esc } from '@/lib/server/htmlEscape'
import { captureError, logger } from '@/lib/logger'
import { expirySpan } from '@/lib/loyaltyCoins'

type Db = ReturnType<typeof getServiceClient>

export const REMINDER_DAYS = 15
const DEFAULT_LIMIT = 10
const DEFAULT_TIME_BUDGET_MS = 20_000
const WORST_CASE_SEND_MS = 12_000

export interface CoinReminderStats { enabled: boolean; candidates: number; sent: number; skipped: number; errors: number; timeBudgetHit?: boolean }

type Candidate = { customer_id: number | string; email: string | null; first_name: string | null; expires_on: string; coins: number; balance: number }

/** "6 March 2027" for a YYYY-MM-DD date (IST calendar date from the database). */
export function formatExpiryDate(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd))
  if (!m) return String(ymd)
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}

export function coinExpiryEmail(c: { firstName: string | null; coins: number; expiresOn: string; balance: number; label?: string; expiryDays?: string }, siteUrl: string) {
  const label = c.label || 'Pahadi Coins'
  const when = formatExpiryDate(c.expiresOn)
  const n = Math.max(0, Math.floor(c.coins))
  const greet = c.firstName && c.firstName !== 'Deleted' ? `Hi ${esc(c.firstName)},` : 'Hi,'
  const subject = `${n} ${label} expire on ${when}`
  const html = brandedEmail({
    heading: `Your ${esc(label)} expire soon`,
    bodyHtml:
      `<p style="margin:0 0 12px">${greet}</p>` +
      `<p style="margin:0 0 12px"><strong>${n} ${n === 1 ? 'coin' : 'coins'}</strong> (worth ₹${n}) in your account will expire on <strong>${esc(when)}</strong>. ` +
      `You have ${Math.max(0, Math.floor(c.balance))} coins in total.</p>` +
      `<p style="margin:0 0 12px">Use them on your next order: coins take money off at checkout (together with any coupon, up to the limit shown there). Coins you spend are always taken from your oldest coins first.</p>` +
      `<p style="margin:16px 0 0;font-size:12px;color:#6b6256">Coins expire ${expirySpan(c.expiryDays) ?? '4 months'} after you earn them — see our <a href="${siteUrl}/policies/terms" style="color:#6b6256">Terms</a>. ` +
      `Don't want these e-mails? <a href="${siteUrl}/account?tab=notifications" style="color:#6b6256">Change your e-mail preferences</a>.</p>`,
    cta: { label: 'Shop now', href: `${siteUrl}/products` },
  })
  return { subject, html }
}

export async function sendCoinExpiryReminders(db: Db, opts: { limit?: number; timeBudgetMs?: number } = {}): Promise<CoinReminderStats> {
  const stats: CoinReminderStats = { enabled: true, candidates: 0, sent: 0, skipped: 0, errors: 0 }
  const startedAt = Date.now()
  const budget = opts.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS
  try {
    const { data: srows, error: serr } = await db.from('site_settings').select('key, value')
      .in('key', ['loyalty_enabled', 'loyalty_expiry_reminder_enabled', 'loyalty_expiry_days', 'loyalty_points_label'])
    if (serr) throw new Error('settings read failed: ' + serr.message)
    const s = Object.fromEntries(((srows ?? []) as Array<{ key: string; value: string }>).map(r => [r.key, String(r.value ?? '').trim()]))
    if (s.loyalty_enabled === 'false' || s.loyalty_expiry_reminder_enabled === 'false' || s.loyalty_expiry_days === '0') {
      stats.enabled = false
      return stats
    }
    const { data, error } = await db.rpc('loyalty_expiry_reminder_candidates', { p_within_days: REMINDER_DAYS, p_limit: Math.max(1, opts.limit ?? DEFAULT_LIMIT) })
    if (error) throw new Error('candidates read failed (migration v40 applied?): ' + error.message)
    const list = (data ?? []) as Candidate[]
    stats.candidates = list.length
    const siteUrl = emailSiteUrl()

    for (const c of list) {
      if (budget - (Date.now() - startedAt) < WORST_CASE_SEND_MS) { stats.timeBudgetHit = true; break }
      const email = (c.email ?? '').trim()
      if (!email.includes('@') || !(Number(c.coins) > 0)) { stats.skipped++; continue }
      try {
        const { data: won, error: claimErr } = await db.from('loyalty_expiry_reminders')
          .upsert({ customer_id: c.customer_id, expires_on: c.expires_on, coins: Number(c.coins) }, { onConflict: 'customer_id,expires_on', ignoreDuplicates: true })
          .select('id')
        if (claimErr) throw new Error('claim failed: ' + claimErr.message)
        if (!won || won.length === 0) { stats.skipped++; continue }
        const { subject, html } = coinExpiryEmail({ firstName: c.first_name, coins: Number(c.coins), expiresOn: c.expires_on, balance: Number(c.balance), label: s.loyalty_points_label, expiryDays: s.loyalty_expiry_days }, siteUrl)
        const result = await sendTransactionalEmail({ type: 'coin_expiry_reminder', to: email, subject, html, context: { customer_id: c.customer_id, expires_on: c.expires_on } })
        if (result.sent || result.deadLettered) stats.sent++
        else {
          await db.from('loyalty_expiry_reminders').delete().eq('customer_id', c.customer_id).eq('expires_on', c.expires_on)
          stats.errors++
        }
      } catch (e) {
        stats.errors++
        captureError(e, { action: 'cron.coin_expiry_reminders.customer', customer_id: String(c.customer_id) })
      }
    }
  } catch (e) {
    stats.errors++
    captureError(e, { action: 'cron.coin_expiry_reminders', alert: true })
  }
  logger.info('cron: coin expiry reminders finished', { action: 'cron.coin_expiry_reminders', ...stats })
  return stats
}
