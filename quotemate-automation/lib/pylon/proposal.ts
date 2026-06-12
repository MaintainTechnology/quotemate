// ════════════════════════════════════════════════════════════════════
// Pylon proposal — pure normalization, guardrails and view models.
//
// NO I/O. The import route fetches the raw design + project payloads via
// lib/pylon/client.ts and feeds them through these functions to produce
// the snapshot stored in pylon_proposals.design and the view models the
// dashboard + customer page render.
//
// Money-path integrity: every dollar figure here is the tradie's own
// human-authored number from their Pylon design, passed through verbatim.
// All Pylon amounts are integer CENTS; line item amounts are EX-tax (the
// GST rides in tax_amount). The two validators below flag — never fix —
// any inconsistency, and a flagged proposal cannot be confirmed.
// ════════════════════════════════════════════════════════════════════

import { randomBytes } from 'node:crypto'
import type { PylonComponentDatasheet, PylonComponentKind } from './client'

// ── stored snapshot types (pylon_proposals.design) ───────────────────

export type PylonLineItem = {
  key: string | null
  description: string
  /** 'subtotal' | 'total' | 'amount_payable' | 'net_outcome' | 'none' */
  included_in_summary_line: string
  unit_amount_cents: number | null
  quantity: number | null
  total_amount_cents: number | null
  /** 'none' | 'input' | 'output' | 'au:exempt_expenses' */
  tax_type: string
  tax_rate: number | null
  tax_amount_cents: number | null
  is_line_hidden: boolean
  is_amount_hidden: boolean
  component_type: string | null
  component_id: string | null
}

export type PylonComponentLine = {
  kind: PylonComponentKind | 'material' | 'heat_pump' | 'ev_charger' | 'mounting'
  sku: string | null
  description: string
  quantity: number | null
  /** Enriched at import time when the SKU resolves; null otherwise. */
  datasheet: PylonComponentDatasheet | null
}

export type PylonProposalQuote = {
  currency: string | null
  total_tax_formatted: string | null
  total_price_formatted: string | null
  deposit_amount_formatted: string | null
  financed_amount_formatted: string | null
  amount_payable_formatted: string | null
  estimated_total_repayments_formatted: string | null
  locale_au: {
    eligible_for_stcs: boolean
    stc_quantity: number | null
    stc_value_formatted: string | null
    battery_stc_quantity: number | null
    battery_stc_value_formatted: string | null
    eligible_for_lgcs: boolean
    lgc_quantity: number | null
    lgc_value_formatted: string | null
  } | null
}

export type PylonProposalDesign = {
  pylon_design_id: string
  title: string | null
  label: string | null
  is_primary: boolean
  summary: {
    dc_output_kw: number | null
    storage_kwh: number | null
    description: string | null
    web_proposal_url: string | null
    pdf_proposal_url: string | null
    pv_site_information_url: string | null
    single_line_diagram_pdf_url: string | null
    latest_snapshot_url: string | null
  }
  locale_au: {
    stc_quantity: number | null
    stc_value_cents: number | null
    battery_stc_quantity: number | null
    battery_stc_value_cents: number | null
  } | null
  components: PylonComponentLine[]
  pricing: {
    total_cents: number | null
    total_includes_tax: boolean
    currency: string | null
  }
  line_items: PylonLineItem[]
  proposal_quote: PylonProposalQuote | null
  pylon_created_at: string | null
  pylon_updated_at: string | null
}

export type PylonProposalCustomer = {
  name: string | null
  phone: string | null
  email: string | null
}

export type PylonProposalSite = {
  address: Record<string, string | null>
  address_text: string | null
  location: [number, number] | null
  roof_type: string | null
  number_of_storeys: number | null
  power_phases: string | null
  nmi: string | null
  energy_retailer: string | null
  energy_distributor: string | null
}

// ── parsing helpers (defensive — payloads come from a third party) ──

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  return null
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

// ── normalization ─────────────────────────────────────────────────────

