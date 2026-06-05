// POST /api/signage/ingest — upload a brand's standards PDF; the AI
// deciphers it into a guided shot list + a verdict_mode-tagged rule set.
//
// Dry-run by default (returns what it found for review). Add ?apply=1 to
// save the shots + rules to the org's brand. HQ-authed.

import { createClient } from '@supabase/supabase-js'
import { orgFromBearer } from '@/lib/signage/org'
import { resolveSignageBrand } from '@/lib/signage/brand'
import { extractBrand } from '@/lib/signage/extract-brand'
import type { VerdictMode } from '@/lib/signage/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const MAX_PDF = 60 * 1024 * 1024 // 60MB

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const MODE_TO_LEGACY: Record<VerdictMode, { applicability: string; mvp_tier: string }> = {
  pass_fail: { applicability: 'auto_vision', mvp_tier: 'mvp_core' },
  detect_only: { applicability: 'needs_metadata_or_context', mvp_tier: 'human_queue_metadata' },
  needs_reference: { applicability: 'needs_scale_reference', mvp_tier: 'phase2_measure' },
  review: { applicability: 'human_review_only', mvp_tier: 'human_queue' },
}

export async function POST(req: Request) {
  const ctx = await orgFromBearer(supabase, req)
  if (!ctx) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  const { brand } = await resolveSignageBrand(supabase, req, ctx.orgId)
  const apply = new URL(req.url).searchParams.get('apply') === '1'

  // Two ingress paths:
  //  • JSON { text } — the browser extracted the PDF text and sends only
  //    that (~30KB), so a 58MB PDF never hits the platform's ~4.5MB request
  //    body limit. This is the path the audit page uses.
  //  • multipart PDF — for small docs / programmatic callers; parsed here.
  const contentType = req.headers.get('content-type') ?? ''
  let docText = ''
  if (contentType.includes('application/json')) {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 })
    }
    docText = typeof (body as { text?: unknown })?.text === 'string' ? ((body as { text: string }).text) : ''
  } else {
    let formData: FormData
    try {
      formData = await req.formData()
    } catch {
      return Response.json({ ok: false, error: 'bad_request' }, { status: 400 })
    }
    const file = formData.get('pdf')
    if (!(file instanceof File)) return Response.json({ ok: false, error: 'no_pdf' }, { status: 400 })
    if (file.type !== 'application/pdf') return Response.json({ ok: false, error: 'not_a_pdf' }, { status: 400 })
    if (file.size > MAX_PDF) return Response.json({ ok: false, error: 'pdf_too_large' }, { status: 400 })
    try {
      const { extractText, getDocumentProxy } = await import('unpdf')
      const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()))
      const res = await extractText(pdf, { mergePages: true })
      docText = Array.isArray(res.text) ? res.text.join('\n') : (res.text as string)
    } catch (e) {
      return Response.json(
        { ok: false, error: 'pdf_parse_failed', detail: e instanceof Error ? e.message : String(e) },
        { status: 200 },
      )
    }
  }

  if (docText.trim().length < 200) {
    return Response.json({ ok: false, error: 'no_text_extracted', detail: 'The PDF has little/no extractable text (scanned image?).' }, { status: 200 })
  }

  // 2. AI deciphers the rules.
  const { shots, rules } = await extractBrand({
    brandName: brand.name,
    locationNoun: brand.location_noun,
    docText,
  })
  if (rules.length === 0) {
    return Response.json({ ok: false, error: 'no_rules_extracted' }, { status: 200 })
  }

  const scored = rules.filter((r) => r.verdict_mode === 'pass_fail' || r.verdict_mode === 'detect_only').length
  const tiers: Record<string, number> = {}
  for (const r of rules) tiers[r.verdict_mode] = (tiers[r.verdict_mode] ?? 0) + 1

  if (!apply) {
    return Response.json({ ok: true, applied: false, brand: brand.name, chars: docText.length, scored, tiers, shots, rules })
  }

  // 3. Apply — merge shots into the brand (union by slot) + upsert rules.
  const existingSlots = new Set(brand.shots.map((s) => s.slot))
  const mergedShots = [...brand.shots, ...shots.filter((s) => !existingSlots.has(s.slot))]
  const { error: brandErr } = await supabase.from('brands').update({ shots: mergedShots }).eq('slug', brand.slug)
  if (brandErr) return Response.json({ ok: false, error: brandErr.message }, { status: 500 })

  const rows = rules.map((r) => ({
    brand_slug: brand.slug,
    rule_set_version: 1,
    rule_key: r.rule_key,
    rule_text: r.rule_text,
    rule_group: r.rule_group,
    modality: r.modality,
    applicability: MODE_TO_LEGACY[r.verdict_mode].applicability,
    confidence: r.confidence,
    mvp_tier: MODE_TO_LEGACY[r.verdict_mode].mvp_tier,
    verdict_mode: r.verdict_mode,
    required_shots: r.shot === 'na' ? [] : [r.shot],
    check_hint: r.check_hint,
    source_citation: r.source_citation,
    active: true,
  }))
  const { error: rulesErr } = await supabase
    .from('signage_rules')
    .upsert(rows, { onConflict: 'brand_slug,rule_set_version,rule_key' })
  if (rulesErr) return Response.json({ ok: false, error: rulesErr.message }, { status: 500 })

  return Response.json({ ok: true, applied: true, brand: brand.name, chars: docText.length, scored, tiers, shots: mergedShots, rules })
}
