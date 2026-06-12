// ════════════════════════════════════════════════════════════════════
// OpenSolar proposal — pure normalization, guardrails and view models.
//
// NO I/O. The import route fetches the raw project / systems-details /
// proposal-data payloads via lib/opensolar/client.ts and feeds them
// through these functions to produce the snapshot stored in
// opensolar_proposals.design and the view models the dashboard +
// customer page render.
//
// Money-path integrity: every dollar figure here is the tradie's own
// number from their OpenSolar design, passed through verbatim. OpenSolar
// amounts are DOLLARS (not cents). The validators below flag — never
// fix — any inconsistency, and a flagged proposal cannot be confirmed.
//
// Plan awareness: the proposal-data slice (line items, bills, financial
// metrics, monthly output) only exists on the Raw Data API Access plan.
// Everything in `proposal` is nullable; consumers fall back to the
// QuoteMate-modelled modules (lib/opensolar/modelled.ts), labelled.
// ════════════════════════════════════════════════════════════════════

import { randomBytes } from 'node:crypto'

// ── parsing helpers (defensive — payloads come from a third party) ──

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    // Proposal-data numerics arrive comma-formatted ("8,547") or as
    // plain numeric strings ("6.210") — strip display formatting.
    const n = Number.parseFloat(v.replace(/[,$\s]/g, ''))
    if (Number.isFinite(n)) return n
  }
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

// ── stored snapshot types (opensolar_proposals.design) ───────────────

export type OpenSolarComponentKind = 'module' | 'inverter' | 'battery' | 'other'

export type OpenSolarComponentLine = {
  kind: OpenSolarComponentKind
  manufacturer: string | null
  code: string | null
  quantity: number | null
}

export type OpenSolarModuleGroup = {
  module_quantity: number | null
  azimuth_deg: number | null
  slope_deg: number | null
  layout: string | null
}

export type OpenSolarAdder = {
  label: string
  total_value_aud: number | null
  quantity: number | null
  show_customer: boolean
}

export type OpenSolarIncentive = {
  title: string
  value_aud: number | null
  paid_to_customer: boolean
}

export type OpenSolarLineItem = {
  description: string
  quantity: number | null
  amount_aud: number | null
}

/** The Raw-Data-plan proposal slice — every field nullable (plan-gated). */
export type OpenSolarProposalSlice = {
  output_monthly_kwh: number[] | null
  payback_year: number | null
  npv_aud: number | null
  irr_pct: number | null
  roi_pct: number | null
  bill_before_annual_aud: number | null
  bill_after_annual_aud: number | null
  line_items: OpenSolarLineItem[]
  payment_option_label: string | null
  deposit_aud: number | null
  tax_name: string | null
  calculation_error_messages: string[]
}

export type OpenSolarProposalDesign = {
  opensolar_project_id: string
  system_uuid: string
  system_name: string | null
  kw_stc: number | null
  module_quantity: number | null
  battery_total_kwh: number | null
  /** Real designed annual AC output from the system payload, kWh/yr. */
  output_annual_kwh: number | null
  consumption_offset_pct: number | null
  co2_tons_lifetime: number | null
  /** The tradie's own price — verbatim, dollars. */
  price_including_tax_aud: number | null
  price_excluding_tax_aud: number | null
  components: OpenSolarComponentLine[]
  module_groups: OpenSolarModuleGroup[]
  adders: OpenSolarAdder[]
  incentives: OpenSolarIncentive[]
  /** STC quantity when the design exposes one (incentive detail). */
  stc_quantity: number | null
  /** Σ module_groups quantities matches the total — geometry sanity. */
  geometry_consistent: boolean
  /** Raw-Data-plan proposal slice; null on the API Access plan. */
  proposal: OpenSolarProposalSlice | null
  /** Non-blocking import notices (plan limits, decode failures, OpenSolar
   *  calculation errors) — shown on the dashboard card, never block confirm. */
  import_warnings: string[]
}

export type OpenSolarProposalCustomer = {
  name: string | null
  phone: string | null
  email: string | null
}

export type OpenSolarProposalSite = {
  address_text: string | null
  state: string | null
  zip: string | null
  location: [number, number] | null
}

// ── normalization: project facts (customer + site) ───────────────────

