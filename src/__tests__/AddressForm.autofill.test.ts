/**
 * AddressForm.autofill.test.ts
 *
 * Regression tests for the checkout autofill fixes (pincode → city/state
 * lookup). This surface had ZERO test coverage before this file, which is
 * exactly how the underlying bugs shipped unnoticed:
 *
 *   1. [BUG FIX — cache poisoning] An ABORTED pincode lookup (timeout, a
 *      newer keystroke superseding it, or unmount) was cached identically to
 *      a genuine "no such pincode" API response. One slow/interrupted lookup
 *      permanently disabled autofill for that pincode for the rest of the
 *      session — even retyping the exact same valid pincode later would
 *      short-circuit straight to the poisoned `null` cache entry and never
 *      hit the network again.
 *
 *   2. [BUG FIX — unbounded wait] The lookup fetch had no timeout at all —
 *      only cancelled when the user typed a new pincode. A hung/slow
 *      response left the "Looking up pincode" spinner running forever with
 *      no way for the user to know it had failed.
 *
 *   3. [BUG FIX — silent failure] A failed lookup (timeout or genuine
 *      no-match) produced zero user-facing feedback — the spinner just
 *      disappeared and city/state silently stayed blank. Now an explicit
 *      message tells the user to fill them in manually.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import React from 'react'
import AddressForm from '@/components/checkout/AddressForm'
import type { OrderAddress } from '@/types'

function baseAddr(overrides: Partial<OrderAddress> = {}): OrderAddress {
  return {
    name: 'Test User', phone: '9876543210', flat: '', area: '',
    city: '', state: 'Uttarakhand', pincode: '', label: 'Home',
    ...overrides,
  }
}

function setup(addrOverrides: Partial<OrderAddress> = {}, extraProps: Record<string, unknown> = {}) {
  const onChange = vi.fn()
  const addr = baseAddr(addrOverrides)
  const utils = render(
    React.createElement(AddressForm, {
      addr,
      email: '',
      touched: {},
      onChange,
      onEmailChange: vi.fn(),
      onTouch: vi.fn(),
      selectedSavedIdx: null,
      ...extraProps,
    })
  )
  return { onChange, ...utils }
}

// Standard successful postalpincode.in-shaped response
function pincodeApiSuccess(district: string, state: string) {
  return {
    ok: true,
    json: async () => ([{ PostOffice: [{ District: district, State: state }] }]),
  }
}

function pincodeApiNotFound() {
  return { ok: true, json: async () => ([{ PostOffice: null }]) }
}

describe('AddressForm — pincode autofill', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('fills city and state on a successful lookup', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      pincodeApiSuccess('Dehradun', 'Uttarakhand')
    )
    const { onChange } = setup()

    const pin = screen.getByPlaceholderText('248001')
    await act(async () => {
      fireEvent.change(pin, { target: { value: '248001' } })
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(onChange).toHaveBeenCalledWith('city', 'Dehradun')
    expect(onChange).toHaveBeenCalledWith('state', 'Uttarakhand')
  })

  it('[BUG FIX] shows a visible error message when the lookup genuinely finds nothing — not a silent no-op', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(pincodeApiNotFound())
    setup()

    const pin = screen.getByPlaceholderText('248001')
    await act(async () => {
      fireEvent.change(pin, { target: { value: '999999' } })
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(
      screen.getByText('Could not auto-detect — please enter city & state below')
    ).toBeTruthy()
  })

  it('[BUG FIX] a hung request does not spin forever — it times out and shows the failure message', async () => {
    // fetch that never resolves on its own — only the internal timeout's
    // AbortController will end it.
    ;(global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      (_url: string, opts?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          opts?.signal?.addEventListener('abort', () => {
            const err = new Error('aborted')
            err.name = 'AbortError'
            reject(err)
          })
        })
    )
    setup()

    const pin = screen.getByPlaceholderText('248001')
    fireEvent.change(pin, { target: { value: '110001' } })

    // Spinner should be up immediately, no message yet
    expect(screen.getByLabelText('Looking up pincode')).toBeTruthy()

    // Advance past the 5s internal timeout. advanceTimersByTimeAsync (rather
    // than the sync advanceTimersByTime + a manual Promise.resolve() loop,
    // and rather than testing-library's waitFor — which polls on REAL time
    // and hangs indefinitely once real timers are faked out) flushes
    // microtasks between ticks, which is what lets the AbortController's
    // rejection actually propagate through React's update queue.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_001)
    })

    expect(
      screen.getByText('Could not auto-detect — please enter city & state below')
    ).toBeTruthy()
    expect(screen.queryByLabelText('Looking up pincode')).toBeNull()
  })

  it('[BUG FIX — cache poisoning] a timed-out pincode can be retried later and succeed, instead of being permanently marked "not found"', async () => {
    const mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)

    // First attempt on 560001: hangs until aborted (simulated timeout)
    mockFetch.mockImplementationOnce(
      (_url: string, opts?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          opts?.signal?.addEventListener('abort', () => {
            const err = new Error('aborted')
            err.name = 'AbortError'
            reject(err)
          })
        })
    )

    const { onChange } = setup()
    const pin = screen.getByPlaceholderText('248001')

    fireEvent.change(pin, { target: { value: '560001' } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_001) // trips the internal timeout
    })
    expect(
      screen.getByText('Could not auto-detect — please enter city & state below')
    ).toBeTruthy()
    expect(onChange).not.toHaveBeenCalledWith('city', expect.anything())

    // Second attempt on the SAME pincode: network has recovered now.
    // If the abort had been cached as a permanent "not found" (the bug),
    // this would short-circuit to the cache and never call fetch again —
    // city/state would never get filled no matter how many times the user
    // retries.
    mockFetch.mockResolvedValueOnce(pincodeApiSuccess('Bengaluru', 'Karnataka'))

    // Clear the field then re-enter the same pincode to trigger a fresh lookup
    fireEvent.change(pin, { target: { value: '' } })
    fireEvent.change(pin, { target: { value: '560001' } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(onChange).toHaveBeenCalledWith('city', 'Bengaluru')
    expect(onChange).toHaveBeenCalledWith('state', 'Karnataka')
  })

  it('a genuine "no such pincode" response IS cached — retyping it does not re-hit the network', async () => {
    const mockFetch = vi.fn().mockResolvedValue(pincodeApiNotFound())
    vi.stubGlobal('fetch', mockFetch)
    setup()

    const pin = screen.getByPlaceholderText('248001')
    fireEvent.change(pin, { target: { value: '000000' } })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(mockFetch).toHaveBeenCalledTimes(1)

    fireEvent.change(pin, { target: { value: '' } })
    fireEvent.change(pin, { target: { value: '000000' } })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    // Genuine negative results are still cached — this is intentional
    // (don't hammer the API for a pincode that really doesn't exist).
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('typing a new pincode before the previous lookup resolves does not let the stale result overwrite the new one', async () => {
    const mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)

    let resolveFirst!: (v: unknown) => void
    mockFetch.mockImplementationOnce(
      () => new Promise(res => { resolveFirst = res })
    )
    mockFetch.mockResolvedValueOnce(pincodeApiSuccess('Chennai', 'Tamil Nadu'))

    const { onChange } = setup()
    const pin = screen.getByPlaceholderText('248001')

    fireEvent.change(pin, { target: { value: '600001' } }) // first lookup, still pending
    fireEvent.change(pin, { target: { value: '' } })
    fireEvent.change(pin, { target: { value: '600002' } }) // supersedes it

    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    // Now let the FIRST (stale, superseded) request resolve
    await act(async () => {
      resolveFirst(pincodeApiSuccess('Old Result City', 'Old State'))
      await Promise.resolve()
      await Promise.resolve()
    })

    // Stale result must never reach onChange
    expect(onChange).not.toHaveBeenCalledWith('city', 'Old Result City')
    expect(onChange).toHaveBeenCalledWith('city', 'Chennai')
  })
})

describe('AddressForm — saved-address prefill loading indicator', () => {
  it('[BUG FIX] shows a loading status when prefillLoading=true so the form does not look frozen', () => {
    setup({}, { prefillLoading: true })
    expect(screen.getByText('Loading your saved details…')).toBeTruthy()
    expect(screen.getByRole('status', { name: '' })).toBeTruthy()
  })

  it('shows nothing extra when prefillLoading is false/omitted', () => {
    setup()
    expect(screen.queryByText('Loading your saved details…')).toBeNull()
  })
})
