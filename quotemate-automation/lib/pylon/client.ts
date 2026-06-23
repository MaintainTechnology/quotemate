// ════════════════════════════════════════════════════════════════════
// Pylon — light API integration (premium quote spec §4.5).
//
// SERVER-ONLY. api.getpylon.com is REST/JSON:API with a Bearer token
// read from PYLON_API_KEY (never hardcoded; the key once shared in chat
// must be rotated). The whole integration is enrichment:
//
//   • GET /v1/au/stc_amount — Pylon's official STC quantity calculator,
//     used as a CROSS-CHECK guardrail against our deterministic STC
//     math. It never changes a price; a mismatch only flags the
//     estimate for tradie review.
//   • POST /v1/opportunities_form — optional CRM lead push on first
//     confirm, behind the per-tenant pylon_lead_push flag.
//
// Flags: PYLON_ENABLED env gate (default off) + PYLON_API_KEY present.
// Every function returns a result object and NEVER throws — Pylon
// unreachable means the estimate flow is bit-identical to today
// (degradation matrix §4.6).
// ════════════════════════════════════════════════════════════════════

const PYLON_BASE_URL = 'https://api.getpylon.com'
const TIMEOUT_MS = 5_000

/** PURE — the integration gate. Enabled only when PYLON_ENABLED is
 *  'true'/'1' AND a key exists. Callers pass process.env values. */
export function pylonEnabled(env: {
  PYLON_ENABLED?: string
  PYLON_API_KEY?: string
}): boolean {
  const on = env.PYLON_ENABLED === 'true' || env.PYLON_ENABLED === '1'
  return on && typeof env.PYLON_API_KEY === 'string' && env.PYLON_API_KEY.length > 0
}

/**
 * PURE — per-tenant CRM lead-push gate (spec §4.5). The spec calls for a
 * tenant-level flag; the tenants table has no settings jsonb yet (and
 * this feature ships with NO DB migration), so the allowlist lives in
 * the PYLON_LEAD_PUSH_TENANTS env var: comma-separated tenant ids, or
 * '*' for all tenants. Moves into tenant settings when that column
 * lands. Requires the master pylonEnabled() gate too.
 */
export function pylonLeadPushEnabled(
  env: { PYLON_ENABLED?: string; PYLON_API_KEY?: string; PYLON_LEAD_PUSH_TENANTS?: string },
  tenantId: string | null,
): boolean {
  if (!pylonEnabled(env)) return false
  if (!tenantId) return false
  const list = (env.PYLON_LEAD_PUSH_TENANTS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return list.includes('*') || list.includes(tenantId)
}

export type PylonResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: 'disabled' | 'http_error' | 'network_error' | 'invalid_response'; detail: string }

