'use client'

import { useReportWebVitals } from 'next/web-vitals'
import { ga4Event } from '@/lib/analytics/ga4'

/**
 * Real-user Core Web Vitals (LCP, INP, CLS, FCP, TTFB) from every visitor's own device and network, sent to Google Analytics 4
 * the way Google documents it — one event per metric, value in ms (CLS ×1000), `metric_rating` = good / needs-improvement / poor.
 * Lab tools (Lighthouse) simulate a slow phone; Google ranks on this field data, so this is the number to watch
 * (GA4 → Reports → Events → LCP / INP / CLS, or Explore with `metric_rating`). Respects cookie consent via ga4Event.
 */
export function vitalsEventParams(m: { name: string; value: number; delta: number; id: string; rating?: string }) {
  const scale = m.name === 'CLS' ? 1000 : 1
  return {
    value: Math.round(m.delta * scale),
    metric_id: m.id,
    metric_value: Math.round(m.value * scale),
    metric_rating: m.rating ?? 'unknown',
    non_interaction: true,
  }
}

export default function WebVitalsReporter() {
  useReportWebVitals(metric => {
    ga4Event(metric.name, vitalsEventParams(metric as never))
  })
  return null
}
