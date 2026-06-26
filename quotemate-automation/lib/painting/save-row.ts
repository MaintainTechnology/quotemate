// ════════════════════════════════════════════════════════════════════
// Painting — build the painting_measurements insert row from a validated
// save request. Pulled out of app/api/painting/save/route.ts so the row
// construction (denormalised summary columns + the two unguessable tokens)
// is a pure function we can unit-test without a Supabase client.
//
// Two tokens per saved job, mirroring roofing (migration 140/151):
//   • public_token   — the customer quote at /q/paint/[public_token]
//   • estimate_token — the tradie results page at /p/[estimate_token]
// ════════════════════════════════════════════════════════════════════

import { randomBytes } from 'node:crypto'
import type { SavePaintingRequest } from './request-schema'

/** Mint one unguessable 32-char hex token (16 random bytes). */
export function mintToken(): string {
  return randomBytes(16).toString('hex')
}

/** Read a nested value off an unknown payload without `any`. */
function readPath(obj: unknown, path: Array<string | number>): unknown {
  let cur: unknown = obj
  for (const k of path) {
    if (cur && typeof cur === 'object' && String(k) in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[String(k)]
    } else {
      return undefined
    }
  }
  return cur
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}
function strOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null
}

export type PaintingMeasurementRow = {
  tenant_id: string | null
  // Nullable: a tradie-dashboard save stamps the auth user; an SMS / public
  // self-serve lead has no authenticated user, so created_by is null there.
  created_by: string | null
  address: string
  postcode: string
  state: string
  source: SavePaintingRequest['source']
  customer_name: string | null
  customer_phone: string | null
  scopes: string[]
  floor_area_m2: number | null
  total_area_m2: number | null
  confidence: string | null
  better_inc_gst: number | null
  routing: string | null
  inputs: SavePaintingRequest['inputs']
  estimate: unknown
  public_token: string
  estimate_token: string
  // Tradie-release gate (migration 157). A dashboard save is tradie-authored,
  // so it's released at save time; an SMS / self-serve draft leaves this null
  // and stays gated until the tradie clicks "Send to customer".
  released_at: string | null
}

/**
 * Build the row inserted into public.painting_measurements. The full
 * PaintingEstimate is stored verbatim in `estimate`; the denormalised
 * summary columns are derived from it (the same paths the list view +
 * customer page read). `mint` is injectable so tests can assert token
 * ordering deterministically — production passes the default crypto mint.
 */
export function buildSavedPaintingRow(args: {
  tenantId: string | null
  userId: string | null
  data: SavePaintingRequest
  mint?: () => string
  /** ISO timestamp to release immediately (dashboard saves), or null/omitted
   *  to leave the quote drafted/held for tradie review (SMS / self-serve). */
  releasedAt?: string | null
}): PaintingMeasurementRow {
  const mint = args.mint ?? mintToken
  const { address, source, inputs, estimate, customer_name, customer_phone } = args.data
  return {
    tenant_id: args.tenantId,
    created_by: args.userId,
    address: address.address,
    postcode: address.postcode,
    state: address.state,
    source,
    customer_name: customer_name ?? null,
    customer_phone: customer_phone ?? null,
    scopes: Array.isArray(inputs.scopes) ? inputs.scopes : [],
    floor_area_m2: numOrNull(readPath(estimate, ['measurement', 'floor_area_m2'])),
    total_area_m2: numOrNull(readPath(estimate, ['price', 'total_area_m2'])),
    confidence: strOrNull(readPath(estimate, ['price', 'confidence'])),
    // Better tier (index 1) inc-GST is the headline number for the list.
    better_inc_gst: numOrNull(readPath(estimate, ['price', 'tiers', 1, 'inc_gst'])),
    routing: strOrNull(readPath(estimate, ['price', 'routing', 'decision'])),
    inputs,
    estimate: estimate ?? null,
    // public_token first, estimate_token second — both unguessable, distinct.
    public_token: mint(),
    estimate_token: mint(),
    released_at: args.releasedAt ?? null,
  }
}
