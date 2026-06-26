// Tests for the send-once welcome-email orchestration. The single-send +
// retry-on-failure guarantees are the whole point, so they're exercised
// against a fake supabase that records every claim/release UPDATE and an
// injected sendEmail so nothing touches the network or DB.

import { describe, expect, it, vi } from 'vitest'
import {
  sendWelcomeEmailOnce,
  type WelcomeEmailTenantRow,
} from '@/lib/onboard/welcome-email'
import type { SendEmailOptions } from '@/lib/email/resend'

type ClaimResult = { data: Array<{ id: string }> | null; error: { message: string } | null }

/**
 * Minimal chainable supabase stub. The claim chain ends in `.select('id')`
 * (resolves to the configured claim result); the release chain is awaited
 * directly after `.eq(...)` (resolves to {error:null}). Every UPDATE is
 * recorded with its payload + filters so tests can assert claim vs release.
 */
function fakeSupabase(claim: ClaimResult) {
  const updates: Array<{ payload: Record<string, unknown>; filters: Array<[string, unknown]> }> = []
  function chain(payload: Record<string, unknown>) {
    const rec = { payload, filters: [] as Array<[string, unknown]> }
    const builder: any = {
      eq(col: string, val: unknown) {
        rec.filters.push([col, val])
        return builder
      },
      is(col: string, val: unknown) {
        rec.filters.push([col, val])
        return builder
      },
      // Claim path — the conditional update + RETURNING id.
      select() {
        updates.push(rec)
        return Promise.resolve(claim)
      },
      // Release path — `await update().eq().eq()` (no .select()).
      then(resolve: (v: { error: null }) => unknown, reject: (e: unknown) => unknown) {
        updates.push(rec)
        return Promise.resolve({ error: null }).then(resolve, reject)
      },
    }
    return builder
  }
  const supabase = {
    from(_table: string) {
      return { update: (payload: Record<string, unknown>) => chain(payload) }
    },
  }
  return { supabase, updates }
}

const okSend = () =>
  vi.fn(async (_opts: SendEmailOptions) => ({ ok: true as const, messageId: 'msg_welcome_1' }))

function tenant(overrides: Partial<WelcomeEmailTenantRow> = {}): WelcomeEmailTenantRow {
  return {
    id: 'tenant-1',
    status: 'active',
    welcome_email_sent_at: null,
    owner_email: 'alex@sparky.com.au',
    business_name: 'Pilot Sparky Electrical',
    owner_first_name: 'Alex',
    twilio_sms_number: '+61481613464',
    trades: ['electrical'],
    ...overrides,
  }
}

const DEPS = { appUrl: 'https://app.example.com', nowIso: '2026-06-26T00:00:00.000Z' }

describe('sendWelcomeEmailOnce — happy path', () => {
  it('claims the row, sends the email, and reports sent', async () => {
    const { supabase, updates } = fakeSupabase({ data: [{ id: 'tenant-1' }], error: null })
    const send = okSend()

    const out = await sendWelcomeEmailOnce(supabase as any, tenant(), { ...DEPS, sendEmail: send })

    expect(out).toEqual({ ok: true, sent: true, messageId: 'msg_welcome_1' })

    // Exactly one UPDATE — the claim, stamping the timestamp we passed in.
    expect(updates).toHaveLength(1)
    expect(updates[0].payload).toEqual({ welcome_email_sent_at: DEPS.nowIso })
    // Claim is guarded on still-NULL + active.
    expect(updates[0].filters).toContainEqual(['welcome_email_sent_at', null])
    expect(updates[0].filters).toContainEqual(['status', 'active'])

    // The email went to the owner, with the welcome subject + dashboard URL.
    expect(send).toHaveBeenCalledTimes(1)
    const arg = send.mock.calls[0][0]
    expect(arg.to).toBe('alex@sparky.com.au')
    expect(arg.subject).toContain('Welcome to QuoteMax')
    expect(arg.html).toContain('https://app.example.com/dashboard')
  })
})

