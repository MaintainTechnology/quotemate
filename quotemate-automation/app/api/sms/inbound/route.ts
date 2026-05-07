// ─────────────────────────────────────────────────────────────────────
// SMS Agent — Phase 2 (the AI brain).
// Validates Twilio signature, persists inbound, asks the Haiku dialog
// agent (lib/sms/dialog.ts) what to do next, sends the reply via the
// shared dispatcher (SMS-first / WhatsApp-fallback), persists outbound,
// updates conversation status + assumptions, and on `finish` fires a
// fire-and-forget handoff to /api/intake/structure.
// Phase 1 plumbing (signature validation, dispatcher, hardening) is
// preserved verbatim — the only swap is STATIC_REPLY → decideNextTurn.
// ─────────────────────────────────────────────────────────────────────

import { createClient } from '@supabase/supabase-js'
import { after } from 'next/server'
import { randomBytes } from 'node:crypto'
import {
  validateTwilioSignature,
  parseTwilioForm,
} from '@/lib/sms/twilio-validator'
import { dispatchQuoteMessage } from '@/lib/sms/dispatch'
import { decideNextTurn, type ConversationTurn } from '@/lib/sms/dialog'
import { extractAndStoreMmsPhotos } from '@/lib/sms/mms'
import { buildPhotoRequestSms } from '@/lib/sms/templates'
import { withRetry } from '@/lib/util/retry'

// Twilio webhook ack. We send the real customer reply via the REST API
// inside after() — never as TwiML in the webhook response — so this
// endpoint must return an EMPTY <Response/> document. If the body is
// non-TwiML text (e.g. "ok"), Twilio's messaging webhook will treat it
// as a reply and SMS it back to the customer, producing a phantom "ok"
// bubble before the agent's actual greeting. Empty TwiML = no auto-reply.
const TWIML_EMPTY = '<?xml version="1.0" encoding="UTF-8"?><Response/>'
function ackTwiml() {
  return new Response(TWIML_EMPTY, {
    status: 200,
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
  })
}

// Easy-5 jobs benefit from a photo (visual ceiling/wall/access detail)
// before Opus drafts the quote. Out-of-scope jobs go straight to
// inspection so a photo prompt would be off-message.
const EASY_5_JOB_TYPES = new Set([
  'downlights',
  'power_points',
  'ceiling_fans',
  'smoke_alarms',
  'outdoor_lighting',
])

// Best-effort first-name guess from a customer's SMS turn. Used only
// for the photo-request SMS greeting — Opus does the authoritative
// extraction in structureIntake later. We look for a turn that's 1-3
// words, mostly letters, no digits (so "6 downlights" or "Bondi" don't
// match as names). Returns null if we can't be confident.
function guessFirstName(turns: ConversationTurn[]): string | undefined {
  const inbound = turns.filter(t => t.direction === 'inbound')
  for (const t of inbound) {
    const trimmed = t.body.trim()
    // 1-3 words, only letters + spaces + hyphens (Anne-Marie OK), no digits
    if (
      /^[A-Za-z][A-Za-z\- ]{0,30}$/.test(trimmed) &&
      trimmed.split(/\s+/).length <= 3 &&
      !/^(hi|hey|yo|ok|okay|yes|yeah|nope|no|cheers|ta|bondi|sydney|melbourne)$/i.test(trimmed)
    ) {
      return trimmed.split(/\s+/)[0]
    }
  }
  return undefined
}

// Allow the after() block enough time for Haiku + Twilio + DB writes.
// Vercel Hobby = 60s ceiling; Pro = 300s. The inline path returns 200
// in <500ms so Twilio is happy regardless.
export const maxDuration = 60

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// Graceful fallback if the dialog agent throws — the customer still gets
// a reply rather than silence.
const DIALOG_FALLBACK_REPLY =
  "Thanks — we'll get back to you shortly to confirm details."

