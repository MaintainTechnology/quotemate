// Per-tenant marketing capabilities for the /t/<slug> landing page.
//
// "What can a customer request from THIS tradie?" is answered by
// tenants.trades[] — the single source of truth the dashboard sidebar and
// the roofing toggle already use (admin toggle-roofing writes 'roofing'
// into this array). A tradie set up for ['electrical','solar'] shows only
// the Electrical + Solar cards; nothing else leaks onto their page.
//
// PURE — no I/O, no React. Maps each known trade key to customer-facing
// marketing copy. Unknown keys are dropped (forward-compatible: a future
// trade added to trades[] simply shows nothing until it gets an entry
// here). Display order is fixed and sensible, independent of array order.

export type TenantCapability = {
  /** Canonical trade key (lower-snake), as stored in tenants.trades[]. */
  key: string
  /** Customer-facing service name. */
  label: string
  /** One-line, no-fluff blurb in the Maintain voice. */
  tagline: string
  /** Concrete "you can request this" examples — the marketing payload. */
  examples: string[]
}

// Fixed display order — electrical/plumbing lead (the live trades), then
// the higher-ticket add-ons. Anything not in this map is ignored.
const CATALOGUE: Record<string, TenantCapability> = {
  electrical: {
    key: 'electrical',
    label: 'Electrical',
    tagline: 'Licensed electrical work, quoted from a photo.',
    examples: [
      'Downlights & LED upgrades',
      'Extra power points',
      'Switchboard upgrades',
      'Ceiling fans',
      'EV charger install',
      'Safety switches',
    ],
  },
  plumbing: {
    key: 'plumbing',
    label: 'Plumbing',
    tagline: 'Leaks, hot water and drains — sorted fast.',
    examples: [
      'Hot water systems',
      'Blocked drains',
      'Leaking taps & toilets',
      'Burst pipes',
      'Gas fitting',
      'Bathroom rough-in',
    ],
  },
  roofing: {
    key: 'roofing',
    label: 'Roofing',
    tagline: 'Restorations, repairs and full re-roofs.',
    examples: [
      'Roof restoration',
      'Leak repairs',
      'Gutter replacement',
      'Re-roofing',
      'Ridge capping',
      'Roof condition report',
    ],
  },
  solar: {
    key: 'solar',
    label: 'Solar & Battery',
    tagline: 'Panels and batteries, sized to your roof.',
    examples: [
      'Solar panel install',
      'Battery storage',
      'System upgrades',
      'Instant roof estimate',
      'Inverter replacement',
    ],
  },
  aircon: {
    key: 'aircon',
    label: 'Air Conditioning',
    tagline: 'Cooling and heating, sized and installed.',
    examples: [
      'Split-system install',
      'Multi-head systems',
      'Servicing & cleaning',
      'Sizing for your space',
      'Ducted upgrades',
    ],
  },
  commercial_painting: {
    key: 'commercial_painting',
    label: 'Commercial Painting',
    tagline: 'Commercial and strata repaints, tendered.',
    examples: [
      'Interior repaints',
      'Exterior repaints',
      'Warehouse & strata',
      'Protective coatings',
      'Line marking',
    ],
  },
}

/** The canonical render order, regardless of how trades[] is ordered. */
const ORDER = [
  'electrical',
  'plumbing',
  'roofing',
  'solar',
  'aircon',
  'commercial_painting',
] as const

/**
 * Resolve the marketing capability cards for a tenant from its trades[].
 * Tolerant of casing/whitespace and the legacy scalar `trade`. Returns an
 * empty array when nothing maps (the page falls back to a generic
 * "request a quote" message rather than rendering an empty section).
 */
export function resolveTenantCapabilities(
  trades: ReadonlyArray<string> | null | undefined,
  fallbackTrade?: string | null,
): TenantCapability[] {
  const raw =
    Array.isArray(trades) && trades.length > 0
      ? trades
      : fallbackTrade
        ? [fallbackTrade]
        : []

  const enabled = new Set(
    raw
      .filter((t): t is string => typeof t === 'string')
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length > 0),
  )

  return ORDER.filter((key) => enabled.has(key)).map((key) => CATALOGUE[key])
}
