// ════════════════════════════════════════════════════════════════════
// AI sample-gallery generation — 3 coherent Gemini renders showing the
// same fictional scene in three views (wide / detail / in-use).
//
// Strategy (vs the earlier "3 parallel independent calls" version):
//   1. Generate WIDE first as text-to-image. This anchor establishes the
//      room — wall colour, furniture, ceiling, camera angle, fitting
//      placement.
//   2. Pass the wide-shot image bytes as a reference to BOTH the DETAIL
//      and the IN-USE prompts. They share the wide as visual context so
//      all three images feel like they're set in the same room.
//   3. Detail + Lit run in parallel after wide finishes — total wall
//      time ≈ 2× single-call latency (rather than 3× for fully sequential).
//
// Partial success allowed:
//   - wide fails → status='failed' (no anchor → can't render the others)
//   - wide succeeds, detail or lit fails → status='partial', render survivors
// ════════════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js'
import { buildSamplePrompts, type PromptIntake } from './prompts'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const BUCKET = 'intake-photos'

// Default: gemini-2.5-flash-image (GA, stable). Override via env to
// gemini-3.1-flash-image-preview (newer) or gemini-3-pro-image-preview
// (higher quality). See lib/preview/generate.ts for the full list.
const GEMINI_MODEL = process.env.GEMINI_IMAGE_MODEL ?? 'gemini-2.5-flash-image'