/** PURE — raw project payload → customer + site facts. */
export function normalizeOpenSolarProject(flat: Record<string, unknown>): {
  customer: OpenSolarProposalCustomer
  site: OpenSolarProposalSite
} {
  // Contacts ride as contacts_data (webhook/projects shape); tolerate a
  // plain contacts array of objects with the same fields.
  const contacts = arr(flat.contacts_data).length > 0 ? arr(flat.contacts_data) : arr(flat.contacts)
  const first = obj(contacts[0])
  const name =
    [str(first.first_name), str(first.family_name)].filter(Boolean).join(' ') ||
    str(first.display) ||
    null

  const addressText =
    [str(flat.address), str(flat.locality), str(flat.state), str(flat.zip)]
      .filter(Boolean)
      .join(', ') || null

  const lat = num(flat.lat)
  const lon = num(flat.lon)

  return {
    customer: {
      name,
      phone: str(first.phone),
      email: str(first.email),
    },
    site: {
      address_text: addressText,
      state: str(flat.state),
      zip: str(flat.zip),
      location: lon !== null && lat !== null ? [lon, lat] : null,
    },
  }
}

// ── normalization: systems/details + system list row ─────────────────

const COMPONENT_KEYS: Array<[string, OpenSolarComponentKind]> = [
  ['modules', 'module'],
  ['inverters', 'inverter'],
  ['batteries', 'battery'],
  ['other_components', 'other'],
]

/** PURE — pick one system out of the systems/details payload. A null
 *  uuid selects the first system (the common single-system project). */
export function pickOpenSolarSystem(
  details: Record<string, unknown>,
  systemUuid: string | null,
): Record<string, unknown> | null {
  const systems = arr(details.systems).map(obj)
  if (systems.length === 0) return null
  if (!systemUuid) return systems[0]
  return systems.find((s) => str(s.uuid) === systemUuid) ?? null
}

/** PURE — slim list of systems for the dashboard system picker. */
export function listOpenSolarSystems(details: Record<string, unknown>): Array<{
  uuid: string
  name: string | null
  kw_stc: number | null
  module_quantity: number | null
}> {
  return arr(details.systems)
    .map(obj)
    .flatMap((s) => {
      const uuid = str(s.uuid)
      if (!uuid) return []
      return [
        {
          uuid,
          name: str(s.name),
          kw_stc: num(s.kw_stc),
          module_quantity: num(s.total_module_quantity) ?? num(s.module_quantity),
        },
      ]
    })
}

/** Incentive titles that look like the AU STC line ("39 STCs", "STC…"). */
function extractStcQuantity(incentives: OpenSolarIncentive[]): number | null {
  for (const inc of incentives) {
    if (!/\bSTC/i.test(inc.title)) continue
    const m = inc.title.match(/(\d+(?:\.\d+)?)\s*STC/i)
    if (m) return Number.parseFloat(m[1])
  }
  return null
}

/**
 * PURE — one system from systems/details (+ the optional matching
 * proposal-data slice) → the stored design snapshot.
 */
export function normalizeOpenSolarDesign(args: {
  projectId: string
  system: Record<string, unknown>
  proposalSlice?: OpenSolarProposalSlice | null
  importWarnings?: string[]
}): OpenSolarProposalDesign {
  const { system } = args

  const components: OpenSolarComponentLine[] = []
  for (const [key, kind] of COMPONENT_KEYS) {
    for (const raw of arr(system[key])) {
      const c = obj(raw)
      const manufacturer = str(c.manufacturer_name)
      const code = str(c.code)
      if (!manufacturer && !code) continue
      components.push({ kind, manufacturer, code, quantity: num(c.quantity) })
    }
  }

  const module_groups: OpenSolarModuleGroup[] = arr(system.module_groups).map((raw) => {
    const g = obj(raw)
    return {
      module_quantity: num(g.module_quantity),
      azimuth_deg: num(g.azimuth),
      slope_deg: num(g.slope),
      layout: str(g.layout),
    }
  })

  const adders: OpenSolarAdder[] = arr(system.adders).flatMap((raw) => {
    const a = obj(raw)
    const label = str(a.label)
    if (!label) return []
    return [
      {
        label,
        total_value_aud: num(a.total_value),
        quantity: num(a.quantity),
        show_customer: a.show_customer === true,
      },
    ]
  })

  const incentives: OpenSolarIncentive[] = arr(system.incentives).flatMap((raw) => {
    const i = obj(raw)
    const title = str(i.title)
    if (!title) return []
    return [
      {
        title,
        value_aud: num(i.value),
        paid_to_customer: i.paid_to_customer === true,
      },
    ]
  })

  const totalModules = num(system.total_module_quantity) ?? num(system.module_quantity)
  const groupSum = module_groups.reduce((acc, g) => acc + (g.module_quantity ?? 0), 0)
  // Geometry sanity: a mismatched sum means we must not draw anything —
  // the cached system image carries the layout section instead.
  const geometry_consistent =
    module_groups.length === 0 || totalModules == null || groupSum === totalModules

  return {
    opensolar_project_id: args.projectId,
    system_uuid: str(system.uuid) ?? '',
    system_name: str(system.name),
    kw_stc: num(system.kw_stc),
    module_quantity: totalModules,
    battery_total_kwh: num(system.battery_total_kwh),
    output_annual_kwh: num(system.output_annual_kwh),
    consumption_offset_pct: num(system.consumption_offset_percentage),
    co2_tons_lifetime: num(system.co2_tons_lifetime),
    price_including_tax_aud: num(system.price_including_tax),
    price_excluding_tax_aud: num(system.price_excluding_tax),
    components,
    module_groups,
    adders,
    incentives,
    stc_quantity: extractStcQuantity(incentives),
    geometry_consistent,
    proposal: args.proposalSlice ?? null,
    import_warnings: [
      ...(args.importWarnings ?? []),
      ...(args.proposalSlice?.calculation_error_messages.length
        ? [
            `calc_errors_opensolar: ${args.proposalSlice.calculation_error_messages
              .slice(0, 3)
              .join('; ')}`,
          ]
        : []),
    ],
  }
}

