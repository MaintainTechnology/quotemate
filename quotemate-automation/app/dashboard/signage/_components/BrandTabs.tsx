'use client'

// Brand tab switcher for the signage dashboard (F45 / Anytime Fitness / …).
//
// The parent page owns the selected-brand state and re-fetches when it
// changes; this is a controlled presentational component. We deliberately do
// NOT read the URL here (no useSearchParams) to avoid Next 16's Suspense
// requirement on prerendered client pages — the parent syncs the `?brand=`
// query param via history.replaceState.

export type BrandTab = { slug: string; name: string }

export function BrandTabs({
  brands,
  selected,
  onSelect,
}: {
  brands: BrandTab[]
  selected: string | null
  onSelect: (slug: string) => void
}) {
  if (!brands || brands.length === 0) return null
  return (
    <div role="group" aria-label="Brand" className="inline-flex flex-wrap gap-1 border border-ink-line bg-ink-card p-1">
      {brands.map((b) => {
        const active = b.slug === selected
        return (
          <button
            key={b.slug}
            type="button"
            aria-pressed={active ? 'true' : 'false'}
            onClick={() => !active && onSelect(b.slug)}
            className={`px-5 py-2.5 font-mono text-xs font-semibold uppercase tracking-[0.16em] transition-colors ${
              active
                ? 'bg-accent text-white'
                : 'text-text-dim hover:bg-ink-line/40 hover:text-text-pri'
            }`}
          >
            {b.name}
          </button>
        )
      })}
    </div>
  )
}

/** Append the active brand to a dashboard link so the tab survives
 *  navigation between the signage sub-pages. */
export function withBrand(href: string, brand: string | null): string {
  if (!brand) return href
  const sep = href.includes('?') ? '&' : '?'
  return `${href}${sep}brand=${encodeURIComponent(brand)}`
}

/** Read the initial brand from the URL on the client (used once on mount). */
export function brandFromUrl(): string | null {
  if (typeof window === 'undefined') return null
  return new URLSearchParams(window.location.search).get('brand')
}

/** Sync the `?brand=` query param without a navigation/re-render storm. */
export function syncBrandInUrl(slug: string): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  url.searchParams.set('brand', slug)
  window.history.replaceState(null, '', url.toString())
}
