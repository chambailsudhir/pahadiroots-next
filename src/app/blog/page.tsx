import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { supabase } from '@/lib/supabase'
import { getSiteSettings } from '@/lib/getSiteSettings'
import { notFound } from 'next/navigation'
import { formatDate } from '@/lib/utils'

export const metadata: Metadata = {
  title:       'Blog — Pahadi Roots',
  description: 'Stories from the mountains — recipes, health tips, and tales from Himalayan farming communities.',
}

export const revalidate = 3600

export default async function BlogPage() {
  const settings = await getSiteSettings()
  if (settings.show_blog === 'false') notFound()

  let posts = null
  try {
    const { data } = await supabase
      .from('blog_posts')
      .select('id, title, slug, excerpt, cover_image, published_at')
      .eq('is_published', true)
      .order('published_at', { ascending: false })
      .limit(20)
    posts = data
  } catch (e: unknown) { console.error("[blog] posts fetch failed:", e); posts = null }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <div className="text-center mb-10">
        <h1 className="text-3xl font-bold text-stone-900 mb-2">Stories from the Mountains</h1>
        <p className="text-stone-500 text-sm max-w-md mx-auto">Recipes, health tips, and tales from Himalayan farming communities.</p>
      </div>

      {!posts || posts.length === 0 ? (
        <div className="text-center py-20">
          <div className="text-4xl mb-4">✍️</div>
          <h2 className="text-lg font-semibold text-stone-700 mb-2">Stories coming soon</h2>
          <p className="text-stone-400 text-sm">We're writing about the mountains. Check back soon!</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {posts.map(post => (
            <Link
              key={post.id}
              href={`/blog/${post.slug}`}
              className="group flex flex-col bg-white border border-stone-100 rounded-2xl overflow-hidden hover:shadow-lg transition-all"
            >
              <div className="relative aspect-[16/9] bg-stone-50">
                {post.cover_image ? (
                  <Image src={post.cover_image} alt={post.title} fill sizes="(max-width: 640px) 100vw, 33vw" className="object-cover group-hover:scale-105 transition-transform duration-300" />
                ) : (
                  <div className="absolute inset-0 bg-gradient-to-br from-forest-100 to-earth-100 flex items-center justify-center text-4xl">🏔️</div>
                )}
              </div>
              <div className="p-4 flex flex-col flex-1">
                <p className="text-xs text-stone-400 mb-1">{post.published_at ? formatDate(post.published_at) : ''}</p>
                <h2 className="text-sm font-bold text-stone-900 mb-2 line-clamp-2 group-hover:text-forest-700 transition-colors">{post.title}</h2>
                {post.excerpt && <p className="text-xs text-stone-500 line-clamp-2 leading-relaxed flex-1">{post.excerpt}</p>}
                <span className="mt-3 text-xs font-semibold text-forest-700 group-hover:text-forest-900">Read more →</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
