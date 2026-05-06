// ════════════════════════════════════════════════════════════════════
// Phase 4 / cleanup — daily Vercel cron sweep.
// Marks SMS conversations as 'abandoned' when:
//   • status = 'open' (still considered active by the dialog agent)
//   • last_message_at < now() - 24h (no inbound or outbound for a day)
//
// Triggered by Vercel Cron — see vercel.json. The cron sends an
// Authorization: Bearer ${CRON_SECRET} header which Vercel auto-injects
// from the env var. We require it in production; in non-production we
// allow unauthenticated calls so the route is testable locally.
//
// Conversations with `last_message_at IS NULL` are left alone — they're
// rare (a conversation row can only exist post-first-message in our
// inbound route) and falling back to created_at would be guessing.
// ════════════════════════════════════════════════════════════════════
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

function isAuthorised(req: Request): boolean {
  const expected = process.env.CRON_SECRET
  // In production, Vercel Cron always sends the Bearer header — require it.
  if (process.env.NODE_ENV === 'production') {
    if (!expected) return false                              // misconfigured: no secret
    const got = req.headers.get('authorization')
    return got === `Bearer ${expected}`
  }
  // Local dev — allow callers without a Bearer for easier manual testing.
  // If a Bearer IS supplied locally, still validate it (so dev secrets aren't
  // silently accepted as anything-goes).
  const got = req.headers.get('authorization')
  if (got && expected) return got === `Bearer ${expected}`
  return true
}

export async function GET(req: Request) {
  if (!isAuthorised(req)) {
    return Response.json({ ok: false, error: 'unauthorised' }, { status: 401 })
  }

  const cutoffMs = Date.now() - 24 * 60 * 60 * 1000
  const cutoffIso = new Date(cutoffMs).toISOString()

  const { data, error } = await supabase
    .from('sms_conversations')
    .update({ status: 'abandoned', updated_at: new Date().toISOString() })
    .eq('status', 'open')
    .lt('last_message_at', cutoffIso)
    .select('id, from_number, last_message_at')

  if (error) {
    console.error('[cron/sms-cleanup] sweep failed', error)
    return Response.json({ ok: false, error: error.message }, { status: 500 })
  }

  const swept = data?.length ?? 0
  console.log('[cron/sms-cleanup] swept', {
    swept,
    cutoff: cutoffIso,
    sample: data?.slice(0, 3).map(r => ({
      id: r.id,
      from: r.from_number,
      last_message_at: r.last_message_at,
    })),
  })

  return Response.json({ ok: true, swept, cutoff: cutoffIso })
}
