import type { SiteSettings } from '@/types'

// ─────────────────────────────────────────────────────────────────────────────
// lib/heroStats.ts
//
// BUG FIX (found by cross-referencing the pahadi-admin repo directly):
// HeroBanner.tsx's stats bar was almost entirely disconnected from the
// admin panel. The admin's "Hero Stats Bar" section (pahadi-admin
// src/app/admin/settings/page.jsx, StatsSection component) manages 4
// stats — Farmer Families, Himalayan States, Happy Customers, Avg
// Dispatch — each with its own value, label, and show/hide toggle,
// under these exact keys:
//
//   stat_farmer_families / stat_farmer_label / stat_hide_stat_farmer_families
//   stat_himalayan_states / stat_states_label / stat_hide_stat_himalayan_states
//   stat_happy_customers / stat_customers_label / stat_hide_stat_happy_customers
//   stat_avg_dispatch / stat_dispatch_label / stat_hide_stat_avg_dispatch
//
// Before this fix, HeroBanner.tsx hardcoded "500+ Farmer Families",
// "10K+ Happy Customers", "48hr Avg Dispatch" as plain strings — none of
// which read from settings at all — and its 4th stat used a DIFFERENT,
// nonexistent key (`states_covered`) that the admin panel never writes
// to (its real key is `stat_himalayan_states`). None of the 4 hide
// toggles were ever checked either, so a store owner hiding a stat in
// the admin panel had no effect on the live site.
//
// The admin UI shows a separate suffix hint next to each number field
// ("+", "+", "k+", "hr") rather than storing it in the value — formatSuffix
// below reproduces that exact mapping so the display matches what the
// admin panel implies it will look like.
// ─────────────────────────────────────────────────────────────────────────────

export interface HeroStat {
  key: 'farmers' | 'states' | 'customers' | 'dispatch'
  num: string
  lbl: string
}

function formatCustomers(raw: string): string {
  const n = parseFloat(raw)
  if (isNaN(n)) return `${raw}+`
  // Admin's default is '10000' with a "k+" suffix hint, implying values
  // are entered as full numbers and abbreviated for display (10000 ->
  // "10k+"). Guarded to avoid a nonsensical "0.5k+" if a store ever
  // enters a sub-1000 customer count — '+' alone reads fine at that size.
  if (n >= 1000) return `${Math.round(n / 1000)}k+`
  return `${Math.round(n)}+`
}

/** The Himalayan-states figure alone — used by AnnouncementBar.tsx and
 *  WhySection.tsx, which each need just this one number, not the full
 *  4-stat array. Kept as the single source both HeroBanner (via
 *  getHeroStats) and these two components read from, so they can't
 *  drift apart again the way HeroBanner/WhySection previously did. */
/** Overlay the REAL number of active states (from the `states` table the
 *  admin manages) onto the settings object, so every place that shows a
 *  "Himalayan States" figure (hero stat, top announcement bar, Why section,
 *  About page) follows the admin automatically: activate 4 states → "4",
 *  activate 10 → "10". The manual `stat_himalayan_states` admin field is only
 *  used as a fallback when no states can be loaded (count 0). */
export function withLiveStateCount(settings: SiteSettings, activeStateCount: number): SiteSettings {
  if (!Number.isFinite(activeStateCount) || activeStateCount <= 0) return settings
  return { ...settings, stat_himalayan_states: String(activeStateCount), stat_states_live: 'true' }
}

export function getStatesCovered(settings: SiteSettings): string {
  return settings.stat_himalayan_states || '10'
}

/** Full hero stats bar: 4 stats in display order, already filtered to
 *  exclude any the admin has hidden. */
export function getHeroStats(settings: SiteSettings): HeroStat[] {
  const all: Array<HeroStat & { hidden: boolean }> = [
    {
      key: 'farmers',
      num: `${settings.stat_farmer_families || '50'}+`,
      lbl: settings.stat_farmer_label || 'Farmer Families',
      hidden: settings.stat_hide_stat_farmer_families === 'true',
    },
    {
      key: 'states',
      // A live count is exact ("4"), so no "+" — the "+" only made sense for
      // the old hand-typed marketing number.
      num: settings.stat_states_live === 'true' ? getStatesCovered(settings) : `${getStatesCovered(settings)}+`,
      lbl: settings.stat_states_label || 'Himalayan States',
      hidden: settings.stat_hide_stat_himalayan_states === 'true',
    },
    {
      key: 'customers',
      num: formatCustomers(settings.stat_happy_customers || '10000'),
      lbl: settings.stat_customers_label || 'Happy Customers',
      hidden: settings.stat_hide_stat_happy_customers === 'true',
    },
    {
      key: 'dispatch',
      num: `${settings.stat_avg_dispatch || '48'}hr`,
      lbl: settings.stat_dispatch_label || 'Avg Dispatch',
      hidden: settings.stat_hide_stat_avg_dispatch === 'true',
    },
  ]
  return all.filter(s => !s.hidden).map(({ hidden: _hidden, ...rest }) => rest)
}
