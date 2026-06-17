// Pure view-model helpers for the dashboard Solar tab.
//
// NO I/O. The GET /api/tenant/solar route reads solar_estimates rows
// (service-role) and feeds the raw row shape through mapSolarEstimateRow()
// to produce the lean, client-safe view model the SolarTab renders.
//
// The live solar_estimates schema (migration 100) stores the deterministic
// engine output across separate jsonb columns — `price` (SolarQuotePrice),
// `sizing` (SolarSizingResult) — rather than one `estimate` blob. The
// "headline" figures the dashboard shows come from the 'better' tier
// (falling back to the first priced tier), mirroring how the creation
// route and persist-helpers pick the selected tier.

import type { DetectedBuilding, LatLng, SolarPriceTier, SolarSystemTier } from './types'
import { resolveSolarOverlayCenter } from './static-map-center'

/**
 * Lifecycle status of a solar estimate, in the tradie's mental model:
 *  • flagged              — guardrail_flags non-empty; blocked from confirm,
 *                            needs the tradie to adjust + re-draft.
 *  • paid                 — a deposit has landed (paid_at set). Terminal-ish.
 *  • confirmed            — tradie reviewed + released (confirmed_at set);
 *                            customer can now see prices + pay.
 *  • awaiting_confirmation — clean, drafted, not yet released.
 *
 * Precedence: flagged is surfaced FIRST even if confirmed_at/paid_at happen
 * to be set, because an open guardrail check is the thing the tradie must
 * act on. (In practice a flagged estimate can't be confirmed — the confirm
 * route 409s — so this branch is also the correct "stuck" indicator.)
 * Then paid > confirmed > awaiting.
 */
export type SolarEstimateStatus =
  | 'awaiting_confirmation'
  | 'confirmed'
  | 'paid'
  | 'flagged'

export type SolarEstimateStatusInput = {
  guardrail_flags?: unknown
  confirmed_at?: string | null
  /** Optional — no `paid_at` column ships in migration 100 yet, but the
   *  mapper stays forward-compatible if a deposit timestamp is added. */
  paid_at?: string | null
}

/** Count guardrail flags defensively — the column is jsonb (string[]). */
export function solarGuardrailCount(flags: unknown): number {
  return Array.isArray(flags) ? flags.length : 0
}

/** Normalise the jsonb column to a clean string[] for display — the
 *  tradie must SEE what each open check is, not just a count. */
export function solarGuardrailFlags(flags: unknown): string[] {
  if (!Array.isArray(flags)) return []
  return flags.filter((f): f is string => typeof f === 'string' && f.length > 0)
}

/** PURE — derive the lifecycle status from the raw row fields. */
export function deriveSolarEstimateStatus(
  row: SolarEstimateStatusInput,
): SolarEstimateStatus {
  if (solarGuardrailCount(row.guardrail_flags) > 0) return 'flagged'
  if (row.paid_at) return 'paid'
  if (row.confirmed_at) return 'confirmed'
  return 'awaiting_confirmation'
}

/**
 * PURE — the customer-facing entry-form link the tradie shares so a
 * customer can request a solar estimate. The /solar/[tenantSlug] route's
 * slug carries the tenant id (uuid). appUrl is trimmed of a trailing slash
 * so callers can pass either form.
 */
export function buildSolarShareUrl(appUrl: string, tenantId: string): string {
  const base = (appUrl || '').replace(/\/+$/, '')
  return `${base}/solar/${tenantId}`
}

/**
 * PURE — the public quote link for a single, completed estimate. Points at
 * the /q/solar/[token] page, keyed by the row's public_token.
 */
export function buildSolarQuoteUrl(appUrl: string, publicToken: string): string {
  const base = (appUrl || '').replace(/\/+$/, '')
  return `${base}/q/solar/${publicToken}`
}

/** Either tier shape carries system_kw_dc; price tiers also carry net_inc_gst. */
type TierLike = Pick<SolarSystemTier | SolarPriceTier, 'tier' | 'system_kw_dc'>

/** Pick the 'better' tier, else the first — mirrors persist-helpers. */
function pickTier<T extends { tier: string }>(tiers: T[] | null | undefined): T | null {
  if (!Array.isArray(tiers) || tiers.length === 0) return null
  return tiers.find((t) => t.tier === 'better') ?? tiers[0] ?? null
}

/** Felt provisioning summary as stored on solar_estimates.felt (Felt tab
 *  spec 2026-06-13) — only the fields the dashboard renders. */
export type SolarFeltRowSummary = {
  status?: 'pending' | 'provisioning' | 'ready' | 'partial' | 'failed' | null
  map_url?: string | null
  embed_url?: string | null
  thumbnail_url?: string | null
} | null

