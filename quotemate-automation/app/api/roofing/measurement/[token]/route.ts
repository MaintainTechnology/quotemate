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
import type { MultiRoofQuote } from '@/lib/roofing/types'
import { denormFromSelection, sanitizeIndices, structureCount } from '@/lib/roofing/selection'

export const dynamic = 'force-dynamic'

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