const COMPONENT_TYPE_KEYS: Array<[string, PylonComponentLine['kind']]> = [
  ['module_types', 'module'],
  ['inverter_types', 'inverter'],
  ['storage_types', 'battery'],
  ['material_types', 'material'],
  ['heat_pump_types', 'heat_pump'],
  ['ev_charger_types', 'ev_charger'],
  ['solar_mounting_system_types', 'mounting'],
]

/** PURE — raw flat design payload (client unwrap) → stored snapshot. */
export function normalizePylonDesign(flat: Record<string, unknown>): PylonProposalDesign {
  const summary = obj(flat.summary)
  const pricing = obj(flat.pricing)
  const localeAu = obj(obj(flat.locale).au)
  const pq = obj(flat.proposal_quote)
  const pqAu = obj(pq.locale_au)

  const components: PylonComponentLine[] = []
  for (const [key, kind] of COMPONENT_TYPE_KEYS) {
    for (const raw of arr(flat[key])) {
      const c = obj(raw)
      const description = str(c.description)
      if (!description) continue
      components.push({
        kind,
        sku: str(c.sku),
        description,
        quantity: num(c.quantity),
        datasheet: null,
      })
    }
  }

  const lineItems: PylonLineItem[] = []
  for (const raw of arr(flat.line_items)) {
    const li = obj(raw)
    const description = str(li.description)
    if (!description) continue
    lineItems.push({
      key: str(li.key),
      description,
      included_in_summary_line: str(li.included_in_summary_line) ?? 'none',
      unit_amount_cents: num(li.unit_amount),
      quantity: num(li.quantity),
      total_amount_cents: num(li.total_amount),
      tax_type: str(li.tax_type) ?? 'none',
      tax_rate: num(li.tax_rate),
      tax_amount_cents: num(li.tax_amount),
      is_line_hidden: li.is_line_hidden === true,
      is_amount_hidden: li.is_amount_hidden === true,
      component_type: str(li.component_type),
      component_id: str(li.component_id),
    })
  }

  const hasLocaleAu = Object.keys(localeAu).length > 0
  const hasPq = Object.keys(pq).length > 0

  return {
    pylon_design_id: String(flat.id ?? ''),
    title: str(flat.title),
    label: str(flat.label),
    is_primary: flat.is_primary === true,
    summary: {
      dc_output_kw: num(summary.dc_output_kw),
      storage_kwh: num(summary.storage_kwh),
      description: str(summary.description),
      web_proposal_url: str(summary.web_proposal_url),
      pdf_proposal_url: str(summary.pdf_proposal_url),
      pv_site_information_url: str(summary.pv_site_information_url),
      single_line_diagram_pdf_url: str(summary.single_line_diagram_pdf_url),
      latest_snapshot_url: str(summary.latest_snapshot_url),
    },
    locale_au: hasLocaleAu
      ? {
          stc_quantity: num(localeAu.stc_quantity),
          stc_value_cents: num(localeAu.stc_value),
          battery_stc_quantity: num(localeAu.battery_stc_quantity),
          battery_stc_value_cents: num(localeAu.battery_stc_value),
        }
      : null,
    components,
    pricing: {
      total_cents: num(pricing.total),
      total_includes_tax: pricing.total_includes_tax === true,
      currency: str(pricing.currency),
    },
    line_items: lineItems,
    proposal_quote: hasPq
      ? {
          currency: str(pq.currency),
          total_tax_formatted: str(pq.total_tax_formatted),
          total_price_formatted: str(pq.total_price_formatted),
          deposit_amount_formatted: str(pq.deposit_amount_formatted),
          financed_amount_formatted: str(pq.financed_amount_formatted),
          amount_payable_formatted: str(pq.amount_payable_formatted),
          estimated_total_repayments_formatted: str(pq.estimated_total_repayments_formatted),
          locale_au:
            Object.keys(pqAu).length > 0
              ? {
                  eligible_for_stcs: pqAu.eligible_for_stcs === true,
                  stc_quantity: num(pqAu.stc_quantity),
                  stc_value_formatted: str(pqAu.stc_value_formatted),
                  battery_stc_quantity: num(pqAu.battery_stc_quantity),
                  battery_stc_value_formatted: str(pqAu.battery_stc_value_formatted),
                  eligible_for_lgcs: pqAu.eligible_for_lgcs === true,
                  lgc_quantity: num(pqAu.lgc_quantity),
                  lgc_value_formatted: str(pqAu.lgc_value_formatted),
                }
              : null,
        }
      : null,
    pylon_created_at: str(flat.created_at),
    pylon_updated_at: str(flat.updated_at),
  }
}

