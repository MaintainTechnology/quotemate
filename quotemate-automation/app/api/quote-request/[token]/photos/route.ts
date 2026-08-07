// POST /api/quote-request/[token]/photos — the OPTIONAL photo field on the
// public generic form (spec: specs/generic-quote-request-form.md §2).
//
// Same capability model as its siblings: the unguessable token is the auth,
// and the row must still be pending. Photos land in the private
// intake-photos bucket via the existing uploadIntakePhoto helper and are
// merged onto the SMS conversation — which is exactly where
// /api/intake/structure already aggregates them from
// (sms_conversations.photo_urls), so the electrical/plumbing vision pass
// picks them up with no new plumbing.
//
// Uploaded on pick rather than carried in the JSON submit, so the parent
// POST stays one small validated body.

import { createClient } from '@supabase/supabase-js'
import { uploadIntakePhoto } from '@/lib/storage/upload'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_FILES = 5
const MAX_SIZE = 5 * 1024 * 1024
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params

  const { data: lead, error: leadErr } = await supabase
    .from('trade_lead_requests')
    .select('token, conversation_id, status')
    .eq('token', token)
    .maybeSingle()
  if (leadErr) {
    console.error('[quote-request/photos] lead lookup failed', leadErr.message)
    return Response.json({ ok: false, error: 'lookup_failed' }, { status: 503 })
  }
  if (!lead) return Response.json({ ok: false, error: 'invalid_link' }, { status: 404 })
  if ((lead.status as string) !== 'pending') {
    return Response.json({ ok: false, error: 'link_expired' }, { status: 410 })
  }
  const conversationId = (lead.conversation_id as string | null) ?? null
  if (!conversationId) {
    return Response.json({ ok: false, error: 'no_thread' }, { status: 409 })
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return Response.json({ ok: false, error: 'invalid_form' }, { status: 400 })
  }
  const photos = formData.getAll('photos').filter((v): v is File => v instanceof File)
  if (photos.length === 0) return Response.json({ ok: false, error: 'no_photos' }, { status: 400 })
  if (photos.length > MAX_FILES) return Response.json({ ok: false, error: `max_${MAX_FILES}_photos` }, { status: 400 })
  for (const f of photos) {
    if (f.size > MAX_SIZE) return Response.json({ ok: false, error: 'photo_over_5mb' }, { status: 400 })
    if (!ALLOWED_MIME.has(f.type)) return Response.json({ ok: false, error: 'unsupported_image_type' }, { status: 400 })
  }

  const urls: string[] = []
  const paths: string[] = []
  for (let i = 0; i < photos.length; i++) {
    const f = photos[i]
    try {
      // `callId` is just the storage-path partition key — the conversation
      // id works exactly as it does for the /upload/[token] surface.
      const { signedUrl, path } = await uploadIntakePhoto({
        callId: conversationId,
        data: new Uint8Array(await f.arrayBuffer()),
        contentType: f.type,
        index: i,
      })
      urls.push(signedUrl)
      paths.push(path)
    } catch (e) {
      console.error('[quote-request/photos] storage write failed', e instanceof Error ? e.message : e)
      return Response.json({ ok: false, error: 'storage_write_failed' }, { status: 502 })
    }
  }

  const { data: convo, error: readErr } = await supabase
    .from('sms_conversations')
    .select('photo_urls, photo_paths')
    .eq('id', conversationId)
    .maybeSingle()
  if (readErr) {
    console.error('[quote-request/photos] conversation read failed', readErr.message)
    return Response.json({ ok: false, error: 'thread_read_failed' }, { status: 502 })
  }

  const existing = (k: 'photo_urls' | 'photo_paths') =>
    Array.isArray(convo?.[k]) ? (convo[k] as string[]).filter((v) => typeof v === 'string' && v) : []

  // NOTE: photos_completed_at is deliberately NOT stamped. /api/upload/[token]
  // uses it as its own idempotency gate, so setting it here would make a
  // later photo-request link report "already done".
  const { error: writeErr } = await supabase
    .from('sms_conversations')
    .update({
      photo_urls: [...existing('photo_urls'), ...urls],
      photo_paths: [...existing('photo_paths'), ...paths],
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationId)
  if (writeErr) {
    console.error('[quote-request/photos] conversation update failed', writeErr.message)
    return Response.json({ ok: false, error: 'thread_write_failed' }, { status: 502 })
  }

  return Response.json({ ok: true, count: urls.length })
}
