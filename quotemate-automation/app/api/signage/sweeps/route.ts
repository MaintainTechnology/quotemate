// /api/signage/sweeps
//
// POST → HQ creates a compliance sweep: a sweep row + one tokenised
//        signage_request per matching studio. Returns the upload links
//        (SMS dispatch is gated behind SIGNAGE_SMS_ENABLED; off in dev,
//        so HQ copies/sends the links).
// GET  → the signage hub payload: this org's studios + recent sweeps,
//        each sweep carrying its requests (token, link, state, latest
//        assessment rollup).
//
// Auth: bearer token → org (mirrors the tenant pattern). Service-role
// client; org scoping is app-layer.

import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { orgFromBearer } from '@/lib/signage/org'
import { coerceShots, shotSlots } from '@/lib/signage/shots'
import { brandForOrg } from '@/lib/signage/brand'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const CreateSweepSchema = z.object({
  name: z.string().trim().min(1).max(120),
  region: z.string().trim().max(60).optional(),
  studio_status: z.enum(['prospect', 'open', 'closed']).optional(),
  required_shots: z.array(z.string()).optional(),
})

function originOf(req: Request): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin
}

export async function POST(req: Request) {
  const ctx = await orgFromBearer(supabase, req)
  if (!ctx) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }
  const parsed = CreateSweepSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ ok: false, error: 'invalid_request', issues: parsed.error.issues }, { status: 400 })
  }

  const brand = await brandForOrg(supabase, ctx.orgId)
  const brandSlots = shotSlots(brand.shots)
  const shots = coerceShots(parsed.data.required_shots, brandSlots)
  const requiredShots = shots.length > 0 ? shots : brandSlots

  // Find target studios for this org.
  let studioQ = supabase.from('studios').select('id, name').eq('org_id', ctx.orgId)
  if (parsed.data.region) studioQ = studioQ.eq('region', parsed.data.region)
  if (parsed.data.studio_status) studioQ = studioQ.eq('status', parsed.data.studio_status)
  const { data: studios, error: studioErr } = await studioQ
  if (studioErr) return Response.json({ ok: false, error: studioErr.message }, { status: 500 })
  if (!studios || studios.length === 0) {
    return Response.json({ ok: false, error: 'no_matching_studios' }, { status: 400 })
  }

  // Create the sweep.
  const { data: sweep, error: sweepErr } = await supabase
    .from('signage_sweeps')
    .insert({
      org_id: ctx.orgId,
      name: parsed.data.name,
      rule_set_version: 1,
      studio_filter: {
        region: parsed.data.region ?? null,
        status: parsed.data.studio_status ?? null,
      },
      required_shots: requiredShots,
      status: 'sent',
      created_by: ctx.userId,
    })
    .select('id')
    .single()
  if (sweepErr || !sweep) {
    return Response.json({ ok: false, error: sweepErr?.message ?? 'sweep_failed' }, { status: 500 })
  }

  // One tokenised request per studio.
  const requestRows = studios.map((s) => ({
    sweep_id: sweep.id as string,
    studio_id: s.id as string,
    org_id: ctx.orgId,
    public_token: randomBytes(16).toString('hex'),
    state: 'pending',
    required_shots: requiredShots,
  }))
  const { data: requests, error: reqErr } = await supabase
    .from('signage_requests')
    .insert(requestRows)
    .select('id, public_token, studio_id')
  if (reqErr) {
    return Response.json({ ok: false, error: reqErr.message }, { status: 500 })
  }

  const origin = originOf(req)
  const nameById = new Map(studios.map((s) => [s.id as string, s.name as string]))
  const links = (requests ?? []).map((r) => ({
    studio_name: nameById.get(r.studio_id as string) ?? 'Studio',
    token: r.public_token as string,
    link: `${origin}/studio/${r.public_token}/upload`,
  }))

  // SMS dispatch is intentionally gated — sending to real studios is a
  // Phase-2 concern. In dev/MVP, HQ copies the links from the response.
  // (lib/sms/dispatch.ts would slot in here behind SIGNAGE_SMS_ENABLED.)

  return Response.json({ ok: true, sweep_id: sweep.id, studio_count: studios.length, links })
}

export async function GET(req: Request) {
  const ctx = await orgFromBearer(supabase, req)
  if (!ctx) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  const origin = originOf(req)

  const [{ data: studios }, { data: sweeps }] = await Promise.all([
    supabase
      .from('studios')
      .select('id, name, region, status')
      .eq('org_id', ctx.orgId)
      .order('region')
      .order('name'),
    supabase
      .from('signage_sweeps')
      .select('id, name, created_at, required_shots, status')
      .eq('org_id', ctx.orgId)
      .order('created_at', { ascending: false })
      .limit(25),
  ])

  const sweepIds = (sweeps ?? []).map((s) => s.id as string)
  let requestsBySweep: Record<string, Array<Record<string, unknown>>> = {}
  if (sweepIds.length > 0) {
    const { data: requests } = await supabase
      .from('signage_requests')
      .select('id, sweep_id, studio_id, public_token, state')
      .in('sweep_id', sweepIds)

    const studioName = new Map((studios ?? []).map((s) => [s.id as string, s.name as string]))

    // Latest assessment per request for the rollup chip.
    const reqIds = (requests ?? []).map((r) => r.id as string)
    const assessmentByReq = new Map<string, { id: string; overall: string | null; status: string }>()
    if (reqIds.length > 0) {
      const { data: assessments } = await supabase
        .from('signage_assessments')
        .select('id, request_id, overall, status')
        .in('request_id', reqIds)
      for (const a of assessments ?? []) {
        assessmentByReq.set(a.request_id as string, {
          id: a.id as string,
          overall: (a.overall as string | null) ?? null,
          status: a.status as string,
        })
      }
    }

    requestsBySweep = {}
    for (const r of requests ?? []) {
      const sid = r.sweep_id as string
      const a = assessmentByReq.get(r.id as string)
      ;(requestsBySweep[sid] ??= []).push({
        id: r.id,
        studio_name: studioName.get(r.studio_id as string) ?? 'Studio',
        token: r.public_token,
        link: `${origin}/studio/${r.public_token}/upload`,
        state: r.state,
        overall: a?.overall ?? null,
        assessment_id: a?.id ?? null,
        assessment_status: a?.status ?? null,
      })
    }
  }

  const sweepsOut = (sweeps ?? []).map((s) => ({
    ...s,
    requests: requestsBySweep[s.id as string] ?? [],
  }))

  // The brand drives the sweep builder's shot checkboxes + terminology.
  const brand = await brandForOrg(supabase, ctx.orgId)
  return Response.json({
    ok: true,
    brand: {
      name: brand.name,
      location_noun: brand.location_noun,
      location_noun_plural: brand.location_noun_plural,
      shots: brand.shots,
    },
    studios: studios ?? [],
    sweeps: sweepsOut,
  })
}