/** The raw row shape GET /api/tenant/solar reads from solar_estimates. */
export type SolarEstimateRawRow = {
  public_token: string
  address: string | null
  state: string | null
  postcode: string | null
  intake_id: string | null
  confirmed_at: string | null
  paid_at?: string | null
  guardrail_flags: unknown
  routing: string | null
  created_at: string
  price: { tiers?: SolarPriceTier[] } | null
  sizing: { tiers?: SolarSystemTier[] } | null
  /** Quote layout variant (migration 111). Missing on old rows = instant. */
  quote_variant?: string | null
  /** Property electrical phase (migration 116/117). Missing on old rows = unknown. */
  electrical_phase?: string | null
  /** Tradie/customer-requested system size kW DC (migration 116); null = auto. */
  requested_system_kw?: number | null
  /** Felt map provisioning record (felt-variant rows only). */
  felt?: SolarFeltRowSummary
  /**
   * Pylon STC cross-check, projected from estimate.context.pylon_stc_check.
   * The /api/tenant/solar route MUST project this as a top-level alias via the
   * arrow operator — `pylon_stc_check:estimate->context->pylon_stc_check` —
   * exactly like the sibling `pylon_opportunity` / `opensolar_project`
   * projections. PostgREST returns the value AT the path under the alias key,
   * NOT a re-nested `{ context: { pylon_stc_check } }` object. (The `name(cols)`
   * parenthesis form is foreign-table embedding and 400s against this jsonb
   * column.) Field names mirror SolarEstimateContext.pylon_stc_check; null when
   * the Pylon STC cross-check was disabled/unavailable.
   */
  pylon_stc_check?: {
    zone_rating?: number | null
    deeming_period?: number | null
    verified?: boolean
  } | null
  /** Detected structures on the property (multi-roof building picker,
   *  2026-06-16). Null/[] on the single-building path. */
  buildings?: DetectedBuilding[] | null
  /** Which building the headline estimate currently reflects. */
  selected_building_id?: string | null
  /** Resolved roof centre, projected from estimate.roof + context.location,
   *  so the dashboard picker's map framing matches the static-map image.
   *  Projected via the `estimate->roof` / `estimate->context->location`
   *  JSON-path aliases on the route's select. */
  roof?: { panels?: Array<{ center: { lat: number; lng: number } }> | null; polygon_geojson: { type?: string; coordinates?: number[][][] } | null } | null
  location?: { lat: number; lng: number } | null
}

/** The lean, client-safe view model the SolarTab renders per card. */
export type SolarEstimateViewModel = {
  token: string
  customerName: string | null
  address: string | null
  systemKw: number | null
  netIncGst: number | null
  stcCertificates: number | null
  /** Dollar STC rebate already subtracted from netIncGst; null when no priced
   *  tier / no STC breakdown. Shown so the dashboard matches the SMS + customer
   *  page ("net after STC rebate" — the rebate is already off Net). */
  stcRebateAud: number | null
  /** Pylon-verified STC zone rating (1.382...1.622); null when unverified. */
  stcZoneRating: number | null
  /** Deeming period years from the STC calc; null when unverified. */
  stcDeemingPeriod: number | null
  /** True when Pylon verified the STC count. */
  stcVerified: boolean
  status: SolarEstimateStatus
  guardrailCount: number
  /** The open checks, verbatim — rendered on flagged cards so the tradie
   *  knows exactly what to fix before re-drafting. */
  guardrailFlags: string[]
  routing: string | null
  createdAt: string
  /** True only when the tradie may confirm-and-release from the dashboard. */
  canConfirm: boolean
  /** True when the estimate may be re-drafted (any unreleased estimate —
   *  the fix loop for flagged rows, also useful after a config update). */
  canRedraft: boolean
  /** The /q/solar/[token] public quote link. */
  quoteUrl: string
  /** Live Pylon pipeline stage of the pushed lead (supplements build
   *  2026-06-13); null when no lead was pushed or Pylon is unreachable. */
  pylonStage: string | null
  /** Deep link to the lead in Pylon's web app. */
  pylonLeadUrl: string | null
  /** Deep link to the OpenSolar project created by the confirm-time lead
   *  push (enrichment build 2026-06-13); null when none was pushed. */
  openSolarProjectUrl: string | null
  /** Quote layout variant (Felt tab spec 2026-06-13). */
  quoteVariant: 'instant' | 'felt'
  /** Property electrical phase (design 2026-06-16). */
  electricalPhase: 'single' | 'three' | 'unknown'
  /** Tradie/customer-requested system size in kW DC; null when auto-sized. */
  requestedSystemKw: number | null
  /** Felt map provisioning status; null on instant rows / pre-provision. */
  feltStatus: 'pending' | 'provisioning' | 'ready' | 'partial' | 'failed' | null
  /** Tradie-facing "Open in Felt" editor link. */
  feltMapUrl: string | null
  /** Static map thumbnail for the card preview. */
  feltThumbnailUrl: string | null
  /** Structures detected on the property (multi-roof picker, 2026-06-16).
   *  [] on the single-building path — the dashboard switcher then hides. */
  buildings: DetectedBuilding[]
  /** Which building the estimate currently reflects. */
  selectedBuildingId: string | null
  /** Roof centre the picker projects building outlines against — matches
   *  the /api/solar/q/[token]/static-map framing. Null when unresolvable. */
  buildingMapCenter: LatLng | null
}

