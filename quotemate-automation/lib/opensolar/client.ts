// ════════════════════════════════════════════════════════════════════
// OpenSolar — API client for the Solar OpenSolar tab (spec 2026-06-12).
//
// SERVER-ONLY. api.opensolar.com is org-scoped REST with a Bearer token.
// Unlike Pylon there is no static API key: tokens come from a machine-
// user login flow (docs: "Getting Bearer Tokens"). Two env shapes are
// supported — a pre-provisioned long-lived token (OPENSOLAR_API_TOKEN)
// or machine-user credentials (OPENSOLAR_USERNAME / OPENSOLAR_PASSWORD)
// exchanged at runtime and cached in-memory.
//
// Plan gating (docs: "API Access Plans", effective 2026-03-17): the
// `design` field on Projects and the /api/user_logins/ proposal-data
// endpoint require the Raw Data API Access plan. Plan-gated 402/403
// responses surface as { ok: false, code: 'plan' } so callers treat the
// reduced mode as data, never as an exception (degradation matrix §4.8).
//
// Every function returns a result object and NEVER throws — OpenSolar
// unreachable means the other solar paths are bit-identical to today.
// ════════════════════════════════════════════════════════════════════

import { gunzipSync } from 'node:zlib'

const OPENSOLAR_BASE_URL = 'https://api.opensolar.com'
const TIMEOUT_MS = 5_000
const LIST_TIMEOUT_MS = 15_000
/** generate_document renders server-side at OpenSolar — give it headroom. */
const DOCUMENT_TIMEOUT_MS = 30_000

/** Compressed design payloads and binary assets are size-capped. */
const MAX_ASSET_BYTES = 20 * 1024 * 1024
const MAX_DESIGN_JSON_BYTES = 20 * 1024 * 1024

// ── gates (PURE — callers pass process.env values) ───────────────────

export type OpenSolarEnv = {
  OPENSOLAR_ENABLED?: string
  OPENSOLAR_PROPOSALS_ENABLED?: string
  OPENSOLAR_ORG_ID?: string
  OPENSOLAR_API_TOKEN?: string
  OPENSOLAR_USERNAME?: string
  OPENSOLAR_PASSWORD?: string
  OPENSOLAR_LEAD_PUSH_TENANTS?: string
  /** Index signature so routes can pass process.env directly. */
  [key: string]: string | undefined
}

function hasCredentials(env: OpenSolarEnv): boolean {
  const token = typeof env.OPENSOLAR_API_TOKEN === 'string' && env.OPENSOLAR_API_TOKEN.length > 0
  const login =
    typeof env.OPENSOLAR_USERNAME === 'string' &&
    env.OPENSOLAR_USERNAME.length > 0 &&
    typeof env.OPENSOLAR_PASSWORD === 'string' &&
    env.OPENSOLAR_PASSWORD.length > 0
  return token || login
}

/** PURE — client-level enablement: flag + org id + some credential. */
export function openSolarEnabled(env: OpenSolarEnv): boolean {
  const on = env.OPENSOLAR_ENABLED === 'true' || env.OPENSOLAR_ENABLED === '1'
  const org = typeof env.OPENSOLAR_ORG_ID === 'string' && env.OPENSOLAR_ORG_ID.length > 0
  return on && org && hasCredentials(env)
}

/** PURE — the OpenSolar-tab feature gate (default off). Independent from
 *  SOLAR_PREMIUM_QUOTE and PYLON_PROPOSALS_ENABLED. */
export function openSolarProposalsEnabled(env: OpenSolarEnv): boolean {
  const on =
    env.OPENSOLAR_PROPOSALS_ENABLED === 'true' || env.OPENSOLAR_PROPOSALS_ENABLED === '1'
  const org = typeof env.OPENSOLAR_ORG_ID === 'string' && env.OPENSOLAR_ORG_ID.length > 0
  return on && org && hasCredentials(env)
}

