// /api/signage/assessment/[id]
//
// GET   → full assessment detail for the HQ reviewer: the per-rule
//         verdicts (with rule text + group + applicability), the studio,
//         and signed URLs for the submitted photos.
// PATCH → HQ decision: { hq_decision: approved|needs_changes|escalated,
//         hq_note? }. Sets status='resolved' on approve/needs_changes.
//
// Auth: bearer → org; the assessment must belong to that org.

import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { orgFromBearer } from '@/lib/signage/org'
import { loadActiveRules } from '@/lib/signage/run'
import { refreshSignedUrl } from '@/lib/storage/upload'
import type { RuleVerdict, SignageRule } from '@/lib/signage/types'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function loadOwned(orgId: string, id: string) {
  const { data } = await supabase
    .from('signage_assessments')
    .select('id, request_id, studio_id, org_id, brand_slug, status, overall, counts, verdicts, hq_decision, hq_note, rule_set_version, created_at')
    .eq('id', id)
    .maybeSingle()
  if (!data || (data.org_id as string) !== orgId) return null
  return data
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await orgFromBearer(supabase, req)
  if (!auth) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  const { id } = await ctx.params

  const a = await loadOwned(auth.orgId, id)
  if (!a) return Response.json({ ok: false, error: 'not_found' }, { status: 404 })

  const brandSlug = (a.brand_slug as string | null)?.trim() || 'f45'
  const [{ data: studio }, { data: subs }, rules] = await Promise.all([
    supabase.from('studios').select('name, region').eq('id', a.studio_id as string).maybeSingle(),
    supabase
      .from('signage_photo_submissions')
      .select('shot_slot, storage_path')
      .eq('request_id', a.request_id as string),
    loadActiveRules(supabase, brandSlug, (a.rule_set_version as number) ?? 1),
  ])

  const ruleByKey = new Map<string, SignageRule>(rules.map((r) => [r.rule_key, r]))
  const verdicts = ((a.verdicts as RuleVerdict[]) ?? []).map((v) => {
    const rule = ruleByKey.get(v.rule_key)
    return {
      ...v,
      rule_text: rule?.rule_text ?? v.rule_key,
      rule_group: rule?.rule_group ?? 'other',
      applicability: rule?.applicability ?? 'human_review_only',
      source_citation: rule?.source_citation ?? null,
    }
  })

  // Sign the submitted photos for display (best-effort).
  const photos: Array<{ shot_slot: string; url: string | null }> = []
  for (const s of subs ?? []) {
    let url: string | null = null
    try {
      url = await refreshSignedUrl(s.storage_path as string)
    } catch {
      url = null
    }
    photos.push({ shot_slot: s.shot_slot as string, url })
  }

  return Response.json({
    ok: true,
    assessment: {
      id: a.id,
      status: a.status,
      overall: a.overall,
      counts: a.counts,
      hq_decision: a.hq_decision,
      hq_note: a.hq_note,
      created_at: a.created_at,
      studio_name: (studio?.name as string) ?? 'Studio',
      region: (studio?.region as string) ?? null,
    },
    verdicts,
    photos,
  })
}

const DecisionSchema = z.object({
  hq_decision: z.enum(['approved', 'needs_changes', 'escalated']),
  hq_note: z.string().trim().max(2000).optional(),
})

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await orgFromBearer(supabase, req)
  if (!auth) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  const { id } = await ctx.params

  const a = await loadOwned(auth.orgId, id)
  if (!a) return Response.json({ ok: false, error: 'not_found' }, { status: 404 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }
  const parsed = DecisionSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ ok: false, error: 'invalid_request', issues: parsed.error.issues }, { status: 400 })
  }

  // approved / needs_changes resolve the item; escalated keeps it open.
  const status = parsed.data.hq_decision === 'escalated' ? 'hq_review' : 'resolved'

  const { error } = await supabase
    .from('signage_assessments')
    .update({
      hq_decision: parsed.data.hq_decision,
      hq_note: parsed.data.hq_note ?? null,
      hq_reviewed_by: auth.userId,
      status,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 })

  return Response.json({ ok: true, status })
}
