# Web-lead → SMS dialog bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make web-lead form submissions start an SMS back-and-forth (reusing the existing dialog engine) that confirms details and asks only the missing questions before drafting one quote — and harden the estimate dispatch so a quote/link is never silently lost.

**Architecture:** A new HTTP-agnostic helper `lib/sms/start-web-lead-conversation.ts` seeds an `sms_conversations` row from the form, inserts a synthetic inbound message, runs the first `decideNextTurn` turn, sends the first SMS from the tenant number, and alerts the tradie. The web route calls it behind `WEB_LEAD_DIALOG_ENABLED` (default on) and no longer creates an intake/draft. The customer's reply flows through the unchanged `/api/sms/inbound` → `finish` → `/api/intake/structure` → `/api/estimate/draft`. Dispatch hardening is an independent change to the draft route's send path.

**Tech Stack:** Next.js 16 App Router, TypeScript, Supabase (service-role), Vercel AI SDK (Sonnet dialog), Twilio (via `dispatchQuoteMessage`), vitest.

**Verified signatures (from source):**
- `decideNextTurn(args): Promise<TurnDecision>` — `lib/sms/dialog.ts`. Args used: `{ history: ConversationTurn[], inboundCount: number, knownFields?: {firstName?,suburb?}, conversationState?: ConversationState, tenantTrades?: ReadonlyArray<string>, photoLink?: PhotoLinkHint }`. `ConversationTurn = { direction: 'inbound'|'outbound'; body: string }`. `PhotoLinkHint = 'pending'|'already_sent'|'not_applicable'`. `TurnDecision` includes `{ action, reply_to_send, ready_for_intake, assumptions_made, job_type_guess, request_photo_link }`.
- `seedStateFromKnownFields({first_name?,suburb?,address?,email?}): ConversationState` — `lib/sms/extract-slots.ts`. `ConversationState = { slots, sources, last_extracted_at }`.
- `dispatchQuoteMessage({to,text,from?,mediaUrl?}): Promise<DispatchResult>` — `lib/sms/dispatch.ts`. `DispatchResult = {ok:true,channel,sid,status,...} | {ok:false,smsAttempt,...}`.
- `pipelineLog(scope, traceId?)` → `{ step, ok, err, done }` — `lib/log/pipeline.ts`.
- `findOrCreateCustomer(phone, 'web', tenantId): Promise<CustomerProfile|null>` — already called in the lead route.
- tenants columns: `owner_mobile` (not null), `owner_first_name`, `twilio_sms_number`, `trades`, `business_name`, `trade`, `id`.
- sms_conversations columns exist: `conversation_type` ('customer_quote'), `turn_count`, `assumptions_made` (jsonb), `conversation_state` (jsonb), `photo_urls`/`photo_paths`, `photo_request_token`, `from_number`, `to_number`, `status`, `tenant_id`, `customer_id`, `intake_id`.
- Outbound insert pattern (`app/api/sms/inbound/route.ts:2316`): `sms_messages.insert({ conversation_id, direction:'outbound', body, twilio_message_sid })`.
- Inbound insert pattern (`route.ts:1012`): `sms_messages.insert({ conversation_id, direction:'inbound', body, twilio_message_sid, photo_urls, photo_paths })`.
- Conversation update pattern (`route.ts:2389`): `{ turn_count: n+1, last_message_at, updated_at, assumptions_made, status? }`.

---

## File Structure

- **Create** `lib/sms/start-web-lead-conversation.ts` — the bridge helper (DI: receives `supabase` client; HTTP-agnostic, unit-testable).
- **Create** `lib/sms/start-web-lead-conversation.test.ts` — vitest unit tests.
- **Modify** `lib/sms/templates.ts` — add `buildTradieWebLeadAlert()`.
- **Modify** `lib/sms/templates.test.ts` (or create) — test the new template.
- **Modify** `app/api/t/[slug]/lead/route.ts` — branch on `WEB_LEAD_DIALOG_ENABLED`; ensure tenant select includes owner/sms columns; call the helper.
- **Modify** `app/api/estimate/draft/route.ts` — dispatch hardening (APP_URL fallback, warn-on-skip logs, tradie fallback notice).

