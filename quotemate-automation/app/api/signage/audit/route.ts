// POST /api/signage/audit — instant ad-hoc audit. HQ uploads photos
// (keyed by shot slot) and gets a compliance report back inline, scored
// against the org's brand rules. No sweep/studio ceremony; nothing is
// persisted (it's a quick check) — use a sweep for the tracked flow.

import { createClient } from '@supabase/supabase-js'
import { orgFromBearer } from '@/lib/signage/org'
import { resolveSignageBrand } from '@/lib/signage/brand'
import { shotLabel, shotSlots } from '@/lib/signage/shots'
import { loadActiveRules, applicableRules } from '@/lib/signage/run'
import { assessPhoto } from '@/lib/signage/vision-assess'
import { validateSignageAssessment } from '@/lib/signage/validate-verdicts'
import { composeReport } from '@/lib/signage/compose-report'
import { runKbStage, type KbStageResult } from '@/lib/signage/kb-assess'
import { mergeRuleVerdicts } from '@/lib/signage/merge'
import { loadKbConfigFromEnv } from '@/lib/admin-loader/mt-filestore-kb'
import type { ShotSlot } from '@/lib/signage/types'

/** Step-2 brand file-store cross-check runs by default; kill-switch with
 *  SIGNAGE_TWO_STAGE=0 (mirrors lib/signage/run.ts). */
function twoStageEnabled(): boolean {
  return process.env.SIGNAGE_TWO_STAGE !== '0'
}

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const MAX_FILES = 12
const MAX_SIZE = 5 * 1024 * 1024
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function POST(req: Request) {
  const ctx = await orgFromBearer(supabase, req)
  if (!ctx) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  const { brand } = await resolveSignageBrand(supabase, req, ctx.orgId)
  const validSlots = new Set(shotSlots(brand.shots))

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return Response.json({ ok: false, error: 'bad_request' }, { status: 400 })
  }

  const pending: Array<{ slot: string; file: File }> = []
  for (const def of brand.shots) {
    for (const f of formData.getAll(def.slot)) if (f instanceof File) pending.push({ slot: def.slot, file: f })
  }
  if (pending.length === 0) return Response.json({ ok: false, error: 'no_photos' }, { status: 400 })
  if (pending.length > MAX_FILES) return Response.json({ ok: false, error: `max_${MAX_FILES}_photos` }, { status: 400 })
  for (const p of pending) {
    if (p.file.size > MAX_SIZE) return Response.json({ ok: false, error: `${p.file.name}_over_5mb` }, { status: 400 })
    if (!ALLOWED_MIME.has(p.file.type)) return Response.json({ ok: false, error: `${p.file.name}_bad_type` }, { status: 400 })
    if (!validSlots.has(p.slot)) return Response.json({ ok: false, error: 'bad_shot' }, { status: 400 })
  }

  const submittedShots = Array.from(new Set(pending.map((p) => p.slot)))
  const allRules = await loadActiveRules(supabase, brand.slug, 1)
  const scoped = applicableRules(allRules, submittedShots)

  // Read all photos into memory (no storage for an instant audit); keep one
  // representative photo per shot for the Step-2 re-look.
  const photos = await Promise.all(
    pending.map(async (p) => ({
      slot: p.slot,
      photo: { base64: Buffer.from(await p.file.arrayBuffer()).toString('base64'), mime: p.file.type },
    })),
  )
  const photoByShot = new Map<ShotSlot, { base64: string; mime: string }>()
  for (const { slot, photo } of photos) if (!photoByShot.has(slot)) photoByShot.set(slot, photo)
  const shotsForKb = Array.from(photoByShot, ([slot, photo]) => ({
    slot,
    label: shotLabel(slot, brand.shots),
    photo,
  }))

  // Step 1 (vision vs DB rules) ∥ Step 2 (brand file-store cross-check) run
  // concurrently; each is internally chunked + bounded by the vision limiter.
  const step2Promise: Promise<KbStageResult | null> = (async () => {
    if (!twoStageEnabled()) return null
    try {
      const kbConfig = loadKbConfigFromEnv()
      return await runKbStage(kbConfig, { brand, shots: shotsForKb, scopedRules: scoped })
    } catch {
      return null
    }
  })()
  const [modelVerdicts, stage] = await Promise.all([
    Promise.all(
      photos.map((p) =>
        assessPhoto({
          photo: p.photo,
          shotSlot: p.slot,
          rules: scoped,
          persona: brand.vision_persona,
          shotLabel: shotLabel(p.slot, brand.shots),
        }),
      ),
    ).then((r) => r.flat()),
    step2Promise,
  ])

  const step1 = validateSignageAssessment(scoped, modelVerdicts)
  const merged = mergeRuleVerdicts(scoped, step1.verdicts, stage?.kbVerdicts ?? [], stage?.advisory ?? [])
  const kb = stage && stage.stores.length > 0 ? { stores: stage.stores, kb_degraded: stage.degraded } : undefined

  const report = composeReport(scoped, merged.verdicts, brand.hq_name, {
    provenance: merged.provenance,
    advisory: merged.advisory,
  })

  return Response.json({
    ok: true,
    brand: { name: brand.name, hq_name: brand.hq_name },
    overall: merged.overall,
    counts: merged.counts,
    report,
    ...(kb ? { kb } : {}),
  })
}