/** PURE — the design's project relationship id, when present. */
export function designProjectId(flat: Record<string, unknown>): string | null {
  const rels = obj(flat.relationships)
  const project = obj(rels.project)
  const data = obj(project.data)
  return str(data.id)
}

/** PURE — raw flat solar_project payload → customer + site. */
export function normalizePylonProject(flat: Record<string, unknown>): {
  customer: PylonProposalCustomer
  site: PylonProposalSite
} {
  const cd = obj(flat.customer_details)
  const sa = obj(flat.site_address)
  const sd = obj(flat.site_details)
  const loc = arr(flat.site_location)

  const address: Record<string, string | null> = {
    line1: str(sa.line1),
    line2: str(sa.line2),
    city: str(sa.city),
    state: str(sa.state),
    zip: str(sa.zip),
    country: str(sa.country),
  }
  const addressText =
    [address.line1, address.line2, address.city, address.state, address.zip]
      .filter((p): p is string => !!p)
      .join(', ') || null

  const lng = num(loc[0])
  const lat = num(loc[1])

  return {
    customer: {
      name: str(cd.name),
      phone: str(cd.phone),
      email: str(cd.email),
    },
    site: {
      address,
      address_text: addressText,
      location: lng !== null && lat !== null ? [lng, lat] : null,
      roof_type: str(sd.roof_type),
      number_of_storeys: num(sd.number_of_storeys),
      power_phases: str(sd.power_phases),
      nmi: str(sd.nmi),
      energy_retailer: str(sd.energy_retailer),
      energy_distributor: str(sd.energy_distributor),
    },
  }
}

// ── guardrails (flag, never fix) ─────────────────────────────────────

/** STC line items are matched by quantity+negative amount or description. */
function findStcQuantity(design: PylonProposalDesign): number | null {
  // The authoritative source is locale.au.stc_quantity when present.
  if (design.locale_au?.stc_quantity != null) return design.locale_au.stc_quantity
  if (design.proposal_quote?.locale_au?.stc_quantity != null) {
    return design.proposal_quote.locale_au.stc_quantity
  }
  // Fall back to an STC-looking line item's quantity.
  const li = design.line_items.find(
    (l) => /\bSTC/i.test(l.description) && (l.total_amount_cents ?? 0) < 0,
  )
  return li?.quantity ?? null
}

/**
 * PURE — STC cross-check (mirrors the solar-tab guardrail). Compares the
 * design's own STC quantity against Pylon's stc_amount calculator result.
 * |Δ| > 1 certificate ⇒ flag. Either side missing ⇒ no flag (cannot check).
 */
export function stcMismatchFlag(
  design: PylonProposalDesign,
  pylonCalculatedStcs: number | null,
): string | null {
  const designStcs = findStcQuantity(design)
  if (designStcs === null || pylonCalculatedStcs === null) return null
  if (Math.abs(designStcs - pylonCalculatedStcs) > 1) {
    return `stc_mismatch_pylon:design=${designStcs},calculated=${Math.round(pylonCalculatedStcs)}`
  }
  return null
}

/**
 * PURE — totals re-add. Per the docs, summary lines are not cumulative:
 * the displayed total is Σ(items routed to 'subtotal' or 'total'), plus
 * tax when pricing.total_includes_tax. Divergence beyond rounding (>$1)
 * ⇒ flag. Missing inputs ⇒ no flag (cannot check).
 */