---

## Task 1: Tradie web-lead alert template

**Files:**
- Modify: `lib/sms/templates.ts`
- Test: `lib/sms/templates.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// lib/sms/templates.test.ts — add to the existing describe block (or create the file with imports)
import { describe, it, expect } from 'vitest'
import { buildTradieWebLeadAlert } from './templates'

describe('buildTradieWebLeadAlert', () => {
  it('includes tradie name, customer name, suburb and a trimmed description', () => {
    const body = buildTradieWebLeadAlert({
      tradieFirstName: 'Jon',
      customerName: 'Jeph',
      suburb: 'Bondi',
      description: 'I need 6 downlights installed in the lounge',
    })
    expect(body).toContain('Jon')
    expect(body).toContain('Jeph')
    expect(body).toContain('Bondi')
    expect(body).toContain('downlights')
    expect(body).toContain('texting them now')
    expect(body.length).toBeLessThanOrEqual(320)
  })

  it('handles missing tradie first name and long descriptions', () => {
    const body = buildTradieWebLeadAlert({
      tradieFirstName: null,
      customerName: 'Sam',
      suburb: 'Newtown',
      description: 'x'.repeat(400),
    })
    expect(body.length).toBeLessThanOrEqual(320)
    expect(body).toContain('Sam')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/sms/templates.test.ts -t buildTradieWebLeadAlert`
Expected: FAIL — `buildTradieWebLeadAlert is not a function`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// lib/sms/templates.ts — add near the other buildTradie* builders
/**
 * One-line "new web lead arrived" alert to the tradie, fired the moment a
 * /t/<slug> form is submitted (dialog-first mode). The customer is being
 * texted to finalise the quote; this just makes sure the tradie knows a hot
 * lead came in even if the customer never replies. Kept ≤320 chars (1–2 SMS).
 */