export type PylonClientOpts = {
  apiKey?: string
  baseUrl?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

async function pylonGet(
  path: string,
  params: Record<string, string>,
  opts: PylonClientOpts,
): Promise<PylonResult<unknown>> {
  return pylonRequest(path + '?' + new URLSearchParams(params).toString(), { method: 'GET' }, opts)
}

async function pylonRequest(
  pathWithQuery: string,
  init: RequestInit,
  opts: PylonClientOpts,
): Promise<PylonResult<unknown>> {
  const apiKey = opts.apiKey ?? process.env.PYLON_API_KEY
  if (!apiKey) {
    return { ok: false, code: 'disabled', detail: 'PYLON_API_KEY is not set.' }
  }
  const base = (opts.baseUrl ?? PYLON_BASE_URL).replace(/\/$/, '')
  const doFetch = opts.fetchImpl ?? fetch
  let res: Response
  try {
    res = await doFetch(base + pathWithQuery, {
      ...init,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/vnd.api+json, application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(opts.timeoutMs ?? TIMEOUT_MS),
    })
  } catch (e) {
    return {
      ok: false,
      code: 'network_error',
      detail: e instanceof Error ? e.message : String(e),
    }
  }
  if (!res.ok) {
    let body = ''
    try {
      body = (await res.text()).slice(0, 300)
    } catch {
      /* ignore */
    }
    return { ok: false, code: 'http_error', detail: `Pylon returned ${res.status}: ${body}` }
  }
  try {
    return { ok: true, data: await res.json() }
  } catch (e) {
    return {
      ok: false,
      code: 'invalid_response',
      detail: e instanceof Error ? e.message : String(e),
    }
  }
}

// ── STC amount cross-check (spec §4.5) ───────────────────────────────

export type PylonStcAmount = {
  stcs: number
  zone: string | null
  zone_rating: number | null
  deeming_period: number | null
}

/**
 * GET /v1/au/stc_amount — Pylon's official STC calculator (no special
 * permissions required per their docs). Never throws.
 */
export async function fetchPylonStcAmount(
  args: {
    output_kw: number
    site_postcode: string
    installation_year: number
    sgu_kind?: string
  },
  opts: PylonClientOpts = {},
): Promise<PylonResult<PylonStcAmount>> {
  const res = await pylonGet(
    '/v1/au/stc_amount',
    {
      sgu_kind: args.sgu_kind ?? 'solar_deemed',
      output_kw: String(args.output_kw),
      site_postcode: args.site_postcode,
      installation_year: String(args.installation_year),
    },
    opts,
  )
  if (!res.ok) return res

  // Tolerate both flat and JSON:API-wrapped payloads.
  const body = res.data as Record<string, unknown>
  const flat =
    body && typeof body === 'object' && body.data && typeof body.data === 'object'
      ? ((body.data as Record<string, unknown>).attributes ?? body.data)
      : body
  const obj = (flat ?? {}) as Record<string, unknown>
  const stcs = numberOrNull(obj.stcs)
  if (stcs === null) {
    return {
      ok: false,
      code: 'invalid_response',
      detail: 'Pylon stc_amount response carried no numeric stcs field.',
    }
  }
  return {
    ok: true,
    data: {
      stcs,
      zone: typeof obj.zone === 'string' ? obj.zone : null,
      zone_rating: numberOrNull(obj.zone_rating),
      deeming_period: numberOrNull(obj.deeming_period),
    },
  }
}

// ── CRM lead push (spec §4.5; field names fixed 2026-06-13) ──────────
//
// Verified against the live docs: the create-leads body uses first_name
// (the ONLY mandatory field), last_name, phone_number, email_address, a
// STRUCTURED address object, notes, source_name/source_linked_id and
// value (whole dollars). The original integration sent name/phone/email/
// address-as-string — fields Pylon does not accept.

export type PylonOpportunityLead = {
  /** Full display name — split into first_name / last_name on the wire. */
  name: string
  phone?: string | null
  email?: string | null
  /** Free-text site address; sent as address.line1. */
  address?: string | null
  state?: string | null
  postcode?: string | null
  /** Lead title shown in Pylon's UI. */
  title?: string | null
  /** Free-text system summary, e.g. "10 kW solar — QuoteMax estimate". */
  summary?: string | null
  /** Estimated opportunity value in WHOLE DOLLARS (per Pylon's docs). */
  valueDollars?: number | null
  /** Our identifier (estimate token) — stored as source.linked_id. */
  sourceLinkedId?: string | null
}

export type PylonOpportunityRef = {
  id: string | null
  in_app_url: string | null
}

/**
 * POST /v1/opportunities_form — push a confirmed QuoteMax estimate into
 * the tenant's Pylon pipeline as a lead. Returns the created
 * opportunity's id + in-app URL so the dashboard can read its pipeline
 * stage back later. Fire-and-forget; never throws.
 */
export async function pushPylonOpportunity(
  lead: PylonOpportunityLead,
  opts: PylonClientOpts = {},
): Promise<PylonResult<PylonOpportunityRef>> {
  const [first, ...rest] = lead.name.trim().split(/\s+/)
  const address =
    lead.address || lead.state || lead.postcode
      ? {
          line1: lead.address ?? undefined,
          state: lead.state ?? undefined,
          zip: lead.postcode ?? undefined,
          country: 'Australia',
        }
      : undefined
  const res = await pylonRequest(
    '/v1/opportunities_form',
    {
      method: 'POST',
      body: JSON.stringify({
        first_name: first || 'QuoteMax',
        last_name: rest.length > 0 ? rest.join(' ') : undefined,
        phone_number: lead.phone ?? undefined,
        email_address: lead.email ?? undefined,
        address,
        title: lead.title ?? undefined,
        notes: lead.summary ?? undefined,
        value:
          lead.valueDollars != null && Number.isFinite(lead.valueDollars)
            ? Math.round(lead.valueDollars)
            : undefined,
        source_name: 'quotemate',
        source_linked_id: lead.sourceLinkedId ?? undefined,
      }),
    },
    opts,
  )
  if (!res.ok) return res
  const flat = unwrapResource((res.data as Record<string, unknown>)?.data ?? res.data)
  return {
    ok: true,
    data: {
      id: typeof flat?.id === 'string' ? flat.id : null,
      in_app_url: typeof flat?.in_app_url === 'string' ? flat.in_app_url : null,
    },
  }
}

// ── Opportunity / pipeline read-back (supplements build 2026-06-13) ──

export type PylonOpportunityStatus = {
  id: string
  current_pipeline_name: string | null
  in_app_url: string | null
  pipeline_stage_id: string | null
  lead_status_id: string | null
}

/** GET /v1/opportunities/{id} — where a pushed lead sits in Pylon. */
export async function fetchPylonOpportunity(
  opportunityId: string,
  opts: PylonClientOpts = {},
): Promise<PylonResult<PylonOpportunityStatus>> {
  const res = await pylonGet(`/v1/opportunities/${encodeURIComponent(opportunityId)}`, {}, opts)
  if (!res.ok) return res
  const flat = unwrapResource((res.data as Record<string, unknown>)?.data ?? res.data)
  if (!flat || typeof flat.id !== 'string') {
    return { ok: false, code: 'invalid_response', detail: 'opportunity payload had no resource object.' }
  }
  const rels = (flat.relationships ?? {}) as Record<
    string,
    { data?: { id?: string } | null } | undefined
  >
  return {
    ok: true,
    data: {
      id: flat.id,
      current_pipeline_name:
        typeof flat.current_pipeline_name === 'string' ? flat.current_pipeline_name : null,
      in_app_url: typeof flat.in_app_url === 'string' ? flat.in_app_url : null,
      pipeline_stage_id: rels.pipeline_stage?.data?.id ?? null,
      lead_status_id: rels.status?.data?.id ?? null,
    },
  }
}

/** GET /v1/pipeline_stages/{id} or /v1/lead_statuses/{id} → display name. */
export async function fetchPylonStageName(
  kind: 'pipeline_stage' | 'lead_status',
  id: string,
  opts: PylonClientOpts = {},
): Promise<PylonResult<string>> {
  const path = kind === 'pipeline_stage' ? '/v1/pipeline_stages/' : '/v1/lead_statuses/'
  const res = await pylonGet(path + encodeURIComponent(id), {}, opts)
  if (!res.ok) return res
  const flat = unwrapResource((res.data as Record<string, unknown>)?.data ?? res.data)
  const name =
    typeof flat?.name === 'string' ? flat.name : typeof flat?.title === 'string' ? flat.title : null
  if (!name) {
    return { ok: false, code: 'invalid_response', detail: `${kind} payload carried no name.` }
  }
  return { ok: true, data: name }
}

// ── Component prices (supplements build 2026-06-13) ──────────────────

const COMPONENT_TYPE_FILTER: Record<PylonComponentKind, string> = {
  module: 'solar_modules',
  inverter: 'solar_inverters',
  battery: 'solar_batteries',
}

export type PylonComponentPrice = {
  price_excl_tax_cents: number | null
  cost_excl_tax_cents: number | null
}

/**
 * GET /v1/component_prices?filter[component.type]=…&filter[component.id]=…
 * — the tenant's own LATEST price for one component SKU. Both amounts
 * are integer cents ex-tax per Pylon's money convention. Null fields
 * when the tenant has no price recorded for the SKU.
 */
export async function fetchPylonComponentPrice(
  kind: PylonComponentKind,
  sku: string,
  opts: PylonClientOpts = {},
): Promise<PylonResult<PylonComponentPrice>> {
  const res = await pylonGet(
    '/v1/component_prices',
    {
      'filter[component.type]': COMPONENT_TYPE_FILTER[kind],
      'filter[component.id]': sku,
    },
    opts,
  )
  if (!res.ok) return res
  const body = res.data as Record<string, unknown>
  const data = Array.isArray(body?.data) ? body.data : []
  // Prefer the row marked latest; fall back to the first.
  const rows = data
    .map((r) => unwrapResource(r))
    .filter((r): r is Record<string, unknown> => r !== null)
  const latest = rows.find((r) => r.is_latest === true) ?? rows[0] ?? null
  return {
    ok: true,
    data: {
      price_excl_tax_cents: numberOrNull(latest?.price_excl_tax),
      cost_excl_tax_cents: numberOrNull(latest?.cost_excl_tax),
    },
  }
}

// ════════════════════════════════════════════════════════════════════
// Pylon tab — design-import integration (spec 2026-06-12, Pylon tab).
//
// Designs CANNOT be created via the API; they are authored in Pylon
// studio and read back here. The functions below power the import flow:
// list designs → fetch one design (+ its solar_project for customer and
// site details) → fetch component datasheets by SKU → download the
// snapshot / single-line-diagram / site-info assets for caching.
//
// Verified against the live docs 2026-06-12:
//  • fields[solar_designs] is MANDATORY on both list + show (a
//    documented divergence from the JSON:API spec).
//  • All money amounts are integer CENTS; line item amounts are ex-tax.
//  • Customer details live on solar_projects, not the design.
// ════════════════════════════════════════════════════════════════════

/** PURE — the Pylon-tab feature gate. Independent from the STC/lead-push
 *  integration: requires PYLON_PROPOSALS_ENABLED plus a key. */
export function pylonProposalsEnabled(env: {
  PYLON_PROPOSALS_ENABLED?: string
  PYLON_API_KEY?: string
}): boolean {
  const on =
    env.PYLON_PROPOSALS_ENABLED === 'true' || env.PYLON_PROPOSALS_ENABLED === '1'
  return on && typeof env.PYLON_API_KEY === 'string' && env.PYLON_API_KEY.length > 0
}

/** Every design attribute we consume — fields[solar_designs] is mandatory. */
const DESIGN_FIELDS = [
  'title',
  'label',
  'is_primary',
  'summary',
  'locale',
  'module_types',
  'material_types',
  'inverter_types',
  'storage_types',
  'heat_pump_types',
  'ev_charger_types',
  'solar_mounting_system_types',
  'pricing',
  'line_items',
  'proposal_quote',
  'created_at',
  'updated_at',
].join(',')

/** Lighter field set for the design picker list. */
const DESIGN_LIST_FIELDS = ['title', 'label', 'summary', 'pricing', 'created_at', 'updated_at'].join(',')

/** JSON:API resource → flat { id, ...attributes, relationships } object. */
function unwrapResource(res: unknown): Record<string, unknown> | null {
  if (!res || typeof res !== 'object') return null
  const obj = res as Record<string, unknown>
  const attrs = (obj.attributes ?? {}) as Record<string, unknown>
  return {
    id: obj.id,
    ...attrs,
    relationships: obj.relationships ?? null,
  }
}

export type PylonDesignListRow = {
  id: string
  title: string | null
  label: string | null
  dc_output_kw: number | null
  storage_kwh: number | null
  description: string | null
  total_cents: number | null
  currency: string | null
  project_id: string | null
  created_at: string | null
  updated_at: string | null
}

/**
 * GET /v1/solar_designs — the design picker list. Paginated upstream;
 * we fetch the first page (newest designs come back first in practice;
 * the picker is a recency surface, not an archive). Never throws.
 */
export async function listPylonSolarDesigns(
  opts: PylonClientOpts = {},
): Promise<PylonResult<PylonDesignListRow[]>> {
  const res = await pylonGet(
    '/v1/solar_designs',
    { 'fields[solar_designs]': DESIGN_LIST_FIELDS },
    { timeoutMs: 15_000, ...opts },
  )
  if (!res.ok) return res
  const body = res.data as Record<string, unknown>
  const data = Array.isArray(body?.data) ? body.data : null
  if (!data) {
    return { ok: false, code: 'invalid_response', detail: 'solar_designs list carried no data array.' }
  }
  const rows: PylonDesignListRow[] = []
  for (const raw of data) {
    const flat = unwrapResource(raw)
    if (!flat || typeof flat.id !== 'string') continue
    const summary = (flat.summary ?? {}) as Record<string, unknown>
    const pricing = (flat.pricing ?? {}) as Record<string, unknown>
    const rels = (flat.relationships ?? {}) as Record<string, unknown>
    const project = (rels?.project as { data?: { id?: string } } | undefined)?.data?.id ?? null
    rows.push({
      id: flat.id,
      title: typeof flat.title === 'string' ? flat.title : null,
      label: typeof flat.label === 'string' ? flat.label : null,
      dc_output_kw: numberOrNull(summary.dc_output_kw),
      storage_kwh: numberOrNull(summary.storage_kwh),
      description: typeof summary.description === 'string' ? summary.description : null,
      total_cents: numberOrNull(pricing.total),
      currency: typeof pricing.currency === 'string' ? pricing.currency : null,
      project_id: project,
      created_at: typeof flat.created_at === 'string' ? flat.created_at : null,
      updated_at: typeof flat.updated_at === 'string' ? flat.updated_at : null,
    })
  }
  return { ok: true, data: rows }
}

/**
 * GET /v1/solar_designs/{id} — the full design payload (all attributes).
 * Returns the flat-unwrapped object; normalization into the stored
 * snapshot shape happens in lib/pylon/proposal.ts (pure, tested).
 */
export async function fetchPylonSolarDesign(
  designId: string,
  opts: PylonClientOpts = {},
): Promise<PylonResult<Record<string, unknown>>> {
  const res = await pylonGet(
    `/v1/solar_designs/${encodeURIComponent(designId)}`,
    { 'fields[solar_designs]': DESIGN_FIELDS },
    { timeoutMs: 15_000, ...opts },
  )
  if (!res.ok) return res
  const body = res.data as Record<string, unknown>
  const flat = unwrapResource(body?.data ?? body)
  if (!flat || typeof flat.id !== 'string') {
    return { ok: false, code: 'invalid_response', detail: 'solar_design payload had no resource object.' }
  }
  return { ok: true, data: flat }
}

/**
 * GET /v1/solar_projects/{id} — customer details + site address/details
 * for an imported design (the design's `project` relationship).
 */
export async function fetchPylonSolarProject(
  projectId: string,
  opts: PylonClientOpts = {},
): Promise<PylonResult<Record<string, unknown>>> {
  const res = await pylonGet(
    `/v1/solar_projects/${encodeURIComponent(projectId)}`,
    {},
    { timeoutMs: 15_000, ...opts },
  )
  if (!res.ok) return res
  const body = res.data as Record<string, unknown>
  const flat = unwrapResource(body?.data ?? body)
  if (!flat || typeof flat.id !== 'string') {
    return { ok: false, code: 'invalid_response', detail: 'solar_project payload had no resource object.' }
  }
  return { ok: true, data: flat }
}

export type PylonComponentKind = 'module' | 'inverter' | 'battery'

const COMPONENT_PATHS: Record<PylonComponentKind, string> = {
  module: '/v1/solar_modules/',
  inverter: '/v1/solar_inverters/',
  battery: '/v1/solar_batteries/',
}

export type PylonComponentDatasheet = {
  sku: string
  name: string | null
  brand: string | null
  series: string | null
  model_number: string | null
  datasheet_url: string | null
}

/**
 * GET /v1/solar_modules|solar_inverters|solar_batteries/{sku} — the
 * manufacturer-datasheet identity for one component. The API exposes
 * identity (brand/series/model) + a datasheet PDF URL only.
 */
export async function fetchPylonComponent(
  kind: PylonComponentKind,
  sku: string,
  opts: PylonClientOpts = {},
): Promise<PylonResult<PylonComponentDatasheet>> {
  const res = await pylonGet(COMPONENT_PATHS[kind] + encodeURIComponent(sku), {}, opts)
  if (!res.ok) return res
  const body = res.data as Record<string, unknown>
  const flat = unwrapResource(body?.data ?? body)
  if (!flat) {
    return { ok: false, code: 'invalid_response', detail: 'component payload had no resource object.' }
  }
  const identity = (flat.identity ?? {}) as Record<string, unknown>
  const files = (flat.files ?? {}) as Record<string, unknown>
  return {
    ok: true,
    data: {
      sku,
      name: typeof flat.name === 'string' ? flat.name : null,
      brand: typeof identity.brand === 'string' ? identity.brand : null,
      series: typeof identity.series === 'string' ? identity.series : null,
      model_number: typeof identity.model_number === 'string' ? identity.model_number : null,
      datasheet_url: typeof files.datasheet_url === 'string' ? files.datasheet_url : null,
    },
  }
}

/** Asset downloads are size-capped — a snapshot/SLD should be ≤ a few MB. */
const MAX_ASSET_BYTES = 20 * 1024 * 1024

export type PylonAsset = {
  bytes: Uint8Array
  contentType: string | null
}

/**
 * Download one Pylon artefact (snapshot image / SLD PDF / site-info PDF)
 * for caching into Supabase storage. Sends the Bearer header (harmless on
 * the public CDN URLs, required if Pylon ever locks them down). Never throws.
 */
export async function downloadPylonAsset(
  url: string,
  opts: PylonClientOpts = {},
): Promise<PylonResult<PylonAsset>> {
  const apiKey = opts.apiKey ?? process.env.PYLON_API_KEY
  const doFetch = opts.fetchImpl ?? fetch
  let res: Response
  try {
    res = await doFetch(url, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
      redirect: 'follow',
    })
  } catch (e) {
    return { ok: false, code: 'network_error', detail: e instanceof Error ? e.message : String(e) }
  }
  if (!res.ok) {
    return { ok: false, code: 'http_error', detail: `Asset fetch returned ${res.status}.` }
  }
  let buf: ArrayBuffer
  try {
    buf = await res.arrayBuffer()
  } catch (e) {
    return { ok: false, code: 'invalid_response', detail: e instanceof Error ? e.message : String(e) }
  }
  if (buf.byteLength === 0) {
    return { ok: false, code: 'invalid_response', detail: 'Asset body was empty.' }
  }
  if (buf.byteLength > MAX_ASSET_BYTES) {
    return { ok: false, code: 'invalid_response', detail: `Asset exceeds ${MAX_ASSET_BYTES} bytes.` }
  }
  return {
    ok: true,
    data: { bytes: new Uint8Array(buf), contentType: res.headers.get('content-type') },
  }
}

// ── helpers ──────────────────────────────────────────────────────────

function numberOrNull(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Number.parseFloat(v)
    if (Number.isFinite(n)) return n
  }
  return null
}
