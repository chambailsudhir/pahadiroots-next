import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4">
      <div className="text-center">
        <div className="text-6xl mb-4">🌿</div>
        <h1 className="text-2xl font-bold text-stone-900 mb-2">Page not found</h1>
        <p className="text-stone-500 text-sm mb-6 max-w-sm mx-auto">
          The page you&apos;re looking for doesn&apos;t exist. It may have been moved or removed.
        </p>
        <div className="flex gap-3 justify-center">
          <Link href="/" className="px-5 py-2.5 bg-forest-700 hover:bg-forest-800 text-white font-semibold rounded-xl text-sm transition-colors">
            Go Home
          </Link>
          <Link href="/products" className="px-5 py-2.5 border border-stone-200 hover:border-forest-400 text-stone-600 font-semibold rounded-xl text-sm transition-colors">
            Browse Products
          </Link>
        </div>
      </div>
    </div>
  )
}
