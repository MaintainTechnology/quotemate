// ════════════════════════════════════════════════════════════════════
// Painting — estimate orchestrator.
//
// Picks a property-data provider (per the dashboard tab + env), looks up
// the property facts, runs the deterministic area engine, prices the
// G/B/B tiers + routing, and returns the structured PaintingEstimate the
// API route hands to the dashboard.
//
// Provider selection (in order):
//   1. opts.provider — explicit override (tests pass MockPropertyProvider)
//   2. opts.source   — which tab: 'rea' → ReaListingProvider,
//                      'auto'/others → the best configured "other tools"
//                      provider (Solar/Geoscape/Domain — stubs for now)
//   3. opts.useMock  — force the deterministic mock (the demo toggle)
//
// PURE-ish: the orchestrator is I/O-free; the provider does the network.
// Unit tests pass MockPropertyProvider.
// ════════════════════════════════════════════════════════════════════

import type {
  PaintAddressInput,
  PaintUserInputs,
  PaintingEstimate,
  PaintingRateCard,
  PropertyDataSource,
} from './types'
import type { PropertyDataProvider } from './providers/base'
import { MockPropertyProvider } from './providers/mock'
import { ReaListingProvider } from './providers/rea'
import { SolarPropertyProvider } from './providers/solar'
import { measurePaintableArea } from './area'
import { calculatePaintingPrice, requiresInspection } from './pricing'

/** Which tab / data path the request came from. */
export type EstimateSource = 'rea' | 'auto'

export type EstimateOpts = {
  /** Explicit provider override — tests + the demo path use this. */
  provider?: PropertyDataProvider
  /** Which dashboard tab issued the request. Default 'auto'. */
  source?: EstimateSource
  /** Force the deterministic mock provider (the dashboard demo toggle). */
  useMock?: boolean
  /** Per-tenant rate card. When omitted, pricing.ts default applies. */
  rateCard?: PaintingRateCard
}

export type EstimateResult =
  | { ok: true; estimate: PaintingEstimate }
  | { ok: false; code: string; detail: string }

/**
 * Pick a property-data provider based on opts → source → env.
 *
 * The "other tools" `auto` tab uses the real Google Solar provider when
 * GOOGLE_MAPS_API_KEY is set (footprint → floor-area estimate); without a
 * key it falls back to the mock. Geoscape/Domain adapters are still to
 * come. The REA tab uses ReaListingProvider, which is inert (returns
 * rea_not_configured) until a scraper/paste backend is injected — unless
 * the demo toggle forces the mock.
 */
export function pickProvider(opts: EstimateOpts = {}): PropertyDataProvider {
  if (opts.provider) return opts.provider

  const source = opts.source ?? 'auto'

  if (opts.useMock) {
    // Demo data, labelled with the tab it stands in for.
    return new MockPropertyProvider({
      stampSource: source === 'rea' ? 'rea' : 'mock',
    })
  }

  if (source === 'rea') {
    // No scraper/paste backend is injected here yet — the provider returns
    // a clean rea_not_configured failure. (Inject `fetchListing` once a
    // managed scraper or paste flow is chosen.)
    return new ReaListingProvider()
  }

  // 'auto' tab — real Google Solar footprint lookup when the key is set;
  // otherwise the deterministic mock so the tab still works.
  if (process.env.GOOGLE_MAPS_API_KEY) {
    return new SolarPropertyProvider()
  }
  return new MockPropertyProvider()
}

/**
 * Full pipeline: address + job inputs → property lookup → area → tier
 * prices + routing. Best-effort surface: any provider failure surfaces
 * as { ok: false, code, detail } — no throws on operational failure.
 */
export async function estimatePainting(
  address: PaintAddressInput,
  inputs: PaintUserInputs,
  opts: EstimateOpts = {},
): Promise<EstimateResult> {
  const provider = pickProvider(opts)

  let lookup
  try {
    lookup = await provider.lookup(address)
  } catch (e) {
    return {
      ok: false,
      code: 'provider_unavailable',
      detail: e instanceof Error ? e.message : String(e),
    }
  }

  if (!lookup.ok) {
    return { ok: false, code: lookup.code, detail: lookup.detail }
  }

  // The user's declared storeys override the provider's value (Google
  // Solar can't infer storeys, and floor area scales with it).
  const facts =
    inputs.storeys && inputs.storeys > 0
      ? { ...lookup.facts, storeys: inputs.storeys }
      : lookup.facts
  const measurement = measurePaintableArea(facts, inputs)

  // No floor area at all → there's nothing to price. Surface the
  // inspection routing as a successful estimate with an inspection
  // decision, so the UI shows the "book a measure" CTA rather than an
  // error (matches the roofing inspection-fallback UX).
  if (measurement === null) {
    return {
      ok: false,
      code: 'no_floor_area',
      detail:
        requiresInspection({ facts, inputs, measurement: null })?.reason ??
        'No floor area could be determined for this address.',
    }
  }

  const price = calculatePaintingPrice({
    facts,
    inputs,
    measurement,
    rateCard: opts.rateCard,
  })

  return {
    ok: true,
    estimate: {
      provider: lookup.provider as PropertyDataSource,
      facts,
      measurement,
      price,
      warnings: lookup.warnings,
    },
  }
}
