'use client'
import { useState, useRef, useEffect, useCallback } from 'react'

export type ToastType = 'success' | 'error'

export function useToast() {
  const [toast,     setToast]     = useState('')
  const [toastType, setToastType] = useState<ToastType>('success')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  // BUG FIX: was a plain function, recreated with a new reference on every
  // render of useToast()'s consumer. Any effect elsewhere that correctly
  // included `showToast` in its dependency array (e.g.
  // NotificationsSection.tsx) would re-run on every unrelated parent
  // re-render — and it's why LoyaltySection's effect couldn't safely add it
  // as a dependency either (would have caused constant loyalty-data
  // refetches). useCallback with an empty dependency array gives this a
  // stable identity across the component's lifetime.
  const show = useCallback((msg: string, type: ToastType = 'success') => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setToast(msg)
    setToastType(type)
    timerRef.current = setTimeout(() => setToast(''), 3500)
  }, [])

  return { toast, toastType, show }
}
