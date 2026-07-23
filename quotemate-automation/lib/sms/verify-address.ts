// ════════════════════════════════════════════════════════════════════
// SMS receptionists — map-check a customer-typed property address.
//
// Live 2026-07-23: a customer typed "15 Schofield drive safety each"
// ("each" for "beach"), the roofing receptionist read it straight back,
// the customer replied yes, and a non-existent address was confirmed.
// The read-back is only a typo check against the customer's OWN typing —
// it can never catch a suburb that doesn't exist.
//
// This module verifies the address against the Google Address Validation
// API (regionCode AU) BEFORE the read-back goes out:
//   • found, as typed      → read back Google's formatted address.
//   • found, but corrected → read back the corrected address as a
//     suggestion ("The closest match I can find is …").
//   • not found            → don't accept it; ask the customer to
//     re-check and re-send (bounded — see MAX_ADDRESS_VERIFY_REJECTS).
//   • API missing/down     → keep today's behaviour (plain read-back).
//     Verification is a net, not a gate; it must never block a lead.
//
// Used by BOTH the roofing and painting receptionists (the route calls
// screenConfirmAddress on every confirm_address ask). The general
// electrical/plumbing dialog is LLM-driven and confirms addresses
// conversationally — it is not screened here.
//
// I/O lives behind an injectable fetch; everything else is pure.
// ════════════════════════════════════════════════════════════════════

import { parseAddressValidationResponse } from '@/lib/solar/address-validation'

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export type AuStateAbbr = 'NSW' | 'VIC' | 'QLD' | 'SA' | 'WA' | 'TAS' | 'ACT' | 'NT'

export type AddressVerification =
  | {
      outcome: 'match'
      /** Google's formatted address, without the trailing ", Australia". */
      formatted: string
      postcode: string | null
      state: AuStateAbbr | null
      /** The formatted address materially differs from what the customer
       *  typed (a token of theirs didn't survive) — phrase the read-back
       *  as a suggestion, not a parrot. */
      corrected: boolean
    }
  | { outcome: 'not_found' }
  | { outcome: 'unavailable' }

export type VerifyAddressOpts = {
  apiKey?: string
  fetchImpl?: FetchLike
  baseUrl?: string
}

const DEFAULT_BASE_URL =
  process.env.GOOGLE_ADDRESS_VALIDATION_API_URL ??
  'https://addressvalidation.googleapis.com/v1:validateAddress'

/** How many "can't find it" re-asks an address gets before we fall back
 *  to the plain read-back. New estates and very fresh subdivisions are
 *  real and not always on the map — the customer must always be able to
 *  push through by confirming, and a bad address still dead-ends safely
 *  at the measure step's inspection fallback. */
export const MAX_ADDRESS_VERIFY_REJECTS = 2

/** Verify a raw customer-typed AU address against Google Address
 *  Validation. Never throws; any failure is 'unavailable'. */
