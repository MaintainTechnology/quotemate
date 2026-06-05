// /api/signage/request/[token] — the franchisee-facing tokenised endpoint.
//
// GET  → if the request is still collecting: the studio name + the guided
//        shot list. If already assessed: the composed compliance report.
// POST → ingest the guided photos (one or more per shot slot), store them
//        in the intake-photos bucket, record submissions, then run the
//        vision assessment + backstop in after() so the response is fast.
//
// No auth — the unguessable public_token IS the capability (mirrors the
// roofing public_token + the /upload/[token] flow).

import { createClient } from '@supabase/supabase-js'
import { after } from 'next/server'
import { uploadIntakePhoto } from '@/lib/storage/upload'
import { pipelineLog } from '@/lib/log/pipeline'
import { coerceShots, shotSlots } from '@/lib/signage/shots'
import { brandForOrg, loadBrand } from '@/lib/signage/brand'
import type { BrandConfig } from '@/lib/signage/types'
import { loadActiveRules, applicableRules, runAssessment } from '@/lib/signage/run'
import { composeReport } from '@/lib/signage/compose-report'
import type { RuleVerdict } from '@/lib/signage/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const MAX_FILES = 12
const MAX_SIZE = 5 * 1024 * 1024
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

type RequestRow = {
  id: string
  studio_id: string
  org_id: string
  state: string
  required_shots: unknown
  sweep_id: string | null
  brand_slug: string | null
}

async function resolveRequest(token: string): Promise<{ req: RequestRow; studioName: string } | null> {
  const { data: req } = await supabase
    .from('signage_requests')
    .select('id, studio_id, org_id, state, required_shots, sweep_id, brand_slug')
    .eq('public_token', token)
    .maybeSingle()
  if (!req) return null
  const { data: studio } = await supabase
    .from('studios')
    .select('name')
    .eq('id', req.studio_id as string)
    .maybeSingle()
  return { req: req as RequestRow, studioName: (studio?.name as string) ?? 'Your studio' }
}

/** Resolve the brand for a request from its stored brand_slug (set at sweep
 *  creation) so the franchisee sees the right brand's shots and the
 *  assessment uses the right brand's rules + Gemini file store. Falls back to
 *  the org's brand for legacy rows. */
async function brandForRequest(reqRow: RequestRow): Promise<BrandConfig> {
  const slug = reqRow.brand_slug?.trim()
  return slug ? loadBrand(supabase, slug) : brandForOrg(supabase, reqRow.org_id)
}

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const resolved = await resolveRequest(token)
  if (!resolved) return Response.json({ ok: false, error: 'invalid_or_expired' }, { status: 404 })

  const { req, studioName } = resolved
  const brand = await brandForRequest(req)
  const requestedShots = coerceShots(req.required_shots, shotSlots(brand.shots))
  const brandInfo = { name: brand.name, location_noun: brand.location_noun, hq_name: brand.hq_name }

  if (req.state === 'assessed') {
    const { data: assessment } = await supabase
      .from('signage_assessments')
      .select('overall, verdicts, counts')
      .eq('request_id', req.id)
      .maybeSingle()
    if (assessment) {
      const allRules = await loadActiveRules(supabase, brand.slug, 1)
      const scoped = applicableRules(allRules, requestedShots)
      const verdicts = (assessment.verdicts as RuleVerdict[]) ?? []
      const report = composeReport(scoped, verdicts, brand.hq_name)
      return Response.json({
        ok: true,
        mode: 'report',
        studio_name: studioName,
        brand: brandInfo,
        overall: assessment.overall,
        report,
      })
    }
  }

  // Still collecting (or assessed but report not yet ready) → shot list.
  const shots = brand.shots.filter((s) => requestedShots.includes(s.slot))
  return Response.json({ ok: true, mode: 'collect', studio_name: studioName, brand: brandInfo, shots, state: req.state })
}

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const log = pipelineLog('signage', token.slice(0, 8))
  const resolved = await resolveRequest(token)
  if (!resolved) return Response.json({ ok: false, error: 'invalid_or_expired' }, { status: 404 })
  const { req: request } = resolved

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return Response.json({ ok: false, error: 'bad_request' }, { status: 400 })
  }

  // Files are keyed by shot slot (e.g. formData 'storefront' → File[]),
  // using THIS request's brand shot list.
  const brand = await brandForRequest(request)
  const validSlots = new Set(shotSlots(brand.shots))
  type Pending = { slot: string; file: File }
  const pending: Pending[] = []
  for (const def of brand.shots) {
    const files = formData.getAll(def.slot).filter((v): v is File => v instanceof File)
    for (const f of files) pending.push({ slot: def.slot, file: f })
  }

  if (pending.length === 0) {
    return Response.json({ ok: false, error: 'no_photos' }, { status: 400 })
  }
  if (pending.length > MAX_FILES) {
    return Response.json({ ok: false, error: `max_${MAX_FILES}_photos` }, { status: 400 })
  }
  for (const p of pending) {
    if (p.file.size > MAX_SIZE) return Response.json({ ok: false, error: `${p.file.name}_over_5mb` }, { status: 400 })
    if (!ALLOWED_MIME.has(p.file.type)) return Response.json({ ok: false, error: `${p.file.name}_bad_type` }, { status: 400 })
    if (!validSlots.has(p.slot)) return Response.json({ ok: false, error: 'bad_shot' }, { status: 400 })
  }

  log.step(`signage upload: ${pending.length} photo(s)`, { request: request.id.slice(0, 8) })

  const rows: Array<{ request_id: string; studio_id: string; org_id: string; shot_slot: string; storage_path: string }> = []
  for (let i = 0; i < pending.length; i++) {
    const p = pending[i]
    const buf = new Uint8Array(await p.file.arrayBuffer())
    try {
      const { path } = await uploadIntakePhoto({
        callId: request.id, // storage-path partition key
        data: buf,
        contentType: p.file.type,
        index: i,
      })
      rows.push({
        request_id: request.id,
        studio_id: request.studio_id,
        org_id: request.org_id,
        shot_slot: p.slot,
        storage_path: path,
      })
    } catch (e) {
      log.err(`upload failed for photo ${i}`, e instanceof Error ? e.message : String(e))
      return Response.json({ ok: false, error: 'storage_write_failed' }, { status: 500 })
    }
  }

  const { error: insErr } = await supabase.from('signage_photo_submissions').insert(rows)
  if (insErr) {
    log.err('submissions insert failed', insErr.message)
    return Response.json({ ok: false, error: 'db_write_failed' }, { status: 500 })
  }

  await supabase
    .from('signage_requests')
    .update({ state: 'submitted', submitted_at: new Date().toISOString() })
    .eq('id', request.id)

  // Score in the background so the franchisee gets a fast response; the
  // report page polls until the assessment lands.
  after(async () => {
    try {
      const result = await runAssessment(supabase, request.id)
      log.ok('signage assessment done', result.ok ? { overall: result.overall } : { error: result.error })
    } catch (e) {
      log.err('signage assessment threw', e instanceof Error ? e.message : String(e))
    }
  })

  return Response.json({ ok: true, count: rows.length })
}