// ── normalization: proposal data (user_logins, Raw Data plan) ─────────

/**
 * PURE — pull the per-system proposal slice out of a user_logins payload.
 * The payload is an array of org objects each carrying projects[] with
 * systems[]; numbers arrive as display-formatted strings. Every field is
 * best-effort — anything missing stays null and the modelled fallbacks
 * carry that section.
 */
export function extractOpenSolarProposalSlice(
  payload: unknown,
  projectId: string,
  systemUuid: string | null,
): OpenSolarProposalSlice | null {
  const orgs = Array.isArray(payload) ? payload.map(obj) : [obj(payload)]
  for (const org of orgs) {
    for (const rawProject of arr(org.projects)) {
      const project = obj(rawProject)
      if (project.id == null || String(project.id) !== projectId) continue

      const pd = obj(project.proposal_data)
      const systems = arr(pd.systems).map(obj)
      const system =
        (systemUuid ? systems.find((s) => str(s.uuid) === systemUuid) : null) ?? systems[0]
      if (!system) return null

      const data = obj(system.data)

      // Monthly output: output_monthly_json (string) or data.output.monthly.
      let monthly: number[] | null = null
      const monthlyJson = str(system.output_monthly_json)
      if (monthlyJson) {
        try {
          const parsed = JSON.parse(monthlyJson) as unknown
          if (Array.isArray(parsed) && parsed.length === 12) {
            const vals = parsed.map((v) => num(v) ?? 0)
            if (vals.some((v) => v > 0)) monthly = vals
          }
        } catch {
          /* tolerate malformed display JSON */
        }
      }
      if (!monthly) {
        const output = obj(data.output)
        const m = arr(output.monthly).map((v) => num(v) ?? 0)
        if (m.length === 12 && m.some((v) => v > 0)) monthly = m
      }

      // Bills: current vs proposed annual totals, shape-tolerant.
      const bills = obj(data.bills)
      const billAnnual = (which: 'current' | 'proposed'): number | null => {
        const b = obj(bills[which])
        return (
          num(b.bill_yearly) ??
          num(b.annual_total) ??
          num(b.total_annual) ??
          num(b.yearly_total) ??
          num(bills[`${which}_annual`])
        )
      }

      // Line items: description + qty + amount, shape-tolerant.
      const line_items: OpenSolarLineItem[] = arr(data.line_items).flatMap((raw) => {
        const li = obj(raw)
        const description = str(li.description) ?? str(li.label) ?? str(li.title)
        if (!description) return []
        return [
          {
            description,
            quantity: num(li.quantity) ?? num(li.qty),
            amount_aud: num(li.amount) ?? num(li.value) ?? num(li.price) ?? num(li.total),
          },
        ]
      })

      // Payment option: the first one is the featured option.
      const paymentOptions = arr(data.payment_options).map(obj)
      const featured = paymentOptions[0] ?? {}
      const deposit =
        num(featured.deposit) ??
        num(featured.deposit_amount) ??
        num(featured.down_payment) ??
        num(obj(featured.pricing).deposit)

      const calcErrors = arr(project.calculation_error_messages)
        .map((m) => str(m))
        .filter((m): m is string => !!m)

      return {
        output_monthly_kwh: monthly,
        payback_year: num(system.systemPaybackYear),
        npv_aud: num(system.systemNetPresentValue),
        irr_pct: num(system.systemIrr),
        roi_pct: num(system.systemReturnOnInvestment),
        bill_before_annual_aud: billAnnual('current'),
        bill_after_annual_aud: billAnnual('proposed'),
        line_items,
        payment_option_label: str(featured.title) ?? str(featured.name),
        deposit_aud: deposit,
        tax_name: str(pd.tax_name) ?? str(project.tax_name) ?? 'GST',
        calculation_error_messages: calcErrors,
      }
    }
  }
  return null
}

