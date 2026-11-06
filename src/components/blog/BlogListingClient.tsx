'use client'

// PERF FIX (F-3): /blog read `?category=` in the Server Component, which made
// the route dynamic on every request (no ISR, every visit hit Supabase for the
// posts AND the category list). The server now renders the default listing
// from the ISR cache and this wrapper applies the category chip in the browser:
// same URLs (/blog?category=recipes), same BlogListing markup.
import { useCallback, useMemo, useState } from 'react'
import SearchParamsBridge from '@/components/ui/SearchParamsBridge'
import BlogListing, { type PostCard } from './BlogListing'

import { BLOG_LISTING_LIMIT } from '@/lib/listingLimits'
export { BLOG_LISTING_LIMIT }

/** The posts one view shows: newest `BLOG_LISTING_LIMIT` overall, or of the chosen category. */
export function selectPosts(posts: PostCard[] | null, category: string | undefined): PostCard[] | null {
  if (!posts) return null
  const list = category ? posts.filter(p => p.category === category) : posts
  return list.slice(0, BLOG_LISTING_LIMIT)
}

interface Props { posts: PostCard[] | null; categories: string[] }

export default function BlogListingClient({ posts, categories }: Props) {
  const [category, setCategory] = useState<string | undefined>(undefined)
  const onChange = useCallback((sp: URLSearchParams) => setCategory(sp.get('category') || undefined), [])
  const visible = useMemo(() => selectPosts(posts, category), [posts, category])
  return (
    <>
      <SearchParamsBridge onChange={onChange} />
      <BlogListing posts={visible} categories={categories} category={category} />
    </>
  )
}
