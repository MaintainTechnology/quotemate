// ─────────────────────────────────────────────────────────────────────────
// Sandbox turn runner — drives THIS service's real pipeline from the web
// chat. Two modes, chosen by content.ts:
//
//   'message-sync'   (Front Desk) — POST its own /api/front-desk/message,
//                    which classifies, forwards and returns the replies.
//   'simulate-poll'  (receptionists) — POST its own /api/receptionist/
//                    simulate (202, fire-and-forget), then poll the shared
//                    Supabase for the outbound reply the pipeline writes.
//
// Both call localhost only; the service key is read server-side and never
// reaches the browser. This is LIVE FIRE: real rows, and a real SMS to the
// From number if it is a real mobile.
// Canonical copy: quotemate-automation/scripts/web-surface/sandbox.service.ts
// ─────────────────────────────────────────────────────────────────────────

import { Injectable } from '@nestjs/common'
import { createClient } from '@supabase/supabase-js'
import { CONTENT } from './content'

export interface SandboxResult {
  ok: boolean
  replies: string[]
  meta?: string
  error?: string
}

const POLL_EVERY_MS = 2_500
// Roofing measure turns can run minutes; keep the browser call bounded and
// tell the operator the reply may land later.
const WAIT_MS = Number(process.env.SANDBOX_WAIT_MS ?? 150_000)
// After the first reply, wait briefly for multi-part follow-ups.
const SETTLE_MS = 4_000

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

@Injectable()
export class SandboxService {
  private base(): string {
    return `http://127.0.0.1:${process.env.PORT ?? 8080}`
  }

  async runTurn(from: string, to: string, body: string): Promise<SandboxResult> {
    const key = process.env[CONTENT.sandbox.keyEnv]
    if (!key) {
      return { ok: false, replies: [], error: `${CONTENT.sandbox.keyEnv} is not configured on this service` }
    }
    return CONTENT.sandbox.mode === 'message-sync'
      ? this.messageSync(from, to, body, key)
      : this.simulateAndPoll(from, to, body, key)
  }

  /** Front Desk shape — its /message endpoint already waits for and returns
   *  the replies, so this is a single localhost round trip. */
  private async messageSync(from: string, to: string, body: string, key: string): Promise<SandboxResult> {
    try {
      const res = await fetch(`${this.base()}${CONTENT.sandbox.path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [CONTENT.sandbox.keyHeader]: key },
        body: JSON.stringify({ from, to, body }),
      })
      const text = await res.text()
      let json: Record<string, unknown> = {}
      try { json = JSON.parse(text) } catch { /* keep raw */ }
      if (!res.ok) {
        const msg = (json as { message?: string }).message ?? text.slice(0, 300)
        return { ok: false, replies: [], error: `${res.status}: ${msg}` }
      }
      const replies = Array.isArray((json as { replies?: unknown }).replies)
        ? ((json as { replies: unknown[] }).replies).map(String)
        : []
      const decision = (json as { decision?: { trade?: string; reason?: string } }).decision
      const timedOut = Boolean((json as { repliesTimedOut?: boolean }).repliesTimedOut)
      return {
        ok: true,
        replies,
        meta: [
          decision?.trade ? `routed to ${decision.trade}` : null,
          decision?.reason ?? null,
          timedOut ? 'reply still running — it will arrive as SMS' : null,
        ].filter(Boolean).join(' · ') || undefined,
      }
    } catch (e) {
      return { ok: false, replies: [], error: e instanceof Error ? e.message : String(e) }
    }
  }

  /** Receptionist shape — simulate returns 202 immediately, the pipeline
   *  writes its reply to sms_messages, and we watermark-poll for it. */
  private async simulateAndPoll(from: string, to: string, body: string, key: string): Promise<SandboxResult> {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseKey) return { ok: false, replies: [], error: 'Supabase is not configured' }
    const db = createClient(supabaseUrl, supabaseKey)

    // Watermark BEFORE the turn starts, from the DB's own clock ordering:
    // the newest outbound already in the thread. Everything after it is
    // this turn's reply. No client clock involved.
    const conversationId = async (): Promise<string | null> => {
      const { data } = await db
        .from('sms_conversations')
        .select('id')
        .eq('from_number', from)
        .eq('to_number', to)
        .order('last_message_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      return (data as { id: string } | null)?.id ?? null
    }

    const preConvo = await conversationId()
    let watermark: string | null = null
    if (preConvo) {
      const { data } = await db
        .from('sms_messages')
        .select('created_at')
        .eq('conversation_id', preConvo)
        .eq('direction', 'outbound')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      watermark = (data as { created_at: string } | null)?.created_at ?? null
    }

    try {
      const res = await fetch(`${this.base()}${CONTENT.sandbox.path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [CONTENT.sandbox.keyHeader]: key },
        body: JSON.stringify({ from, to, body }),
      })
      if (!res.ok) {
        const text = (await res.text()).slice(0, 300)
        const hint = res.status === 403 && CONTENT.sandbox.enableFlag
          ? ` — is ${CONTENT.sandbox.enableFlag}=1 set on this service?`
          : ''
        return { ok: false, replies: [], error: `simulate answered ${res.status}: ${text}${hint}` }
      }
    } catch (e) {
      return { ok: false, replies: [], error: e instanceof Error ? e.message : String(e) }
    }

    const deadline = Date.now() + WAIT_MS
    while (Date.now() < deadline) {
      await sleep(POLL_EVERY_MS)
      const convo = await conversationId()
      if (!convo) continue
      let q = db
        .from('sms_messages')
        .select('body, created_at')
        .eq('conversation_id', convo)
        .eq('direction', 'outbound')
        .order('created_at', { ascending: true })
        .limit(10)
      if (watermark) q = q.gt('created_at', watermark)
      const { data } = await q
      const rows = (data ?? []) as { body: string; created_at: string }[]
      if (rows.length) {
        await sleep(SETTLE_MS) // catch multi-part sends
        const { data: more } = watermark
          ? await db.from('sms_messages').select('body, created_at').eq('conversation_id', convo)
              .eq('direction', 'outbound').gt('created_at', watermark)
              .order('created_at', { ascending: true }).limit(10)
          : { data: rows }
        return { ok: true, replies: ((more ?? rows) as { body: string }[]).map((m) => String(m.body)) }
      }
    }
    return {
      ok: true,
      replies: [],
      meta: `no reply within ${Math.round(WAIT_MS / 1000)}s — the turn may still be running (a roof measure can take minutes); any reply goes out as a real SMS`,
    }
  }
}
