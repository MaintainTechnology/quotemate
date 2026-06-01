// ════════════════════════════════════════════════════════════════════
// Roofing — Geoscape Predictive API adapter.
//
// Powers the type-ahead address autocomplete on the dashboard input.
// The customer / tradie starts typing "27 Smit…" → we hit Predictive
// → suggestions come back → they pick one → the picked addressId
// flows straight into the Buildings API (no further Address lookup
// needed).
//
// Auth + base URL match the Addresses + Buildings adapter in
// geoscape.ts — same API key, same Authorization header.
// ════════════════════════════════════════════════════════════════════

import { extractStatePostcode } from '../address-parse'

// Same as geoscape.ts — see that file for the host-verification note.
const DEFAULT_BASE_URL =
  process.env.GEOSCAPE_API_BASE_URL ?? 'https://api.psma.com.au/v1'

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

export type AddressSuggestion = {
  /** Geoscape addressId / PID — feeds straight into Buildings API. */
  id: string
  /** Display text the user sees, e.g. "27 SMITH STREET, PENRITH NSW 2750". */
  address: string
  /** Parsed AU state when Geoscape returns it. Null otherwise. */
  state: string | null
  /** Parsed AU postcode when Geoscape returns it. */
  postcode: string | null
}

export type SuggestResult =
  | { ok: true; suggestions: AddressSuggestion[] }
  | {
      ok: false
      code:
        | 'invalid_input'
        | 'provider_unavailable'
        | 'provider_rate_limited'
        | 'provider_invalid_response'
      detail: string
    }

export type PredictiveProviderOpts = {
  apiKey?: string
  baseUrl?: string
  fetchImpl?: FetchLike
  /** Cap on suggestions returned. Geoscape's default is 10; we lower
   *  it to keep credit usage tight during fast type-ahead. */
  maxSuggestions?: number
}

export class PredictiveProvider {
  readonly name = 'predictive' as const
  private readonly apiKey: string | undefined
  private readonly baseUrl: string
  private readonly fetchImpl: FetchLike
  private readonly maxSuggestions: number

  constructor(opts: PredictiveProviderOpts = {}) {
    this.apiKey = opts.apiKey ?? process.env.GEOSCAPE_API_KEY
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL
    this.fetchImpl =
      opts.fetchImpl ??
      ((input, init) => fetch(input, init))
    this.maxSuggestions = opts.maxSuggestions ?? 5
  }

  /** Suggest AU addresses starting with `query`. Returns up to N
   *  results. Best-effort surface — any provider failure returns
   *  { ok: false, code }; never throws on operational failure. */
  async suggest(query: string, state?: string): Promise<SuggestResult> {
    const q = query.trim()
    if (q.length < 3) {
      return { ok: false, code: 'invalid_input', detail: 'Query must be at least 3 characters.' }
    }
    if (!this.apiKey) {
      return {
        ok: false,
        code: 'provider_unavailable',
        detail: 'GEOSCAPE_API_KEY is not set.',
      }
    }
    // Confirmed by probe 2026-05-29: the Predictive API expects the
    // partial-text input in `query` (the backend rejected `addressString`
    // with HTTP 400 "[query] is required"). This is DIFFERENT to the
    // Addresses API, which uses `addressString`. The two APIs share
    // auth but not parameter names — likely because Predictive is the
    // type-ahead surface (partial text) and Addresses is the canonical
    // database lookup (full address).
    const stateParam = state ? `&state=${encodeURIComponent(state)}` : ''
    const url =
      `${this.baseUrl}/predictive/address?query=${encodeURIComponent(q)}` +
      `&perPage=${this.maxSuggestions}${stateParam}`
    let res: Response
    try {
      res = await this.fetchImpl(url, {
        method: 'GET',
        headers: { Authorization: this.apiKey!, Accept: 'application/json' },
      })
    } catch (e) {
      return {
        ok: false,
        code: 'provider_unavailable',
        detail: e instanceof Error ? e.message : String(e),
      }
    }
    if (res.status === 429) {
      return { ok: false, code: 'provider_rate_limited', detail: 'Predictive API 429.' }
    }
    if (!res.ok) {
      return {
        ok: false,
        code: 'provider_unavailable',
        detail: `Predictive API HTTP ${res.status}.`,
      }
    }
    let body: unknown
    try {
      body = await res.json()
    } catch {
      return { ok: false, code: 'provider_invalid_response', detail: 'Predictive API returned non-JSON.' }
    }
    return { ok: true, suggestions: parseSuggestions(body) }
  }
}

/**
 * PURE — turn a Predictive API response body into AddressSuggestions.
 * The Predictive API has been documented over multiple major versions
 * (PSMA v1 → Geoscape v1) with subtly different field names; this
 * function tolerates the common ones.
 */
export function parseSuggestions(body: unknown): AddressSuggestion[] {
  if (!body || typeof body !== 'object') return []
  const b = body as Record<string, unknown>
  const list: unknown[] =
    (Array.isArray(b.suggest) && (b.suggest as unknown[])) ||
    (Array.isArray(b.suggestions) && (b.suggestions as unknown[])) ||
    (Array.isArray(b.data) && (b.data as unknown[])) ||
    (Array.isArray(b.results) && (b.results as unknown[])) ||
    []
  const out: AddressSuggestion[] = []
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const id =
      pickString(r, ['id', 'addressId', 'pid', 'address_id']) ?? null
    const address =
      pickString(r, ['address', 'formattedAddress', 'formatted_address', 'displayName', 'display_name', 'text']) ?? null
    if (!id || !address) continue
    // Prefer structured fields when Geoscape supplies them. The
    // Predictive type-ahead usually does NOT — it returns only the
    // display string (e.g. "670 LONDON RD, CHANDLER QLD 4155") — so we
    // derive state + postcode back out of it. Without this the form
    // could not auto-fill those inputs and they sat at the defaults
    // (the QLD-address-but-NSW/2750 mismatch).
    const structuredState = pickString(r, ['state', 'stateAbbrev', 'state_abbrev', 'stateName'])
    const structuredPostcode = pickString(r, ['postcode', 'postCode', 'postal_code'])
    const derived =
      structuredState && structuredPostcode
        ? { state: null, postcode: null }
        : extractStatePostcode(address)
    out.push({
      id,
      address,
      state: structuredState ?? derived.state,
      postcode: structuredPostcode ?? derived.postcode,
    })
  }
  return out
}

function pickString(b: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = b[k]
    if (typeof v === 'string' && v.trim() !== '') return v
  }
  return null
}
