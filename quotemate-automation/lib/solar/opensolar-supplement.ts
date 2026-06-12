// ════════════════════════════════════════════════════════════════════
// OpenSolar supplements for the INSTANT estimate (enrichment build
// 2026-06-13) — combines the tradie's OpenSolar org data with the
// Google-Solar-powered deterministic engine:
//
//   1. Hardware catalogue — the products the tradie has ACTIVATED in
//      OpenSolar (real panel/inverter/battery models + wattage +
//      warranty), stamped into estimate.context.opensolar.hardware for
//      display-only product cards on the quote page.
//   2. Pricing cross-check — the tradie's own OpenSolar pricing scheme
//      applied to each tier's size; a divergence beyond the tolerance
//      appends a guardrail flag (review-forcing — the deterministic
//      engine's price NEVER changes). Mirrors the Pylon STC/hardware-
//      floor guardrail pattern exactly.
//
// Gated by OPENSOLAR_ENRICHMENT_ENABLED + the client credentials.
// Everything is best-effort and merges into ONE row update; OpenSolar
// being down leaves the row bit-identical (degradation contract).
// ════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  fetchOpenSolarComponentActivations,
  fetchOpenSolarPricingSchemes,
  openSolarEnabled,
  type OpenSolarCatalogueRow,
  type OpenSolarClientOpts,
  type OpenSolarPricingScheme,
} from '@/lib/opensolar/client'
import type { SolarEstimate, SolarPriceTier, SolarSystemTier } from './types'

/** PURE — the enrichment gate (separate flag from the OpenSolar tab). */
export function openSolarEnrichmentEnabled(env: {
  OPENSOLAR_ENRICHMENT_ENABLED?: string
  [key: string]: string | undefined
}): boolean {
  const on =
    env.OPENSOLAR_ENRICHMENT_ENABLED === 'true' || env.OPENSOLAR_ENRICHMENT_ENABLED === '1'
  return on && openSolarEnabled(env)
}

// ── pricing scheme selection + price computation (PURE) ──────────────

/**
 * PURE — pick the scheme OpenSolar itself would auto-apply: not archived
 * (client already filters), auto-apply enabled, state/zip restrictions
 * honoured, lowest priority number first. Falls back to the first scheme
 * when none auto-applies (the tradie has exactly one manual scheme).
 */
export function selectOpenSolarPricingScheme(
  schemes: OpenSolarPricingScheme[],
  site: { state: string | null; postcode: string | null },
): OpenSolarPricingScheme | null {
  if (schemes.length === 0) return null
  const matches = (s: OpenSolarPricingScheme): boolean => {
    if (
      s.auto_apply_only_specified_states &&
      site.state &&
      !s.auto_apply_only_specified_states.includes(site.state)
    ) {
      return false
    }
    if (
      s.auto_apply_only_specified_zips &&
      site.postcode &&
      !s.auto_apply_only_specified_zips.includes(site.postcode)
    ) {
      return false
    }
    return true
  }
  const auto = schemes
    .filter((s) => s.auto_apply_enabled && matches(s))
    .toSorted((a, b) => (a.priority ?? 999) - (b.priority ?? 999))
  if (auto.length > 0) return auto[0]
  // Sole-manual-scheme fallback still honours state/zip restrictions —
  // a VIC-only scheme must never price-check a NSW estimate.
  return schemes.length === 1 && matches(schemes[0]) ? schemes[0] : null
}

function cfgNum(cfg: Record<string, unknown>, key: string): number | null {
  const v = cfg[key]
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Number.parseFloat(v)
    if (Number.isFinite(n)) return n
  }
  return null
}

/**
 * PURE — apply one OpenSolar pricing scheme to a system. Supports the
 * deterministic formulas (Price Per Watt, Fixed Price, Price Per
 * Module/Inverter/Battery); cost-dependent formulas (Markup Percentage)
 * and unrecognised config shapes return null — no check, never a guess.
 * Returned price is inc-tax when the scheme embeds tax (AU schemes
 * carry tax_percentage_included), matching gross_inc_gst comparisons.
 */
