// POST /api/roofing/save — persist a confirmed multi-structure roofing
// measurement into public.roofing_measurements (one row per job, N
// structures in a jsonb array). Requires migration 081.
//
// Auth: same bearer-token pattern as the rest of the roofing surface.
// The denormalised summary columns (area, better-tier total, routing)
// are derived defensively from the supplied quote payload for fast list
// views; the full quote + structures are stored verbatim.

import { createClient } from '@supabase/supabase-js'
import { SaveRoofMeasurementSchema } from '@/lib/roofing/request-schema'
import type { MultiRoofQuote, RoofJobIntent } from '@/lib/roofing/types'
import {
  denormFromSelection,
  primaryStructureIndices,
  sanitizeIndices,
  structureCount,
} from '@/lib/roofing/selection'
import type { SolarQuoteAddon } from '@/lib/roofing/solar'
import { detectSolarForJob } from '@/lib/roofing/solar-detect'
import { resolveTenantRequest } from '@/lib/tenant/from-request'
import {
  loadTenantRoofingPricingContext,
  roofMeasurementTokensForRun,
  roofRunRequestDigest,
  verifyRoofPricingRun,
} from '@/lib/roofing/pricing-authority'

export const dynamic = 'force-dynamic'
// Server-side solar/skylight vision (Gemini aerial per structure + an optional
// Anthropic photo pass) runs inline before the insert, so the allowance is
// persisted onto the saved quote. Raise the function ceiling.
export const maxDuration = 60

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// Dual-auth: Clerk session token (→ clerk_user_id) OR legacy Supabase token
// (→ owner_user_id). Tenant is optional here — a job still saves under the
// caller (created_by) when no tenant row exists, so we never 404.
async function userAndTenantFromBearer(
  req: Request,
): Promise<{ userId: string | null; tenantId: string | null; primaryTrade: string | null } | null> {
  const resolved = await resolveTenantRequest(supabase, req, 'id, trade, owner_user_id')
  if (!resolved) return null
  const tenant = resolved.tenant as { id?: string; trade?: string | null; owner_user_id?: string | null } | null
  // created_by is a uuid → auth.users FK, so it must hold the SUPABASE auth id:
  // tenant.owner_user_id for a Clerk caller, the caller's own id for a Supabase
  // caller. Never a Clerk `user_…` string (which isn't a valid uuid).
  const supabaseUserId =
    tenant?.owner_user_id ?? (resolved.identity.provider === 'supabase' ? resolved.identity.userId : null)
  return {
    userId: supabaseUserId,
    tenantId: tenant?.id ?? null,
    primaryTrade: tenant?.trade ?? null,
  }
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

export async function POST(req: Request) {
  const auth = await userAndTenantFromBearer(req)
  if (!auth) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }

  const parsed = SaveRoofMeasurementSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: 'invalid_request', issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const {
    address,
    provider,
    structures: callerStructures,
    run_token,
    quote,
    included_indices,
    customer_name,
    customer_phone,
    solar_photos,
  } = parsed.data

  if (!auth.tenantId) {
    return Response.json(
      { ok: false, error: 'tenant_pricing_required', detail: 'Complete roofing pricing setup.' },
      { status: 422 },
    )
  }
  const pricing = await loadTenantRoofingPricingContext(
    supabase,
    auth.tenantId,
    auth.primaryTrade,
  )
  if (!pricing) {
    return Response.json(
      { ok: false, error: 'tenant_pricing_required', detail: 'Complete every roofing rate and GST setting.' },
      { status: 422 },
    )
  }
  const runSecret = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!runSecret) {
    return Response.json({ ok: false, error: 'pricing_authority_unavailable' }, { status: 503 })
  }
  const requestDigest = roofRunRequestDigest({ address, provider, quote })
  const verified = verifyRoofPricingRun({
    token: run_token,
    secret: runSecret,
    tenantId: auth.tenantId,
    currentAuthority: pricing.authority,
    requestDigest,
  })
  if (!verified.ok) {
    const status = verified.error === 'pricing_stale' ? 409 : 422
    return Response.json({ ok: false, error: verified.error }, { status })
  }

  const fullQuote = quote as MultiRoofQuote
  if (!Array.isArray(fullQuote?.structures) || fullQuote.structures.length === 0) {
    return Response.json({ ok: false, error: 'invalid_verified_quote' }, { status: 422 })
  }
  const structures = fullQuote.structures.map((structure) => ({
    buildingId: structure.buildingId,
    role: structure.role,
    label: structure.label,
    inputs: structure.inputs,
  }))
  // If an older caller still supplies the convenience structure list, it may
  // describe display intent but can never override the signed quote snapshot.
  void callerStructures

  const stableTokens = roofMeasurementTokensForRun({
    runId: verified.proof.run_id,
    secret: runSecret,
  })
  const existingResponse = async () => {
    const { data: existing } = await supabase
      .from('roofing_measurements')
      .select('id, public_token, measure_token')
      .eq('tenant_id', auth.tenantId!)
      .eq('measure_token', stableTokens.measure_token)
      .maybeSingle()
    return existing
      ? Response.json(
          {
            ok: true,
            existing: true,
            id: existing.id,
            public_token: existing.public_token,
            measure_token: existing.measure_token,
            pricing_authority: pricing.authority,
          },
          { status: 200 },
        )
      : null
  }
  const existing = await existingResponse()
  if (existing) return existing

  // A freshly-saved measurement defaults to ROOF-ONLY: just the primary
  // structure is in the job, so the tradie opts secondary structures
  // (sheds/garages) IN rather than out. When the dashboard sends an explicit
  // selection (its include toggles), that wins. included_indices is 1-based;
  // the denormalised summary is derived from it so list views stay in sync.
  const count = structureCount(fullQuote)
  const provided = sanitizeIndices(included_indices, count)
  const includedIndices =
    provided.length > 0 ? provided : count > 0 ? primaryStructureIndices(fullQuote) : null

  // ── Solar / skylight detection (best-effort, persisted on the quote) ──
  // The job's primary intent gates whether the allowance applies (re-roof
  // only). Detection runs server-side here because the dashboard auto-saves
  // and redirects — there's no later client step to attach it.
  const primaryIntent = ((structures.find((s) => s.role === 'primary') ?? structures[0])?.inputs
    ?.intent ?? 'full_reroof') as RoofJobIntent
  const rateCard = pricing.rateCard
  let solarAddon: SolarQuoteAddon | null = null
  try {
    solarAddon = await detectSolarForJob({
      quote: fullQuote,
      provider,
      primaryIntent,
      rateCard,
      photos: solar_photos,
    })
  } catch {
    solarAddon = null
  }
  // Attach to the stored quote (additive — older payloads simply omit it).
  const authorityStampedQuote = {
    ...fullQuote,
    pricing_authority: pricing.authority,
    pricing_run_id: verified.proof.run_id,
  }
  const quoteToStore = solarAddon
    ? { ...authorityStampedQuote, solar: solarAddon }
    : authorityStampedQuote

  // Denormalised summary — computed from the SOLAR-ATTACHED quote (after
  // detection, not before), so combined_better_inc_gst carries the same
  // allowance every display surface shows. Computing it from the pre-solar
  // payload stored a lower dashboard-list price than /m, /q/roof and the PDF.
  const denormQuote = (quoteToStore ?? null) as MultiRoofQuote | null
  const denorm =
    denormQuote && includedIndices
      ? denormFromSelection(denormQuote, includedIndices)
      : {
          combined_area_m2: numOrNull(readPath(quote, ['combined', 'area_m2'])),
          combined_better_inc_gst: numOrNull(readPath(quote, ['combined', 'tiers', 1, 'inc_gst'])),
          structure_count: structures.length,
        }

  const row = {
    tenant_id: auth.tenantId,
    created_by: auth.userId,
    address: address.address,
    postcode: address.postcode,
    state: address.state,
    provider,
    customer_name: customer_name ?? null,
    customer_phone: customer_phone ?? null,
    structure_count: denorm.structure_count,
    combined_area_m2: denorm.combined_area_m2,
    combined_better_inc_gst: denorm.combined_better_inc_gst,
    routing: strOrNull(readPath(quote, ['routing', 'decision'])),
    structures,
    quote: quoteToStore,
    // Authoritative structure selection (migration 140) — the customer quote
    // page + PDF narrow to this. Defaults to roof-only (the primary structure)
    // unless the dashboard sent the tradie's explicit include toggles.
    included_indices: includedIndices,
    // Both capability tokens, minted as a pair by the shared minter (the
    // SMS receptionist uses the same one, so the two write paths cannot
    // drift apart again):
    //   public_token  → /q/roof/[public_token]  customer's priced quote
    //   measure_token → /m/[measure_token]      tradie Measurement Results
    ...stableTokens,
    // Dashboard saves are bearer-authed (the tradie) and the tradie has
    // already picked the structures — so the quote is confirmed at save
    // time. Stamping confirmed_at lets /q/roof show full prices immediately
    // with NO customer SMS-confirm step. This route is dashboard-only; the
    // SMS receptionist writes roofing_measurements through its own path, so
    // its confirm gate is untouched.
    confirmed_at: new Date().toISOString(),
  }

  const { data, error } = await supabase
    .from('roofing_measurements')
    .insert(row)
    .select('id, public_token, measure_token')
    .single()

  if (error) {
    const raced = await existingResponse()
    if (raced) return raced
    return Response.json(
      { ok: false, error: 'save_failed', detail: error.message },
      { status: 200 },
    )
  }

  return Response.json(
    {
      ok: true,
      id: data.id as string,
      public_token: data.public_token as string,
      measure_token: data.measure_token as string,
      pricing_authority: pricing.authority,
    },
    { status: 200 },
  )
}

// GET /api/roofing/save — list THIS tenant's saved roofing jobs, newest
// first. Powers the "Saved roofing jobs" history in the dashboard Roof
// tab. Returns the denormalised summary columns only (the full quote
// lives on /q/roof/[public_token]).
export async function GET(req: Request) {
  const auth = await userAndTenantFromBearer(req)
  if (!auth) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  let q = supabase
    .from('roofing_measurements')
    .select(
      'id, address, postcode, state, customer_name, structure_count, combined_area_m2, combined_better_inc_gst, routing, public_token, measure_token, created_at',
    )
    .order('created_at', { ascending: false })
    .limit(100)

  // Scope to the tenant; fall back to the saver when there's no tenant
  // (so a job still shows for whoever measured it).
  q = auth.tenantId ? q.eq('tenant_id', auth.tenantId) : q.eq('created_by', auth.userId)

  const { data, error } = await q
  if (error) {
    return Response.json({ ok: false, error: 'list_failed', detail: error.message }, { status: 200 })
  }
  return Response.json({ ok: true, jobs: data ?? [] }, { status: 200 })
}