export async function verifyAuAddress(
  raw: string,
  opts: VerifyAddressOpts = {},
): Promise<AddressVerification> {
  const apiKey =
    opts.apiKey ??
    process.env.GOOGLE_ADDRESS_VALIDATION_API_KEY ??
    process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) return { outcome: 'unavailable' }

  const fetchImpl = opts.fetchImpl ?? ((u: RequestInfo | URL, init?: RequestInit) => fetch(u, init))
  const base = opts.baseUrl ?? DEFAULT_BASE_URL
  let res: Response
  try {
    res = await fetchImpl(`${base}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: { regionCode: 'AU', addressLines: [raw] } }),
    })
  } catch {
    return { outcome: 'unavailable' }
  }
  if (!res.ok) return { outcome: 'unavailable' }

  let payload: unknown
  try {
    payload = await res.json()
  } catch {
    return { outcome: 'unavailable' }
  }

  const insight = parseAddressValidationResponse(payload)
  if (insight.status === 'unavailable' || insight.status === 'skipped') {
    return { outcome: 'unavailable' }
  }
  if (insight.status === 'needs_fix') return { outcome: 'not_found' }
  if (!insight.formatted_address) return { outcome: 'unavailable' }

  const formatted = stripCountry(insight.formatted_address)
  return {
    outcome: 'match',
    formatted,
    postcode: parseFormattedPostcode(formatted),
    state: parseFormattedState(formatted),
    corrected: wasCorrected(raw, formatted),
  }
}

// ── Pure helpers ─────────────────────────────────────────────────────

/** PURE — drop the trailing ", Australia" for the SMS read-back. */
export function stripCountry(formatted: string): string {
  return formatted.replace(/,\s*Australia\s*$/i, '').trim()
}

const AU_STATES: readonly AuStateAbbr[] = ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'ACT', 'NT']

function parseFormattedState(formatted: string): AuStateAbbr | null {
  const m = formatted.toUpperCase().match(/\b(NSW|VIC|QLD|SA|WA|TAS|ACT|NT)\b/)
  return m ? (m[1] as AuStateAbbr) : null
}

function parseFormattedPostcode(formatted: string): string | null {
  const all = formatted.match(/\b\d{4}\b/g)
  return all ? all[all.length - 1] : null
}

/** Common AU street-type abbreviations, so "Drive" vs "Dr" alone doesn't
 *  read as a correction. */
const STREET_TYPES: Record<string, string> = {
  st: 'street', rd: 'road', dr: 'drive', ave: 'avenue', av: 'avenue',
  ct: 'court', cres: 'crescent', cr: 'crescent', pl: 'place', hwy: 'highway',
  pde: 'parade', tce: 'terrace', ln: 'lane', cl: 'close', blvd: 'boulevard',
  gr: 'grove', cct: 'circuit', esp: 'esplanade',
}

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s/-]/g, ' ')
    .split(/[\s/-]+/)
    .filter(Boolean)
    .map((t) => STREET_TYPES[t] ?? t)
}

/** PURE — did Google materially change what the customer typed? True when
 *  any word of the raw input (state names and filler aside) is absent from
 *  the formatted address — e.g. raw "safety each" vs formatted "Safety
 *  Beach" leaves "each" unmatched. Extra words Google ADDED (suburb,
 *  postcode, state) never count as a correction. */
export function wasCorrected(raw: string, formatted: string): boolean {
  const have = new Set(tokens(formatted))
  const auStateWords = new Set([
    ...AU_STATES.map((s) => s.toLowerCase()),
    'new', 'south', 'wales', 'victoria', 'queensland', 'western', 'australia', 'australian',
    'tasmania', 'northern', 'territory', 'capital', 'unit', 'lot',
  ])
  return tokens(raw).some((t) => !have.has(t) && !auStateWords.has(t))
}

// ── Confirm-step planner (shared wording for both trades) ────────────

export type ConfirmAddressPlan =
  | { kind: 'keep' }
  | { kind: 'confirm'; address: string; postcode: string | null; state: AuStateAbbr | null; reply: string }
  | { kind: 'reject'; reply: string }

export function confirmAddressQuestion(address: string, corrected: boolean): string {
  return corrected
    ? `The closest address I can find is "${address}". Is that the one? Reply yes or no.`
    : `Just to confirm, the property is "${address}". Is that right? Reply yes or no.`
}

export function addressNotFoundReply(raw: string): string {
  return `Sorry, I can't find "${raw}" on the map. Could you double-check the spelling and send the full address again — street number, street, suburb and postcode?`
}

/** PURE — turn a verification result into what the confirm step should do. */
export function planConfirmAddress(raw: string, v: AddressVerification): ConfirmAddressPlan {
  if (v.outcome === 'unavailable') return { kind: 'keep' }
  if (v.outcome === 'not_found') return { kind: 'reject', reply: addressNotFoundReply(raw) }
  return {
    kind: 'confirm',
    address: v.formatted,
    postcode: v.postcode,
    state: v.state,
    reply: confirmAddressQuestion(v.formatted, v.corrected),
  }
}

// ── Route-facing wrapper ─────────────────────────────────────────────

/** The address-bearing subset both RoofingSlots and PaintingSlots share. */
export type AddressSlotsLike = {
  address?: string | null
  postcode?: string | null
  state?: AuStateAbbr | null
  address_confirmed?: boolean
  addr_verified?: string | null
  addr_verify_misses?: number
}

/**
 * Screen a confirm_address ask before it goes out. Returns the (possibly
 * revised) slots, plus a step/reply override when the read-back should
 * change. No overrides → send the original question untouched.
 *
 *   confirm → address normalised to Google's formatted string (stamped in
 *             addr_verified so re-entering the confirm step doesn't call
 *             the API again for the same string), postcode/state filled.
 *   reject  → address cleared, step forced back to 'address', bounded by
 *             MAX_ADDRESS_VERIFY_REJECTS via addr_verify_misses.
 *   keep    → API unavailable or reject budget spent; original read-back.
 */
export async function screenConfirmAddress<S extends AddressSlotsLike>(
  slots: S,
  opts: VerifyAddressOpts = {},
): Promise<{ slots: S; step?: 'address'; reply?: string }> {
  const raw = slots.address
  if (!raw) return { slots }
  if (slots.addr_verified === raw) return { slots }
  if ((slots.addr_verify_misses ?? 0) >= MAX_ADDRESS_VERIFY_REJECTS) return { slots }

  const plan = planConfirmAddress(raw, await verifyAuAddress(raw, opts))
  if (plan.kind === 'keep') return { slots }
  if (plan.kind === 'reject') {
    return {
      slots: {
        ...slots,
        address: null,
        postcode: null,
        state: null,
        address_confirmed: false,
        addr_verify_misses: (slots.addr_verify_misses ?? 0) + 1,
      } as S,
      step: 'address',
      reply: plan.reply,
    }
  }
  return {
    slots: {
      ...slots,
      address: plan.address,
      postcode: plan.postcode ?? slots.postcode,
      state: plan.state ?? slots.state,
      addr_verified: plan.address,
    } as S,
    reply: plan.reply,
  }
}
