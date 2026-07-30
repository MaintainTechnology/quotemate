// lib/quote/send-customer — pure send policy + customer contact resolution
// shared by the manual send endpoint and the approve route.

import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  buildQuoteEmail,
  canSendQuote,
  confirmSendCta,
  resolveCustomerContact,
} from '@/lib/quote/send-customer'

// Table-keyed supabase stub: .from(t).select().eq().maybeSingle() resolves the
// preset row for that table (null when absent). Tracks which tables were hit.
function stubSupabase(rows: Record<string, Record<string, unknown> | null>, hits: string[] = []) {
  return {
    from(table: string) {
      hits.push(table)
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        limit: () => builder,
        maybeSingle: async () => ({ data: rows[table] ?? null, error: null }),
      }
      return builder
    },
  } as unknown as SupabaseClient
}

function throwingSupabase() {
  return {
    from() {
      throw new Error('connection refused')
    },
  } as unknown as SupabaseClient
}

describe('canSendQuote', () => {
  it('denies paid and accepted quotes', () => {
    expect(canSendQuote('paid').ok).toBe(false)
    expect(canSendQuote('accepted').ok).toBe(false)
  })

  it('allows every pre-payment state, including held and legacy statuses', () => {
    for (const s of ['draft', 'sent', 'viewed', 'awaiting_tradie_approval', 'inspection', null, undefined]) {
      expect(canSendQuote(s).ok).toBe(true)
    }
  })

  it('names a reason when denying', () => {
    const r = canSendQuote('paid')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBeTruthy()
  })
})

describe('confirmSendCta', () => {
  it('hides once the customer has committed: deposit paid, paid or accepted', () => {
    expect(confirmSendCta('draft', true).show).toBe(false)
    expect(confirmSendCta('paid', false).show).toBe(false)
    expect(confirmSendCta('accepted', false).show).toBe(false)
  })

  it('offers a resend for quotes the customer already has', () => {
    expect(confirmSendCta('sent', false)).toEqual({ show: true, label: 'Send to Customer' })
    expect(confirmSendCta('viewed', false)).toEqual({ show: true, label: 'Send to Customer' })
  })

  it('offers Confirm & Send for every pre-send state, held and legacy included', () => {
    for (const s of ['draft', 'awaiting_tradie_approval', 'inspection', null, undefined]) {
      expect(confirmSendCta(s, false)).toEqual({ show: true, label: 'Confirm & Send' })
    }
  })
})

describe('resolveCustomerContact', () => {
  const args = {
    caller: null as { phone?: string; email?: string } | null,
    intakeId: 'intake-1' as string | null,
    callId: 'call-1' as string | null,
    customerId: 'cust-1' as string | null,
  }

  it('prefers intake.caller.phone when present', async () => {
    const c = await resolveCustomerContact(stubSupabase({}), {
      ...args,
      caller: { phone: '+61411111111' },
    })
    expect(c.phone).toBe('+61411111111')
  })

  it('treats an empty-string caller phone as missing and falls back to sms_conversations', async () => {
    const c = await resolveCustomerContact(
      stubSupabase({ sms_conversations: { from_number: '+61422222222' } }),
      { ...args, caller: { phone: '' } },
    )
    expect(c.phone).toBe('+61422222222')
  })

  it('falls back to calls.caller_number when no conversation row exists', async () => {
    const c = await resolveCustomerContact(
      stubSupabase({ calls: { caller_number: '+61433333333' } }),
      args,
    )
    expect(c.phone).toBe('+61433333333')
  })

  it('falls back to customers.phone last', async () => {
    const c = await resolveCustomerContact(
      stubSupabase({ customers: { phone_number: '+61444444444', email: null } }),
      args,
    )
    expect(c.phone).toBe('+61444444444')
  })

  it('returns null phone when no source has a number', async () => {
    const c = await resolveCustomerContact(stubSupabase({}), args)
    expect(c.phone).toBeNull()
  })

  it('skips lookups whose id is missing', async () => {
    const hits: string[] = []
    await resolveCustomerContact(stubSupabase({}, hits), {
      caller: null,
      intakeId: null,
      callId: null,
      customerId: null,
    })
    expect(hits).toEqual([])
  })

  it('resolves email from intake.caller.email first, then customers.email', async () => {
    const fromCaller = await resolveCustomerContact(
      stubSupabase({ customers: { phone_number: null, email: 'row@example.com' } }),
      { ...args, caller: { email: 'caller@example.com' } },
    )
    expect(fromCaller.email).toBe('caller@example.com')

    const fromCustomer = await resolveCustomerContact(
      stubSupabase({ customers: { phone_number: null, email: 'row@example.com' } }),
      { ...args, caller: { email: '' } },
    )
    expect(fromCustomer.email).toBe('row@example.com')

    const none = await resolveCustomerContact(stubSupabase({}), args)
    expect(none.email).toBeNull()
  })

  it('never throws — a failing query resolves to nulls', async () => {
    const c = await resolveCustomerContact(throwingSupabase(), args)
    expect(c).toEqual({ phone: null, email: null })
  })

  it('a throw in one source does not abort the later sources', async () => {
    // sms_conversations throws; calls should still be consulted.
    const supabase = {
      from(table: string) {
        if (table === 'sms_conversations') throw new Error('transient network blip')
        const builder = {
          select: () => builder,
          eq: () => builder,
          order: () => builder,
          limit: () => builder,
          maybeSingle: async () => ({
            data: table === 'calls' ? { caller_number: '+61433333333' } : null,
            error: null,
          }),
        }
        return builder
      },
    } as unknown as SupabaseClient
    const c = await resolveCustomerContact(supabase, args)
    expect(c.phone).toBe('+61433333333')
  })
})

describe('buildQuoteEmail', () => {
  const base = {
    businessName: 'Pilot Sparky',
    customerName: 'Jon Smith',
    jobType: 'reroof',
    quoteUrl: 'https://www.quotemax.com.au/q/tok_abc',
    pdfAttached: true,
  }

  it('subject names the business and the html links the quote', () => {
    const e = buildQuoteEmail(base)
    expect(e.subject).toContain('Pilot Sparky')
    expect(e.html).toContain(base.quoteUrl)
    expect(e.text).toContain(base.quoteUrl)
  })

  it('greets by first name and falls back to "there"', () => {
    expect(buildQuoteEmail(base).html).toContain('Hi Jon')
    expect(buildQuoteEmail({ ...base, customerName: null }).html).toContain('Hi there')
  })

  it('mentions the attached PDF only when one is attached', () => {
    expect(buildQuoteEmail(base).html.toLowerCase()).toContain('pdf')
    expect(buildQuoteEmail({ ...base, pdfAttached: false }).html.toLowerCase()).not.toContain('attached')
  })
})
