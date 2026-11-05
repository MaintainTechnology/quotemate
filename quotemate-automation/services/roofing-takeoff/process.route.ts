// POST /api/takeoff/internal/process: runs one stage of a takeoff run. The
// takeoff service's worker replays each queued job into it in process; the
// service's internal route, behind CRON_SECRET, serves manual replays.

import { sendEmail } from '@/lib/email/resend'
import { currentSmsWork } from '@/lib/sms/durable-work'
import { getServiceClient } from '@/lib/supabase/admin'
import { notifyOperator, processStage, restartOf, TAKEOFF_STAGES, type OperatorNotifier, type TakeoffStage } from '@/lib/roofing/plan-takeoff'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { run_id?: unknown; stage?: unknown } | null
  const runId = String(body?.run_id ?? '')
  const stage = String(body?.stage ?? '') as TakeoffStage
  if (!UUID.test(runId) || !TAKEOFF_STAGES.includes(stage)) {
    return Response.json({ ok: false, error: 'invalid_request', detail: 'Expected { run_id, stage }' }, { status: 400 })
  }
  const job = currentSmsWork()?.job
  const outcome = await processStage(getServiceClient(), {
    runId,
    stage,
    attempt: job?.attempts ?? 1,
    restart: job ? restartOf(job.work_key) : undefined,
  })
  // TKO-23: the operator hears once a run settles. An email never fails a stage.
  if (outcome.done === 'finished' || outcome.done === 'failed') {
    await notifyOperator(getServiceClient(), runId, outcome, operatorNotifier())
  }
  return Response.json({ ok: true, ...outcome })
}

/** The operator addresses in TAKEOFF_NOTIFY_EMAIL, sent through Resend, with a
 *  link to the run's page on this service when Railway names its domain. */
function operatorNotifier(): OperatorNotifier {
  const domain = process.env.RAILWAY_PUBLIC_DOMAIN
  return {
    recipients: (process.env.TAKEOFF_NOTIFY_EMAIL ?? '').split(',').map((address) => address.trim()).filter(Boolean),
    send: sendEmail,
    runUrl: domain ? (runId) => `https://${domain}/runs/${runId}` : undefined,
  }
}
