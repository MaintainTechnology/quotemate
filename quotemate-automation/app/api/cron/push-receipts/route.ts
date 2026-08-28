import { createClient } from '@supabase/supabase-js'
import { isCronAuthorised } from '@/lib/agents/cron'
import { sweepPushReceipts } from '@/lib/push/receipts'
import { sweepPushEvents } from '@/lib/push/events'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function GET(req: Request) {
  if (!isCronAuthorised(req)) {
    return Response.json({ ok: false, error: 'unauthorised' }, { status: 401 })
  }

  const [receipts, events] = await Promise.all([
    sweepPushReceipts(supabase),
    sweepPushEvents(supabase),
  ])
  if (receipts.error || events.error) {
    console.error('[cron/push-receipts] sweep failed', receipts.error ?? events.error)
    return Response.json({ ok: false, error: 'receipt_sweep_failed' }, { status: 500 })
  }
  console.log('[cron/push-receipts] sweep complete', { receipts, events })
  return Response.json({ ok: true, receipts, events })
}