export function computeOpenSolarSchemePrice(
  scheme: OpenSolarPricingScheme,
  system: { kw_dc: number; panels_count: number },
): number | null {
  const cfg = scheme.configuration
  const formula = scheme.pricing_formula ?? ''
  const taxPct = cfgNum(cfg, 'tax_percentage_included')
  // A null tax field means the configured figures already carry GST for
  // AU orgs; an explicit figure means the same — either way the scheme
  // price is treated as inc-tax (compared against gross_inc_gst).
  void taxPct

  if (formula === 'Price Per Watt') {
    const perWatt = cfgNum(cfg, 'price_per_watt') ?? cfgNum(cfg, 'pricePerWatt')
    if (perWatt == null || perWatt <= 0) return null
    return perWatt * system.kw_dc * 1000
  }

  if (formula === 'Fixed Price') {
    const fixed = cfgNum(cfg, 'fixed_price') ?? cfgNum(cfg, 'price')
    return fixed != null && fixed > 0 ? fixed : null
  }

  if (formula === 'Price Per Module/Inverter/Battery') {
    const perModule = cfgNum(cfg, 'price_per_module')
    if (perModule == null || perModule <= 0) return null
    const perInverter = cfgNum(cfg, 'price_per_inverter') ?? 0
    // Instant estimates carry one inverter and no battery by design.
    return perModule * system.panels_count + perInverter
  }

  // 'Price Per Watt By Size' (bracket shape unverified) and
  // 'Markup Percentage' (needs the tradie's costs) — no check.
  return null
}

/** Divergence beyond ±25% between the engine's gross price and the
 *  tradie's own OpenSolar scheme price forces tradie review. */
const PRICE_TOLERANCE_PCT = 25

export type OpenSolarPriceCheck = NonNullable<
  NonNullable<SolarEstimate['context']['opensolar']>['price_check']
>

/**
 * PURE — the per-tier price cross-check. Compares the scheme price
 * against gross_inc_gst (pre-STC, like OpenSolar prices systems).
 * Flags follow the engine's guardrail vocabulary and block confirm
 * until re-drafted clean, same as the Pylon checks.
 */
export function buildOpenSolarPriceCheck(args: {
  scheme: OpenSolarPricingScheme
  priceTiers: SolarPriceTier[]
  sizingTiers: SolarSystemTier[]
}): OpenSolarPriceCheck | null {
  const sizingByTier = new Map(args.sizingTiers.map((t) => [t.tier, t]))
  const tiers: OpenSolarPriceCheck['tiers'] = []
  let anyComputed = false
  for (const tier of args.priceTiers) {
    const sizing = sizingByTier.get(tier.tier)
    const schemePrice = sizing
      ? computeOpenSolarSchemePrice(args.scheme, {
          kw_dc: tier.system_kw_dc,
          panels_count: sizing.panels_count,
        })
      : null
    let deltaPct: number | null = null
    let flag: string | null = null
    if (schemePrice != null && schemePrice > 0 && tier.gross_inc_gst > 0) {
      anyComputed = true
      deltaPct = Math.round(((tier.gross_inc_gst - schemePrice) / schemePrice) * 1000) / 10
      if (Math.abs(deltaPct) > PRICE_TOLERANCE_PCT) {
        flag =
          `${tier.tier}: gross price $${Math.round(tier.gross_inc_gst).toLocaleString('en-AU')} ` +
          `diverges ${deltaPct > 0 ? '+' : ''}${deltaPct}% from your OpenSolar pricing scheme ` +
          `("${args.scheme.title ?? args.scheme.pricing_formula ?? 'untitled'}" → ` +
          `$${Math.round(schemePrice).toLocaleString('en-AU')})`
      }
    }
    tiers.push({
      tier: tier.tier,
      our_net_inc_gst: tier.net_inc_gst,
      opensolar_price: schemePrice,
      delta_pct: deltaPct,
      flag,
    })
  }
  if (!anyComputed) return null
  return {
    scheme_title: args.scheme.title,
    pricing_formula: args.scheme.pricing_formula,
    tiers,
  }
}

// ── hardware catalogue mapping (PURE) ────────────────────────────────

export type OpenSolarHardware = NonNullable<
  NonNullable<SolarEstimate['context']['opensolar']>['hardware']
>

/**
 * PURE — slim the activation rows for the estimate context: defaults
 * first within each kind, capped at three per kind (a catalogue can be
 * long; the quote shows the tradie's leading products).
 */
export function buildOpenSolarHardware(rows: OpenSolarCatalogueRow[]): OpenSolarHardware | null {
  if (rows.length === 0) return null
  const byKind: OpenSolarHardware = []
  for (const kind of ['module', 'inverter', 'battery'] as const) {
    const ofKind = rows
      .filter((r) => r.kind === kind)
      .toSorted((a, b) => Number(b.is_default) - Number(a.is_default))
      .slice(0, 3)
    for (const r of ofKind) {
      byKind.push({
        kind,
        manufacturer: r.manufacturer,
        code: r.code,
        kw_stc: r.kw_stc,
        product_warranty_years: r.product_warranty_years,
        technology: r.technology,
      })
    }
  }
  return byKind.length > 0 ? byKind : null
}

