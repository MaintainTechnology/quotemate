// PATCH /api/roofing/measurement/[token] — update the persisted structure
// selection (included_indices) for a roofing measurement, keyed by its
// unguessable measure_token (migration 140).
//
// Trust model: the measure_token IS the capability (same as the customer
// /q/roof/[public_token] page — link-shareable, no bearer). Updating the
// selection recomputes the denormalised summary AND invalidates any cached
// quote PDF (pdf_path → null) so the customer page + PDF re-render the new
// selection on next view/download. At least one structure must stay included.

import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { MultiRoofQuote, RoofJobIntent } from '@/lib/roofing/types'
import type { SolarQuoteAddon } from '@/lib/roofing/solar'
import { denormFromSelection, sanitizeIndices, structureCount } from '@/lib/roofing/selection'
import { detectSolarForJob, loadRoofingRateCard } from '@/lib/roofing/solar-detect'

export const dynamic = 'force-dynamic'
// The POST re-scan runs Gemini (per structure) + an Anthropic photo pass
// inline before persisting, so raise the function ceiling like the save route.
export const maxDuration = 60

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const BodySchema = z.object({
  included_indices: z.array(z.number().int()).min(1).max(64),
})

type Row = { id: string; quote: MultiRoofQuote | null }

export async function PATCH(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  if (!token || token.length < 8) {
    return Response.json({ ok: false, error: 'not_found' }, { status: 404 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: 'invalid_request', issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const { data: row, error: readErr } = await supabase
    .from('roofing_measurements')
    .select('id, quote')
    .eq('measure_token', token)
    .maybeSingle<Row>()
  if (readErr || !row) {
    return Response.json({ ok: false, error: 'not_found' }, { status: 404 })
  }

  const count = structureCount(row.quote)
  const included = sanitizeIndices(parsed.data.included_indices, count)
  if (included.length === 0) {
    return Response.json(
      { ok: false, error: 'no_structures', detail: 'Keep at least one structure in the job.' },
      { status: 400 },
    )
  }

  const denorm = row.quote
    ? denormFromSelection(row.quote, included)
    : { combined_area_m2: null, combined_better_inc_gst: null, structure_count: included.length }

  const { error: updErr } = await supabase
    .from('roofing_measurements')
    .update({
      included_indices: included,
      combined_area_m2: denorm.combined_area_m2,
      combined_better_inc_gst: denorm.combined_better_inc_gst,
      structure_count: denorm.structure_count,
      // Invalidate the cached PDF — the lazy PDF route regenerates from the
      // new selection when pdf_path is null.
      pdf_path: null,
    })
    .eq('id', row.id)

  if (updErr) {
    return Response.json({ ok: false, error: 'update_failed', detail: updErr.message }, { status: 200 })
  }

  return Response.json({ ok: true, included_indices: included, ...denorm }, { status: 200 })
}

// POST /api/roofing/measurement/[token] — re-scan this measurement for existing
// solar/skylights using tradie-attached close-up roof PHOTOS, merged with the
// per-structure aerial pass, and persist the result onto
// roofing_measurements.quote.solar. Same measure_token capability model as the
// PATCH above (link-shareable, no bearer). This is the tradie-attached-photo
// source for R2; customer /upload/[token] photo sourcing is gated on the spec's
// open question (roofing jobs don't yet collect customer photos) and not wired.
const RescanBodySchema = z.object({
  photos: z
    .array(z.object({ base64: z.string().min(1), mime: z.string().min(3).max(60) }))
    .min(1)
    .max(6),
})

type RescanRow = {
  id: string
  quote: MultiRoofQuote | null
  tenant_id: string | null
  provider: string | null
}

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  if (!token || token.length < 8) {
    return Response.json({ ok: false, error: 'not_found' }, { status: 404 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }
  const parsed = RescanBodySchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: 'invalid_request', issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const { data: row, error: readErr } = await supabase
    .from('roofing_measurements')
    .select('id, quote, tenant_id, provider')
    .eq('measure_token', token)
    .maybeSingle<RescanRow>()
  if (readErr || !row) {
    return Response.json({ ok: false, error: 'not_found' }, { status: 404 })
  }

  const fullQuote = row.quote
  if (!fullQuote || structureCount(fullQuote) === 0) {
    return Response.json({ ok: false, error: 'no_quote' }, { status: 400 })
  }

  const primary =
    fullQuote.structures.find((s) => s.role === 'primary') ?? fullQuote.structures[0]
  const primaryIntent = (primary?.inputs?.intent ?? 'full_reroof') as RoofJobIntent
  const rateCard = await loadRoofingRateCard(supabase, row.tenant_id, null)

  let solarAddon: SolarQuoteAddon | null = null
  try {
    solarAddon = await detectSolarForJob({
      quote: fullQuote,
      // Re-scan always runs (the tradie explicitly attached photos) — pass a
      // non-mock provider so the orchestrator's demo short-circuit is bypassed.
      provider: row.provider === 'mock' ? 'manual' : row.provider ?? 'geoscape',
      primaryIntent,
      rateCard,
      photos: parsed.data.photos,
    })
  } catch {
    solarAddon = null
  }

  if (!solarAddon) {
    return Response.json(
      { ok: true, solar: null, detail: 'No existing solar or skylights detected from the photos.' },
      { status: 200 },
    )
  }

  const updatedQuote = { ...fullQuote, solar: solarAddon }
  const { error: updErr } = await supabase
    .from('roofing_measurements')
    .update({
      quote: updatedQuote,
      // Invalidate the cached PDF so it regenerates with the solar line.
      pdf_path: null,
    })
    .eq('id', row.id)
  if (updErr) {
    return Response.json({ ok: false, error: 'update_failed', detail: updErr.message }, { status: 200 })
  }

  return Response.json({ ok: true, solar: solarAddon }, { status: 200 })
}
