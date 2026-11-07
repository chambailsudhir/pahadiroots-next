import { describe, it, expect, vi } from 'vitest'
vi.mock('server-only', () => ({}))
vi.mock('@/lib/server/email', () => ({ sendTransactionalEmail: vi.fn(async () => ({ sent: true })) }))
vi.mock('@/lib/logger', () => ({ captureError: vi.fn(), logger: { info: vi.fn(), warn: vi.fn() } }))
import { coinExpiryEmail, formatExpiryDate, sendCoinExpiryReminders } from '@/lib/server/coinExpiryReminders'
import { sendTransactionalEmail } from '@/lib/server/email'
import { expirySpan } from '@/lib/loyaltyCoins'
import { nextExpiryCopy } from '@/app/account/_sections/LoyaltySection'

describe('coin expiry wording', () => {
  it('formats dates and spans', () => {
    expect(formatExpiryDate('2027-03-06')).toBe('6 March 2027')
    expect(expirySpan('120')).toBe('4 months')
    expect(expirySpan(0)).toBeNull()
    expect(expirySpan('')).toBe('4 months')
    expect(nextExpiryCopy({ date: '2027-03-06', coins: 20 })).toBe('⏰ 20 coins expire on 6 March 2027')
    expect(nextExpiryCopy({ date: '2027-03-06', coins: 1 })).toBe('⏰ 1 coin expires on 6 March 2027')
  })
  it('builds an escaped e-mail with the amount, date and span', () => {
    const { subject, html } = coinExpiryEmail({ firstName: '<b>Asha</b>', coins: 25, expiresOn: '2027-03-06', balance: 40, expiryDays: '120' }, 'https://www.pahadiroots.com')
    expect(subject).toBe('25 Pahadi Coins start expiring on 6 March 2027')
    expect(html).toContain('&lt;b&gt;Asha')
    expect(html).toContain('worth ₹25')
    expect(html).toContain('4 months')
    expect(html).toContain('/policies/terms')
  })
})

function fakeDb(opts: { settings?: Record<string, string>; candidates?: unknown[]; claimWins?: boolean }) {
  const deletes: unknown[] = []
  const db = {
    from(table: string) {
      if (table === 'site_settings') return { select: () => ({ in: async () => ({ data: Object.entries(opts.settings ?? {}).map(([key, value]) => ({ key, value })), error: null }) }) }
      return {
        upsert: () => ({ select: async () => ({ data: opts.claimWins === false ? [] : [{ id: 1 }], error: null }) }),
        delete: () => ({ eq: () => ({ eq: async () => { deletes.push(1); return { error: null } } }) }),
      }
    },
    rpc: async () => ({ data: opts.candidates ?? [], error: null }),
  }
  return { db: db as never, deletes }
}

describe('sendCoinExpiryReminders', () => {
  const cand = { customer_id: 7, email: 'a@example.com', first_name: 'A', expires_on: '2027-03-06', coins: 20, balance: 30 }
  it('sends once per claimed candidate', async () => {
    vi.mocked(sendTransactionalEmail).mockClear()
    const { db } = fakeDb({ candidates: [cand] })
    const r = await sendCoinExpiryReminders(db)
    expect(r.sent).toBe(1)
    expect(vi.mocked(sendTransactionalEmail).mock.calls[0][0]).toMatchObject({ type: 'coin_expiry_reminder', to: 'a@example.com' })
  })
  it('skips when another run already claimed it', async () => {
    vi.mocked(sendTransactionalEmail).mockClear()
    const { db } = fakeDb({ candidates: [cand], claimWins: false })
    expect((await sendCoinExpiryReminders(db)).sent).toBe(0)
    expect(sendTransactionalEmail).not.toHaveBeenCalled()
  })
  it('releases the claim when the send failed outright', async () => {
    vi.mocked(sendTransactionalEmail).mockResolvedValueOnce({ sent: false })
    const { db, deletes } = fakeDb({ candidates: [cand] })
    const r = await sendCoinExpiryReminders(db)
    expect(r.errors).toBe(1); expect(deletes.length).toBe(1)
  })
  it('does nothing when expiry or loyalty is off', async () => {
    expect((await sendCoinExpiryReminders(fakeDb({ settings: { loyalty_expiry_days: '0' }, candidates: [cand] }).db)).enabled).toBe(false)
    expect((await sendCoinExpiryReminders(fakeDb({ settings: { loyalty_enabled: 'false' }, candidates: [cand] }).db)).enabled).toBe(false)
  })
})

// R6-1 (Nov 2026): a time-budget shortfall must alert instead of silently leaving customers un-reminded.
describe('sendCoinExpiryReminders — budget shortfall', () => {
  it('alerts when the budget runs out with candidates still unsent', async () => {
    const { captureError } = await import('@/lib/logger')
    vi.mocked(captureError).mockClear()
    const cands = [1, 2, 3].map(i => ({ customer_id: i, email: `c${i}@example.com`, first_name: 'C', expires_on: '2027-03-06', coins: 20, balance: 30 }))
    const r = await sendCoinExpiryReminders(fakeDb({ candidates: cands }).db, { timeBudgetMs: 1_000 })
    expect(r.timeBudgetHit).toBe(true)
    expect(r.sent).toBe(0)
    expect(vi.mocked(captureError)).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ action: 'cron.coin_expiry_reminders.budget', alert: true, unsent: 3 }))
  })
})

