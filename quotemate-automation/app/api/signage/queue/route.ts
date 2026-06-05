// /api/signage/queue — the HQ fleet view + review queue payload.
//
// GET ?status=hq_review|all
//   rollup  → org-wide counts (studios, assessed, pass/fix/review, awaiting)
//   fleet   → one row per studio with its latest assessment status
//   queue   → assessments needing attention (hq_review by default), newest first
//
// Auth: bearer → org. Service-role client; org-scoped in app layer.

import { createClient } from '@supabase/supabase-js'
import { orgFromBearer } from '@/lib/signage/org'
import { resolveSignageBrand } from '@/lib/signage/brand'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function GET(req: Request) {
  const ctx = await orgFromBearer(supabase, req)
  if (!ctx) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const statusFilter = url.searchParams.get('status') ?? 'hq_review'
  const { brand, brands } = await resolveSignageBrand(supabase, req, ctx.orgId)

  const [{ data: studios }, { data: assessments }, { data: openRequests }] = await Promise.all([
    supabase.from('studios').select('id, name, region, status').eq('org_id', ctx.orgId).eq('brand_slug', brand.slug),
    supabase
      .from('signage_assessments')
      .select('id, request_id, studio_id, status, overall, counts, hq_decision, created_at')
      .eq('org_id', ctx.orgId)
      .eq('brand_slug', brand.slug)
      .order('created_at', { ascending: false }),
    supabase
      .from('signage_requests')
      .select('id, state')
      .eq('org_id', ctx.orgId)
      .eq('brand_slug', brand.slug)
      .in('state', ['pending', 'submitted']),
  ])

  const studioName = new Map((studios ?? []).map((s) => [s.id as string, s.name as string]))
  const studioRegion = new Map((studios ?? []).map((s) => [s.id as string, (s.region as string) ?? null]))

  // Latest assessment per studio (assessments already sorted desc).
  const latestByStudio = new Map<string, Record<string, unknown>>()
  for (const a of assessments ?? []) {
    const sid = a.studio_id as string
    if (!latestByStudio.has(sid)) latestByStudio.set(sid, a)
  }

  const fleet = (studios ?? []).map((s) => {
    const a = latestByStudio.get(s.id as string)
    return {
      studio_id: s.id,
      studio_name: s.name,
      region: (s.region as string) ?? null,
      latest_overall: (a?.overall as string | null) ?? null,
      latest_status: (a?.status as string | null) ?? null,
      assessment_id: (a?.id as string | null) ?? null,
      assessed_at: (a?.created_at as string | null) ?? null,
    }
  })

  const rollup = {
    studios: studios?.length ?? 0,
    assessed: latestByStudio.size,
    pass: fleet.filter((f) => f.latest_overall === 'pass').length,
    fix_needed: fleet.filter((f) => f.latest_overall === 'fix_needed').length,
    needs_review: fleet.filter((f) => f.latest_overall === 'needs_review').length,
    awaiting: openRequests?.length ?? 0,
  }

  const queueSource =
    statusFilter === 'all'
      ? assessments ?? []
      : (assessments ?? []).filter((a) => a.status === statusFilter)

  const queue = queueSource.map((a) => ({
    id: a.id,
    studio_id: a.studio_id,
    studio_name: studioName.get(a.studio_id as string) ?? 'Studio',
    region: studioRegion.get(a.studio_id as string) ?? null,
    status: a.status,
    overall: a.overall,
    counts: a.counts,
    hq_decision: a.hq_decision,
    created_at: a.created_at,
  }))

  return Response.json({ ok: true, rollup, fleet, queue, brands, selected: brand.slug })
}