// ── guardrails (flag, never fix) ─────────────────────────────────────

/**
 * PURE — STC cross-check. Compares the design's own STC quantity against
 * the independently calculated quantity (deterministic calculator /
 * Pylon stc_amount second opinion). |Δ| > 1 certificate ⇒ flag. Either
 * side missing ⇒ no flag (cannot check).
 */
export function openSolarStcMismatchFlag(
  design: OpenSolarProposalDesign,
  calculatedStcs: number | null,
): string | null {
  if (design.stc_quantity === null || calculatedStcs === null) return null
  if (Math.abs(design.stc_quantity - calculatedStcs) > 1) {
    return `stc_mismatch_opensolar:design=${design.stc_quantity},calculated=${Math.round(calculatedStcs)}`
  }
  return null
}

/**
 * PURE — totals re-add. Only checkable when the Raw-Data plan exposed
 * line items: Σ line-item amounts must land within $1 of the system's
 * price_including_tax. Missing inputs ⇒ no flag (cannot check).
 */
export function openSolarPricingMismatchFlag(design: OpenSolarProposalDesign): string | null {
  const total = design.price_including_tax_aud
  const items = design.proposal?.line_items ?? []
  if (total === null || items.length === 0) return null
  if (items.some((li) => li.amount_aud === null)) return null
  const sum = items.reduce((acc, li) => acc + (li.amount_aud ?? 0), 0)
  if (Math.abs(sum - total) > 1) {
    return `pricing_mismatch_opensolar:lines=${sum.toFixed(2)},total=${total.toFixed(2)}`
  }
  return null
}

/** PURE — all import-time guardrail flags for a normalized design. */
export function validateOpenSolarProposal(
  design: OpenSolarProposalDesign,
  calculatedStcs: number | null,
): string[] {
  const flags: string[] = []
  const stc = openSolarStcMismatchFlag(design, calculatedStcs)
  if (stc) flags.push(stc)
  const pricing = openSolarPricingMismatchFlag(design)
  if (pricing) flags.push(pricing)
  return flags
}

// ── money formatting (AU display, dollar amounts) ────────────────────