/**
 * PURE — shape one solar_estimates row (+ its resolved customer name and the
 * app base url) into the dashboard view model. The headline kW comes from
 * the chosen sizing tier; the net price from the matching price tier.
 */
export function mapSolarEstimateRow(args: {
  row: SolarEstimateRawRow
  customerName: string | null
  appUrl: string
  /** Resolved Pylon pipeline stage for this row's pushed lead, if any. */
  pylonStage?: { stage: string; url: string | null } | null
  /** OpenSolar project link for this row's pushed lead, if any. */
  openSolarProjectUrl?: string | null
}): SolarEstimateViewModel {
  const { row, customerName, appUrl } = args

  const sizingTier = pickTier<SolarSystemTier>(row.sizing?.tiers)
  const priceTier = pickTier<SolarPriceTier>(row.price?.tiers)

  // Prefer the price tier's own system_kw_dc (always priced) and fall back
  // to the sizing tier so a missing price jsonb still shows a system size.
  const systemKw =
    (priceTier?.system_kw_dc ?? sizingTier?.system_kw_dc ?? null) as number | null
  const netIncGst = (priceTier?.net_inc_gst ?? null) as number | null

  // STC certificate count + dollar rebate come from the deterministic price
  // tier (engine = source of truth — present whether or not Pylon is enabled).
  // The zone rating / deeming period / verified flag come from the optional
  // Pylon cross-check, projected to the top-level `pylon_stc_check` alias.
  const stcCertificates = (priceTier?.stc?.certificates ?? null) as number | null
  const stcRebateAud = (priceTier?.stc?.rebate_aud ?? null) as number | null
  const pylonStcCheck = row.pylon_stc_check
  const stcZoneRating = (pylonStcCheck?.zone_rating ?? null) as number | null
  const stcDeemingPeriod = (pylonStcCheck?.deeming_period ?? null) as number | null
  const stcVerified = pylonStcCheck?.verified ?? false

  const status = deriveSolarEstimateStatus(row)
  const guardrailFlags = solarGuardrailFlags(row.guardrail_flags)

  return {
    token: row.public_token,
    customerName: customerName?.trim() || null,
    address: row.address?.trim() || null,
    systemKw,
    netIncGst,
    stcCertificates,
    stcRebateAud,
    stcZoneRating,
    stcDeemingPeriod,
    stcVerified,
    status,
    guardrailCount: guardrailFlags.length,
    guardrailFlags,
    routing: row.routing,
    createdAt: row.created_at,
    // Only a clean, drafted-but-unreleased estimate can be confirmed from
    // the dashboard. Flagged → must re-draft; already confirmed/paid → no-op.
    canConfirm: status === 'awaiting_confirmation',
    // Any unreleased estimate may be re-drafted: the fix loop for flagged
    // rows, and a refresh path after a config/rate-card update.
    canRedraft: status === 'flagged' || status === 'awaiting_confirmation',
    quoteUrl: buildSolarQuoteUrl(appUrl, row.public_token),
    pylonStage: args.pylonStage?.stage ?? null,
    pylonLeadUrl: args.pylonStage?.url ?? null,
    openSolarProjectUrl: args.openSolarProjectUrl ?? null,
    quoteVariant: row.quote_variant === 'felt' ? 'felt' : 'instant',
    electricalPhase:
      row.electrical_phase === 'three' || row.electrical_phase === 'single'
        ? row.electrical_phase
        : 'unknown',
    requestedSystemKw:
      typeof row.requested_system_kw === 'number' ? row.requested_system_kw : null,
    feltStatus: row.felt?.status ?? null,
    feltMapUrl: row.felt?.map_url ?? null,
    feltThumbnailUrl: row.felt?.thumbnail_url ?? null,
    buildings: Array.isArray(row.buildings) ? row.buildings : [],
    selectedBuildingId: row.selected_building_id ?? null,
    buildingMapCenter: row.roof
      ? resolveSolarOverlayCenter({ roof: row.roof, location: row.location ?? null })
      : null,
  }
}

export type { TierLike }