describe('sendWelcomeEmailOnce — idempotency / eligibility', () => {
  it('does nothing when the email was already sent (column set)', async () => {
    const { supabase, updates } = fakeSupabase({ data: [], error: null })
    const send = okSend()
    const out = await sendWelcomeEmailOnce(
      supabase as any,
      tenant({ welcome_email_sent_at: '2026-06-01T00:00:00.000Z' }),
      { ...DEPS, sendEmail: send },
    )
    expect(out).toEqual({ ok: true, sent: false, reason: 'already_sent' })
    expect(send).not.toHaveBeenCalled()
    expect(updates).toHaveLength(0) // no claim attempted
  })

  it('does nothing when the tenant is not active yet', async () => {
    const { supabase, updates } = fakeSupabase({ data: [], error: null })
    const send = okSend()
    const out = await sendWelcomeEmailOnce(supabase as any, tenant({ status: 'onboarding' }), {
      ...DEPS,
      sendEmail: send,
    })
    expect(out).toEqual({ ok: true, sent: false, reason: 'not_active' })
    expect(send).not.toHaveBeenCalled()
    expect(updates).toHaveLength(0)
  })

  it('does nothing when there is no recipient email', async () => {
    const { supabase } = fakeSupabase({ data: [], error: null })
    const send = okSend()
    const out = await sendWelcomeEmailOnce(supabase as any, tenant({ owner_email: null }), {
      ...DEPS,
      sendEmail: send,
    })
    expect(out).toEqual({ ok: true, sent: false, reason: 'no_recipient' })
    expect(send).not.toHaveBeenCalled()
  })

  it('does nothing when the business name is missing', async () => {
    const { supabase } = fakeSupabase({ data: [], error: null })
    const send = okSend()
    const out = await sendWelcomeEmailOnce(supabase as any, tenant({ business_name: ' ' }), {
      ...DEPS,
      sendEmail: send,
    })
    expect(out).toEqual({ ok: true, sent: false, reason: 'no_business_name' })
    expect(send).not.toHaveBeenCalled()
  })

  it('treats a lost claim race (zero rows updated) as already_sent — no send', async () => {
    // Eligible row in memory, but the conditional UPDATE matched nothing
    // (a concurrent dashboard load already claimed it).
    const { supabase } = fakeSupabase({ data: [], error: null })
    const send = okSend()
    const out = await sendWelcomeEmailOnce(supabase as any, tenant(), { ...DEPS, sendEmail: send })
    expect(out).toEqual({ ok: true, sent: false, reason: 'already_sent' })
    expect(send).not.toHaveBeenCalled()
  })
})

describe('sendWelcomeEmailOnce — failure handling', () => {
  it('surfaces a claim error without sending', async () => {
    const { supabase } = fakeSupabase({ data: null, error: { message: 'permission denied' } })
    const send = okSend()
    const out = await sendWelcomeEmailOnce(supabase as any, tenant(), { ...DEPS, sendEmail: send })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toMatch(/claim_failed: permission denied/)
    expect(send).not.toHaveBeenCalled()
  })

  it('RELEASES the claim (resets to NULL) when the send fails, so it retries later', async () => {
    const { supabase, updates } = fakeSupabase({ data: [{ id: 'tenant-1' }], error: null })
    const send = vi.fn(async (_opts: SendEmailOptions) => ({
      ok: false as const,
      code: 'http_422',
      reason: 'invalid to',
    }))

    const out = await sendWelcomeEmailOnce(supabase as any, tenant(), { ...DEPS, sendEmail: send })

    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toMatch(/send_failed: invalid to/)

    // Two UPDATEs: the claim (stamp), then the release (back to NULL), the
    // release guarded on the exact timestamp we wrote.
    expect(updates).toHaveLength(2)
    expect(updates[0].payload).toEqual({ welcome_email_sent_at: DEPS.nowIso })
    expect(updates[1].payload).toEqual({ welcome_email_sent_at: null })
    expect(updates[1].filters).toContainEqual(['welcome_email_sent_at', DEPS.nowIso])
  })
})
