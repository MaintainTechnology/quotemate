import { createClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'
import { after } from 'next/server'
import { uploadIntakePhoto } from '@/lib/storage/upload'
import { pipelineLog } from '@/lib/log/pipeline'
import { generatePreviewImage } from '@/lib/ig-engine/generate'
import { generateSampleImages } from '@/lib/ig-engine/samples'

export const maxDuration = 300

const MAX_FILES = 5
const MAX_SIZE = 5 * 1024 * 1024
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const log = pipelineLog('intake', token.slice(0, 8))
  log.step('photo upload received', { token: token.slice(0, 8) + '…' })

  // Token resolves to EITHER a calls row (voice flow) OR an
  // sms_conversations row (SMS flow). Storage path keys off the resolved
  // owner-id, then we update the right table with the new URLs + paths.
  type Resolved =
    | { source: 'call'; ownerId: string; existingUrls: string[]; existingPaths: string[]; completedAt: string | null }
    | { source: 'sms';  ownerId: string; existingUrls: string[]; existingPaths: string[]; completedAt: string | null }

  let resolved: Resolved | null = null

  const { data: call } = await supabase
    .from('calls')
    .select('id, photos_completed_at, photo_urls, photo_paths')
    .eq('photo_request_token', token)
    .maybeSingle()

  if (call) {
    resolved = {
      source: 'call',
      ownerId: call.id as string,
      existingUrls: Array.isArray(call.photo_urls) ? (call.photo_urls as string[]) : [],
      existingPaths: Array.isArray(call.photo_paths) ? (call.photo_paths as string[]) : [],
      completedAt: call.photos_completed_at as string | null,
    }
  } else {
    const { data: convo } = await supabase
      .from('sms_conversations')
      .select('id, photos_completed_at, photo_urls, photo_paths')
      .eq('photo_request_token', token)
      .maybeSingle()
    if (convo) {
      resolved = {
        source: 'sms',
        ownerId: convo.id as string,
        existingUrls: Array.isArray(convo.photo_urls) ? (convo.photo_urls as string[]) : [],
        existingPaths: Array.isArray(convo.photo_paths) ? (convo.photo_paths as string[]) : [],
        completedAt: convo.photos_completed_at as string | null,
      }
    }
  }

  if (!resolved) {
    log.err('token not found in calls or sms_conversations')
    return Response.json({ ok: false, error: 'Invalid or expired link' }, { status: 404 })
  }
  if (resolved.completedAt) {
    log.ok('photos already submitted, returning idempotent ok', { source: resolved.source })
    return Response.json({ ok: true, alreadyDone: true })
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    log.err('multipart parse failed')
    return Response.json({ ok: false, error: 'Bad request' }, { status: 400 })
  }

  const photos = formData.getAll('photos').filter((v): v is File => v instanceof File)
  if (photos.length === 0) {
    return Response.json({ ok: false, error: 'No photos in upload' }, { status: 400 })
  }
  if (photos.length > MAX_FILES) {
    return Response.json({ ok: false, error: `Max ${MAX_FILES} photos` }, { status: 400 })
  }

  for (const f of photos) {
    if (f.size > MAX_SIZE) return Response.json({ ok: false, error: `${f.name} over 5MB` }, { status: 400 })
    if (!ALLOWED_MIME.has(f.type)) return Response.json({ ok: false, error: `${f.name} not an allowed image type` }, { status: 400 })
  }

  log.step(`uploading ${photos.length} photo(s) to storage`, { source: resolved.source })
  const newSignedUrls: string[] = []
  const newPaths: string[] = []
  for (let i = 0; i < photos.length; i++) {
    const f = photos[i]
    const buf = new Uint8Array(await f.arrayBuffer())
    try {
      // uploadIntakePhoto's `callId` field is the storage-path partition
      // key; works for both call IDs and sms_conversation IDs (storage
      // paths read as <ownerId>/<stamp>-<i>-<rand>.<ext>).
      const { signedUrl, path } = await uploadIntakePhoto({
        callId: resolved.ownerId,
        data: buf,
        contentType: f.type,
        index: i,
      })
      newSignedUrls.push(signedUrl)
      newPaths.push(path)
    } catch (e: any) {
      log.err(`upload failed for photo ${i}`, e?.message ?? e)
      return Response.json({ ok: false, error: 'Storage write failed' }, { status: 500 })
    }
  }
  log.ok(`uploaded ${newSignedUrls.length} photo(s)`)

  const mergedUrls = [...resolved.existingUrls, ...newSignedUrls]
  const mergedPaths = [...resolved.existingPaths, ...newPaths]

  const targetTable = resolved.source === 'call' ? 'calls' : 'sms_conversations'
  const { error: updateErr } = await supabase
    .from(targetTable)
    .update({
      photo_urls: mergedUrls,
      photo_paths: mergedPaths,
      photos_completed_at: new Date().toISOString(),
    })
    .eq('id', resolved.ownerId)

  if (updateErr) {
    log.err(`${targetTable} update failed`, updateErr.message)
    return Response.json({ ok: false, error: 'DB update failed' }, { status: 500 })
  }

  log.done('photos persisted', {
    count: newSignedUrls.length,
    source: resolved.source,
    owner_id: resolved.ownerId.slice(0, 8) + '…',
  })

  // ─── Mirror new paths into intakes.photo_paths ─────────────────────
  // The customer quote page (/q/<token>) renders from intakes.photo_paths
  // first and only falls back to live calls/sms_conversations.photo_paths
  // when the intake snapshot is empty. Without this mirror, late uploads
  // (via the SMS link or in-page Step 02 widget) would be invisible on
  // any quote that already had dialog-attached photos in its snapshot.
  // We merge (intake snapshot ∪ new paths) instead of overwriting, so
  // dialog-MMS photos are preserved alongside the late uploads.
  let mirroredIntakeId: string | null = null
  try {
    if (resolved.source === 'call') {
      const { data } = await supabase
        .from('intakes')
        .select('id, photo_paths')
        .eq('call_id', resolved.ownerId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (data?.id) {
        mirroredIntakeId = data.id as string
        const existing = Array.isArray(data.photo_paths)
          ? (data.photo_paths as string[]).filter((p): p is string => typeof p === 'string' && p.length > 0)
          : []
        const mergedIntakePaths = Array.from(new Set([...existing, ...newPaths]))
        const { error: mirrorErr } = await supabase
          .from('intakes')
          .update({ photo_paths: mergedIntakePaths })
          .eq('id', mirroredIntakeId)
        if (mirrorErr) log.err('intakes.photo_paths mirror failed (call)', mirrorErr.message)
        else log.ok('intakes.photo_paths mirrored', { intake_id: mirroredIntakeId, total: mergedIntakePaths.length })
      }
    } else {
      const { data: convo } = await supabase
        .from('sms_conversations')
        .select('intake_id')
        .eq('id', resolved.ownerId)
        .maybeSingle()
      const intakeId = (convo?.intake_id as string | null) ?? null
      if (intakeId) {
        mirroredIntakeId = intakeId
        const { data: intake } = await supabase
          .from('intakes')
          .select('photo_paths')
          .eq('id', intakeId)
          .maybeSingle()
        const existing = Array.isArray(intake?.photo_paths)
          ? (intake.photo_paths as string[]).filter((p): p is string => typeof p === 'string' && p.length > 0)
          : []
        const mergedIntakePaths = Array.from(new Set([...existing, ...newPaths]))
        const { error: mirrorErr } = await supabase
          .from('intakes')
          .update({ photo_paths: mergedIntakePaths })
          .eq('id', intakeId)
        if (mirrorErr) log.err('intakes.photo_paths mirror failed (sms)', mirrorErr.message)
        else log.ok('intakes.photo_paths mirrored', { intake_id: intakeId, total: mergedIntakePaths.length })
      } else {
        log.ok('intakes.photo_paths mirror skipped — no intake yet for this conversation')
      }
    }
  } catch (e: any) {
    log.err('intakes.photo_paths mirror threw', e?.message ?? String(e))
  }

  // ─── Resume a conversation that was WAITING on this photo ───────────
  // The note below is still true for VOICE, where the intake/estimate chain
  // already raced to a quote while the call was ending, and for any SMS thread
  // that has already produced an intake: there the photo is a late addition and
  // re-triggering would duplicate work.
  //
  // It is NOT true for an SMS thread with no intake yet. There the photo is a
  // PREREQUISITE — the receptionist said "need a quick photo of the install spot
  // to lock it in" and stopped. Nothing else watches this table: no cron sweeps
  // photos_completed_at, and the customer has no reason to text again because
  // they did exactly what was asked. Live 2026-09-06, Electrical3 conversation
  // 8db5259f: every slot collected, photo uploaded at 22:05:26, and then silence
  // — intake_id NULL, no quote, thread still `open` a day later.
  //
  // /api/intake/structure is the same endpoint the SMS route calls on `finish`,
  // with the same CRON_SECRET auth, and it is idempotent by conversation_id
  // (it short-circuits when convo.intake_id is already set), so firing it here
  // cannot double-quote a thread that raced us.
  if (resolved.source === 'sms') {
    after(async () => {
      try {
        const { data: convo } = await supabase
          .from('sms_conversations')
          .select('id, intake_id, status, conversation_state')
          .eq('id', resolved.ownerId)
          .maybeSingle()

        if (!convo) return
        if (convo.intake_id) {
          log.ok('resume skipped — conversation already has an intake', { intake_id: convo.intake_id })
          return
        }
        if (convo.status === 'closed') {
          log.ok('resume skipped — conversation is closed')
          return
        }
        // Readiness proxy: the dialog must have identified WHAT the job is.
        // Without a job_type there is nothing to quote and structuring would
        // mint a junk intake from a thread that never got started.
        const jobType = (convo.conversation_state as { slots?: { job_type?: string } } | null)
          ?.slots?.job_type
        if (!jobType) {
          log.ok('resume skipped — no job_type on the conversation yet')
          return
        }

        log.step('photo was the last thing missing — resuming intake/structure', {
          conversation_id: resolved.ownerId,
          job_type: jobType,
        })
        const res = await fetch(`${process.env.APP_URL}/api/intake/structure`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.CRON_SECRET}`,
          },
          body: JSON.stringify({ conversationId: resolved.ownerId, sourceChannel: 'sms' }),
        })
        if (!res.ok) {
          log.err('resume handoff rejected', `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
        } else {
          log.ok('resume handoff accepted — quote pipeline running')
        }
      } catch (e: any) {
        // Never fail the upload because the resume failed: the photos are
        // already stored, and the tradie can still quote from the dashboard.
        log.err('resume handoff threw', e?.message ?? String(e))
      }
    })
  }

  // ─── AI preview trigger 1 (photo upload) ───
  // Customer just submitted photos. Find the linked quote (via the
  // intake row that points at this call/conversation) and kick off
  // Gemini-driven preview generation in after() so the upload response
  // returns fast. The customer's first photo becomes the reference
  // image — Gemini edits THAT photo to show the proposed work.
  // generatePreviewImage() is idempotent — safe to fire even if another
  // trigger already started or finished generation.
  after(async () => {
    try {
      let intakeId: string | null = null
      if (resolved.source === 'call') {
        const { data } = await supabase
          .from('intakes')
          .select('id')
          .eq('call_id', resolved.ownerId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        intakeId = (data?.id as string | null) ?? null
      } else {
        const { data } = await supabase
          .from('sms_conversations')
          .select('intake_id')
          .eq('id', resolved.ownerId)
          .maybeSingle()
        intakeId = (data?.intake_id as string | null) ?? null
      }

      if (!intakeId) {
        log.ok('preview trigger: no intake yet — estimate-draft trigger will catch this when the quote drafts', { source: resolved.source })
        return
      }

      const { data: quote } = await supabase
        .from('quotes')
        .select('id')
        .eq('intake_id', intakeId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (!quote?.id) {
        log.ok('preview trigger: intake exists but no quote yet — estimate-draft trigger will catch this', { intakeId })
        return
      }

      log.step('preview + samples trigger 1 — kicking off Gemini generation (parallel)', { quoteId: quote.id })
      // Run preview (room-specific edit) + sample gallery (3 generic
      // examples) in parallel. Each is independently idempotent.
      const [previewResult, samplesResult] = await Promise.all([
        generatePreviewImage(quote.id as string),
        generateSampleImages(quote.id as string),
      ])
      log.ok('preview trigger 1 result', { status: previewResult.status })
      log.ok('samples trigger 1 result', { status: samplesResult.status })
    } catch (e: any) {
      log.err('preview trigger 1 threw', e?.message ?? String(e))
    }
  })

  return Response.json({ ok: true, count: newSignedUrls.length })
}
