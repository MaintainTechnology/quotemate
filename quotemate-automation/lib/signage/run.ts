// ════════════════════════════════════════════════════════════════════
// Signage Compliance — server-side assessment runner (I/O).
//
// Ties the pure modules to the DB + storage + Claude vision:
//   load active rules → download each submitted photo → assessPhoto per
//   shot → validateSignageAssessment backstop → persist signage_assessments
//   + advance the request.
//
// NEVER throws to the caller — returns a tagged result. A vision/storage
// failure degrades to all-cannot_determine (→ hq_review), never a false
// pass/fail (the same safety posture as the roofing flow).
// ════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js'
import type { RuleVerdict, SignageRule, ShotSlot } from './types'
import { coerceShots, shotLabel } from './shots'
import { brandForOrg, loadBrand } from './brand'
import { assessPhoto } from './vision-assess'
import { validateSignageAssessment } from './validate-verdicts'
import {
  observedFromEvidence,
  runKbSupplement,
  supplementOverall,
  type KbConcern,
  type KbSupplementResult,
} from './kb-supplement'
import { loadKbConfigFromEnv } from '../admin-loader/mt-filestore-kb'

const BUCKET = 'intake-photos'

/** Gemini file-search SUPPLEMENT is opt-in: it only runs when this flag is
 *  set, which also gates writing the `signage_assessments.kb_supplement`
 *  column — so the running system is unaffected until migration 094 is
 *  applied and the flag is turned on. */
function kbSupplementEnabled(): boolean {
  return process.env.SIGNAGE_KB_SUPPLEMENT === '1'
}

/** Map a signage_rules DB row to the typed SignageRule. */
export function mapRuleRow(row: Record<string, unknown>): SignageRule {
  return {
    rule_key: String(row.rule_key ?? ''),
    rule_text: String(row.rule_text ?? ''),
    rule_group: String(row.rule_group ?? 'other'),
    modality: (row.modality as SignageRule['modality']) ?? 'must',
    applicability: (row.applicability as SignageRule['applicability']) ?? 'human_review_only',
    confidence: (row.confidence as SignageRule['confidence']) ?? 'low',
    mvp_tier: (row.mvp_tier as SignageRule['mvp_tier']) ?? 'human_queue',
    verdict_mode: (row.verdict_mode as SignageRule['verdict_mode']) ?? 'review',
    required_shots: coerceShots(row.required_shots),
    check_hint: (row.check_hint as string | null) ?? null,
    source_citation: (row.source_citation as string | null) ?? null,
  }
}

export async function loadActiveRules(
  supabase: SupabaseClient,
  brandSlug = 'f45',
  ruleSetVersion = 1,
): Promise<SignageRule[]> {
  const { data } = await supabase
    .from('signage_rules')
    .select(
      'rule_key, rule_text, rule_group, modality, applicability, confidence, mvp_tier, verdict_mode, required_shots, check_hint, source_citation',
    )
    .eq('brand_slug', brandSlug)
    .eq('rule_set_version', ruleSetVersion)
    .eq('active', true)
  return (data ?? []).map((r) => mapRuleRow(r as Record<string, unknown>))
}

/** Rules in scope for a request = those whose required_shots intersect the
 *  shots we actually asked the studio for. */
export function applicableRules(rules: SignageRule[], requestedShots: ShotSlot[]): SignageRule[] {
  const want = new Set(requestedShots)
  return rules.filter((r) => r.required_shots.some((s) => want.has(s)))
}

async function downloadBase64(
  supabase: SupabaseClient,
  path: string,
): Promise<{ base64: string; mime: string } | null> {
  try {
    const { data, error } = await supabase.storage.from(BUCKET).download(path)
    if (error || !data) return null
    const buf = Buffer.from(await data.arrayBuffer())
    const mime = data.type && data.type.startsWith('image/') ? data.type : extToMime(path)
    return { base64: buf.toString('base64'), mime }
  } catch {
    return null
  }
}

function extToMime(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase()
  if (ext === 'png') return 'image/png'
  if (ext === 'webp') return 'image/webp'
  return 'image/jpeg'
}

export type RunResult =
  | { ok: true; assessmentId: string; overall: 'pass' | 'fix_needed' | 'needs_review'; counts: { compliant: number; fix: number; review: number } }
  | { ok: false; error: string }

/**
 * Score one submitted request and persist the assessment. Idempotent on
 * signage_assessments (unique on request_id) — safe to re-run.
 */
