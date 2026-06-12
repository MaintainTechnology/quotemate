// ════════════════════════════════════════════════════════════════════
// Solar — Pylon hardware supplements (supplements build 2026-06-13).
//
// The tradie nominates their standard hardware SKUs once (Pylon
// component SKUs, stored in tenants.pylon_settings). Every instant
// estimate is then enriched with:
//
//   • Manufacturer datasheet identity (brand / series / model + the
//     datasheet PDF link) — customer-facing credibility on the quote.
//   • The tenant's own LATEST Pylon component prices — INTERNAL ONLY,
//     used for the hardware-floor guardrail and never rendered on a
//     customer surface.
//
// Hardware-floor guardrail: if the tradie's own ex-tax hardware cost
// (panel price × panel count + inverter price) EXCEEDS a tier's ex-GST
// net price, the quote can't be right — flag it for review. Like every
// Pylon integration this can only FLAG, never change, a number.
//
// Compare logic is PURE; the enrichment runner does I/O via the
// injected client opts and never throws.
// ════════════════════════════════════════════════════════════════════

import {
  fetchPylonComponent,
  fetchPylonComponentPrice,
  pylonEnabled,
  type PylonClientOpts,
  type PylonComponentKind,
} from '../pylon/client'
import type { SolarEstimateContext, SolarPriceTier, SolarSystemTier } from './types'

export type PylonHardwareComponent = NonNullable<
  SolarEstimateContext['pylon_components']
>[number]

/** Per-tenant nominated SKUs — the shape of tenants.pylon_settings. */
export type PylonSkuSettings = {
  module_sku?: string | null
  inverter_sku?: string | null
  battery_sku?: string | null
}

/** PURE — defensive parse of the tenants.pylon_settings jsonb. */
export function parsePylonSkuSettings(v: unknown): PylonSkuSettings {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
  const obj = v as Record<string, unknown>
  const sku = (key: string): string | null => {
    const raw = obj[key]
    return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null
  }
  return {
    module_sku: sku('module_sku'),
    inverter_sku: sku('inverter_sku'),
    battery_sku: sku('battery_sku'),
  }
}

/** PURE — true when at least one SKU is nominated. */
export function hasPylonSkus(settings: PylonSkuSettings): boolean {
  return !!(settings.module_sku || settings.inverter_sku || settings.battery_sku)
}

/**
 * Fetch datasheet identity + the tenant's latest price for each
 * nominated SKU (parallel, best-effort per component). Returns the
 * context.pylon_components array; empty when nothing resolved.
 */
export async function enrichPylonHardware(
  settings: PylonSkuSettings,
  opts: PylonClientOpts = {},
): Promise<PylonHardwareComponent[]> {
  const wanted: Array<{ kind: PylonComponentKind; sku: string }> = []
  if (settings.module_sku) wanted.push({ kind: 'module', sku: settings.module_sku })
  if (settings.inverter_sku) wanted.push({ kind: 'inverter', sku: settings.inverter_sku })
  if (settings.battery_sku) wanted.push({ kind: 'battery', sku: settings.battery_sku })
  if (wanted.length === 0) return []

  const results = await Promise.all(
    wanted.map(async ({ kind, sku }): Promise<PylonHardwareComponent | null> => {
      const [sheet, price] = await Promise.all([
        fetchPylonComponent(kind, sku, opts),
        fetchPylonComponentPrice(kind, sku, opts),
      ])
      if (!sheet.ok) {
        console.warn(`[solar/pylon] ${kind} datasheet ${sku} unavailable (${sheet.code})`)
        return null
      }
      return {
        kind,
        sku,
        name: sheet.data.name,
        brand: sheet.data.brand,
        series: sheet.data.series,
        model_number: sheet.data.model_number,
        datasheet_url: sheet.data.datasheet_url,
        price_excl_tax_cents: price.ok ? price.data.price_excl_tax_cents : null,
        cost_excl_tax_cents: price.ok ? price.data.cost_excl_tax_cents : null,
      }
    }),
  )
  return results.filter((c): c is PylonHardwareComponent => c !== null)
}

/**
 * PURE — the hardware-floor guardrail. For each priced tier, sum the
 * tradie's own ex-tax Pylon prices for the hardware that tier contains
 * (panel price × panel count + one inverter; batteries aren't part of
 * sized tiers and are excluded). If that floor exceeds the tier's
 * ex-GST net price, flag it. Missing prices ⇒ no check (cannot compare).
 */
export function hardwareFloorFlags(args: {
  components: PylonHardwareComponent[]
  priceTiers: Array<Pick<SolarPriceTier, 'tier' | 'net_ex_gst'>>
  sizingTiers: Array<Pick<SolarSystemTier, 'tier' | 'panels_count'>>
}): string[] {
  const panelPrice = args.components.find((c) => c.kind === 'module')?.price_excl_tax_cents ?? null
  const inverterPrice =
    args.components.find((c) => c.kind === 'inverter')?.price_excl_tax_cents ?? null
  if (panelPrice === null) return []

  const panelsByTier = new Map(args.sizingTiers.map((t) => [t.tier, t.panels_count]))
  const flags: string[] = []
  for (const tier of args.priceTiers) {
    const panels = panelsByTier.get(tier.tier)
    if (panels == null || panels <= 0) continue
    const floorCents = panelPrice * panels + (inverterPrice ?? 0)
    const floorAud = floorCents / 100
    if (!Number.isFinite(tier.net_ex_gst) || tier.net_ex_gst <= 0) continue
    if (floorAud > tier.net_ex_gst) {
      flags.push(
        `hardware_cost_exceeds_price:${tier.tier}: your own Pylon hardware prices ` +
          `($${Math.round(floorAud).toLocaleString('en-AU')} ex GST for ${panels} panels` +
          `${inverterPrice !== null ? ' + inverter' : ''}) exceed the tier's net price ` +
          `($${Math.round(tier.net_ex_gst).toLocaleString('en-AU')} ex GST) — ` +
          'check the rate card before sending.',
      )
    }
  }
  return flags
}

/**
 * Load the tenant's nominated SKUs (tenants.pylon_settings) and run the
 * full hardware enrichment. Returns null when the integration is off,
 * no tenant, or no SKUs nominated. Never throws.
 */
export async function runPylonHardwareSupplement(
  args: {
    settings: unknown
    env?: { PYLON_ENABLED?: string; PYLON_API_KEY?: string }
  },
  opts: PylonClientOpts = {},
): Promise<PylonHardwareComponent[] | null> {
  const env = args.env ?? {
    PYLON_ENABLED: process.env.PYLON_ENABLED,
    PYLON_API_KEY: process.env.PYLON_API_KEY,
  }
  if (!pylonEnabled(env)) return null
  const settings = parsePylonSkuSettings(args.settings)
  if (!hasPylonSkus(settings)) return null
  const clientOpts: PylonClientOpts = { apiKey: env.PYLON_API_KEY, ...opts }
  const components = await enrichPylonHardware(settings, clientOpts)
  return components.length > 0 ? components : null
}
