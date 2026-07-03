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
