'use client'
import { useState, useRef, useEffect } from 'react'

export type ToastType = 'success' | 'error'

export function useToast() {
  const [toast,     setToast]     = useState('')
  const [toastType, setToastType] = useState<ToastType>('success')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  function show(msg: string, type: ToastType = 'success') {
    if (timerRef.current) clearTimeout(timerRef.current)
    setToast(msg)
    setToastType(type)
    timerRef.current = setTimeout(() => setToast(''), 3500)
  }

  return { toast, toastType, show }
}
