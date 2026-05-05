import { createClient } from '@supabase/supabase-js'
import { after } from 'next/server'
import { structureIntake } from '@/lib/intake/structure'
import { embedIntake } from '@/lib/intake/embed'
import { evaluateIntakeQuality } from '@/lib/intake/quality'
import { pipelineLog } from '@/lib/log/pipeline'
import { withRetry } from '@/lib/util/retry'
import { dispatchQuoteMessage } from '@/lib/sms/dispatch'
import { buildIncompleteCallSms, buildPhotoRequestSms } from '@/lib/sms/templates'

export const maxDuration = 300

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {
  const { callId } = await req.json()
  const log = pipelineLog('intake', callId)
  log.step('received', { callId })

  log.step('loading transcript from calls')
  const { data: call } = await supabase.from('calls').select('*').eq('id', callId).single()
  if (!call) {
    log.err('call not found in DB', null, { callId })
    return Response.json({ error: 'call not found' }, { status: 404 })
  }
  log.ok('transcript loaded', {
    chars: call.transcript?.length ?? 0,
    photo_count: (call.photo_urls ?? []).length,
  })

  log.step('running Opus vision (Claude 4.7) — typically ~35s, up to 3 attempts')
  const intake = await withRetry(
    () => structureIntake(call.transcript, call.photo_urls),
    {
      maxAttempts: 3,
      baseDelayMs: 2000,
      onAttemptFailed: (err, attempt, willRetry) => {
        const msg = err instanceof Error ? err.message : String(err)
        if (willRetry) {
          log.err(`Opus intake attempt ${attempt}/3 failed — retrying`, msg)
        } else {
          log.err(`Opus intake attempt ${attempt}/3 failed — giving up`, msg)
        }
      },
    }
  )
  log.ok('Opus structured intake', {
    job_type: intake.job_type,
    confidence: intake.confidence,
    inspection_required: intake.inspection_required,
    risks: intake.risks?.length ?? 0,
  })

  log.step('embedding intake (1536-dim) for similarity search')
  const embedding = await embedIntake(intake)
  log.ok('embedding complete', { dims: embedding.length })

  log.step('inserting intakes row')
  const { data: intakeRow } = await supabase.from('intakes').insert({
    call_id: callId,
    job_type: intake.job_type,
    address: intake.address,
    suburb: intake.suburb,
    scope: intake.scope,
    access: intake.access,
    property: intake.property,
    risks: intake.risks,
    inspection_required: intake.inspection_required,
    caller: intake.caller,
    timing: intake.timing,
    confidence: intake.confidence,
    confidence_reason: intake.confidence_reason,
    embedding,
  }).select().single()
  log.ok('intakes row inserted', { intake_id: intakeRow!.id })

  // Quality gate — decides whether downstream SMS dispatches and the
  // estimation engine should run at all.
  const quality = evaluateIntakeQuality(intake)
  log.ok('intake quality evaluated', {
    quality,
    confidence: intake.confidence,
    has_name: !!intake.caller?.name,
    has_scope: !!(intake.scope?.description && intake.scope.description.length >= 10),
    job_type: intake.job_type,
  })

  const callerNumber = call.caller_number ?? null
  const callerFirstName = (intake.caller?.name ?? '').split(' ')[0] || undefined

  if (quality === 'empty') {
    // Empty intake — call captured nothing usable. Send a brief callback
    // request SMS, suppress photo-request and estimation entirely.
    after(async () => {
      const ds = pipelineLog('dispatch', callId)
      ds.step('intake gated as empty — sending callback-request SMS')
      if (!callerNumber) {
        ds.err('no caller_number — cannot send callback request', null, { intake_id: intakeRow!.id })
        return
      }
      try {
        const body = buildIncompleteCallSms({ firstName: callerFirstName })
        const result = await dispatchQuoteMessage({ to: callerNumber, text: body })
        if (result.ok) {
          ds.ok('callback-request SMS sent', { channel: result.channel, sid: result.sid })
        } else {
          ds.err('callback-request SMS failed', null, {
            sms_code: result.smsAttempt.code,
            wa_code: result.waAttempt?.code,
          })
        }
      } catch (e) {
        ds.err('callback-request SMS threw', e)
      }
    })

    log.done('intake handler done — quality gate fired (no estimation, no photo SMS)', {
      intake_id: intakeRow!.id,
      gated_reason: 'empty_intake',
    })
    return Response.json({
      ok: true,
      intakeId: intakeRow!.id,
      gated: 'empty_intake',
    })
  }

  // Quality is 'usable' — fire the photo-request SMS AND dispatch estimate.
  // Both run in after() so the response goes back to the caller (webhook)
  // immediately and the work survives the function lifetime.
  after(async () => {
    // Photo-request SMS (was previously fired from webhook; moved here so it
    // can be suppressed cleanly when the quality gate fires)
    const photoLog = pipelineLog('dispatch', callId)
    photoLog.step('dispatching photo-request SMS')
    if (!callerNumber) {
      photoLog.err('no caller_number — skipping photo SMS', null, { call_id: callId })
    } else if (!call.photo_request_token) {
      photoLog.err('no photo_request_token on call — skipping photo SMS', null, { call_id: callId })
    } else {
      try {
        const uploadUrl = `${process.env.APP_URL}/upload/${call.photo_request_token}`
        const body = buildPhotoRequestSms({ firstName: callerFirstName, uploadUrl })
        const result = await dispatchQuoteMessage({ to: callerNumber, text: body })
        if (result.ok) {
          photoLog.ok('photo-request SMS sent', { channel: result.channel, sid: result.sid })
        } else {
          photoLog.err('photo-request SMS failed', null, {
            sms_code: result.smsAttempt.code,
            wa_code: result.waAttempt?.code,
          })
        }
      } catch (e) {
        photoLog.err('photo-request SMS threw', e)
      }
    }

    // Dispatch to /api/estimate/draft
    const dispatch = pipelineLog('intake', callId)
    dispatch.step('dispatching to /api/estimate/draft', { intake_id: intakeRow!.id })
    try {
      const res = await fetch(`${process.env.APP_URL}/api/estimate/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intakeId: intakeRow!.id }),
      })
      if (res.ok) {
        dispatch.ok('estimate/draft dispatched', { http: res.status })
      } else {
        dispatch.err('estimate/draft rejected', `HTTP ${res.status}`, { body: (await res.text()).slice(0, 200) })
      }
    } catch (e) {
      dispatch.err('estimate dispatch threw', e)
    }
  })

  log.done('intake handler done', { intake_id: intakeRow!.id })
  return Response.json({ ok: true, intakeId: intakeRow!.id })
}
