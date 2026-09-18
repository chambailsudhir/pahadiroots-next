/**
 * ProductGallery.test.ts
 *
 * ProductGallery.tsx had ZERO test coverage before this file, despite the
 * audit specifically naming it in the "zero PDP test coverage" finding, and
 * despite carrying real accessibility logic (focus trap, Escape-to-close,
 * focus restoration) documented in its own bug-fix comments.
 *
 * Covers:
 *   1. Empty-state fallback when there are no images.
 *   2. Main image renders the active index; discount badge only shows when
 *      savings >= 5.
 *   3. Thumbnail click changes the active image (aria-pressed, image counter).
 *   4. Prev/Next arrows wrap around at the ends.
 *   5. Arrows/thumbnails are omitted entirely for a single-image gallery.
 *   6. Clicking the main image opens the zoom lightbox and moves focus to the
 *      close button (WCAG 2.4.3 — focus must move into the dialog).
 *   7. Escape closes the lightbox and restores focus to the gallery trigger.
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/react'
import React from 'react'

vi.mock('next/image', () => ({
  default: (props: { alt: string; src: string }) =>
    React.createElement('img', { alt: props.alt, src: props.src }),
}))

import ProductGallery from '@/components/product/ProductGallery'

const images = [
  { url: 'img1.jpg', alt: 'Front view' },
  { url: 'img2.jpg', alt: 'Side view' },
  { url: 'img3.jpg', alt: 'Back view' },
]

describe('ProductGallery', () => {
  it('renders an emoji placeholder when there are no images (no crash, no broken <img>)', () => {
    render(React.createElement(ProductGallery, { images: [], productName: 'Wild Honey' }))
    expect(screen.getByText('🌿')).toBeTruthy()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('renders the first image as active by default', () => {
    render(React.createElement(ProductGallery, { images, productName: 'Wild Honey' }))
    expect(screen.getAllByAltText('Front view').length).toBeGreaterThan(0)
  })

  it('shows the discount badge only when savings >= 5', () => {
    const { rerender } = render(
      React.createElement(ProductGallery, { images, productName: 'Wild Honey', savings: 3 })
    )
    expect(screen.queryByText('-3%')).toBeNull()

    rerender(React.createElement(ProductGallery, { images, productName: 'Wild Honey', savings: 20 }))
    expect(screen.getByText('-20%')).toBeTruthy()
  })

  it('clicking a thumbnail changes the active image and updates aria-pressed / the counter', () => {
    render(React.createElement(ProductGallery, { images, productName: 'Wild Honey' }))
    expect(screen.getByText('1 / 3')).toBeTruthy()

    fireEvent.click(screen.getByLabelText('Image 2'))
    expect(screen.getByText('2 / 3')).toBeTruthy()
    expect(screen.getByLabelText('Image 2').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByLabelText('Image 1').getAttribute('aria-pressed')).toBe('false')
  })

  it('Next wraps from the last image back to the first', () => {
    render(React.createElement(ProductGallery, { images, productName: 'Wild Honey' }))
    fireEvent.click(screen.getByLabelText('Image 3')) // go to last
    expect(screen.getByText('3 / 3')).toBeTruthy()

    fireEvent.click(screen.getAllByLabelText('Next image')[0])
    expect(screen.getByText('1 / 3')).toBeTruthy()
  })

  it('Previous wraps from the first image back to the last', () => {
    render(React.createElement(ProductGallery, { images, productName: 'Wild Honey' }))
    fireEvent.click(screen.getAllByLabelText('Previous image')[0])
    expect(screen.getByText('3 / 3')).toBeTruthy()
  })

  it('omits arrows, thumbnails, and the counter for a single-image gallery', () => {
    render(React.createElement(ProductGallery, { images: [images[0]], productName: 'Wild Honey' }))
    expect(screen.queryByLabelText('Next image')).toBeNull()
    expect(screen.queryByLabelText('Previous image')).toBeNull()
    expect(screen.queryByLabelText('Image 1')).toBeNull() // no thumbnail row
    expect(screen.queryByText('1 / 1')).toBeNull()
  })

  it('opens the zoom lightbox on main-image click and moves focus to the close button', () => {
    render(React.createElement(ProductGallery, { images, productName: 'Wild Honey' }))
    fireEvent.click(screen.getByLabelText('View full image'))

    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeTruthy()
    expect(dialog.getAttribute('aria-label')).toBe('Wild Honey — full size image')
    // Focus moves into the modal — specifically to the close button (WCAG 2.4.3)
    expect(document.activeElement).toBe(screen.getByLabelText('Close image zoom (Escape)'))
  })

  it('Escape closes the lightbox and restores focus to the gallery trigger', async () => {
    render(React.createElement(ProductGallery, { images, productName: 'Wild Honey' }))
    fireEvent.click(screen.getByLabelText('View full image'))
    expect(screen.getByRole('dialog')).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()

    // Focus restoration happens inside a setTimeout(0,...) — flush it.
    await new Promise(r => setTimeout(r, 0))
    expect(document.activeElement).toBe(screen.getByLabelText('View full image'))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// MISSING FEATURE FIX — touch-swipe navigation on the main image
// (the gallery had prev/next arrows and thumbnail taps, but no swipe —
// the interaction mobile shoppers reach for first). Had ZERO test coverage
// despite the file having its own test suite.
// ─────────────────────────────────────────────────────────────────────────────
describe('ProductGallery — touch-swipe navigation', () => {
  it('a left swipe past the 40px threshold advances to the next image', () => {
    render(React.createElement(ProductGallery, { images, productName: 'Wild Honey' }))
    const trigger = screen.getByLabelText('View full image')
    fireEvent.touchStart(trigger, { touches: [{ clientX: 300, clientY: 100 }] })
    fireEvent.touchEnd(trigger, { changedTouches: [{ clientX: 250, clientY: 100 }] }) // dx=-50
    expect(screen.getByText('2 / 3')).toBeTruthy()
  })

  it('a right swipe past the threshold goes to the previous image (wraps to last from first)', () => {
    render(React.createElement(ProductGallery, { images, productName: 'Wild Honey' }))
    const trigger = screen.getByLabelText('View full image')
    fireEvent.touchStart(trigger, { touches: [{ clientX: 200, clientY: 100 }] })
    fireEvent.touchEnd(trigger, { changedTouches: [{ clientX: 260, clientY: 100 }] }) // dx=+60
    expect(screen.getByText('3 / 3')).toBeTruthy()
  })

  it('ignores a swipe shorter than the 40px threshold (treated as a tap/jitter, not a swipe)', () => {
    render(React.createElement(ProductGallery, { images, productName: 'Wild Honey' }))
    const trigger = screen.getByLabelText('View full image')
    fireEvent.touchStart(trigger, { touches: [{ clientX: 300, clientY: 100 }] })
    fireEvent.touchEnd(trigger, { changedTouches: [{ clientX: 285, clientY: 100 }] }) // dx=-15
    expect(screen.getByText('1 / 3')).toBeTruthy()
  })

  it('ignores a mostly-vertical touch (page scroll), even if the horizontal delta alone would pass the threshold', () => {
    render(React.createElement(ProductGallery, { images, productName: 'Wild Honey' }))
    const trigger = screen.getByLabelText('View full image')
    fireEvent.touchStart(trigger, { touches: [{ clientX: 300, clientY: 100 }] })
    // dx=-50 (would pass on its own), but dy=-120 is larger — a vertical scroll, not a swipe.
    fireEvent.touchEnd(trigger, { changedTouches: [{ clientX: 250, clientY: -20 }] })
    expect(screen.getByText('1 / 3')).toBeTruthy()
  })

  it('does not throw or navigate on a single-image gallery (no swipe target, no thumbnail row either)', () => {
    render(React.createElement(ProductGallery, { images: [images[0]], productName: 'Wild Honey' }))
    const trigger = screen.getByLabelText('View full image')
    expect(() => {
      fireEvent.touchStart(trigger, { touches: [{ clientX: 300, clientY: 100 }] })
      fireEvent.touchEnd(trigger, { changedTouches: [{ clientX: 100, clientY: 100 }] })
    }).not.toThrow()
    expect(screen.queryByText(/\d \/ \d/)).toBeNull() // counter is still absent, same as the base single-image test
  })

  it('a swipe does not also open the zoom lightbox via the synthetic click that follows it on real touch devices', () => {
    render(React.createElement(ProductGallery, { images, productName: 'Wild Honey' }))
    const trigger = screen.getByLabelText('View full image')
    fireEvent.touchStart(trigger, { touches: [{ clientX: 300, clientY: 100 }] })
    fireEvent.touchEnd(trigger, { changedTouches: [{ clientX: 250, clientY: 100 }] })
    expect(screen.getByText('2 / 3')).toBeTruthy() // the swipe itself worked
    fireEvent.click(trigger) // the browser's own follow-up synthetic click after touchend
    expect(screen.queryByRole('dialog')).toBeNull() // must NOT have opened the lightbox

    // A genuine subsequent tap (no swipe before it) still opens the lightbox normally —
    // the didSwipeRef flag must reset after consuming one click, not stay stuck forever.
    fireEvent.click(trigger)
    expect(screen.getByRole('dialog')).toBeTruthy()
  })
})