export async function runAssessment(
  supabase: SupabaseClient,
  requestId: string,
): Promise<RunResult> {
  // 1. Load the request.
  const { data: reqRow, error: reqErr } = await supabase
    .from('signage_requests')
    .select('id, studio_id, org_id, required_shots, submitted_at, sweep_id, brand_slug')
    .eq('id', requestId)
    .maybeSingle()
  if (reqErr || !reqRow) return { ok: false, error: 'request_not_found' }

  const requestedShots = coerceShots(reqRow.required_shots)

  // 2. Resolve rule_set_version from the sweep (fallback v1).
  let ruleSetVersion = 1
  if (reqRow.sweep_id) {
    const { data: sweep } = await supabase
      .from('signage_sweeps')
      .select('rule_set_version')
      .eq('id', reqRow.sweep_id)
      .maybeSingle()
    if (sweep?.rule_set_version) ruleSetVersion = sweep.rule_set_version as number
  }

  // 3. Resolve the brand from the REQUEST (set at sweep creation) so the
  //    assessment scores against the right brand's rules + shots and queries
  //    the right brand's Gemini file store — never the org's default. Fall
  //    back to the org's brand for legacy rows with no brand_slug.
  const reqBrandSlug = (reqRow.brand_slug as string | null)?.trim()
  const brand = reqBrandSlug
    ? await loadBrand(supabase, reqBrandSlug)
    : await brandForOrg(supabase, reqRow.org_id as string)
  const [{ data: subs }, allRules] = await Promise.all([
    supabase
      .from('signage_photo_submissions')
      .select('shot_slot, storage_path')
      .eq('request_id', requestId),
    loadActiveRules(supabase, brand.slug, ruleSetVersion),
  ])

  const scoped = applicableRules(allRules, requestedShots)

  // 4. Assess each submitted photo against the scoped rules, framed for
  //    this brand (persona + the brand's label for the shot). Keep each
  //    shot's evidence so the KB supplement can describe the observed scene.
  const modelVerdicts: RuleVerdict[] = []
  const evidenceByShot = new Map<ShotSlot, string[]>()
  for (const s of subs ?? []) {
    const slot = s.shot_slot as ShotSlot
    const photo = await downloadBase64(supabase, s.storage_path as string)
    if (!photo) continue // missing photo → its rules stay cannot_determine via backstop
    const verdicts = await assessPhoto({
      photo,
      shotSlot: slot,
      rules: scoped,
      persona: brand.vision_persona,
      shotLabel: shotLabel(slot, brand.shots),
    })
    modelVerdicts.push(...verdicts)
    const ev = evidenceByShot.get(slot) ?? []
    ev.push(...verdicts.map((v) => v.evidence).filter((e): e is string => !!e && e.trim() !== ''))
    evidenceByShot.set(slot, ev)
  }

  // 5. Grounding backstop over the full scoped rule set.
  const { verdicts, overall, counts } = validateSignageAssessment(scoped, modelVerdicts)

  // 5b. Brand-scoped Gemini file-search SUPPLEMENT (opt-in). Queries the
  //     brand's store(s) for the guideline wording behind each shot and may
  //     only RAISE caution — flipping an otherwise-clean pass to needs_review.
  //     Supabase verdicts stay authoritative. Best-effort: never throws.
  let finalOverall = overall
  let kbSupplement: KbSupplementResult | null = null
  let kbConcerns: KbConcern[] = []
  if (kbSupplementEnabled()) {
    try {
      const kbConfig = loadKbConfigFromEnv()
      const submittedSlots = Array.from(new Set((subs ?? []).map((s) => s.shot_slot as ShotSlot)))
      const shotsForKb = submittedSlots.map((slot) => ({
        slot,
        label: shotLabel(slot, brand.shots),
        observed: observedFromEvidence(evidenceByShot.get(slot) ?? []),
      }))
      kbSupplement = await runKbSupplement(kbConfig, { brand, shots: shotsForKb, scopedRules: scoped })
      const merged = supplementOverall(overall, kbSupplement)
      finalOverall = merged.overall
      kbConcerns = merged.concerns
    } catch {
      // KB config missing / network down — leave the Supabase verdict as-is.
    }
  }

  // 6. Persist the assessment (upsert on request_id) + advance the request.
  const status = finalOverall === 'pass' ? 'report_ready' : 'hq_review'
  const payload: Record<string, unknown> = {
    request_id: requestId,
    studio_id: reqRow.studio_id,
    org_id: reqRow.org_id,
    brand_slug: brand.slug,
    rule_set_version: ruleSetVersion,
    status,
    overall: finalOverall,
    verdicts,
    counts,
    updated_at: new Date().toISOString(),
  }
  // Only reference the kb_supplement column when the flag is on (i.e.
  // migration 094 has been applied) so older DBs never see an unknown column.
  if (kbSupplement) {
    payload.kb_supplement = { stores: kbSupplement.stores, shots: kbSupplement.shots, concerns: kbConcerns }
  }
  const { data: saved, error: saveErr } = await supabase
    .from('signage_assessments')
    .upsert(payload, { onConflict: 'request_id' })
    .select('id')
    .single()

  if (saveErr || !saved) return { ok: false, error: saveErr?.message ?? 'save_failed' }

  await supabase
    .from('signage_requests')
    .update({
      state: 'assessed',
      submitted_at: reqRow.submitted_at ?? new Date().toISOString(),
    })
    .eq('id', requestId)

  return { ok: true, assessmentId: saved.id as string, overall: finalOverall, counts }
}
