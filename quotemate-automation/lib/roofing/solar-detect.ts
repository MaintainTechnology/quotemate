// ════════════════════════════════════════════════════════════════════
// Roofing — server-side solar/skylight detection orchestrator.
//
// Shared by /api/roofing/save (runs at save time, because the dashboard
// auto-saves + redirects) and /api/roofing/measurement/[token] POST (the
// tradie photo re-scan on the /m review page). Keeps the per-structure
// aerial fan-out + the optional Anthropic photo pass + the deterministic
// allowance in ONE place so the two entry points can't drift.
//
// I/O surface (Google Static Maps fetch + Gemini + Anthropic) — every call
// is best-effort and NEVER throws on operational failure, so the save / patch
// flows are unaffected when a key is missing or a model hiccups.
// ════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js'
import { buildStaticMapUrl } from './google-maps'
import { polygonCentroid } from './map-utils'
import { effectiveRateCardFromOverlay } from './rate-card-overlay'
import { DEFAULT_ROOFING_RATE_CARD } from './pricing'
import { geminiProvider } from '@/lib/ig-engine/providers/gemini'
import {
  aggregateSolarDetections,
  buildSolarDetectPrompt,
  computeSolarAllowance,
  detectSolarFromPhotos,
  mergeSolarDetections,
  parseSolarDetection,
  solarAllowanceConfigFromCard,
  SOLAR_DETECTION_SCHEMA,
  type SolarDetection,
  type SolarQuoteAddon,
  type SolarStructureDetection,
} from './solar'
import type { MultiRoofQuote, RoofingRateCard, RoofJobIntent } from './types'

// Same dead id as lib/invoice/extract.ts carried: 'gemini-2.5-flash' now 404s
// ("no longer available to new users"), and GEMINI_VISION_MODEL is NOT set in
// Production, so this default was the live path — aerial solar detection has
// been failing on it. gemini-3.6-flash verified 2026-08-06 with an image part
// at temperature 0.
const SOLAR_VISION_MODEL = process.env.GEMINI_VISION_MODEL ?? 'gemini-3.6-flash'
// Cap how many structures we run the aerial vision pass over per call, so a
// parcel with many footprints can't fan out into an unbounded vision bill.
// Structures beyond the cap are reported via SolarQuoteAddon.structuresSkipped.
export const MAX_SOLAR_STRUCTURES = 4

export type RoofPhoto = { base64: string; mime: string }

/** Read the tenant's roofing rate card (for the allowance config + GST),
 *  falling back to defaults. Best-effort — any miss returns the defaults.
 *
 *  The card is per-tenant and trade-agnostic: the writer
 *  (/api/tenant/roofing-rates PATCH) targets the primary-trade row but
 *  falls back to ANY pricing_book row when the primary trade has none —
 *  "it doesn't matter which row holds it". So this reader SEARCHES every
 *  row rather than addressing one. The old single-row read had two live
 *  failure modes: primaryTrade=null degenerated to an unordered limit(1)
 *  (the /m reprice priced Atomic off its card-less plumbing row), and a
 *  tenant whose primary trade has no row (Sparky: commercial_painting)
 *  could save rates that were then never read.
 *
 *  primaryTrade is a PREFERENCE for the rare multi-card tenant, not an
 *  address: primary-trade row first, then a 'roofing' row, then the first
 *  carded row by trade name (deterministic, never row-order-dependent). */
export async function loadRoofingRateCard(
  supabase: SupabaseClient,
  tenantId: string | null,
  primaryTrade: string | null,
): Promise<RoofingRateCard> {
  if (!tenantId) return DEFAULT_ROOFING_RATE_CARD
  try {
    const { data } = await supabase
      .from('pricing_book')
      .select('trade, overlays')
      .eq('tenant_id', tenantId)
    const rows = (Array.isArray(data) ? data : []) as Array<{
      trade: string | null
      overlays: Record<string, unknown> | null
    }>
    const carded = rows.filter((r) => r.overlays?.roofing_rate_card != null)
    if (carded.length === 0) return DEFAULT_ROOFING_RATE_CARD
    const pick =
      (primaryTrade ? carded.find((r) => r.trade === primaryTrade) : undefined) ??
      carded.find((r) => r.trade === 'roofing') ??
      [...carded].sort((a, b) => String(a.trade).localeCompare(String(b.trade)))[0]
    return effectiveRateCardFromOverlay(pick.overlays!.roofing_rate_card)
  } catch {
    return DEFAULT_ROOFING_RATE_CARD
  }
}

