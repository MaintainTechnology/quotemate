// POST /api/filestore/chat — the estimator chatbot.
//
// Answers a customer/tradie question about ONE estimator session, grounded in
// that session's dedicated File Search store (their uploaded files + the
// estimate result PDF). Uses the free Gemini 2.5 model via the mt-filestore-kb
// search tool with the QuoteMate estimate-assistant framing.
//
// Tenant-scoped (Bearer): the caller must own the session (paint_runs /
// plan_extractions row with a matching tenant_id), so one tenant can never
// query another tenant's store. Degrades gracefully — when the KB service is
// unconfigured or the session has no documents yet, it returns a friendly
// message rather than an error.

import { tenantFromBearer, estimatorSupabase } from '@/lib/estimation/auth'
import { parseChatRequest, type ChatRequest } from '@/lib/filestore/chat-request'
import { loadKbConfigFromEnv } from '@/lib/admin-loader/mt-filestore-kb'
import { searchSessionStore } from '@/lib/filestore/session-store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
// One Gemini File Search generateContent call; a few seconds normally, but the
// upstream retries 429s, so give it room.
export const maxDuration = 60

const CHAT_MODEL = (process.env.FILESTORE_CHAT_MODEL || 'gemini-2.5-flash').trim()

/** The table whose id is this estimator's session id (for the ownership check). */
const SESSION_TABLE: Record<ChatRequest['estimator'], string> = {
  paint: 'paint_runs',
  electrical: 'plan_extractions',
}

export async function POST(req: Request) {
  const tenant = await tenantFromBearer(req)
  if (!tenant) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }
  const parsed = parseChatRequest(raw)
  if (!parsed.ok) {
    return Response.json({ ok: false, error: 'invalid_request', detail: parsed.error }, { status: 400 })
  }
  const { estimator, sessionId, query } = parsed.value

  // Ownership: the session must belong to this tenant.
  const { data: owned } = await estimatorSupabase
    .from(SESSION_TABLE[estimator])
    .select('id')
    .eq('id', sessionId)
    .eq('tenant_id', tenant.id)
    .maybeSingle()
  if (!owned) {
    return Response.json({ ok: false, error: 'session_not_found' }, { status: 404 })
  }

  // KB service config — graceful when unset.
  let config
  try {
    config = loadKbConfigFromEnv()
  } catch {
    return Response.json({
      ok: true,
      unavailable: true,
      storeFound: false,
      answer:
        'The estimate assistant isn’t available right now. You can still review the estimate above, or contact us with any questions.',
      citations: [],
    })
  }

  const result = await searchSessionStore({
    config,
    estimator,
    sessionId,
    query,
    model: CHAT_MODEL,
  })

  if (!result.ok) {
    return Response.json(
      {
        ok: true,
        storeFound: result.storeFound,
        answer:
          'I couldn’t reach the documents for this job just now — please try again in a moment.',
        citations: [],
        degraded: true,
      },
      { status: 200 },
    )
  }

  if (!result.storeFound) {
    return Response.json({
      ok: true,
      storeFound: false,
      answer:
        'There aren’t any documents indexed for this job yet. Once your files and the estimate are processed, I can answer questions about them here.',
      citations: [],
    })
  }

  return Response.json({
    ok: true,
    storeFound: true,
    answer: result.answer,
    citations: result.citations,
  })
}
