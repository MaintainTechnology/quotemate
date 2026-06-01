// ════════════════════════════════════════════════════════════════════
// Roofing — measurement orchestrator.
//
// Picks a provider, runs the measurement, applies pricing + routing,
// returns the structured result the API route hands to the dashboard.
//
// Provider selection (in order):
//   1. opts.provider — explicit override (tests pass MockRoofingProvider)
//   2. ROOFING_PROVIDER env var — 'geoscape' | 'mock' | 'manual'
//   3. fallback — Geoscape if GEOSCAPE_API_KEY present, else mock
//
// PURE-ish: the orchestrator itself is I/O-free, the provider it calls
// does the network work. Unit tests pass MockRoofingProvider.
// ════════════════════════════════════════════════════════════════════

import type {
  MultiRoofQuote,
  RoofAddressInput,
  RoofMetrics,
  RoofUserInputs,
  RoofingMeasurementResult,
  RoofingMultiMeasurementResult,
  RoofingQuotePrice,
  RoofingRateCard,
} from './types'
import type { RoofingMeasurementProvider } from './providers/base'
import { GeoscapeProvider } from './providers/geoscape'
import { MockRoofingProvider } from './providers/mock'
import {
  calculateRoofingPrice,
  priceMultiRoof,
  slopedAreaFromFootprint,
  type RoofStructureInput,
} from './pricing'

export type MeasureRoofOpts = {
  /** Explicit provider override — tests and the dashboard demo path use this. */
  provider?: RoofingMeasurementProvider
  /** Per-tenant rate card. When omitted, pricing.ts default applies. */
  rateCard?: RoofingRateCard
}

export type MeasureRoofResult =
  | {
      ok: true
      metrics: RoofMetrics
      price: RoofingQuotePrice
      provider: RoofingMeasurementProvider['name']
      warnings: string[]
    }
  | {
      ok: false
      code: string
      detail: string
    }

/** PURE — apply the customer's pitch declaration to update sloped area. */
export function reapplyPitchToMetrics(
  metrics: RoofMetrics,
  inputs: RoofUserInputs,
): RoofMetrics {
  const sloped = slopedAreaFromFootprint(metrics.footprint_m2, inputs.pitch)
  return { ...metrics, sloped_area_m2: sloped }
}

/** Pick a measurement provider based on opts → env → key presence. */
export function pickProvider(opts: MeasureRoofOpts = {}): RoofingMeasurementProvider {
  if (opts.provider) return opts.provider
  const envChoice = (process.env.ROOFING_PROVIDER ?? '').toLowerCase()
  if (envChoice === 'mock')   return new MockRoofingProvider()
  if (envChoice === 'geoscape') return new GeoscapeProvider()
  // Fallback heuristic
  if (process.env.GEOSCAPE_API_KEY) return new GeoscapeProvider()
  return new MockRoofingProvider()
}

/**
 * Full pipeline: address + customer inputs → measurement → tier prices
 * + routing decision. Best-effort surface: any provider failure surfaces
 * as { ok: false, code, detail } — no throws on operational failure.
 */
export async function measureAndPriceRoof(
  address: RoofAddressInput,
  inputs: RoofUserInputs,
  opts: MeasureRoofOpts = {},
): Promise<MeasureRoofResult> {
  const provider = pickProvider(opts)

  let raw: RoofingMeasurementResult
  try {
    raw = await provider.measure(address)
  } catch (e) {
    return {
      ok: false,
      code: 'provider_unavailable',
      detail: e instanceof Error ? e.message : String(e),
    }
  }

  if (!raw.ok) {
    return { ok: false, code: raw.code, detail: raw.detail }
  }

  // The provider used a default pitch to seed sloped area; rerun the
  // pitch correction with the customer's declared bucket so the price
  // matches what the customer just confirmed.
  const metrics = reapplyPitchToMetrics(raw.metrics, inputs)

  const price = calculateRoofingPrice({
    metrics,
    inputs,
    rateCard: opts.rateCard,
  })

  return {
    ok: true,
    metrics,
    price,
    provider: raw.provider,
    warnings: raw.warnings,
  }
}

// ── Multi-structure pipeline ──────────────────────────────────────────

export type MeasureRoofsOpts = MeasureRoofOpts & {
  /**
   * Per-building input overrides keyed by buildingId — a shed is often a
   * different material/pitch/intent than the main house. Any field left
   * out falls back to the shared `inputs` argument.
   */
  perBuilding?: Record<string, Partial<RoofUserInputs>>
}

export type MeasureRoofsResult =
  | {
      ok: true
      quote: MultiRoofQuote
      provider: RoofingMeasurementProvider['name']
      warnings: string[]
    }
  | {
      ok: false
      code: string
      detail: string
    }

/**
 * Full multi-structure pipeline: address → every structure at the
 * property → per-structure pricing → aggregated MultiRoofQuote. Uses the
 * provider's measureAll() when available, else wraps a single measure()
 * into a one-building result so any provider works. Each structure is
 * priced with its own (optionally overridden) inputs — areas are never
 * summed onto a single material rate.
 */
export async function measureAndPriceRoofs(
  address: RoofAddressInput,
  inputs: RoofUserInputs,
  opts: MeasureRoofsOpts = {},
): Promise<MeasureRoofsResult> {
  const provider = pickProvider(opts)

  let multi: RoofingMultiMeasurementResult
  try {
    if (typeof provider.measureAll === 'function') {
      multi = await provider.measureAll(address)
    } else {
      const single = await provider.measure(address)
      multi = single.ok
        ? {
            ok: true,
            provider: single.provider,
            warnings: single.warnings,
            buildings: [
              {
                buildingId: single.metrics.buildingId ?? null,
                role: 'primary',
                metrics: single.metrics,
              },
            ],
          }
        : single
    }
  } catch (e) {
    return {
      ok: false,
      code: 'provider_unavailable',
      detail: e instanceof Error ? e.message : String(e),
    }
  }

  if (!multi.ok) {
    return { ok: false, code: multi.code, detail: multi.detail }
  }

  const structures: RoofStructureInput[] = multi.buildings.map((b) => {
    const override = (b.buildingId ? opts.perBuilding?.[b.buildingId] : undefined) ?? {}
    const merged: RoofUserInputs = { ...inputs, ...override }
    const metrics = reapplyPitchToMetrics(b.metrics, merged)
    return { buildingId: b.buildingId, role: b.role, metrics, inputs: merged }
  })

  const quote = priceMultiRoof({ structures, rateCard: opts.rateCard })

  return { ok: true, quote, provider: multi.provider, warnings: multi.warnings }
}