/**
 * PURE — per-tenant allowlist for the write-path features (lead push,
 * usage push, workflow stage sync). Comma-separated tenant ids or '*'.
 * Mirrors pylonLeadPushEnabled.
 */
export function openSolarLeadPushEnabled(env: OpenSolarEnv, tenantId: string | null): boolean {
  if (!openSolarProposalsEnabled(env)) return false
  if (!tenantId) return false
  const list = (env.OPENSOLAR_LEAD_PUSH_TENANTS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return list.includes('*') || list.includes(tenantId)
}

// ── result + opts ─────────────────────────────────────────────────────

export type OpenSolarResult<T> =
  | { ok: true; data: T }
  | {
      ok: false
      code: 'disabled' | 'http_error' | 'network_error' | 'invalid_response' | 'plan' | 'throttled'
      detail: string
    }

export type OpenSolarClientOpts = {
  orgId?: string
  apiToken?: string
  username?: string
  password?: string
  baseUrl?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
  /** 429 backoff delay — injectable so tests run instantly. */
  retryDelayMs?: number
}

function resolveOrgId(opts: OpenSolarClientOpts): string | null {
  const org = opts.orgId ?? process.env.OPENSOLAR_ORG_ID
  return typeof org === 'string' && org.length > 0 ? org : null
}

// ── token acquisition (machine user) ──────────────────────────────────

type TokenCache = { token: string; viaLogin: boolean } | null
let tokenCache: TokenCache = null
let tokenInflight: Promise<OpenSolarResult<string>> | null = null

/** Test hook — clears the in-memory machine-user token. */
export function resetOpenSolarTokenCache(): void {
  tokenCache = null
  tokenInflight = null
}

/**
 * Resolve a bearer token. Precedence: explicit opts token → env token →
 * cached login token → machine-user login (single-flight). The login
 * endpoint shape is per the docs' "Option A: Email and password";
 * Phase 0 re-verifies it against the live org before launch.
 */
async function getOpenSolarToken(opts: OpenSolarClientOpts): Promise<OpenSolarResult<string>> {
  const direct = opts.apiToken ?? process.env.OPENSOLAR_API_TOKEN
  if (direct) return { ok: true, data: direct }

  if (tokenCache) return { ok: true, data: tokenCache.token }
  if (tokenInflight) return tokenInflight

  const username = opts.username ?? process.env.OPENSOLAR_USERNAME
  const password = opts.password ?? process.env.OPENSOLAR_PASSWORD
  if (!username || !password) {
    return { ok: false, code: 'disabled', detail: 'No OpenSolar credentials configured.' }
  }

  tokenInflight = (async (): Promise<OpenSolarResult<string>> => {
    const base = (opts.baseUrl ?? OPENSOLAR_BASE_URL).replace(/\/$/, '')
    const doFetch = opts.fetchImpl ?? fetch
    let res: Response
    try {
      res = await doFetch(`${base}/api-token-auth/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? LIST_TIMEOUT_MS),
      })
    } catch (e) {
      return { ok: false, code: 'network_error', detail: e instanceof Error ? e.message : String(e) }
    }
    if (!res.ok) {
      return { ok: false, code: 'http_error', detail: `OpenSolar login returned ${res.status}.` }
    }
    let body: Record<string, unknown>
    try {
      body = (await res.json()) as Record<string, unknown>
    } catch (e) {
      return { ok: false, code: 'invalid_response', detail: e instanceof Error ? e.message : String(e) }
    }
    const token = typeof body.token === 'string' ? body.token : null
    if (!token) {
      return { ok: false, code: 'invalid_response', detail: 'OpenSolar login carried no token field.' }
    }
    tokenCache = { token, viaLogin: true }
    return { ok: true, data: token }
  })()

  const result = await tokenInflight
  tokenInflight = null
  return result
}

// ── core request wrapper (throttle-aware, plan-aware) ────────────────

async function osRequest(
  pathWithQuery: string,
  init: RequestInit,
  opts: OpenSolarClientOpts,
  attempt = 0,
): Promise<OpenSolarResult<unknown>> {
  const tokenRes = await getOpenSolarToken(opts)
  if (!tokenRes.ok) return tokenRes
  const base = (opts.baseUrl ?? OPENSOLAR_BASE_URL).replace(/\/$/, '')
  const doFetch = opts.fetchImpl ?? fetch

  let res: Response
  try {
    res = await doFetch(base + pathWithQuery, {
      ...init,
      headers: {
        Authorization: `Bearer ${tokenRes.data}`,
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(opts.timeoutMs ?? TIMEOUT_MS),
    })
  } catch (e) {
    return { ok: false, code: 'network_error', detail: e instanceof Error ? e.message : String(e) }
  }

  // Expired login-flow token: clear the cache and retry once.
  if (res.status === 401 && tokenCache?.viaLogin && attempt === 0) {
    tokenCache = null
    return osRequest(pathWithQuery, init, opts, attempt + 1)
  }

  // Plan-gated endpoint (API Access vs Raw Data API Access) — data, not error.
  if (res.status === 402 || res.status === 403) {
    return {
      ok: false,
      code: 'plan',
      detail: `OpenSolar returned ${res.status} — endpoint requires a higher API access plan or permissions.`,
    }
  }

  // Documented throttle limits: one backoff retry, then a clean failure.
  if (res.status === 429) {
    if (attempt === 0) {
      await new Promise((r) => setTimeout(r, opts.retryDelayMs ?? 1_000))
      return osRequest(pathWithQuery, init, opts, attempt + 1)
    }
    return { ok: false, code: 'throttled', detail: 'OpenSolar throttled the request (429).' }
  }

  if (!res.ok) {
    let body = ''
    try {
      body = (await res.text()).slice(0, 300)
    } catch {
      /* ignore */
    }
    return { ok: false, code: 'http_error', detail: `OpenSolar returned ${res.status}: ${body}` }
  }

  try {
    return { ok: true, data: await res.json() }
  } catch (e) {
    return { ok: false, code: 'invalid_response', detail: e instanceof Error ? e.message : String(e) }
  }
}

// ── design decompression (PURE) ───────────────────────────────────────

/**
 * PURE — the Projects `design` field is the full design as a base64-
 * encoded gzip-compressed JSON string (Raw Data API Access plan only).
 * Tolerates null/absent input (API Access plan) by returning null.
 */
export function decompressOpenSolarDesign(
  design: unknown,
):
  | { ok: true; data: Record<string, unknown> | null }
  | { ok: false; detail: string } {
  if (design == null || design === '') return { ok: true, data: null }
  if (typeof design !== 'string') {
    return { ok: false, detail: 'design field was not a string.' }
  }
  let raw: Buffer
  try {
    raw = Buffer.from(design, 'base64')
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) }
  }
  if (raw.byteLength === 0) return { ok: false, detail: 'design field decoded to zero bytes.' }
  let json: Buffer
  try {
    json = gunzipSync(raw, { maxOutputLength: MAX_DESIGN_JSON_BYTES })
  } catch (e) {
    return { ok: false, detail: `gunzip failed: ${e instanceof Error ? e.message : String(e)}` }
  }
  try {
    const parsed = JSON.parse(json.toString('utf8')) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, detail: 'design JSON was not an object.' }
    }
    return { ok: true, data: parsed as Record<string, unknown> }
  } catch (e) {
    return { ok: false, detail: `JSON parse failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ── projects ──────────────────────────────────────────────────────────

export type OpenSolarProjectListRow = {
  id: string
  address: string | null
  locality: string | null
  state: string | null
  zip: string | null
  stage: number | null
  identifier: string | null
  created_at: string | null
  modified_at: string | null
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Number.parseFloat(v)
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

/** GET /api/orgs/:org/projects/?fieldset=list — the project picker. */
export async function listOpenSolarProjects(
  opts: OpenSolarClientOpts = {},
): Promise<OpenSolarResult<OpenSolarProjectListRow[]>> {
  const orgId = resolveOrgId(opts)
  if (!orgId) return { ok: false, code: 'disabled', detail: 'OPENSOLAR_ORG_ID is not set.' }
  const res = await osRequest(
    `/api/orgs/${encodeURIComponent(orgId)}/projects/?fieldset=list&limit=50&ordering=-modified_date`,
    { method: 'GET' },
    { timeoutMs: LIST_TIMEOUT_MS, ...opts },
  )
  if (!res.ok) return res
  const body = res.data
  const list = Array.isArray(body) ? body : Array.isArray(obj(body).results) ? (obj(body).results as unknown[]) : null
  if (!list) {
    return { ok: false, code: 'invalid_response', detail: 'projects list carried no array.' }
  }
  const rows: OpenSolarProjectListRow[] = []
  for (const raw of list) {
    const p = obj(raw)
    const id = p.id != null ? String(p.id) : null
    if (!id) continue
    rows.push({
      id,
      address: str(p.address),
      locality: str(p.locality),
      state: str(p.state),
      zip: str(p.zip),
      stage: num(p.stage),
      identifier: str(p.identifier),
      created_at: str(p.created_date),
      modified_at: str(p.modified_date),
    })
  }
  return { ok: true, data: rows }
}

/** GET /api/orgs/:org/projects/:id/ — full project payload (incl. the
 *  compressed `design` field on the Raw Data plan). */
export async function fetchOpenSolarProject(
  projectId: string,
  opts: OpenSolarClientOpts = {},
): Promise<OpenSolarResult<Record<string, unknown>>> {
  const orgId = resolveOrgId(opts)
  if (!orgId) return { ok: false, code: 'disabled', detail: 'OPENSOLAR_ORG_ID is not set.' }
  const res = await osRequest(
    `/api/orgs/${encodeURIComponent(orgId)}/projects/${encodeURIComponent(projectId)}/`,
    { method: 'GET' },
    { timeoutMs: LIST_TIMEOUT_MS, ...opts },
  )
  if (!res.ok) return res
  const flat = obj(res.data)
  if (flat.id == null) {
    return { ok: false, code: 'invalid_response', detail: 'project payload had no id.' }
  }
  return { ok: true, data: flat }
}

/** GET …/projects/:id/systems/details/ — hardware, adders, incentives and
 *  module groups (available on BOTH plans, minus custom_data). */
export async function fetchOpenSolarSystemDetails(
  projectId: string,
  opts: OpenSolarClientOpts = {},
): Promise<OpenSolarResult<Record<string, unknown>>> {
  const orgId = resolveOrgId(opts)
  if (!orgId) return { ok: false, code: 'disabled', detail: 'OPENSOLAR_ORG_ID is not set.' }
  const res = await osRequest(
    `/api/orgs/${encodeURIComponent(orgId)}/projects/${encodeURIComponent(projectId)}/systems/details/`,
    { method: 'GET' },
    { timeoutMs: LIST_TIMEOUT_MS, ...opts },
  )
  if (!res.ok) return res
  return { ok: true, data: obj(res.data) }
}

/** GET /api/user_logins/?project_ids=… — the whole proposal payload
 *  (Raw Data API Access plan only; 'plan' result on lower tiers). */
export async function fetchOpenSolarProposalData(
  projectId: string,
  opts: OpenSolarClientOpts = {},
): Promise<OpenSolarResult<unknown>> {
  return osRequest(
    `/api/user_logins/?project_ids=${encodeURIComponent(projectId)}`,
    { method: 'GET' },
    { timeoutMs: LIST_TIMEOUT_MS, ...opts },
  )
}

// ── binary fetches (system image, generated documents) ───────────────

export type OpenSolarAsset = {
  bytes: Uint8Array
  contentType: string | null
}

async function fetchOpenSolarBinary(
  url: string,
  opts: OpenSolarClientOpts,
): Promise<OpenSolarResult<OpenSolarAsset>> {
  const tokenRes = await getOpenSolarToken(opts)
  if (!tokenRes.ok) return tokenRes
  const doFetch = opts.fetchImpl ?? fetch
  let res: Response
  try {
    // The system-image endpoint responds with redirects until the render
    // is ready — follow them (docs: System Image).
    res = await doFetch(url, {
      headers: { Authorization: `Bearer ${tokenRes.data}` },
      signal: AbortSignal.timeout(opts.timeoutMs ?? DOCUMENT_TIMEOUT_MS),
      redirect: 'follow',
    })
  } catch (e) {
    return { ok: false, code: 'network_error', detail: e instanceof Error ? e.message : String(e) }
  }
  if (res.status === 402 || res.status === 403) {
    return { ok: false, code: 'plan', detail: `OpenSolar returned ${res.status} for a binary fetch.` }
  }
  if (!res.ok) {
    return { ok: false, code: 'http_error', detail: `Binary fetch returned ${res.status}.` }
  }
  let buf: ArrayBuffer
  try {
    buf = await res.arrayBuffer()
  } catch (e) {
    return { ok: false, code: 'invalid_response', detail: e instanceof Error ? e.message : String(e) }
  }
  if (buf.byteLength === 0) {
    return { ok: false, code: 'invalid_response', detail: 'Binary body was empty.' }
  }
  if (buf.byteLength > MAX_ASSET_BYTES) {
    return { ok: false, code: 'invalid_response', detail: `Binary exceeds ${MAX_ASSET_BYTES} bytes.` }
  }
  return {
    ok: true,
    data: { bytes: new Uint8Array(buf), contentType: res.headers.get('content-type') },
  }
}

/** GET …/systems/:uuid/image/?width&height — the authoritative layout
 *  render, regenerated by OpenSolar whenever the design changes. */
export async function fetchOpenSolarSystemImage(
  projectId: string,
  systemUuid: string,
  size: { width: number; height: number },
  opts: OpenSolarClientOpts = {},
): Promise<OpenSolarResult<OpenSolarAsset>> {
  const orgId = resolveOrgId(opts)
  if (!orgId) return { ok: false, code: 'disabled', detail: 'OPENSOLAR_ORG_ID is not set.' }
  const base = (opts.baseUrl ?? OPENSOLAR_BASE_URL).replace(/\/$/, '')
  const url =
    `${base}/api/orgs/${encodeURIComponent(orgId)}/projects/${encodeURIComponent(projectId)}` +
    `/systems/${encodeURIComponent(systemUuid)}/image/?width=${size.width}&height=${size.height}`
  return fetchOpenSolarBinary(url, opts)
}

/** Authenticated download of any OpenSolar-hosted artefact (private file
 *  contents, proposal-data system images, …) for caching into storage. */
export async function downloadOpenSolarAsset(
  url: string,
  opts: OpenSolarClientOpts = {},
): Promise<OpenSolarResult<OpenSolarAsset>> {
  return fetchOpenSolarBinary(url, opts)
}

// ── document generation (quote appendices + install pack) ────────────

/** The only document types QuoteMate ever requests — a whitelist so a
 *  bad caller can never trigger arbitrary OpenSolar document renders. */
export const OPENSOLAR_DOCUMENT_TYPES = [
  'shade_report',
  'energy_yield_report',
  'pv_site_plan',
  'global_bom',
  'owners_manual',
  'financials_report',
  'system_performance_8760',
] as const
export type OpenSolarDocumentType = (typeof OPENSOLAR_DOCUMENT_TYPES)[number]

export function isOpenSolarDocumentType(v: unknown): v is OpenSolarDocumentType {
  return typeof v === 'string' && (OPENSOLAR_DOCUMENT_TYPES as readonly string[]).includes(v)
}

/**
 * POST …/generate_document/{type}/ — generate one engineering document.
 * The response shape varies by type/flow (URL, file content reference, or
 * private-file ref when action=save); callers extract what they need via
 * extractOpenSolarDocumentUrl and download with downloadOpenSolarAsset.
 */
export async function generateOpenSolarDocument(
  projectId: string,
  type: OpenSolarDocumentType,
  params: { systemUuid?: string | null; paymentOptionId?: string | null } = {},
  opts: OpenSolarClientOpts = {},
): Promise<OpenSolarResult<unknown>> {
  const orgId = resolveOrgId(opts)
  if (!orgId) return { ok: false, code: 'disabled', detail: 'OPENSOLAR_ORG_ID is not set.' }
  const qs = new URLSearchParams()
  if (params.systemUuid) qs.set('system_uuid', params.systemUuid)
  if (params.paymentOptionId) qs.set('payment_option_id', params.paymentOptionId)
  const query = qs.toString()
  return osRequest(
    `/api/orgs/${encodeURIComponent(orgId)}/projects/${encodeURIComponent(projectId)}` +
      `/generate_document/${type}/${query ? `?${query}` : ''}`,
    { method: 'POST' },
    { timeoutMs: DOCUMENT_TIMEOUT_MS, ...opts },
  )
}

/** PURE — pull a downloadable URL out of a generate_document response,
 *  tolerating the documented shape variations (url / file_contents /
 *  nested private-file refs). Null when none is present. */
export function extractOpenSolarDocumentUrl(payload: unknown): string | null {
  if (typeof payload === 'string' && /^https?:\/\//.test(payload)) return payload
  const o = obj(payload)
  for (const key of ['url', 'file_contents', 'file_url', 'download_url', 'pdf_url']) {
    const v = o[key]
    if (typeof v === 'string' && /^https?:\/\//.test(v)) return v
  }
  const nested = obj(o.private_file)
  for (const key of ['file_contents', 'url']) {
    const v = nested[key]
    if (typeof v === 'string' && /^https?:\/\//.test(v)) return v
  }
  return null
}

// ── org catalogue: component activations + pricing schemes ───────────
// (Instant-estimate enrichment build — supplements the Google Solar
// engine with the tradie's real products and commercial pricing config.)

export type OpenSolarCatalogueKind = 'module' | 'inverter' | 'battery'

export type OpenSolarCatalogueRow = {
  kind: OpenSolarCatalogueKind
  manufacturer: string | null
  code: string | null
  /** STC-rated capacity, kW (modules; from the activation's data blob). */
  kw_stc: number | null
  product_warranty_years: number | null
  technology: string | null
  is_default: boolean
}

/**
 * GET /api/orgs/:org/component_{kind}_activations/ — the products the
 * tradie has activated in their OpenSolar org. The per-row `data` field
 * is a JSON-encoded STRING (per the docs example) carrying the component
 * specs (kw_stc, warranty, technology) — parsed defensively.
 */
export async function fetchOpenSolarComponentActivations(
  kind: OpenSolarCatalogueKind,
  opts: OpenSolarClientOpts = {},
): Promise<OpenSolarResult<OpenSolarCatalogueRow[]>> {
  const orgId = resolveOrgId(opts)
  if (!orgId) return { ok: false, code: 'disabled', detail: 'OPENSOLAR_ORG_ID is not set.' }
  const res = await osRequest(
    `/api/orgs/${encodeURIComponent(orgId)}/component_${kind}_activations/?limit=100`,
    { method: 'GET' },
    { timeoutMs: LIST_TIMEOUT_MS, ...opts },
  )
  if (!res.ok) return res
  const body = res.data
  const list = Array.isArray(body)
    ? body
    : Array.isArray(obj(body).results)
      ? (obj(body).results as unknown[])
      : null
  if (!list) {
    return { ok: false, code: 'invalid_response', detail: 'activation list carried no array.' }
  }
  const rows: OpenSolarCatalogueRow[] = []
  for (const raw of list) {
    const a = obj(raw)
    if (a.is_archived === true) continue
    let specs: Record<string, unknown> = {}
    if (typeof a.data === 'string' && a.data.length > 0) {
      try {
        specs = obj(JSON.parse(a.data))
      } catch {
        /* tolerate malformed spec blobs */
      }
    } else {
      specs = obj(a.data)
    }
    const manufacturer = str(a.manufacturer_name) ?? str(specs.manufacturer_name)
    const code = str(a.code) ?? str(specs.code)
    if (!manufacturer && !code) continue
    rows.push({
      kind,
      manufacturer,
      code,
      kw_stc: num(specs.kw_stc),
      product_warranty_years: num(a.product_warranty) ?? num(specs.product_warranty),
      technology: str(specs.technology),
      is_default: a.is_default === true,
    })
  }
  return { ok: true, data: rows }
}

export type OpenSolarPricingScheme = {
  id: string
  title: string | null
  /** 'Markup Percentage' | 'Price Per Watt' | 'Price Per Watt By Size' |
   *  'Fixed Price' | 'Price Per Module/Inverter/Battery' | … */
  pricing_formula: string | null
  /** Parsed configuration_json; {} when absent/malformed. */
  configuration: Record<string, unknown>
  priority: number | null
  auto_apply_enabled: boolean
  auto_apply_only_specified_states: string[] | null
  auto_apply_only_specified_zips: string[] | null
}

/** GET /api/orgs/:org/pricing_schemes/ — the tradie's commercial pricing
 *  config (used as a cross-check guardrail, never as the price source). */
export async function fetchOpenSolarPricingSchemes(
  opts: OpenSolarClientOpts = {},
): Promise<OpenSolarResult<OpenSolarPricingScheme[]>> {
  const orgId = resolveOrgId(opts)
  if (!orgId) return { ok: false, code: 'disabled', detail: 'OPENSOLAR_ORG_ID is not set.' }
  const res = await osRequest(
    `/api/orgs/${encodeURIComponent(orgId)}/pricing_schemes/?limit=50`,
    { method: 'GET' },
    { timeoutMs: LIST_TIMEOUT_MS, ...opts },
  )
  if (!res.ok) return res
  const body = res.data
  const list = Array.isArray(body)
    ? body
    : Array.isArray(obj(body).results)
      ? (obj(body).results as unknown[])
      : null
  if (!list) {
    return { ok: false, code: 'invalid_response', detail: 'pricing scheme list carried no array.' }
  }
  const toStringArray = (v: unknown): string[] | null => {
    if (Array.isArray(v)) return v.map((s) => String(s))
    if (typeof v === 'string' && v.trim().length > 0) {
      return v.split(',').map((s) => s.trim()).filter(Boolean)
    }
    return null
  }
  const rows: OpenSolarPricingScheme[] = []
  for (const raw of list) {
    const s = obj(raw)
    if (s.is_archived === true) continue
    if (s.id == null) continue
    let configuration: Record<string, unknown> = {}
    if (typeof s.configuration_json === 'string' && s.configuration_json.length > 0) {
      try {
        configuration = obj(JSON.parse(s.configuration_json))
      } catch {
        /* tolerate malformed config */
      }
    }
    rows.push({
      id: String(s.id),
      title: str(s.title),
      pricing_formula: str(s.pricing_formula),
      configuration,
      priority: num(s.priority),
      auto_apply_enabled: s.auto_apply_enabled === true,
      auto_apply_only_specified_states: toStringArray(s.auto_apply_only_specified_states),
      auto_apply_only_specified_zips: toStringArray(s.auto_apply_only_specified_zips),
    })
  }
  return { ok: true, data: rows }
}

// ── write path: lead push, usage push, stage sync ─────────────────────

/** POST /api/orgs/:org/contacts/ — create the customer contact. */
export async function createOpenSolarContact(
  contact: { first_name?: string | null; family_name?: string | null; email?: string | null; phone?: string | null },
  opts: OpenSolarClientOpts = {},
): Promise<OpenSolarResult<Record<string, unknown>>> {
  const orgId = resolveOrgId(opts)
  if (!orgId) return { ok: false, code: 'disabled', detail: 'OPENSOLAR_ORG_ID is not set.' }
  const res = await osRequest(
    `/api/orgs/${encodeURIComponent(orgId)}/contacts/`,
    {
      method: 'POST',
      body: JSON.stringify({
        first_name: contact.first_name ?? undefined,
        family_name: contact.family_name ?? undefined,
        email: contact.email ?? undefined,
        phone: contact.phone ?? undefined,
      }),
    },
    { timeoutMs: LIST_TIMEOUT_MS, ...opts },
  )
  if (!res.ok) return res
  return { ok: true, data: obj(res.data) }
}

/** POST /api/orgs/:org/projects/ — the lead push (the two-way feature the
 *  Pylon tab can't do): pre-load the site + customer for studio design. */
export async function createOpenSolarProject(
  body: Record<string, unknown>,
  opts: OpenSolarClientOpts = {},
): Promise<OpenSolarResult<Record<string, unknown>>> {
  const orgId = resolveOrgId(opts)
  if (!orgId) return { ok: false, code: 'disabled', detail: 'OPENSOLAR_ORG_ID is not set.' }
  const res = await osRequest(
    `/api/orgs/${encodeURIComponent(orgId)}/projects/`,
    { method: 'POST', body: JSON.stringify(body) },
    { timeoutMs: LIST_TIMEOUT_MS, ...opts },
  )
  if (!res.ok) return res
  return { ok: true, data: obj(res.data) }
}

/** Supported usage_data_source values (docs: Updating a Project's Energy
 *  Consumption). QuoteMate primarily pushes bill_quarterly. */
export type OpenSolarUsagePayload = {
  usage_data_source:
    | 'kwh_annual'
    | 'kwh_monthly'
    | 'kwh_every_second_month'
    | 'kwh_quarterly'
    | 'kwh_daily_per_month'
    | 'bill_annual'
    | 'bill_monthly'
    | 'bill_every_second_month'
    | 'bill_quarterly'
    | 'estimate'
  values: number | number[] | string
}

/** PATCH …/projects/:id/ with { usage } — personalises OpenSolar's own
 *  bills/offset/financials from the customer's real consumption. */
export async function updateOpenSolarProjectUsage(
  projectId: string,
  usage: OpenSolarUsagePayload,
  opts: OpenSolarClientOpts = {},
): Promise<OpenSolarResult<unknown>> {
  const orgId = resolveOrgId(opts)
  if (!orgId) return { ok: false, code: 'disabled', detail: 'OPENSOLAR_ORG_ID is not set.' }
  return osRequest(
    `/api/orgs/${encodeURIComponent(orgId)}/projects/${encodeURIComponent(projectId)}/`,
    { method: 'PATCH', body: JSON.stringify({ usage }) },
    { timeoutMs: LIST_TIMEOUT_MS, ...opts },
  )
}

/** PATCH …/projects/:id/ with workflow.active_stage_id — pipeline sync
 *  (Presale → Sold → Installed). Best-effort; never blocks the money path. */
export async function updateOpenSolarProjectStage(
  projectId: string,
  activeStageId: number,
  opts: OpenSolarClientOpts = {},
): Promise<OpenSolarResult<unknown>> {
  const orgId = resolveOrgId(opts)
  if (!orgId) return { ok: false, code: 'disabled', detail: 'OPENSOLAR_ORG_ID is not set.' }
  return osRequest(
    `/api/orgs/${encodeURIComponent(orgId)}/projects/${encodeURIComponent(projectId)}/`,
    { method: 'PATCH', body: JSON.stringify({ workflow: { active_stage_id: activeStageId } }) },
    { timeoutMs: LIST_TIMEOUT_MS, ...opts },
  )
}