export async function POST(req: Request) {
 try {
  console.log('[sms/inbound] step 1 — reading body')
  // 1. Read raw body (needed for both signature check and field parsing).
  const rawBody = await req.text()
  const params = parseTwilioForm(rawBody)

  // 2. Verify the request really came from Twilio.
  // Reconstruct the URL from forwarded headers so the signature math matches
  // what the original requester (Twilio or our simulator) signed against.
  // On Vercel, req.url can reflect an internal deployment URL while the
  // original request hit the production alias — the forwarded headers
  // preserve the original.
  const signature = req.headers.get('x-twilio-signature')
  const reqUrl = new URL(req.url)
  const forwardedHost = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
  const forwardedProto = req.headers.get('x-forwarded-proto') ?? 'https'
  const url = forwardedHost
    ? `${forwardedProto}://${forwardedHost}${reqUrl.pathname}${reqUrl.search}`
    : reqUrl.toString()

  if (!validateTwilioSignature(signature, url, params)) {
    console.warn('[sms/inbound] rejected — bad Twilio signature', {
      url,
      reqUrl: req.url,
      forwardedHost: req.headers.get('x-forwarded-host'),
      forwardedProto: req.headers.get('x-forwarded-proto'),
      host: req.headers.get('host'),
      hasSignature: !!signature,
      hasAuthToken: !!process.env.TWILIO_AUTH_TOKEN,
      authTokenLen: process.env.TWILIO_AUTH_TOKEN?.length ?? 0,
      paramsKeys: Object.keys(params).sort(),
    })
    return new Response('Invalid signature', { status: 403 })
  }

  const fromNumber = params.From
  const toNumber = params.To
  const inboundBody = (params.Body ?? '').trim()
  const messageSid = params.MessageSid ?? null

  if (!fromNumber || !toNumber || !inboundBody) {
    return new Response('Missing required Twilio fields', { status: 400 })
  }

  // ─────── Idempotency guard ───────
  // Twilio may retry the webhook (timeout, fallback URL config, etc.).
  // Without this, a retry would persist a duplicate inbound row, run
  // Haiku again, and dispatch another reply. We dedupe on MessageSid —
  // if we've already persisted an inbound row for this SID, ack with
  // 200 immediately and bail. SMS-without-SID (extremely rare) falls
  // through to normal processing rather than failing closed.
  if (messageSid) {
    const { data: existingMsg } = await supabase
      .from('sms_messages')
      .select('id, conversation_id')
      .eq('twilio_message_sid', messageSid)
      .eq('direction', 'inbound')
      .maybeSingle()
    if (existingMsg) {
      console.warn('[sms/inbound] duplicate MessageSid — ignoring retry', {
        messageSid,
        existingMessageId: existingMsg.id,
        conversationId: existingMsg.conversation_id,
      })
      return ackTwiml()
    }
  }

  console.log('[sms/inbound] step 3 — completion-aware conversation lookup', { fromNumber })
  // 3. Smart conversation re-engagement.
  //
  // Find the MOST RECENT conversation for this from_number, regardless of
  // status, then decide whether to REUSE it (continuation) or CREATE a
  // new one (fresh request). Rules:
  //
  //   - status in ('open','structuring') AND age < 4h:  REUSE (still mid-flow)
  //   - status in ('open','structuring') AND age >= 4h: NEW (abandoned)
  //   - status = 'done' AND age < 5min:                 REUSE (add-on grace)
  //   - status = 'done' AND age >= 5min:                NEW (returning customer)
  //   - no prior conversation:                          NEW (first-time customer)
  //
  // The customerHistoryHint is passed to the dialog agent so it can pick
  // the right opener: full intro for first-timers, "welcome back" for
  // returning customers, no greeting for continuations.
  const REUSE_OPEN_WINDOW_MS = 4 * 60 * 60 * 1000   // 4 hours
  const REUSE_DONE_GRACE_MS = 5 * 60 * 1000         // 5 minutes

  const { data: prior, error: lookupErr } = await supabase
    .from('sms_conversations')
    .select('*')
    .eq('from_number', fromNumber)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()

  if (lookupErr) {
    console.error('[sms/inbound] conversation lookup failed', lookupErr)
    return new Response('DB error', { status: 500 })
  }

  type CustomerHistoryHint = 'first_time' | 'returning' | 'continuing'
  let customerHistoryHint: CustomerHistoryHint
  let conversation: typeof prior

  const ageMs = prior?.last_message_at
    ? Date.now() - new Date(prior.last_message_at as string).getTime()
    : Infinity

  const shouldReuse = !!prior && (
    ((prior.status === 'open' || prior.status === 'structuring') && ageMs < REUSE_OPEN_WINDOW_MS)
    || (prior.status === 'done' && ageMs < REUSE_DONE_GRACE_MS)
  )

  if (shouldReuse) {
    conversation = prior!
    customerHistoryHint = 'continuing'
    console.log('[sms/inbound] step 3 — REUSE prior conversation', {
      conversationId: conversation.id,
      priorStatus: conversation.status,
      ageSeconds: Math.round(ageMs / 1000),
    })
    // If reusing a 'done' conversation in the grace window, flip back to 'open'
    // so the dialog can append normally. The intake_id stays linked — the
    // dialog agent treats this as an add-on/clarification turn.
    if (conversation.status === 'done') {
      await supabase
        .from('sms_conversations')
        .update({ status: 'open', updated_at: new Date().toISOString() })
        .eq('id', conversation.id)
      conversation = { ...conversation, status: 'open' }
      console.log('[sms/inbound] step 3 — reopened done conversation (grace window)', {
        conversationId: conversation.id,
      })
    }
  } else {
    // Create new conversation.
    const photoToken = randomBytes(16).toString('hex')
    const { data: created, error: createErr } = await supabase
      .from('sms_conversations')
      .insert({
        from_number: fromNumber,
        to_number: toNumber,
        status: 'open',
        photo_request_token: photoToken,
      })
      .select()
      .single()
    if (createErr || !created) {
      console.error('[sms/inbound] conversation create failed', createErr)
      return new Response('DB error', { status: 500 })
    }
    conversation = created
    // First-time vs returning: do we have ANY prior conversation row?
    customerHistoryHint = prior ? 'returning' : 'first_time'
    console.log('[sms/inbound] step 3 — NEW conversation', {
      conversationId: conversation.id,
      customerHistoryHint,
      priorAgeHours: prior ? Math.round(ageMs / 3600000 * 10) / 10 : null,
    })
  }

  // 4a. If this is an MMS, fetch the media from Twilio and upload to our
  //     intake-photos bucket BEFORE persisting the inbound row, so the
  //     resulting signed URLs + permanent paths land on the same row.
  let inboundPhotoUrls: string[] = []
  let inboundPhotoPaths: string[] = []
  const numMedia = parseInt(params.NumMedia ?? '0', 10)
  if (Number.isFinite(numMedia) && numMedia > 0) {
    console.log('[sms/inbound] step 4a — extracting MMS attachments', {
      numMedia,
      conversationId: conversation.id,
    })
    try {
      const result = await extractAndStoreMmsPhotos({
        conversationId: conversation.id,
        params,
      })
      inboundPhotoUrls = result.signedUrls
      inboundPhotoPaths = result.paths
      const failed = result.attempts.filter(a => !a.ok)
      if (failed.length) {
        console.warn('[sms/inbound] step 4a — some MMS attachments failed', {
          ok: result.signedUrls.length,
          failed: failed.length,
          reasons: failed.map(f => 'reason' in f ? f.reason : 'unknown'),
        })
      } else {
        console.log('[sms/inbound] step 4a — MMS attachments stored', {
          count: result.signedUrls.length,
        })
      }
    } catch (e) {
      console.error('[sms/inbound] step 4a — MMS extraction threw', e)
    }
  }

  console.log('[sms/inbound] step 4 — persisting inbound', {
    conversationId: conversation.id,
    photoCount: inboundPhotoUrls.length,
  })
  // 4. Persist the inbound message — including any MMS photo URLs we
  //    just stored. After this point everything is moved into after()
  //    so we can ack Twilio with 200 quickly and prevent timeout-driven
  //    retries (which would otherwise produce duplicate replies).
  //
  // The application-layer idempotency check above catches almost all
  // retries; the unique partial index created in migration 004 catches
  // the racy window where two retries arrive within the same millisecond.
  // PostgreSQL error 23505 = unique_violation → ack as duplicate.
  const { error: insertErr } = await supabase.from('sms_messages').insert({
    conversation_id: conversation.id,
    direction: 'inbound',
    body: inboundBody,
    twilio_message_sid: messageSid,
    photo_urls: inboundPhotoUrls,
    photo_paths: inboundPhotoPaths,
  })
  if (insertErr) {
    if (insertErr.code === '23505') {
      console.warn('[sms/inbound] race lost — duplicate MessageSid landed concurrently', {
        messageSid,
        conversationId: conversation.id,
      })
      return ackTwiml()
    }
    console.error('[sms/inbound] inbound persist failed', insertErr)
    return new Response('DB error', { status: 500 })
  }

  // ─────── Per-conversation lock claim ───────
  // Atomically try to claim "I'm the leader who'll prepare the next reply
  // for this conversation". If the row's processing_until is NULL or in
  // the past, we win the lock; otherwise another webhook is already
  // running Haiku for this customer and we should bail without sending
  // a duplicate reply. The follower's inbound message is already persisted
  // (above) so the leader will see it when it loads conversation history.
  //
  // Lock auto-expires after 60s in case a function crashes mid-flow —
  // a customer is never permanently blocked.
  const LOCK_DURATION_MS = 60 * 1000
  const lockUntilIso = new Date(Date.now() + LOCK_DURATION_MS).toISOString()
  const nowIso = new Date().toISOString()

  const { data: lockedRow, error: lockErr } = await supabase
    .from('sms_conversations')
    .update({ processing_until: lockUntilIso })
    .eq('id', conversation.id)
    .or(`processing_until.is.null,processing_until.lt.${nowIso}`)
    .select()
    .maybeSingle()

  if (lockErr) {
    console.error('[sms/inbound] lock claim threw', lockErr)
    // Don't fail the whole webhook — fall through and try to process
    // anyway. Worst case: customer might get a duplicate reply (the bug
    // we're trying to prevent) but at least they get one.
  }

  if (!lockedRow) {
    // Another webhook is already preparing a reply for this conversation.
    // Our message is persisted; the leader's tail-check will see it and
    // either fold it into its current reply or trigger a follow-up turn.
    console.log('[sms/inbound] coalesced — leader holds the lock; bailing without dispatch', {
      conversationId: conversation.id,
    })
    return ackTwiml()
  }

  // ─────── Fast-ack the webhook ───────
  // Everything below — Haiku call, Twilio outbound, conversation update,
  // intake handoff — runs after the 200 is returned. This keeps the
  // webhook latency under ~500ms regardless of how long Haiku takes.
  const conversationId = conversation.id
  const initialAssumptions = (conversation.assumptions_made as string[] | null) ?? []
  const initialTurnCount = conversation.turn_count
  // Photo-request state — passed into after() so we can decide whether
  // to fire the upload-link SMS (parallel to Haiku's reply, only on the
  // first turn that identifies an easy-5 job_type, never twice).
  const photoRequestToken = conversation.photo_request_token as string | null
  const photoRequestAlreadySent = !!conversation.photo_request_sent_at
  // Customer-history hint flows into the dialog agent so it picks the
  // right opener: full intro / welcome-back / no greeting.
  const customerHistory = customerHistoryHint

  after(async () => {
    try {
      // ─────── Debounce window ───────
      // Wait briefly to let any rapid-fire follow-up messages land before we
      // read history + run Haiku. Customer firing "Hey there" + "Hi there"
      // within ~1s lands both in DB; we then call Haiku ONCE with both in
      // history and reply ONCE. The follow-up webhook fails to claim the
      // lock and bails (its message is already persisted).
      const DEBOUNCE_MS = 1500
      await new Promise(r => setTimeout(r, DEBOUNCE_MS))

      console.log('[sms/inbound:after] step 5 — loading conversation history (post-debounce)', { conversationId })
      // 5. Load the full message history (oldest first) — including the inbound
      //    we just persisted AND any rapid-fire messages that landed during
      //    the debounce window.
      const { data: historyRows } = await supabase
        .from('sms_messages')
        .select('direction, body, created_at')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })

      const turns: ConversationTurn[] = (historyRows ?? []).map(m => ({
        direction: m.direction as 'inbound' | 'outbound',
        body: m.body,
      }))
      const inboundCount = turns.filter(t => t.direction === 'inbound').length

      console.log('[sms/inbound:after] step 6 — calling Haiku dialog agent', {
        turnCount: turns.length,
        inboundCount,
        customerHistory,
      })
      // 6. Ask Haiku what to do next — ask | finish | escalate_inspection.
      // customerHistory drives the OPENER LOGIC (Rule 9 in the system prompt):
      // first_time → full intro, returning → "welcome back", continuing → no greeting.
      let decision: Awaited<ReturnType<typeof decideNextTurn>>
      try {
        decision = await decideNextTurn({ history: turns, inboundCount, customerHistory })
        console.log('[sms/inbound:after] step 6 — decision', {
          action: decision.action,
          job_type_guess: decision.job_type_guess,
          ready_for_intake: decision.ready_for_intake,
          assumptions: decision.assumptions_made.length,
        })
      } catch (err: any) {
        console.error('[sms/inbound:after] dialog agent failed', {
          message: err?.message,
          name: err?.name,
        })
        decision = {
          action: 'escalate_inspection',
          job_type_guess: 'unknown',
          reply_to_send: DIALOG_FALLBACK_REPLY,
          assumptions_made: [],
          ready_for_intake: false,
          reason_for_escalation: 'dialog agent error',
        }
      }

      console.log('[sms/inbound:after] step 7 — dispatching reply (SMS-first, WhatsApp fallback)')
      const dispatch = await dispatchQuoteMessage({
        to: fromNumber,
        from: toNumber,
        text: decision.reply_to_send,
      })

      let outboundSid: string | null = null
      let outboundChannel: 'sms' | 'whatsapp' | null = null

      if (dispatch.ok) {
        outboundSid = dispatch.sid
        outboundChannel = dispatch.channel
        console.log('[sms/inbound:after] step 7 — dispatch OK', {
          channel: outboundChannel,
          sid: outboundSid,
          smsFallbackReason: dispatch.smsAttempt?.reason,
        })
      } else {
        console.error('[sms/inbound:after] step 7 — dispatch failed (both channels)', {
          smsAttempt: dispatch.smsAttempt,
          waAttempt: dispatch.waAttempt,
        })
      }

      console.log('[sms/inbound:after] step 8 — persisting outbound', { channel: outboundChannel })
      await supabase.from('sms_messages').insert({
        conversation_id: conversationId,
        direction: 'outbound',
        body: outboundChannel === 'whatsapp'
          ? `[WhatsApp fallback] ${decision.reply_to_send}`
          : decision.reply_to_send,
        twilio_message_sid: outboundSid,
      })

      // 8b. Photo-request SMS (parity with voice agent's send_sms_photo_link).
      // Fire ONCE per conversation, the first turn that identifies an
      // easy-5 job_type AND we haven't already sent the link. We send it
      // as a separate SMS rather than appending to Haiku's reply so the
      // 320-char dialog cap stays clean and the upload-link message is
      // visually distinct in the customer's thread.
      const shouldSendPhotoRequest =
        photoRequestToken &&
        !photoRequestAlreadySent &&
        EASY_5_JOB_TYPES.has(decision.job_type_guess) &&
        decision.action !== 'escalate_inspection'

      if (shouldSendPhotoRequest) {
        console.log('[sms/inbound:after] step 8b — dispatching photo-request SMS', {
          conversationId,
          jobType: decision.job_type_guess,
        })
        try {
          const appUrl = process.env.APP_URL ?? 'https://quote-mate-rho.vercel.app'
          const uploadUrl = `${appUrl}/upload/${photoRequestToken}`
          // Customer's first name is best-effort — Opus will recover it from
          // the transcript later regardless. Pull from the most recent
          // inbound turn that looks like a name (1-3 words, mostly letters)
          // OR fall back to a generic greeting.
          const firstName = guessFirstName(turns)
          const photoBody = buildPhotoRequestSms({ firstName, uploadUrl, source: 'sms' })
          const photoDispatch = await dispatchQuoteMessage({
            to: fromNumber,
            from: toNumber,
            text: photoBody,
          })
          if (photoDispatch.ok) {
            console.log('[sms/inbound:after] step 8b — photo-request SMS sent', {
              channel: photoDispatch.channel,
              sid: photoDispatch.sid,
            })
            // Persist as an outbound row so the agent's history reflects it.
            await supabase.from('sms_messages').insert({
              conversation_id: conversationId,
              direction: 'outbound',
              body: photoDispatch.channel === 'whatsapp'
                ? `[WhatsApp fallback] ${photoBody}`
                : photoBody,
              twilio_message_sid: photoDispatch.sid,
            })
            // Stamp the conversation so we don't double-send on a later turn.
            await supabase
              .from('sms_conversations')
              .update({ photo_request_sent_at: new Date().toISOString() })
              .eq('id', conversationId)
          } else {
            console.error('[sms/inbound:after] step 8b — photo-request SMS failed', {
              smsAttempt: photoDispatch.smsAttempt,
              waAttempt: photoDispatch.waAttempt,
            })
          }
        } catch (e: any) {
          console.error('[sms/inbound:after] step 8b — photo-request SMS threw', {
            message: e?.message,
            name: e?.name,
          })
        }
      }

      // 9. Update conversation: bump turn_count, merge assumptions, set status
      //    based on the dialog agent's decision.
      const newStatus =
        decision.action === 'finish' ? 'structuring'
      : decision.action === 'escalate_inspection' ? 'done'
      : 'open'

      const mergedAssumptions = [
        ...initialAssumptions,
        ...decision.assumptions_made,
      ]

      console.log('[sms/inbound:after] step 9 — updating conversation', {
        newStatus,
        mergedAssumptionsCount: mergedAssumptions.length,
      })
      await supabase
        .from('sms_conversations')
        .update({
          turn_count: initialTurnCount + 1,
          last_message_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          assumptions_made: mergedAssumptions,
          status: newStatus,
        })
        .eq('id', conversationId)

      // 10. If the dialog finished, hand off to the existing intake pipeline.
      // Wrapped in withRetry — the customer already got their dialog reply,
      // but the quote depends entirely on this POST landing successfully.
      // Silent failure here = no quote ever drafted = lost customer.
      // 3 attempts, 2s/4s backoff. Runs inside after() so customer doesn't wait.
      if (decision.action === 'finish') {
        console.log('[sms/inbound:after] step 10 — firing intake/structure handoff', { conversationId })
        try {
          await withRetry(
            async () => {
              const res = await fetch(`${process.env.APP_URL}/api/intake/structure`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ conversationId, sourceChannel: 'sms' }),
              })
              if (!res.ok) {
                throw new Error(`intake/structure HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
              }
            },
            {
              maxAttempts: 3,
              baseDelayMs: 2000,
              onAttemptFailed: (err, attempt, willRetry) => {
                const msg = err instanceof Error ? err.message : String(err)
                const tag = willRetry ? 'retrying' : 'EXHAUSTED'
                console.warn(`[sms/inbound:after] intake handoff attempt ${attempt}/3 failed — ${tag}`, msg.slice(0, 200))
              },
            }
          )
        } catch (e: any) {
          // Three attempts failed. This is a critical event — the customer
          // will never receive a quote unless we ship an alerting hook.
          console.error('[sms/inbound:after] intake handoff EXHAUSTED — quote LOST', {
            conversationId,
            error: e?.message ?? String(e),
          })
        }
      }
    } catch (e: any) {
      console.error('[sms/inbound:after] UNHANDLED in after()', {
        message: e?.message,
        name: e?.name,
        stack: e?.stack?.split('\n').slice(0, 6).join('\n'),
      })
    } finally {
      // ─────── Release the per-conversation lock ───────
      // Always runs — whether the work succeeded, threw, or was downgraded
      // to the fallback. Clearing processing_until lets the next inbound
      // SMS (which may be sitting in DB after a failed lock claim) be
      // processed by the next webhook for this customer.
      try {
        await supabase
          .from('sms_conversations')
          .update({ processing_until: null })
          .eq('id', conversationId)
        console.log('[sms/inbound:after] lock released', { conversationId })
      } catch (releaseErr: any) {
        console.error('[sms/inbound:after] lock release failed (will auto-expire in 60s)', {
          conversationId,
          error: releaseErr?.message ?? String(releaseErr),
        })
      }
    }
  })

  console.log('[sms/inbound] step 11 — returning empty TwiML ack (work continues in after())')
  return ackTwiml()
 } catch (err: any) {
  console.error('[sms/inbound] UNHANDLED error', {
    message: err?.message,
    name: err?.name,
    stack: err?.stack?.split('\n').slice(0, 8).join('\n'),
  })
  return new Response(
    JSON.stringify({ error: err?.message ?? String(err) }),
    { status: 500, headers: { 'Content-Type': 'application/json' } },
  )
 }
}