/** Run one structure's centre-aerial through Gemini vision. Best-effort —
 *  any miss returns null and the structure simply doesn't contribute. */
async function detectStructureAerial(
  center: { lat: number; lng: number },
): Promise<SolarDetection | null> {
  try {
    const url = buildStaticMapUrl(
      { center, zoom: 20, size: { width: 640, height: 640 }, maptype: 'satellite' },
      { apiKey: process.env.GOOGLE_MAPS_API_KEY! },
    )
    const res = await fetch(url)
    if (!res.ok) return null
    const mime = res.headers.get('content-type') ?? 'image/png'
    const bytes = Buffer.from(await res.arrayBuffer())
    const generateText = geminiProvider.generateText
    if (!generateText) return null
    const text = await generateText({
      prompt: buildSolarDetectPrompt(),
      images: [{ base64: bytes.toString('base64'), mime }],
      temperature: 0,
      model: SOLAR_VISION_MODEL,
      responseSchema: SOLAR_DETECTION_SCHEMA,
    })
    return parseSolarDetection(text, 'aerial')
  } catch {
    return null
  }
}

/**
 * Detect existing solar + skylights across the job's structures and compute
 * the detach & reinstate allowance. Aerial (Gemini) runs PER STRUCTURE; an
 * optional Anthropic photo pass is merged into the primary structure. The
 * per-structure reads are RETAINED (R3 attribution) on the returned addon and
 * aggregated to a job-level detection (arrays summed across structures). Any
 * structures beyond MAX_SOLAR_STRUCTURES are reported via structuresSkipped.
 *
 * Best-effort: returns null on any shortfall so the caller never blocks.
 * Skipped entirely for the mock provider (demo measurements).
 */
export async function detectSolarForJob(args: {
  quote: MultiRoofQuote | null
  provider: string
  primaryIntent: RoofJobIntent
  rateCard: RoofingRateCard
  photos?: RoofPhoto[]
}): Promise<SolarQuoteAddon | null> {
  const { quote, provider, primaryIntent, rateCard, photos } = args
  if (!quote || !Array.isArray(quote.structures) || quote.structures.length === 0) return null
  if (provider === 'mock') return null

  const canAerial = !!process.env.GOOGLE_MAPS_API_KEY && !!process.env.GEMINI_API_KEY
  const hasPhotos = Array.isArray(photos) && photos.length > 0
  if (!canAerial && !hasPhotos) return null

  const all = quote.structures
  const scanned = all.slice(0, MAX_SOLAR_STRUCTURES)
  const structuresSkipped = Math.max(0, all.length - scanned.length)

  // 1. Per-structure aerial reads, retaining buildingId + label per structure.
  const perStructure: SolarStructureDetection[] = []
  let primaryIdx = scanned.findIndex((s) => s.role === 'primary')
  if (primaryIdx < 0) primaryIdx = 0

  for (let i = 0; i < scanned.length; i++) {
    const s = scanned[i]
    const poly = s?.metrics?.polygon_geojson ?? null
    const centroid = canAerial && poly ? polygonCentroid(poly) : null
    let det = centroid ? await detectStructureAerial({ lat: centroid[1], lng: centroid[0] }) : null

    // 2. Photo pass — close-up photos are whole-property, so merge them into
    //    the PRIMARY structure's read only.
    if (hasPhotos && i === primaryIdx) {
      const photoDet = await detectSolarFromPhotos(
        photos!.map((p) => ({ base64: p.base64, mime: p.mime })),
      )
      if (photoDet) det = mergeSolarDetections(det, photoDet)
    }

    if (det) {
      perStructure.push({
        buildingId: s.buildingId ?? s.metrics?.buildingId ?? null,
        label: s.label,
        detection: det,
      })
    }
  }

  // 3. Fold to a job-level detection + deterministic allowance.
  const detection = aggregateSolarDetections(perStructure.map((p) => p.detection))
  if (!detection) {
    // No solar/skylight found anywhere — still record the skip count so the
    // tradie can see the scan wasn't exhaustive, but only when something was
    // actually skipped; otherwise return null (nothing to persist).
    return null
  }
  const cfg = solarAllowanceConfigFromCard(rateCard)
  const allowance = computeSolarAllowance(detection, {
    intent: primaryIntent,
    base_ex_gst: cfg.base_ex_gst,
    per_array_ex_gst: cfg.per_array_ex_gst,
    gstRegistered: rateCard.gst_registered,
  })
  return {
    detection,
    allowance,
    perStructure,
    structuresSkipped: structuresSkipped > 0 ? structuresSkipped : undefined,
  }
}
