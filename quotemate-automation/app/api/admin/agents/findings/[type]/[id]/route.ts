// PATCH /api/admin/agents/findings/[type]/[id]
//
// Move a finding through its status lifecycle:
//   pending → approved | rejected
//   approved → applied   (only after a separate "apply" step runs)
//
// `type` is one of:
//   catalogue        → catalogue_findings table
//   tradie-edit      → tradie_edit_patterns table
//
// Eval runs aren't reviewable (they're measurements, not suggestions),
// so this route doesn't touch eval_runs / eval_run_items.

import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { resolveAdminUserId } from '@/lib/admin-loader/route-auth'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const BodySchema = z.object({
  status: z.enum(['approved', 'rejected', 'applied']),
})

const VALID_TYPES: Record<string, string> = {
  catalogue: 'catalogue_findings',
  'tradie-edit': 'tradie_edit_patterns',
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ type: string; id: string }> },
) {
  const adminId = await resolveAdminUserId(supabase, req)
  if (!adminId) return Response.json({ error: 'forbidden' }, { status: 403 })

  const { type, id } = await ctx.params
  const table = VALID_TYPES[type]
  if (!table) {
    return Response.json(
      { error: 'invalid_type', valid: Object.keys(VALID_TYPES) },
      { status: 400 },
    )
  }

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  const parsed = BodySchema.safeParse(raw)
  if (!parsed.success) {
    return Response.json(
      { error: 'invalid_payload', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const { data, error } = await supabase
    .from(table)
    .update({
      status: parsed.data.status,
      reviewed_by: adminId,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('id, status, reviewed_at')
    .maybeSingle()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!data) return Response.json({ error: 'not_found' }, { status: 404 })

  return Response.json({ ok: true, ...data })
}