// ── catalogue cache (per process — respect OpenSolar throttle limits) ─

type CacheEntry<T> = { at: number; value: T }
const CACHE_TTL_MS = 5 * 60 * 1000
let catalogueCache: CacheEntry<OpenSolarCatalogueRow[]> | null = null
let schemesCache: CacheEntry<OpenSolarPricingScheme[]> | null = null

/** Test hook. */
export function resetOpenSolarSupplementCache(): void {
  catalogueCache = null
  schemesCache = null
}

async function loadCatalogue(opts: OpenSolarClientOpts): Promise<OpenSolarCatalogueRow[]> {
  if (catalogueCache && Date.now() - catalogueCache.at < CACHE_TTL_MS) {
    return catalogueCache.value
  }
  const [modules, inverters, batteries] = await Promise.all([
    fetchOpenSolarComponentActivations('module', opts),
    fetchOpenSolarComponentActivations('inverter', opts),
    fetchOpenSolarComponentActivations('battery', opts),
  ])
  const rows = [
    ...(modules.ok ? modules.data : []),
    ...(inverters.ok ? inverters.data : []),
    ...(batteries.ok ? batteries.data : []),
  ]
  // Only cache a successful sweep — a transient outage shouldn't pin an
  // empty catalogue for five minutes.
  if (modules.ok || inverters.ok || batteries.ok) {
    catalogueCache = { at: Date.now(), value: rows }
  }
  return rows
}

async function loadSchemes(opts: OpenSolarClientOpts): Promise<OpenSolarPricingScheme[]> {
  if (schemesCache && Date.now() - schemesCache.at < CACHE_TTL_MS) {
    return schemesCache.value
  }
  const res = await fetchOpenSolarPricingSchemes(opts)
  if (res.ok) {
    schemesCache = { at: Date.now(), value: res.data }
    return res.data
  }
  return []
}

// ── the after() body (I/O — mirrors applyPylonStcCrossCheck) ─────────

/**
 * Apply the OpenSolar supplements to a freshly persisted instant
 * estimate: stamp context.opensolar (hardware + price check) and append
 * any divergence guardrail flags. ONE row update; never throws.
 */
export async function applyOpenSolarSupplement(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  estimate: SolarEstimate,
  opts: OpenSolarClientOpts = {},
): Promise<void> {
  try {
    if (!openSolarEnrichmentEnabled(process.env)) return

    const [catalogue, schemes] = await Promise.all([loadCatalogue(opts), loadSchemes(opts)])
    const hardware = buildOpenSolarHardware(catalogue)
    const scheme = selectOpenSolarPricingScheme(schemes, {
      state: estimate.context.state ?? null,
      postcode: estimate.context.postcode ?? null,
    })
    const priceCheck = scheme
      ? buildOpenSolarPriceCheck({
          scheme,
          priceTiers: estimate.price.tiers,
          sizingTiers: estimate.sizing.tiers,
        })
      : null

    if (!hardware && !priceCheck) return

    const newFlags = (priceCheck?.tiers ?? [])
      .map((t) => t.flag)
      .filter((f): f is string => !!f)
    const mergedFlags = [...estimate.guardrail_flags, ...newFlags]
    const updatedEstimate: SolarEstimate = {
      ...estimate,
      guardrail_flags: mergedFlags,
      context: {
        ...estimate.context,
        opensolar: {
          checked_at: new Date().toISOString(),
          hardware,
          price_check: priceCheck,
          project: estimate.context.opensolar?.project ?? null,
        },
      },
    }
    const { error } = await supabase
      .from('solar_estimates')
      .update({ guardrail_flags: mergedFlags, estimate: updatedEstimate })
      .eq('public_token', estimate.token)
    if (error) {
      console.error('[solar/opensolar] supplement row update FAILED', {
        token: estimate.token.slice(0, 8) + '…',
        message: error.message,
      })
      return
    }
    if (newFlags.length > 0) {
      console.warn('[solar/opensolar] price-check flags raised', newFlags)
    } else {
      console.log('[solar/opensolar] supplements applied', {
        token: estimate.token.slice(0, 8) + '…',
        hardware: hardware?.length ?? 0,
        priceChecked: !!priceCheck,
      })
    }
  } catch (e) {
    console.warn(
      '[solar/opensolar] supplements skipped (non-fatal)',
      e instanceof Error ? e.message : e,
    )
  }
}