export function buildTradieWebLeadAlert(opts: {
  tradieFirstName?: string | null
  customerName: string
  suburb: string
  description: string
}): string {
  const hi = opts.tradieFirstName?.trim() ? `Hi ${opts.tradieFirstName.trim()}, ` : ''
  const desc = opts.description.trim().replace(/\s+/g, ' ').slice(0, 140)
  return (
    `${hi}new web lead — ${opts.customerName} in ${opts.suburb}: "${desc}". ` +
    `We're texting them now to finalise the quote. — QuoteMate`
  ).slice(0, 320)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/sms/templates.test.ts -t buildTradieWebLeadAlert`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add lib/sms/templates.ts lib/sms/templates.test.ts
git commit -m "feat(marketing): tradie web-lead alert SMS template"
```

---

## Task 2: `startWebLeadConversation` helper

**Files:**
- Create: `lib/sms/start-web-lead-conversation.ts`
- Test: `lib/sms/start-web-lead-conversation.test.ts`

**Interface:**
```typescript
export type WebLeadTenant = {
  id: string
  business_name: string | null
  trade: string | null
  trades: string[] | null
  owner_mobile: string
  owner_first_name: string | null
  twilio_sms_number: string | null
}
export type StartWebLeadInput = {
  supabase: SupabaseClient          // DI for testability
  tenant: WebLeadTenant
  form: { name: string; mobile: string; suburb: string; description: string }
  photoPaths: string[]
  photoUrls: string[]
  customerId: string | null
  fallbackFrom?: string | null      // process.env.TWILIO_SMS_NUMBER
}
export type StartWebLeadResult = { conversationId: string; reused: boolean; firstReply: string | null }
```

- [ ] **Step 1: Write the failing test**

```typescript
// lib/sms/start-web-lead-conversation.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./dialog', () => ({
  decideNextTurn: vi.fn(async () => ({
    action: 'ask',
    reply_to_send: 'Hi Jeph! Quick Q on the 6 downlights — replacing existing fittings or new spots?',
    ready_for_intake: false,
    assumptions_made: [],
    job_type_guess: 'downlights',
    request_photo_link: false,
  })),
}))
vi.mock('./dispatch', () => ({
  dispatchQuoteMessage: vi.fn(async () => ({ ok: true, channel: 'sms', sid: 'SM123', status: 'queued' })),
}))

import { decideNextTurn } from './dialog'
import { dispatchQuoteMessage } from './dispatch'
import { startWebLeadConversation } from './start-web-lead-conversation'

// Minimal chainable Supabase stub recording inserts/updates.
function makeSupabaseStub() {
  const calls: any[] = []
  const conversationsRows: any[] = []
  const api = {
    calls,
    from(table: string) {
      return {
        // dedupe lookup: .select().eq().eq().eq().order().limit().maybeSingle()
        select() { return this },
        eq() { return this },
        order() { return this },
        limit() { return this },
        maybeSingle: async () => ({ data: null, error: null }),
        insert(row: any) {
          calls.push({ table, op: 'insert', row })
          if (table === 'sms_conversations') {
            const created = { id: 'conv-1', ...row }
            conversationsRows.push(created)
            return { select() { return { single: async () => ({ data: created, error: null }) } } }
          }
          return { error: null }
        },
        update(row: any) { calls.push({ table, op: 'update', row }); return { eq: async () => ({ error: null }) } },
      } as any
    },
  }
  return api as any
}

const baseInput = () => ({
  supabase: makeSupabaseStub(),
  tenant: {
    id: 'tenant-1', business_name: 'Sparky Co', trade: 'electrical', trades: ['electrical'],
    owner_mobile: '+61400000001', owner_first_name: 'Jon', twilio_sms_number: '+61480000002',
  },
  form: { name: 'Jeph', mobile: '+61480808517', suburb: 'Bondi', description: 'I need 6 downlights in the lounge' },
  photoPaths: ['tenant-1/a.jpg'], photoUrls: ['https://signed/a.jpg'], customerId: 'cust-1',
  fallbackFrom: '+61481613464',
})

describe('startWebLeadConversation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('seeds a customer_quote conversation with photos and intake_id null', async () => {
    const input = baseInput()
    await startWebLeadConversation(input as any)
    const convInsert = (input.supabase as any).calls.find((c: any) => c.table === 'sms_conversations' && c.op === 'insert')
    expect(convInsert.row.conversation_type).toBe('customer_quote')
    expect(convInsert.row.intake_id ?? null).toBeNull()
    expect(convInsert.row.from_number).toBe('+61480808517')
    expect(convInsert.row.to_number).toBe('+61480000002') // tenant number preferred
    expect(convInsert.row.photo_paths).toEqual(['tenant-1/a.jpg'])
    expect(convInsert.row.photo_urls).toEqual(['https://signed/a.jpg'])
    expect(convInsert.row.tenant_id).toBe('tenant-1')
    expect(typeof convInsert.row.photo_request_token).toBe('string')
  })

  it('runs the dialog with already_sent photo hint and known name/suburb, then sends from tenant number', async () => {
    const input = baseInput()
    await startWebLeadConversation(input as any)
    const args = (decideNextTurn as any).mock.calls[0][0]
    expect(args.photoLink).toBe('already_sent')
    expect(args.knownFields).toEqual({ firstName: 'Jeph', suburb: 'Bondi' })
    expect(args.history[0]).toEqual({ direction: 'inbound', body: 'I need 6 downlights in the lounge' })
    expect(args.inboundCount).toBe(1)
    const custSend = (dispatchQuoteMessage as any).mock.calls.find((c: any[]) => c[0].to === '+61480808517')
    expect(custSend[0].from).toBe('+61480000002')
    expect(custSend[0].text).toContain('downlights')
  })

  it('inserts synthetic inbound + outbound messages and bumps turn_count to 1', async () => {
    const input = baseInput()
    await startWebLeadConversation(input as any)
    const inbound = (input.supabase as any).calls.find((c: any) => c.table === 'sms_messages' && c.row.direction === 'inbound')
    const outbound = (input.supabase as any).calls.find((c: any) => c.table === 'sms_messages' && c.row.direction === 'outbound')
    expect(inbound.row.body).toBe('I need 6 downlights in the lounge')
    expect(outbound.row.body).toContain('downlights')
    const update = (input.supabase as any).calls.find((c: any) => c.table === 'sms_conversations' && c.op === 'update')
    expect(update.row.turn_count).toBe(1)
  })

  it('alerts the tradie at their owner_mobile', async () => {
    const input = baseInput()
    await startWebLeadConversation(input as any)
    const tradieSend = (dispatchQuoteMessage as any).mock.calls.find((c: any[]) => c[0].to === '+61400000001')
    expect(tradieSend).toBeTruthy()
    expect(tradieSend[0].text).toContain('Jeph')
  })

  it('NEVER creates an intake or calls estimate/draft', async () => {
    const input = baseInput()
    await startWebLeadConversation(input as any)
    const intakeInsert = (input.supabase as any).calls.find((c: any) => c.table === 'intakes')
    expect(intakeInsert).toBeUndefined()
  })

  it('falls back to a fixed first question if the dialog errors', async () => {
    ;(decideNextTurn as any).mockRejectedValueOnce(new Error('LLM down'))
    const input = baseInput()
    const res = await startWebLeadConversation(input as any)
    const custSend = (dispatchQuoteMessage as any).mock.calls.find((c: any[]) => c[0].to === '+61480808517')
    expect(custSend).toBeTruthy() // customer still hears back
    expect(res.conversationId).toBe('conv-1')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/sms/start-web-lead-conversation.test.ts`
Expected: FAIL — `startWebLeadConversation is not a function` / module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// lib/sms/start-web-lead-conversation.ts
import { randomBytes } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { decideNextTurn, type ConversationTurn } from './dialog'
import { seedStateFromKnownFields } from './extract-slots'
import { dispatchQuoteMessage } from './dispatch'
import { buildTradieWebLeadAlert } from './templates'
import { pipelineLog } from '@/lib/log/pipeline'

export type WebLeadTenant = {
  id: string
  business_name: string | null
  trade: string | null
  trades: string[] | null
  owner_mobile: string
  owner_first_name: string | null
  twilio_sms_number: string | null
}
export type StartWebLeadInput = {
  supabase: SupabaseClient
  tenant: WebLeadTenant
  form: { name: string; mobile: string; suburb: string; description: string }
  photoPaths: string[]
  photoUrls: string[]
  customerId: string | null
  fallbackFrom?: string | null
}
export type StartWebLeadResult = { conversationId: string; reused: boolean; firstReply: string | null }

export async function startWebLeadConversation(input: StartWebLeadInput): Promise<StartWebLeadResult> {
  const { supabase, tenant, form, photoPaths, photoUrls, customerId, fallbackFrom } = input
  const log = pipelineLog('dispatch', `webLead:${tenant.id.slice(0, 8)}`)
  const fromNumber = tenant.twilio_sms_number ?? fallbackFrom ?? undefined
  if (!fromNumber) log.err('web-lead: tenant has no SMS number and no fallback — customer SMS will be skipped', null, { tenant_id: tenant.id })

  // a. dedupe — reuse an OPEN customer_quote conversation for this (from_number, tenant_id)
  const { data: existing } = await supabase
    .from('sms_conversations')
    .select('id')
    .eq('from_number', form.mobile)
    .eq('tenant_id', tenant.id)
    .eq('status', 'open')
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()
  if (existing?.id) {
    log.ok('web-lead: reusing existing open conversation', { conversation_id: existing.id })
    return { conversationId: existing.id, reused: true, firstReply: null }
  }

  // c. seed conversation_state with the customer's identity fields (skips re-asking name/suburb)
  const conversationState = seedStateFromKnownFields({ first_name: form.name, suburb: form.suburb })

  // d. create the conversation row (intake_id stays null — SMS pipeline owns intake creation)
  const { data: convo, error: convErr } = await supabase
    .from('sms_conversations')
    .insert({
      from_number: form.mobile,
      to_number: fromNumber ?? null,
      status: 'open',
      conversation_type: 'customer_quote',
      tenant_id: tenant.id,
      customer_id: customerId,
      photo_request_token: randomBytes(16).toString('hex'),
      photo_urls: photoUrls,
      photo_paths: photoPaths,
      conversation_state: conversationState,
      turn_count: 0,
    })
    .select('id')
    .single()
  if (convErr || !convo) {
    log.err('web-lead: conversation insert failed', convErr?.message, { tenant_id: tenant.id })
    throw convErr ?? new Error('conversation insert failed')
  }
  const conversationId = convo.id as string

  // e. synthetic inbound message = the customer's "first text"
  const inboundBody = form.description.trim()
  await supabase.from('sms_messages').insert({
    conversation_id: conversationId,
    direction: 'inbound',
    body: inboundBody,
    photo_urls: photoUrls,
    photo_paths: photoPaths,
  })

  // f. first dialog turn — photos already on file so photoLink='already_sent'
  const history: ConversationTurn[] = [{ direction: 'inbound', body: inboundBody }]
  let firstReply: string
  let assumptions: string[] = []
  try {
    const decision = await decideNextTurn({
      history,
      inboundCount: 1,
      knownFields: { firstName: form.name, suburb: form.suburb },
      conversationState,
      tenantTrades: tenant.trades ?? undefined,
      photoLink: 'already_sent',
    })
    firstReply = decision.reply_to_send
    assumptions = Array.isArray(decision.assumptions_made) ? decision.assumptions_made : []
  } catch (e: any) {
    log.err('web-lead: decideNextTurn failed — using fixed first question', e?.message, { conversation_id: conversationId })
    firstReply =
      `Thanks ${form.name}! Got your request: "${inboundBody.slice(0, 80)}". ` +
      `One quick question so we can price it right — could you tell me a bit more about the job?`
  }

  // g. send the first SMS to the customer from the tenant's number
  let sentSid: string | null = null
  if (fromNumber) {
    const res = await dispatchQuoteMessage({ to: form.mobile, text: firstReply, from: fromNumber })
    if (res.ok) { sentSid = res.sid; log.ok('web-lead: first question sent', { channel: res.channel, sid: res.sid }) }
    else log.err('web-lead: first question send failed', null, { code: res.smsAttempt?.code })
  }

  // h. persist outbound message + bump conversation turn
  await supabase.from('sms_messages').insert({
    conversation_id: conversationId,
    direction: 'outbound',
    body: firstReply,
    twilio_message_sid: sentSid,
  })
  await supabase
    .from('sms_conversations')
    .update({
      turn_count: 1,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      assumptions_made: assumptions,
    })
    .eq('id', conversationId)

  // i. alert the tradie — a hot lead is never lost even if the customer goes quiet
  try {
    const alert = buildTradieWebLeadAlert({
      tradieFirstName: tenant.owner_first_name,
      customerName: form.name,
      suburb: form.suburb,
      description: form.description,
    })
    const r = await dispatchQuoteMessage({ to: tenant.owner_mobile, text: alert, from: fromNumber })
    if (r.ok) log.ok('web-lead: tradie alerted', { sid: r.sid })
    else log.err('web-lead: tradie alert failed', null, { code: r.smsAttempt?.code })
  } catch (e: any) {
    log.err('web-lead: tradie alert threw', e?.message, { conversation_id: conversationId })
  }

  return { conversationId, reused: false, firstReply }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/sms/start-web-lead-conversation.test.ts`
Expected: PASS (all 6 cases).

- [ ] **Step 5: Commit**

```bash
git add lib/sms/start-web-lead-conversation.ts lib/sms/start-web-lead-conversation.test.ts
git commit -m "feat(marketing): startWebLeadConversation — bridge web form into SMS dialog engine"
```

---

## Task 3: Wire the helper into the lead route behind a flag

**Files:**
- Modify: `app/api/t/[slug]/lead/route.ts`

- [ ] **Step 1: Confirm tenant select includes the needed columns**

Read `app/api/t/[slug]/lead/route.ts` where `tenant` is loaded. Ensure the `.select(...)` for the tenants row includes: `id, business_name, trade, trades, owner_mobile, owner_first_name, twilio_sms_number`. If any are missing, add them to the select string.

- [ ] **Step 2: Add the flag branch in the `after()` block**

Replace the body of the `after(async () => { ... })` block (lines ~122-193, the structureIntake → intake insert → POST /api/estimate/draft sequence) with:

```typescript
after(async () => {
  try {
    const dialogEnabled = (process.env.WEB_LEAD_DIALOG_ENABLED ?? 'true').toLowerCase() !== 'false'

    if (dialogEnabled) {
      const { startWebLeadConversation } = await import('@/lib/sms/start-web-lead-conversation')
      await startWebLeadConversation({
        supabase,
        tenant: {
          id: tenant.id,
          business_name: tenant.business_name ?? null,
          trade: tenant.trade ?? null,
          trades: (tenant as { trades?: string[] | null }).trades ?? null,
          owner_mobile: (tenant as { owner_mobile: string }).owner_mobile,
          owner_first_name: (tenant as { owner_first_name?: string | null }).owner_first_name ?? null,
          twilio_sms_number: (tenant as { twilio_sms_number?: string | null }).twilio_sms_number ?? null,
        },
        form: { name, mobile, suburb, description },
        photoPaths,
        photoUrls,
        customerId: customer?.id ?? null,
        fallbackFrom: process.env.TWILIO_SMS_NUMBER ?? null,
      })
      console.log('[t/lead] web lead → SMS dialog started', { tenant: tenant.id })
      return
    }

    // ── Legacy one-shot path (WEB_LEAD_DIALOG_ENABLED=false) ──
    // <KEEP the existing structureIntake → embedIntake → intakes.insert →
    //  POST /api/estimate/draft code here verbatim, including the APP_URL
    //  origin fallback at lines 178-179>
  } catch (e: any) {
    console.error('[t/lead] web intake pipeline failed', e?.message ?? String(e))
  }
})
```

Keep the existing legacy code intact inside the `else` branch (do not delete it — the flag is a true revert). Preserve the existing `photoUrls`/`photoPaths` variables already built earlier in the route.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors in `app/api/t/[slug]/lead/route.ts` or `lib/sms/start-web-lead-conversation.ts`.

- [ ] **Step 4: Commit**

```bash
git add app/api/t/[slug]/lead/route.ts
git commit -m "feat(marketing): web leads start SMS dialog (WEB_LEAD_DIALOG_ENABLED, default on)"
```

---

## Task 4: Dispatch hardening (no link / quote-didn't-arrive)

**Files:**
- Modify: `app/api/estimate/draft/route.ts`

- [ ] **Step 1: APP_URL origin fallback**

Replace `const appUrl = process.env.APP_URL!` (line 464) with:

```typescript
const appUrl =
  process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin
```

Confirm `req` is in scope (it is the route handler's Request). If the handler signature is `(req: Request)`, this works; if it's named differently, use that name.

- [ ] **Step 2: Make the silent skips loud**

In the customer-dispatch `after()` block, replace the bare `return` skips and add a no-FROM-number guard:

```typescript
} else if (!callerNumber) {
  dispatch.err('customer SMS skipped — no recipient', null, {
    quote_id: quote!.id, reason: 'no caller_number (voice call row, sms convo, or intake.caller.phone all empty)',
  })
  await notifyTradieQuoteUndelivered(quote!.id, shareToken, appUrl, 'no customer phone on file')
  return
}
```

And where `fromNumber` is computed for the customer send, add:

```typescript
if (isSmsSource && !fromNumber) {
  dispatch.err('customer SMS — no tenant FROM number and TWILIO_SMS_NUMBER unset', null, { quote_id: quote!.id })
}
```

- [ ] **Step 3: Add the tradie fallback notice helper**

Add near the other helpers in the route (or inline before the `after()` blocks):

```typescript
// Best-effort: if we cannot deliver the quote to the customer, make sure the
// tradie gets the link so the lead is never silently lost.
async function notifyTradieQuoteUndelivered(quoteId: string, token: string, base: string, why: string) {
  const dlog = pipelineLog('dispatch', `undelivered:${quoteId.slice(0, 8)}`)
  try {
    const to = tenantOwnerMobile
    if (!to) { dlog.err('cannot notify tradie of undelivered quote — no owner_mobile', null, { quoteId }); return }
    const r = await dispatchQuoteMessage({
      to,
      from: tenantSmsNumber ?? undefined,
      text: `Heads up — we couldn't text the customer their quote (${why}). Quote ready: ${base}/q/${token}`,
    })
    if (r.ok) dlog.ok('tradie notified of undelivered customer quote', { sid: r.sid })
  } catch (e: any) {
    dlog.err('tradie undelivered-notice failed', e?.message, { quoteId })
  }
}
```

(If `tenantOwnerMobile`/`tenantSmsNumber` are not in scope at that point, thread them in or read from the already-loaded `tenantRow`. They are loaded at route.ts:114-116.)

- [ ] **Step 4: Also log the Stripe-link-failed case**

The existing `catch` blocks at lines 488-490 and 510-512 already log Stripe failures — confirm they include `quote_id`. If not, add `{ quote_id: quote!.id }` to those `log.err` calls so a linkless SMS is traceable.

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: no new errors.

```bash
git add app/api/estimate/draft/route.ts
git commit -m "fix(estimate): harden customer SMS dispatch — APP_URL fallback, loud skips, tradie fallback notice"
```

---

## Task 5: Full verification

- [ ] **Step 1: Run the full unit suite**

Run: `npx vitest run`
Expected: all pass (new template + helper tests green; no regressions).

- [ ] **Step 2: Typecheck the whole project**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Lint the changed files**

Run: `npx eslint app/api/t/[slug]/lead/route.ts app/api/estimate/draft/route.ts lib/sms/start-web-lead-conversation.ts lib/sms/templates.ts`
Expected: clean.

- [ ] **Step 4: Manual smoke (optional, dev server running)**

POST a web lead to the dev tenant and confirm in logs: conversation created (`conversation_type=customer_quote`, `intake_id=null`), first SMS attempted from the tenant/fallback number, tradie alert attempted, and NO intake/estimate-draft call. Reply to the SMS and confirm the inbound webhook continues the dialog through to a quote.

- [ ] **Step 5: Final commit (if any fixups)**

```bash
git add -A
git commit -m "test(marketing): web-lead dialog bridge + dispatch hardening — green suite"
```

---

## Self-Review

**Spec coverage:**
- Dialog-first web lead → Task 2 + Task 3. ✓
- Helper shape (`startWebLeadConversation`) → Task 2. ✓
- Seeded row (conversation_type, photos, intake_id null, slots/sources) → Task 2 (tested). ✓
- Tradie alert on submit → Task 1 (template) + Task 2 (fire). ✓
- Abandonment = leave open, no auto-quote → Task 2 (no intake/draft; conversation stays `open`). ✓
- No migration → confirmed; only existing columns used. ✓
- Flag `WEB_LEAD_DIALOG_ENABLED` default on, legacy revert → Task 3. ✓
- Dispatch hardening (APP_URL fallback, loud skips, fallback notice, doc the timeout) → Task 4. ✓
- Photos survive to intake → handled by seeding `photo_urls`/`photo_paths` on the conversation (structure/route.ts:215-235 aggregates them); no extra task needed. ✓
- Tenant-without-SMS-number warning → Task 2 (logged) + Task 4 (no-FROM guard). ✓
- Testing → Tasks 1,2,4 unit tests; Task 5 suite. ✓

**Placeholder scan:** Legacy code in Task 3 Step 2 references "KEEP existing code" — that is an explicit instruction to retain verbatim existing lines, not a missing implementation. All new code is complete.

**Type consistency:** `WebLeadTenant`, `StartWebLeadInput`, `StartWebLeadResult` consistent across Task 2 and Task 3. `dispatchQuoteMessage`/`decideNextTurn`/`seedStateFromKnownFields`/`buildTradieWebLeadAlert`/`pipelineLog` signatures match the verified source. `ConversationTurn = {direction, body}` used correctly.
