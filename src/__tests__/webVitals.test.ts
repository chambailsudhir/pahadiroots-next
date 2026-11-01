import { describe, it, expect } from 'vitest'
import { vitalsEventParams } from '@/components/analytics/WebVitalsReporter'

describe('vitalsEventParams (GA4 web-vitals recipe)', () => {
  it('reports ms rounded, with id and rating, as a non-interaction event', () => {
    expect(vitalsEventParams({ name: 'LCP', value: 2512.4, delta: 2512.4, id: 'v1-1', rating: 'needs-improvement' }))
      .toEqual({ value: 2512, metric_id: 'v1-1', metric_value: 2512, metric_rating: 'needs-improvement', non_interaction: true })
  })
  it('scales CLS (a tiny unitless number) by 1000 so GA4 does not round it to 0', () => {
    expect(vitalsEventParams({ name: 'CLS', value: 0.0123, delta: 0.0123, id: 'v1-2', rating: 'good' }).value).toBe(12)
  })
  it('falls back to "unknown" when no rating is given', () => {
    expect(vitalsEventParams({ name: 'TTFB', value: 300, delta: 300, id: 'x' }).metric_rating).toBe('unknown')
  })
})