export function pricingMismatchFlag(design: PylonProposalDesign): string | null {
  const total = design.pricing.total_cents
  if (total === null || design.line_items.length === 0) return null
  let sum = 0
  for (const li of design.line_items) {
    if (li.included_in_summary_line !== 'subtotal' && li.included_in_summary_line !== 'total') {
      continue
    }
    sum += li.total_amount_cents ?? 0
    if (design.pricing.total_includes_tax) sum += li.tax_amount_cents ?? 0
  }
  if (Math.abs(sum - total) > 100) {
    return `pricing_mismatch_pylon:lines=${sum},total=${total}`
  }
  return null
}

/** PURE — all import-time guardrail flags for a normalized design. */
export function validatePylonProposal(
  design: PylonProposalDesign,
  pylonCalculatedStcs: number | null,
): string[] {
  const flags: string[] = []
  const stc = stcMismatchFlag(design, pylonCalculatedStcs)
  if (stc) flags.push(stc)
  const pricing = pricingMismatchFlag(design)
  if (pricing) flags.push(pricing)
  return flags
}

// ── money formatting (AU display) ────────────────────────────────────

/** Cents → "$12,345.67" (negative → "−$360.50" with a true minus). */
export function formatCentsAud(cents: number): string {
  const abs = Math.abs(cents)
  const dollars = Math.floor(abs / 100)
  const rem = abs % 100
  const core = `$${dollars.toLocaleString('en-AU')}.${String(rem).padStart(2, '0')}`
  return cents < 0 ? `\u2212${core}` : core
}

/**
 * PURE — "$7,600.00" / "$1,840" → integer cents; null when unparseable.
 * Pylon exposes the deposit only as a pre-formatted display string, so
 * the Stripe Checkout amount derives from it (the tradie's own figure).
 */
export function parseFormattedAudToCents(s: string | null | undefined): number | null {
  if (!s) return null
  const cleaned = s.replace(/[^0-9.\-\u2212]/g, '').replace('\u2212', '-')
  if (!cleaned) return null
  const dollars = Number.parseFloat(cleaned)
  if (!Number.isFinite(dollars)) return null
  return Math.round(dollars * 100)
}

export type PylonQuoteTableRow = {
  description: string
  quantity: number | null
  /** Display amount inc-tax for the line; null when the amount is hidden. */
  amount_formatted: string | null
  is_rebate: boolean
}

export type PylonQuoteTable = {
  rows: PylonQuoteTableRow[]
  total_tax_formatted: string | null
  total_formatted: string | null
  deposit_formatted: string | null
  amount_payable_formatted: string | null
}

/**
 * PURE — the customer-facing quote table: visible line items with
 * inc-tax amounts (ex-tax total + tax_amount), price-hidden lines shown
 * without an amount, hidden lines omitted entirely. Summary figures
 * come from proposal_quote's pre-formatted strings (the exact values
 * Pylon shows on its own proposal), falling back to pricing.total.
 */
export function buildPylonQuoteTable(design: PylonProposalDesign): PylonQuoteTable {
  const rows: PylonQuoteTableRow[] = []
  for (const li of design.line_items) {
    if (li.is_line_hidden) continue
    const incTax =
      li.total_amount_cents !== null
        ? li.total_amount_cents + (li.tax_amount_cents ?? 0)
        : null
    rows.push({
      description: li.description,
      quantity: li.quantity,
      amount_formatted: li.is_amount_hidden || incTax === null ? null : formatCentsAud(incTax),
      is_rebate: (incTax ?? 0) < 0,
    })
  }
  const pq = design.proposal_quote
  const fallbackTotal =
    design.pricing.total_cents !== null ? formatCentsAud(design.pricing.total_cents) : null
  return {
    rows,
    total_tax_formatted: pq?.total_tax_formatted ?? null,
    total_formatted: pq?.total_price_formatted ?? fallbackTotal,
    deposit_formatted: pq?.deposit_amount_formatted ?? null,
    amount_payable_formatted: pq?.amount_payable_formatted ?? null,
  }
}

