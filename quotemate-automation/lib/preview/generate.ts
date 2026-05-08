// ════════════════════════════════════════════════════════════════════
// AI preview generation — Gemini 2.5 Flash Image edits the customer's
// uploaded photos to show the proposed work installed.
//
// IMPORTANT: each customer photo gets its OWN edited preview. Two
// uploaded photos → two AI previews. Three uploaded photos → three.
// All paths are stored in quotes.preview_image_paths (text[]).
//
// For backwards compat the legacy quotes.preview_image_path (singular)
// also gets set to the FIRST generated path. Readers prefer the array
// and fall back to the singular when the array is empty.
//
// Atomicity: only one generation per quote runs at a time. The status
// flip from idle/no_photos/failed → generating is a CAS update.
// ════════════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js'
import { buildPreviewPrompt, type PromptIntake, type SystemUserPrompt } from './prompts'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const BUCKET = 'intake-photos'

// Default: gemini-2.5-flash-image (GA, stable). Override via env to
// gemini-3.1-flash-image-preview / gemini-3-pro-image-preview /
// nano-banana-pro-preview.
const GEMINI_MODEL = process.env.GEMINI_IMAGE_MODEL ?? 'gemini-2.5-flash-image'

const GEMINI_ENDPOINT = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`

export type PreviewStatus = 'idle' | 'no_photos' | 'generating' | 'ready' | 'failed' | 'partial'

export type PreviewResult =
  | { status: 'ready'; paths: string[] }
  | { status: 'partial'; paths: string[]; failures: number }
  | { status: 'no_photos' }
  | { status: 'failed'; error: string }
  | { status: 'skipped'; reason: string }

/**
 * Atomically claim and generate one preview per uploaded customer photo.
 * Idempotent. Safe to call from any of the triggers — only one generation
 * runs at a time per quote.
 */
export async function generatePreviewImage(quoteId: string): Promise<PreviewResult> {
  if (!process.env.GEMINI_API_KEY) {
    console.warn('[preview] GEMINI_API_KEY not set — skipping')
    return { status: 'skipped', reason: 'GEMINI_API_KEY missing' }
  }

  const { data: quote } = await supabase
    .from('quotes')
    .select('id, intake_id, needs_inspection, preview_status')
    .eq('id', quoteId)
    .maybeSingle()

  if (!quote) return { status: 'skipped', reason: 'quote not found' }
  if (quote.needs_inspection) return { status: 'skipped', reason: 'inspection-only quote' }
  if (quote.preview_status === 'ready' || quote.preview_status === 'generating') {
    return { status: 'skipped', reason: `already ${quote.preview_status}` }
  }

  // Atomic claim
  const { data: locked } = await supabase
    .from('quotes')
    .update({
      preview_status: 'generating',
      preview_generated_at: new Date().toISOString(),
      preview_error: null,
    })
    .eq('id', quoteId)
    .in('preview_status', ['idle', 'no_photos', 'failed', 'partial'])
    .select('id, intake_id')
    .maybeSingle()

  if (!locked) {
    return { status: 'skipped', reason: 'claim race lost' }
  }

  console.log('[preview] generation start', { quoteId, intakeId: locked.intake_id })

  try {
    const { data: intake } = await supabase
      .from('intakes')
      .select('id, job_type, scope, access, caller, photo_paths')
      .eq('id', locked.intake_id)
      .maybeSingle()

    if (!intake) throw new Error('intake row not found')

    const photoPaths = (Array.isArray(intake.photo_paths) ? intake.photo_paths : []) as string[]

    if (photoPaths.length === 0) {
      await supabase
        .from('quotes')
        .update({ preview_status: 'no_photos', preview_error: null })
        .eq('id', quoteId)
      return { status: 'no_photos' }
    }

    const prompt = buildPreviewPrompt(intake as PromptIntake)
    const t0 = Date.now()
    const promptText = `[system]\n${prompt.system}\n\n[user]\n${prompt.user}`

    // Generate ONE preview per uploaded customer photo, in parallel.
    // Each gets its own Gemini call with that specific photo as the
    // reference. Result: N customer photos → N edited previews, all
    // visually consistent (same room from N angles).
    const results = await Promise.allSettled(
      photoPaths.map((path, i) => generateOnePreview({
        intakeId: intake.id as string,
        sourcePath: path,
        index: i,
        prompt,
      }))
    )

    const succeededPaths: string[] = []
    const failureReasons: string[] = []
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        succeededPaths.push(r.value)
      } else {
        const reason = r.reason?.message ?? String(r.reason)
        failureReasons.push(`photo-${i}: ${reason}`)
      }
    })

    const elapsedMs = Date.now() - t0
    console.log('[preview] generation finished', {
      quoteId,
      elapsedMs,
      photoCount: photoPaths.length,
      succeeded: succeededPaths.length,
      failed: failureReasons.length,
    })

    let finalStatus: PreviewStatus
    if (succeededPaths.length === photoPaths.length) finalStatus = 'ready'
    else if (succeededPaths.length > 0) finalStatus = 'partial'
    else finalStatus = 'failed'

    await supabase.from('quotes').update({
      // New plural column — primary read source.
      preview_image_paths: succeededPaths,
      // Legacy singular column — keep in sync for any old reader.
      preview_image_path: succeededPaths[0] ?? null,
      preview_status: finalStatus,
      preview_prompt: promptText,
      preview_error: failureReasons.length > 0 ? failureReasons.join(' | ').slice(0, 500) : null,
      preview_generated_at: new Date().toISOString(),
    }).eq('id', quoteId)

    if (finalStatus === 'failed') return { status: 'failed', error: failureReasons.join(' | ') }
    if (finalStatus === 'partial') return { status: 'partial', paths: succeededPaths, failures: failureReasons.length }
    return { status: 'ready', paths: succeededPaths }
  } catch (err: any) {
    const msg = err?.message ?? String(err)
    console.error('[preview] generation FAILED (unhandled)', { quoteId, error: msg })
    await supabase.from('quotes').update({
      preview_status: 'failed',
      preview_error: msg.slice(0, 500),
    }).eq('id', quoteId)
    return { status: 'failed', error: msg }
  }
}

async function generateOnePreview(opts: {
  intakeId: string
  sourcePath: string
  index: number
  prompt: SystemUserPrompt
}): Promise<string> {
  // Download the source photo from storage.
  const { data: blob, error: dlErr } = await supabase.storage
    .from(BUCKET)
    .download(opts.sourcePath)
  if (dlErr || !blob) throw new Error(`could not download reference photo (${opts.sourcePath}): ${dlErr?.message ?? 'no blob'}`)
  const refBuf = Buffer.from(await blob.arrayBuffer())
  const refBase64 = refBuf.toString('base64')
  const refMime = blob.type || 'image/jpeg'

  // Call Gemini.
  const apiUrl = `${GEMINI_ENDPOINT(GEMINI_MODEL)}?key=${encodeURIComponent(process.env.GEMINI_API_KEY!)}`
  const t0 = Date.now()
  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      // Authoritative rules — sent in systemInstruction so Gemini treats
      // them as command-style instructions, not mixed in with the brief.
      systemInstruction: {
        parts: [{ text: opts.prompt.system }],
      },
      contents: [
        {
          role: 'user',
          parts: [
            { text: opts.prompt.user },
            { inline_data: { mime_type: refMime, data: refBase64 } },
          ],
        },
      ],
      generation_config: {
        // Low temperature — follow the JOB BRIEF tightly, no improv.
        temperature: 0.1,
        response_modalities: ['IMAGE'],
      },
    }),
  })
  const elapsedMs = Date.now() - t0

  if (!res.ok) {
    const errText = (await res.text()).slice(0, 500)
    throw new Error(`Gemini HTTP ${res.status} after ${elapsedMs}ms: ${errText}`)
  }

  const data = await res.json() as GeminiResponse
  const parts = data.candidates?.[0]?.content?.parts ?? []
  const imagePart = parts.find(p => p.inline_data?.data || p.inlineData?.data)
  const inline = imagePart?.inline_data ?? imagePart?.inlineData
  if (!inline?.data) {
    const textRefusal = parts.find(p => p.text)?.text
    throw new Error(`Gemini returned no image data after ${elapsedMs}ms${textRefusal ? ` — ${textRefusal.slice(0, 200)}` : ''}`)
  }

  const outMime = inline.mime_type ?? inline.mimeType ?? 'image/png'
  const outExt = outMime === 'image/jpeg' ? 'jpg' : 'png'
  const imageBytes = Buffer.from(inline.data, 'base64')

  const previewPath = `${opts.intakeId}/preview-${opts.index}-${Date.now()}.${outExt}`
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(previewPath, imageBytes, { contentType: outMime, upsert: false })
  if (upErr) throw new Error(`storage upload failed: ${upErr.message}`)

  return previewPath
}

type GeminiInline = {
  inline_data?: { mime_type?: string; mimeType?: string; data: string }
  inlineData?: { mime_type?: string; mimeType?: string; data: string }
  text?: string
}
type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: GeminiInline[] }
    finish_reason?: string
  }>
  error?: { message?: string; code?: number }
}