const GEMINI_ENDPOINT = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`

export type SamplesStatus = 'idle' | 'generating' | 'ready' | 'partial' | 'failed'

export type SamplesResult =
  | { status: 'ready'; paths: string[] }
  | { status: 'partial'; paths: string[]; failures: number }
  | { status: 'failed'; error: string }
  | { status: 'skipped'; reason: string }

/**
 * Atomically claim and generate a coherent set of 3 sample images
 * (wide / detail / in-use) for the given quote. All three share the
 * same fictional scene via the wide-shot reference chain.
 *
 * Idempotent — only one process generates per quote.
 *
 * Skips when:
 *   - GEMINI_API_KEY not set
 *   - DISABLE_AI_SAMPLES env truthy (cost kill switch)
 *   - quote needs_inspection=true
 *   - claim race lost (another worker holds it)
 *   - job_type has no SamplePromptSet
 */
export async function generateSampleImages(quoteId: string): Promise<SamplesResult> {
  if (!process.env.GEMINI_API_KEY) {
    console.warn('[samples] GEMINI_API_KEY not set — skipping')
    return { status: 'skipped', reason: 'GEMINI_API_KEY missing' }
  }
  if (process.env.DISABLE_AI_SAMPLES) {
    return { status: 'skipped', reason: 'DISABLE_AI_SAMPLES env set' }
  }

  const { data: quote } = await supabase
    .from('quotes')
    .select('id, intake_id, needs_inspection, samples_status')
    .eq('id', quoteId)
    .maybeSingle()

  if (!quote) return { status: 'skipped', reason: 'quote not found' }
  if (quote.needs_inspection) return { status: 'skipped', reason: 'inspection-only quote' }
  if (quote.samples_status === 'ready' || quote.samples_status === 'generating') {
    return { status: 'skipped', reason: `already ${quote.samples_status}` }
  }

  // Atomic claim
  const { data: locked } = await supabase
    .from('quotes')
    .update({
      samples_status: 'generating',
      samples_generated_at: new Date().toISOString(),
      samples_error: null,
    })
    .eq('id', quoteId)
    .in('samples_status', ['idle', 'failed', 'partial'])
    .select('id, intake_id')
    .maybeSingle()

  if (!locked) {
    return { status: 'skipped', reason: 'claim race lost' }
  }

  console.log('[samples] generation start', { quoteId, intakeId: locked.intake_id })

  try {
    const { data: intake } = await supabase
      .from('intakes')
      .select('id, job_type, scope, access, caller')
      .eq('id', locked.intake_id)
      .maybeSingle()
    if (!intake) throw new Error('intake row not found')

    const prompts = buildSamplePrompts(intake as PromptIntake)
    if (!prompts) {
      await supabase.from('quotes')
        .update({ samples_status: 'failed', samples_error: 'no sample prompts for this job_type' })
        .eq('id', quoteId)
      return { status: 'skipped', reason: 'no sample prompts for job_type' }
    }

    const t0 = Date.now()
    const succeededPaths: string[] = []
    const failureReasons: string[] = []

    // ─── STEP 1: generate WIDE (anchor, text-to-image) ───
    let wideBytes: Buffer | null = null
    let wideMime: string | null = null
    try {
      const wideResult = await generateOneSample({
        intakeId: intake.id as string,
        prompt: prompts.wide,
        label: 'wide',
        referenceImage: null, // text-to-image
      })
      succeededPaths.push(wideResult.path)
      wideBytes = wideResult.imageBytes
      wideMime = wideResult.mimeType
      console.log('[samples] wide ok', { path: wideResult.path, bytes: wideResult.imageBytes.length })
    } catch (e: any) {
      const reason = e?.message ?? String(e)
      failureReasons.push(`wide: ${reason}`)
      console.error('[samples] wide FAILED — anchoring lost, cannot run detail/lit', { quoteId, error: reason })
      await supabase.from('quotes').update({
        sample_image_paths: [],
        samples_status: 'failed',
        samples_error: failureReasons.join(' | ').slice(0, 500),
        samples_generated_at: new Date().toISOString(),
      }).eq('id', quoteId)
      return { status: 'failed', error: reason }
    }

    // ─── STEP 2: detail + lit in parallel, both referencing wide ───
    const wideRef = { mimeType: wideMime!, base64: wideBytes!.toString('base64') }
    const followUp = await Promise.allSettled([
      generateOneSample({
        intakeId: intake.id as string,
        prompt: prompts.detail,
        label: 'detail',
        referenceImage: wideRef,
      }),
      generateOneSample({
        intakeId: intake.id as string,
        prompt: prompts.lit,
        label: 'lit',
        referenceImage: wideRef,
      }),
    ])

    const labels = ['detail', 'lit'] as const
    followUp.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        succeededPaths.push(r.value.path)
        console.log(`[samples] ${labels[i]} ok`, { path: r.value.path })
      } else {
        const reason = r.reason?.message ?? String(r.reason)
        failureReasons.push(`${labels[i]}: ${reason}`)
        console.error(`[samples] ${labels[i]} failed`, { quoteId, error: reason })
      }
    })

    const elapsedMs = Date.now() - t0
    console.log('[samples] generation finished', {
      quoteId,
      elapsedMs,
      succeeded: succeededPaths.length,
      failed: failureReasons.length,
    })

    // ─── STEP 3: persist final state ───
    let finalStatus: SamplesStatus
    if (succeededPaths.length === 3) finalStatus = 'ready'
    else if (succeededPaths.length > 0) finalStatus = 'partial'
    else finalStatus = 'failed'

    await supabase.from('quotes').update({
      sample_image_paths: succeededPaths,
      samples_status: finalStatus,
      samples_error: failureReasons.length > 0 ? failureReasons.join(' | ').slice(0, 500) : null,
      samples_generated_at: new Date().toISOString(),
    }).eq('id', quoteId)

    if (finalStatus === 'failed') return { status: 'failed', error: failureReasons.join(' | ') }
    if (finalStatus === 'partial') return { status: 'partial', paths: succeededPaths, failures: failureReasons.length }
    return { status: 'ready', paths: succeededPaths }
  } catch (err: any) {
    const msg = err?.message ?? String(err)
    console.error('[samples] generation FAILED (unhandled)', { quoteId, error: msg })
    await supabase.from('quotes').update({
      samples_status: 'failed',
      samples_error: msg.slice(0, 500),
    }).eq('id', quoteId)
    return { status: 'failed', error: msg }
  }
}

/**
 * Generate one sample image. Returns the storage path + raw bytes
 * + mime type so the caller can re-use the image as a reference for
 * subsequent calls (the wide → detail/lit chain).
 *
 * Throws on failure — the orchestrator decides which failures are
 * fatal vs partial.
 */
async function generateOneSample(opts: {
  intakeId: string
  prompt: string
  label: 'wide' | 'detail' | 'lit'
  referenceImage: { mimeType: string; base64: string } | null
}): Promise<{ path: string; imageBytes: Buffer; mimeType: string }> {
  const apiUrl = `${GEMINI_ENDPOINT(GEMINI_MODEL)}?key=${encodeURIComponent(process.env.GEMINI_API_KEY!)}`

  // Build content parts: text prompt always first, optional reference
  // image second. Gemini reads parts in order, and putting the prompt
  // first orients the model before it processes the reference.
  const parts: Array<Record<string, unknown>> = [{ text: opts.prompt }]
  if (opts.referenceImage) {
    parts.push({
      inline_data: {
        mime_type: opts.referenceImage.mimeType,
        data: opts.referenceImage.base64,
      },
    })
  }

  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generation_config: {
        // Lower temperature → more deterministic, less "creative"
        // variation between runs. We want the model to follow the spec
        // tightly (count, colours, fitting style) rather than improvise.
        temperature: 0.2,
        response_modalities: ['IMAGE'],
      },
    }),
  })

  if (!res.ok) {
    const errText = (await res.text()).slice(0, 300)
    throw new Error(`Gemini HTTP ${res.status}: ${errText}`)
  }

  const data = await res.json() as GeminiResponse
  const responseParts = data.candidates?.[0]?.content?.parts ?? []
  const imagePart = responseParts.find(p => p.inline_data?.data || p.inlineData?.data)
  const inline = imagePart?.inline_data ?? imagePart?.inlineData
  if (!inline?.data) {
    const textRefusal = responseParts.find(p => p.text)?.text
    throw new Error(`no image data${textRefusal ? ` — ${textRefusal.slice(0, 150)}` : ''}`)
  }

  const outMime = inline.mime_type ?? inline.mimeType ?? 'image/png'
  const outExt = outMime === 'image/jpeg' ? 'jpg' : 'png'
  const imageBytes = Buffer.from(inline.data, 'base64')

  const samplePath = `${opts.intakeId}/sample-${opts.label}-${Date.now()}.${outExt}`
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(samplePath, imageBytes, { contentType: outMime, upsert: false })
  if (upErr) throw new Error(`storage upload failed: ${upErr.message}`)

  return { path: samplePath, imageBytes, mimeType: outMime }
}

type GeminiInline = {
  inline_data?: { mime_type?: string; mimeType?: string; data: string }
  inlineData?: { mime_type?: string; mimeType?: string; data: string }
  text?: string
}
type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: GeminiInline[] }
  }>
  error?: { message?: string; code?: number }
}
