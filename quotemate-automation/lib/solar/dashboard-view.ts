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

import type { SolarPriceTier, SolarSystemTier } from './types'

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
}

/** The lean, client-safe view model the SolarTab renders per card. */
export type SolarEstimateViewModel = {
  token: string
  customerName: string | null
  address: string | null
  systemKw: number | null
  netIncGst: number | null
  status: SolarEstimateStatus
  guardrailCount: number
  routing: string | null
  createdAt: string
  /** True only when the tradie may confirm-and-release from the dashboard. */
  canConfirm: boolean
  /** The /q/solar/[token] public quote link. */
  quoteUrl: string
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
}): SolarEstimateViewModel {
  const { row, customerName, appUrl } = args

  const sizingTier = pickTier<SolarSystemTier>(row.sizing?.tiers)
  const priceTier = pickTier<SolarPriceTier>(row.price?.tiers)

  // Prefer the price tier's own system_kw_dc (always priced) and fall back
  // to the sizing tier so a missing price jsonb still shows a system size.
  const systemKw =
    (priceTier?.system_kw_dc ?? sizingTier?.system_kw_dc ?? null) as number | null
  const netIncGst = (priceTier?.net_inc_gst ?? null) as number | null

  const status = deriveSolarEstimateStatus(row)
  const guardrailCount = solarGuardrailCount(row.guardrail_flags)

  return {
    token: row.public_token,
    customerName: customerName?.trim() || null,
    address: row.address?.trim() || null,
    systemKw,
    netIncGst,
    status,
    guardrailCount,
    routing: row.routing,
    createdAt: row.created_at,
    // Only a clean, drafted-but-unreleased estimate can be confirmed from
    // the dashboard. Flagged → must re-draft; already confirmed/paid → no-op.
    canConfirm: status === 'awaiting_confirmation',
    quoteUrl: buildSolarQuoteUrl(appUrl, row.public_token),
  }
}

export type { TierLike }
