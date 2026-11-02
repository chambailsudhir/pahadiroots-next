// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, cleanup } from '@testing-library/react'
import PhoneVerify, { POLL_MS, POLL_MAX_MS } from '@/app/account/_components/PhoneVerify'

type Handler = (url: string, init?: RequestInit) => { ok: boolean; status?: number; json: unknown }
let handler: Handler
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve() }) }

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const r = handler(String(url), init)
    return { ok: r.ok, status: r.status ?? (r.ok ? 200 : 400), json: async () => r.json }
  }))
  vi.spyOn(window, 'open').mockImplementation(() => null)
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

const base = (over: Record<string, unknown> = {}) => ({ phone: '9876543210', initiallyVerified: false, savedPhone: '9876543210', ...over })

describe('<PhoneVerify />', () => {
  it('renders nothing while the feature is disabled', async () => {
    handler = () => ({ ok: true, json: { enabled: false } })
    const { container } = render(<PhoneVerify {...base()} />)
    await flush()
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing when the enabled probe fails', async () => {
    handler = () => ({ ok: false, status: 500, json: {} })
    const { container } = render(<PhoneVerify {...base()} />)
    await flush()
    expect(container.innerHTML).toBe('')
  })

  it('shows "Verified ✓" for a verified saved number, and hides it once the number is edited', async () => {
    handler = () => ({ ok: true, json: { enabled: true } })
    const { rerender } = render(<PhoneVerify {...base({ initiallyVerified: true })} />)
    await flush()
    expect(screen.getByText('Verified ✓')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /verify with whatsapp/i })).toBeNull()
    rerender(<PhoneVerify {...base({ initiallyVerified: true, phone: '9876543211' })} />)
    expect(screen.queryByText('Verified ✓')).toBeNull()
    expect(screen.getByRole('button', { name: /verify with whatsapp/i })).toBeTruthy()
  })

  it('button is disabled until the number is a valid mobile', async () => {
    handler = () => ({ ok: true, json: { enabled: true } })
    render(<PhoneVerify {...base({ phone: '12345' })} />)
    await flush()
    expect((screen.getByRole('button', { name: /verify with whatsapp/i }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('start -> opens wa.me in a new tab -> pending (live region) -> polls -> success', async () => {
    let polls = 0
    handler = (url) => {
      if (url.endsWith('/enabled')) return { ok: true, json: { enabled: true } }
      if (url.endsWith('/start')) return { ok: true, json: { whatsappUrl: 'https://wa.me/919800000000?text=VERIFY%20482913', code: '482913', expiresInSeconds: 600 } }
      polls++
      return { ok: true, json: polls < 3 ? { verified: false, phone: '9876543210', pending: true } : { verified: true, phone: '9876543210', pending: false } }
    }
    const onVerified = vi.fn()
    render(<PhoneVerify {...base()} onVerified={onVerified} />)
    await flush()
    await act(async () => { screen.getByRole('button', { name: /verify with whatsapp/i }).click() })
    await flush()
    expect(window.open).toHaveBeenCalledWith('https://wa.me/919800000000?text=VERIFY%20482913', '_blank', 'noopener,noreferrer')
    const live = screen.getByRole('status')
    expect(live.textContent).toContain('VERIFY 482913')
    const again = screen.getByRole('link', { name: /open whatsapp again/i })
    expect(again.getAttribute('rel')).toContain('noopener')
    expect(again.getAttribute('target')).toBe('_blank')

    for (let i = 0; i < 3; i++) { await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS) }) }
    expect(onVerified).toHaveBeenCalledWith('9876543210')
    expect(screen.getByText('Verified ✓')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain('verified')
  })

  it('expires after two minutes without a match and offers to retry', async () => {
    handler = (url) => {
      if (url.endsWith('/enabled')) return { ok: true, json: { enabled: true } }
      if (url.endsWith('/start')) return { ok: true, json: { whatsappUrl: 'https://wa.me/1?text=x', code: '111111', expiresInSeconds: 600 } }
      return { ok: true, json: { verified: false, phone: '9876543210', pending: true } }
    }
    render(<PhoneVerify {...base()} />)
    await flush()
    await act(async () => { screen.getByRole('button', { name: /verify with whatsapp/i }).click() })
    await flush()
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MAX_MS + POLL_MS) })
    expect(screen.getByRole('status').textContent).toMatch(/did not receive your message in time/i)
    expect((screen.getByRole('button', { name: /verify with whatsapp/i }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows the server error (e.g. rate limit) in an alert', async () => {
    handler = (url) => {
      if (url.endsWith('/enabled')) return { ok: true, json: { enabled: true } }
      return { ok: false, status: 429, json: { error: 'Too many verification attempts — please try again in an hour.' } }
    }
    render(<PhoneVerify {...base()} />)
    await flush()
    await act(async () => { screen.getByRole('button', { name: /verify with whatsapp/i }).click() })
    await flush()
    expect(screen.getByRole('alert').textContent).toContain('Too many verification attempts')
    expect(window.open).not.toHaveBeenCalled()
  })
})
