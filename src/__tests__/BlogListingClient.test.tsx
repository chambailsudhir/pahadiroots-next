// @vitest-environment jsdom
/**
 * BlogListingClient.test.tsx — PERF FIX F-3: /blog is static; the ?category=
 * chip is applied in the browser from the posts the server shipped.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'

let params = new URLSearchParams('')
vi.mock('next/navigation', () => ({ useSearchParams: () => params, useRouter: () => ({ replace: vi.fn() }) }))
vi.mock('next/link', () => ({ default: ({ children, href, ...r }: any) => React.createElement('a', { href, ...r }, children) }))
vi.mock('next/image', () => ({ default: (p: any) => React.createElement('img', { src: p.src, alt: p.alt }) }))
vi.mock('@/components/story/Reveal', () => ({ default: ({ children }: any) => React.createElement('div', null, children) }))

import BlogListingClient, { selectPosts, BLOG_LISTING_LIMIT } from '@/components/blog/BlogListingClient'

const post = (i: number, category: string) => ({
  id: String(i), title: `Story ${i}`, slug: `story-${i}`, excerpt: null, cover_image: null,
  published_at: new Date(Date.UTC(2026, 0, 30 - i)).toISOString(), category, reading_time_minutes: 3, author: null,
})
const posts = [post(1, 'recipes'), post(2, 'guides'), post(3, 'recipes')]

beforeEach(() => { params = new URLSearchParams('') })

describe('selectPosts', () => {
  it('returns the newest BLOG_LISTING_LIMIT posts overall, or of the chosen category', () => {
    const many = Array.from({ length: BLOG_LISTING_LIMIT + 10 }, (_, i) => post(i, i % 2 ? 'a' : 'b'))
    expect(selectPosts(many, undefined)).toHaveLength(BLOG_LISTING_LIMIT)
    expect(selectPosts(many, 'a')!.every(p => p.category === 'a')).toBe(true)
    expect(selectPosts(many, 'a')).toHaveLength(BLOG_LISTING_LIMIT / 2 + 5)
    expect(selectPosts(null, 'a')).toBeNull()
  })
})

describe('BlogListingClient', () => {
  it('default view shows every shipped story with "All stories" selected', () => {
    render(<BlogListingClient posts={posts} categories={['recipes', 'guides']} />)
    expect(screen.getByText('Story 1')).toBeTruthy()
    expect(screen.getByText('Story 2')).toBeTruthy()
    expect(screen.getByText('3 stories')).toBeTruthy()
  })

  it('?category= narrows to that category and links the chips to the same URLs as before', () => {
    params = new URLSearchParams('category=guides')
    render(<BlogListingClient posts={posts} categories={['recipes', 'guides']} />)
    expect(screen.getByText('Story 2')).toBeTruthy()
    expect(screen.queryByText('Story 1')).toBeNull()
    expect(screen.getByText('1 story')).toBeTruthy()
    expect(screen.getByText('recipes').getAttribute('href')).toBe('/blog?category=recipes')
  })

  it('an unknown ?category= shows the empty state, as the filtered query used to', () => {
    params = new URLSearchParams('category=nope')
    render(<BlogListingClient posts={posts} categories={['recipes']} />)
    expect(screen.getByText('Stories are on their way')).toBeTruthy()
  })
})
