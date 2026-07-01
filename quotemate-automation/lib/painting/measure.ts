// ════════════════════════════════════════════════════════════════════
// Painting — estimate orchestrator.
//
// Picks a property-data provider (per env), looks up the property facts,
// runs the deterministic area engine, prices the G/B/B tiers + routing,
// and returns the structured PaintingEstimate the API route hands to the
// dashboard.
//
// Provider selection (in order):
//   1. opts.provider — explicit override (tests pass MockPropertyProvider)
//   2. Google Solar footprint lookup when GOOGLE_MAPS_API_KEY is set
//   3. the deterministic mock (local dev / no key) so the flow still runs
//
// After the base lookup, the facts are ENRICHED with per-address building
// data from Geoscape (storeys, eave height, use) and PropRadar (beds/baths/
// car/type/land/floor-area). Each enricher no-ops without its key, so the
// estimate always succeeds on the base provider alone. See lib/painting/enrich.ts.
//
// PURE-ish: the orchestrator is I/O-free apart from the provider + enrichers.
// Unit tests pass MockPropertyProvider (enrichers no-op without keys).
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
import { SolarPropertyProvider } from './providers/solar'
import { measurePaintableArea } from './area'
import { calculatePaintingPrice, requiresInspection } from './pricing'
import { enrichPaintingFacts, type EnrichPaintingOpts } from './enrich'

export type EstimateOpts = {
  /** Explicit provider override — tests use this. */
  provider?: PropertyDataProvider
  /** Per-tenant rate card. When omitted, pricing.ts default applies. */
  rateCard?: PaintingRateCard
  /** Enrichment provider overrides (apiKey/fetchImpl) — tests inject here;
   *  production reads GEOSCAPE_API_KEY / PROPRADAR_API from the env. */
  enrich?: EnrichPaintingOpts
}

export type EstimateResult =
  | { ok: true; estimate: PaintingEstimate }
  | { ok: false; code: string; detail: string }

/**
 * Pick a property-data provider based on opts → env.
 *
 * Uses the real Google Solar provider when GOOGLE_MAPS_API_KEY is set
 * (footprint → floor-area estimate); without a key it falls back to the
 * deterministic mock so local dev + tests still run. Geoscape/Domain
 * adapters are still to come.
 */
export function pickProvider(opts: EstimateOpts = {}): PropertyDataProvider {
  if (opts.provider) return opts.provider

  // Real Google Solar footprint lookup when the key is set; otherwise the
  // deterministic mock so the tool still works.
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

  // Enrich the base (Solar) facts with Geoscape + PropRadar building data.
  // No-ops per provider without its API key, so this never breaks the estimate.
  const { facts: enriched } = await enrichPaintingFacts(address, lookup.facts, opts.enrich)

  // The user's declared storeys always wins over any provider/enricher value
  // (floor area + exterior area scale with it).
  const facts =
    inputs.storeys && inputs.storeys > 0
      ? { ...enriched, storeys: inputs.storeys }
      : enriched
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