/** Dollars → "$12,345.67" (negative → "−$360.50" with a true minus). */
export function formatAud(dollars: number): string {
  const abs = Math.abs(dollars)
  const core = `$${abs.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  return dollars < 0 ? `\u2212${core}` : core
}

export type OpenSolarQuoteTableRow = {
  description: string
  quantity: number | null
  amount_formatted: string | null
  is_rebate: boolean
}

export type OpenSolarQuoteTable = {
  rows: OpenSolarQuoteTableRow[]
  total_formatted: string | null
  deposit_formatted: string | null
  payment_option_label: string | null
  tax_name: string
}

/**
 * PURE — the customer-facing quote table. Raw-Data plan: the design's
 * own line items verbatim. API Access plan: synthesized from the system
 * facts — one system line at the inc-tax price, customer-visible adders,
 * and incentives as rebate lines. Either way the figures are the
 * tradie's own OpenSolar numbers.
 */
export function buildOpenSolarQuoteTable(design: OpenSolarProposalDesign): OpenSolarQuoteTable {
  const rows: OpenSolarQuoteTableRow[] = []
  const proposalItems = design.proposal?.line_items ?? []

  if (proposalItems.length > 0) {
    for (const li of proposalItems) {
      rows.push({
        description: li.description,
        quantity: li.quantity,
        amount_formatted: li.amount_aud !== null ? formatAud(li.amount_aud) : null,
        is_rebate: (li.amount_aud ?? 0) < 0,
      })
    }
  } else {
    const systemLabel =
      design.system_name ??
      (design.kw_stc != null ? `${design.kw_stc.toFixed(2)} kW solar system` : 'Solar system')
    rows.push({
      description: `${systemLabel} — supply & install`,
      quantity: null,
      amount_formatted:
        design.price_including_tax_aud !== null ? formatAud(design.price_including_tax_aud) : null,
      is_rebate: false,
    })
    for (const adder of design.adders) {
      if (!adder.show_customer) continue
      rows.push({
        description: adder.label,
        quantity: adder.quantity,
        amount_formatted: adder.total_value_aud !== null ? formatAud(adder.total_value_aud) : null,
        is_rebate: (adder.total_value_aud ?? 0) < 0,
      })
    }
    for (const inc of design.incentives) {
      if (!inc.paid_to_customer) continue
      rows.push({
        description: inc.title,
        quantity: null,
        amount_formatted: inc.value_aud !== null ? formatAud(-Math.abs(inc.value_aud)) : null,
        is_rebate: true,
      })
    }
  }

  return {
    rows,
    total_formatted:
      design.price_including_tax_aud !== null ? formatAud(design.price_including_tax_aud) : null,
    deposit_formatted:
      design.proposal?.deposit_aud != null && design.proposal.deposit_aud > 0
        ? formatAud(design.proposal.deposit_aud)
        : null,
    payment_option_label: design.proposal?.payment_option_label ?? null,
    tax_name: design.proposal?.tax_name ?? 'GST',
  }
}

// ── proposal lifecycle + view models ─────────────────────────────────

export type OpenSolarProposalStatus = 'awaiting_confirmation' | 'confirmed' | 'paid' | 'flagged'

/** PURE — same precedence as the Pylon tab: flagged > paid > confirmed. */
export function deriveOpenSolarProposalStatus(row: {
  flags?: unknown
  confirmed_at?: string | null
  paid_at?: string | null
}): OpenSolarProposalStatus {
  if (Array.isArray(row.flags) && row.flags.length > 0) return 'flagged'
  if (row.paid_at) return 'paid'
  if (row.confirmed_at) return 'confirmed'
  return 'awaiting_confirmation'
}

/** Public share token — base64url, 16 bytes (mirrors generatePylonToken). */
export function generateOpenSolarToken(): string {
  return randomBytes(16).toString('base64url')
}

/** PURE — the public customer proposal link. */
export function buildOpenSolarQuoteUrl(appUrl: string, publicToken: string): string {
  const base = (appUrl || '').replace(/\/+$/, '')
  return `${base}/q/opensolar/${publicToken}`
}

/** Raw opensolar_proposals row shape the tenant routes read. */
export type OpenSolarProposalRawRow = {
  public_token: string
  opensolar_project_id: string
  opensolar_system_uuid: string
  title: string | null
  address_text: string | null
  customer: OpenSolarProposalCustomer | null
  design: OpenSolarProposalDesign | null
  assets: Record<string, string | null> | null
  flags: unknown
  status: string | null
  confirmed_at: string | null
  paid_at: string | null
  created_at: string
}

/** The lean, client-safe view model the OpenSolar sub-tab renders per card. */
export type OpenSolarProposalViewModel = {
  token: string
  projectId: string
  systemUuid: string
  title: string | null
  customerName: string | null
  address: string | null
  systemKw: number | null
  storageKwh: number | null
  totalFormatted: string | null
  status: OpenSolarProposalStatus
  flags: string[]
  createdAt: string
  canConfirm: boolean
  canReimport: boolean
  quoteUrl: string
  /** Tradie-facing link to the project in the OpenSolar web app. */
  openSolarProjectUrl: string
}

/** PURE — shape one opensolar_proposals row into the dashboard view model. */
export function mapOpenSolarProposalRow(args: {
  row: OpenSolarProposalRawRow
  appUrl: string
}): OpenSolarProposalViewModel {
  const { row, appUrl } = args
  const flags = Array.isArray(row.flags)
    ? row.flags.filter((f): f is string => typeof f === 'string' && f.length > 0)
    : []
  const status = deriveOpenSolarProposalStatus({
    flags,
    confirmed_at: row.confirmed_at,
    paid_at: row.paid_at,
  })
  const design = row.design
  return {
    token: row.public_token,
    projectId: row.opensolar_project_id,
    systemUuid: row.opensolar_system_uuid,
    title: row.title ?? design?.system_name ?? null,
    customerName: row.customer?.name?.trim() || null,
    address: row.address_text?.trim() || null,
    systemKw: design?.kw_stc ?? null,
    storageKwh: design?.battery_total_kwh ?? null,
    totalFormatted:
      design?.price_including_tax_aud != null ? formatAud(design.price_including_tax_aud) : null,
    status,
    flags,
    createdAt: row.created_at,
    canConfirm: status === 'awaiting_confirmation',
    canReimport: status === 'flagged' || status === 'awaiting_confirmation',
    quoteUrl: buildOpenSolarQuoteUrl(appUrl, row.public_token),
    openSolarProjectUrl: `https://app.opensolar.com/#/projects/${row.opensolar_project_id}`,
  }
}
