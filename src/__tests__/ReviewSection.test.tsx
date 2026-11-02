// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import ReviewSection from '@/components/cart/ReviewSection'

describe('cart ReviewSection — real ratings, no placeholders', () => {
  it('renders nothing when there are no reviews', () => {
    const { container } = render(<ReviewSection reviews={[]} />)
    expect(container.firstChild).toBeNull()
  })
  it('draws the review\'s OWN stars (it used to always draw five)', () => {
    render(<ReviewSection reviews={[{ name: 'Rahul R.', location: 'Pune', text: 'Decent', rating: 3 }]} />)
    expect(screen.getByRole('img', { name: '3 out of 5 stars' }).textContent).toBe('★★★☆☆')
  })
  it('shows name and location, and omits the comma when there is no location', () => {
    const { rerender } = render(<ReviewSection reviews={[{ name: 'Anita K.', location: 'Pune', text: 'Great', rating: 5 }]} />)
    expect(screen.getByText('— Anita K., Pune')).toBeTruthy()
    rerender(<ReviewSection reviews={[{ name: 'Anita K.', location: '', text: 'Great', rating: 5 }]} />)
    expect(screen.getByText('— Anita K.')).toBeTruthy()
  })
  it('clamps a bad rating into 1–5', () => {
    render(<ReviewSection reviews={[{ name: 'A B.', location: '', text: 'x', rating: 11 }]} />)
    expect(screen.getByRole('img', { name: '5 out of 5 stars' })).toBeTruthy()
  })
})
