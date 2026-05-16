'use client'

import { useState } from 'react'

interface Props {
  description:   string | null
  benefits:      string[]
  howToUse:      string[]
  storageTips:   string[]
  whoShouldBuy:  string | null
}

const TABS = [
  { id: 'desc',     label: 'Description' },
  { id: 'benefits', label: 'Benefits' },
  { id: 'how',      label: 'How to Use' },
  { id: 'storage',  label: 'Storage' },
] as const

type TabId = typeof TABS[number]['id']

export default function AIContent({ description, benefits, howToUse, storageTips, whoShouldBuy }: Props) {
  const [tab, setTab] = useState<TabId>('desc')

  // Only show tabs that have content
  const visibleTabs = TABS.filter(t => {
    if (t.id === 'desc'     && !description)          return false
    if (t.id === 'benefits' && benefits.length === 0) return false
    if (t.id === 'how'      && howToUse.length === 0) return false
    if (t.id === 'storage'  && storageTips.length === 0) return false
    return true
  })

  if (!visibleTabs.length) return null

  // Auto-select first available tab
  const activeTab = visibleTabs.find(t => t.id === tab) ? tab : visibleTabs[0].id

  return (
    <section className="border-t border-stone-100 pt-10 mb-12">
      <h2 className="text-xl font-bold text-stone-900 mb-5">Product Details</h2>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-stone-100 mb-6 overflow-x-auto no-scrollbar">
        {visibleTabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-5 py-2.5 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors -mb-px ${
              activeTab === t.id
                ? 'border-forest-600 text-forest-700'
                : 'border-transparent text-stone-500 hover:text-stone-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="max-w-2xl">

        {activeTab === 'desc' && description && (
          <p className="text-stone-600 leading-relaxed text-sm">{description}</p>
        )}

        {activeTab === 'benefits' && benefits.length > 0 && (
          <ul className="space-y-3">
            {benefits.map((b, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="w-5 h-5 bg-forest-100 text-forest-700 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                  ✓
                </span>
                <span className="text-sm text-stone-600">{b}</span>
              </li>
            ))}
          </ul>
        )}

        {activeTab === 'how' && howToUse.length > 0 && (
          <ol className="space-y-4">
            {howToUse.map((step, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="w-6 h-6 bg-earth-100 text-earth-700 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                  {i + 1}
                </span>
                <span className="text-sm text-stone-600">{step}</span>
              </li>
            ))}
          </ol>
        )}

        {activeTab === 'storage' && storageTips.length > 0 && (
          <ul className="space-y-3">
            {storageTips.map((tip, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="text-base shrink-0">📦</span>
                <span className="text-sm text-stone-600">{tip}</span>
              </li>
            ))}
          </ul>
        )}

      </div>

      {/* Who should buy */}
      {whoShouldBuy && (
        <div className="mt-6 p-4 bg-forest-50 rounded-xl border border-forest-100 max-w-2xl">
          <div className="text-sm font-bold text-forest-800 mb-1">👤 Who Should Buy This?</div>
          <p className="text-sm text-forest-700">{whoShouldBuy}</p>
        </div>
      )}
    </section>
  )
}