// ── proposal lifecycle + view models ─────────────────────────────────

export type PylonProposalStatus = 'awaiting_confirmation' | 'confirmed' | 'paid' | 'flagged'

/** PURE — same precedence as the solar tab: flagged > paid > confirmed. */
export function derivePylonProposalStatus(row: {
  flags?: unknown
  confirmed_at?: string | null
  paid_at?: string | null
}): PylonProposalStatus {
  if (Array.isArray(row.flags) && row.flags.length > 0) return 'flagged'
  if (row.paid_at) return 'paid'
  if (row.confirmed_at) return 'confirmed'
  return 'awaiting_confirmation'
}

/** Public share token — base64url, 16 bytes (mirrors generateSolarToken). */
export function generatePylonToken(): string {
  return randomBytes(16).toString('base64url')
}

/** Raw pylon_proposals row shape the tenant routes read. */
export type PylonProposalRawRow = {
  public_token: string
  pylon_design_id: string
  title: string | null
  address_text: string | null
  customer: PylonProposalCustomer | null
  design: PylonProposalDesign | null
  assets: Record<string, string | null> | null
  flags: unknown
  status: string | null
  confirmed_at: string | null
  paid_at: string | null
  created_at: string
}

/** The lean, client-safe view model the Pylon sub-tab renders per card. */
export type PylonProposalViewModel = {
  token: string
  designId: string
  title: string | null
  customerName: string | null
  address: string | null
  systemKw: number | null
  storageKwh: number | null
  totalFormatted: string | null
  status: PylonProposalStatus
  flags: string[]
  createdAt: string
  canConfirm: boolean
  canReimport: boolean
  quoteUrl: string
  /** Tradie-facing reference links to Pylon's own hosted proposal. */
  pylonWebProposalUrl: string | null
  pylonPdfProposalUrl: string | null
}

/** PURE — the public customer proposal link. */
export function buildPylonQuoteUrl(appUrl: string, publicToken: string): string {
  const base = (appUrl || '').replace(/\/+$/, '')
  return `${base}/q/pylon/${publicToken}`
}

/** PURE — shape one pylon_proposals row into the dashboard view model. */
export function mapPylonProposalRow(args: {
  row: PylonProposalRawRow
  appUrl: string
}): PylonProposalViewModel {
  const { row, appUrl } = args
  const flags = Array.isArray(row.flags)
    ? row.flags.filter((f): f is string => typeof f === 'string' && f.length > 0)
    : []
  const status = derivePylonProposalStatus({
    flags,
    confirmed_at: row.confirmed_at,
    paid_at: row.paid_at,
  })
  const design = row.design
  return {
    token: row.public_token,
    designId: row.pylon_design_id,
    title: row.title ?? design?.title ?? null,
    customerName: row.customer?.name?.trim() || null,
    address: row.address_text?.trim() || null,
    systemKw: design?.summary.dc_output_kw ?? null,
    storageKwh: design?.summary.storage_kwh ?? null,
    totalFormatted:
      design?.proposal_quote?.total_price_formatted ??
      (design?.pricing.total_cents != null ? formatCentsAud(design.pricing.total_cents) : null),
    status,
    flags,
    createdAt: row.created_at,
    canConfirm: status === 'awaiting_confirmation',
    // Re-import is the fix loop for flagged proposals and the refresh path
    // after the tradie edits the design in Pylon studio.
    canReimport: status === 'flagged' || status === 'awaiting_confirmation',
    quoteUrl: buildPylonQuoteUrl(appUrl, row.public_token),
    pylonWebProposalUrl: design?.summary.web_proposal_url ?? null,
    pylonPdfProposalUrl: design?.summary.pdf_proposal_url ?? null,
  }
}
