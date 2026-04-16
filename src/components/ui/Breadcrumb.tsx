import Link from 'next/link'

interface Crumb { label: string; href?: string }
interface Props { crumbs: Crumb[]; className?: string }

export default function Breadcrumb({ crumbs, className = '' }: Props) {
  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol className="flex items-center flex-wrap gap-1 text-xs text-stone-400">
        {crumbs.map((crumb, i) => (
          <li key={i} className="flex items-center gap-1">
            {i > 0 && <span className="text-stone-300">/</span>}
            {crumb.href ? (
              <Link href={crumb.href} className="hover:text-forest-700 transition-colors">
                {crumb.label}
              </Link>
            ) : (
              <span className="text-stone-600 font-medium">{crumb.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}
