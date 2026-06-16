import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the heavy dialog + dispatch deps so the unit test never touches the LLM
// or Twilio. The dialog returns a downlights "ask" turn; dispatch always succeeds.
vi.mock('./dialog', () => ({
  decideNextTurn: vi.fn(async () => ({
    action: 'ask',
    job_type_guess: 'downlights',
    reply_to_send: 'Hi Jeph! Quick Q on the 6 downlights — replacing existing fittings or new spots?',
    assumptions_made: [],
    ready_for_intake: false,
    reason_for_escalation: null,
    request_photo_link: false,
    offer_product_choice: false,
  })),
}))
vi.mock('./dispatch', () => ({
  dispatchQuoteMessage: vi.fn(async () => ({ ok: true, channel: 'sms', sid: 'SM123', status: 'queued' })),
}))

import { decideNextTurn } from './dialog'
import { dispatchQuoteMessage } from './dispatch'
import { startWebLeadConversation } from './start-web-lead-conversation'

type RecordedCall = { table: string; op: 'insert' | 'update'; row: Record<string, unknown> }

// Minimal chainable Supabase stub that records inserts/updates and returns a
// created conversation id. Dedupe lookup resolves to no existing row.
function makeSupabaseStub() {
  const calls: RecordedCall[] = []
  const api = {
    calls,
    from(table: string) {
      return {
        select() { return this },
        eq() { return this },
        order() { return this },
        limit() { return this },
        maybeSingle: async () => ({ data: null, error: null }),
        insert(row: Record<string, unknown>) {
          calls.push({ table, op: 'insert', row })
          if (table === 'sms_conversations') {
            const created = { id: 'conv-1', ...row }
            return { select() { return { single: async () => ({ data: created, error: null }) } } }
          }
          return { error: null }
        },
        update(row: Record<string, unknown>) {
          calls.push({ table, op: 'update', row })
          return { eq: async () => ({ error: null }) }
        },
      } as unknown as Record<string, unknown>
    },
  }
  return api
}

const baseInput = () => ({
  supabase: makeSupabaseStub() as never,
  tenant: {
    id: 'tenant-1', business_name: 'Sparky Co', trade: 'electrical', trades: ['electrical'],
    owner_mobile: '+61400000001', owner_first_name: 'Jon', twilio_sms_number: '+61480000002',
  },
  form: { name: 'Jeph', mobile: '+61480808517', suburb: 'Bondi', description: 'I need 6 downlights in the lounge' },
  photoPaths: ['tenant-1/a.jpg'], photoUrls: ['https://signed/a.jpg'], customerId: 'cust-1',
  fallbackFrom: '+61481613464',
})

const callsOf = (input: ReturnType<typeof baseInput>) =>
  (input.supabase as unknown as { calls: RecordedCall[] }).calls
const dispatchCalls = () => (dispatchQuoteMessage as unknown as { mock: { calls: { 0: { to: string; from?: string; text: string } }[] } }).mock.calls

describe('startWebLeadConversation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('seeds a customer_quote conversation with photos and intake_id null', async () => {
    const input = baseInput()
    await startWebLeadConversation(input)
    const convInsert = callsOf(input).find(c => c.table === 'sms_conversations' && c.op === 'insert')!
    expect(convInsert.row.conversation_type).toBe('customer_quote')
    expect(convInsert.row.intake_id ?? null).toBeNull()
    expect(convInsert.row.from_number).toBe('+61480808517')
    expect(convInsert.row.to_number).toBe('+61480000002') // tenant number preferred over fallback
    expect(convInsert.row.photo_paths).toEqual(['tenant-1/a.jpg'])
    expect(convInsert.row.photo_urls).toEqual(['https://signed/a.jpg'])
    expect(convInsert.row.tenant_id).toBe('tenant-1')
    expect(typeof convInsert.row.photo_request_token).toBe('string')
  })

  it('runs the dialog with already_sent photo hint + known name/suburb, sends from tenant number', async () => {
    const input = baseInput()
    await startWebLeadConversation(input)
    const args = (decideNextTurn as unknown as { mock: { calls: [Record<string, unknown>][] } }).mock.calls[0][0] as {
      photoLink: string; knownFields: unknown; history: { direction: string; body: string }[]; inboundCount: number
    }
    expect(args.photoLink).toBe('already_sent')
    expect(args.knownFields).toEqual({ firstName: 'Jeph', suburb: 'Bondi' })
    expect(args.history[0]).toEqual({ direction: 'inbound', body: 'I need 6 downlights in the lounge' })
    expect(args.inboundCount).toBe(1)
    const custSend = dispatchCalls().find(c => c[0].to === '+61480808517')!
    expect(custSend[0].from).toBe('+61480000002')
    expect(custSend[0].text).toContain('downlights')
  })

  it('inserts synthetic inbound + outbound messages and bumps turn_count to 1', async () => {
    const input = baseInput()
    await startWebLeadConversation(input)
    const inbound = callsOf(input).find(c => c.table === 'sms_messages' && c.row.direction === 'inbound')!
    const outbound = callsOf(input).find(c => c.table === 'sms_messages' && c.row.direction === 'outbound')!
    expect(inbound.row.body).toBe('I need 6 downlights in the lounge')
    expect(outbound.row.body).toContain('downlights')
    const update = callsOf(input).find(c => c.table === 'sms_conversations' && c.op === 'update')!
    expect(update.row.turn_count).toBe(1)
  })

  it('alerts the tradie at their owner_mobile', async () => {
    const input = baseInput()
    await startWebLeadConversation(input)
    const tradieSend = dispatchCalls().find(c => c[0].to === '+61400000001')!
    expect(tradieSend).toBeTruthy()
    expect(tradieSend[0].text).toContain('Jeph')
  })

  it('NEVER creates an intake', async () => {
    const input = baseInput()
    await startWebLeadConversation(input)
    const intakeInsert = callsOf(input).find(c => c.table === 'intakes')
    expect(intakeInsert).toBeUndefined()
  })

  it('falls back to a fixed first question if the dialog errors', async () => {
    ;(decideNextTurn as unknown as { mockRejectedValueOnce: (e: Error) => void }).mockRejectedValueOnce(new Error('LLM down'))
    const input = baseInput()
    const res = await startWebLeadConversation(input)
    const custSend = dispatchCalls().find(c => c[0].to === '+61480808517')!
    expect(custSend).toBeTruthy() // customer still hears back
    expect(custSend[0].text).toContain('quick question')
    expect(res.conversationId).toBe('conv-1')
  })

  it('reuses an existing open conversation (double-submit dedupe)', async () => {
    const input = baseInput()
    // Override maybeSingle to return an existing conversation.
    const stub = input.supabase as unknown as { from: (t: string) => Record<string, unknown> }
    const realFrom = stub.from.bind(stub)
    stub.from = (table: string) => {
      const obj = realFrom(table) as Record<string, unknown> & { maybeSingle: () => Promise<unknown> }
      if (table === 'sms_conversations') obj.maybeSingle = async () => ({ data: { id: 'existing-9' }, error: null })
      return obj
    }
    const res = await startWebLeadConversation(input)
    expect(res).toEqual({ conversationId: 'existing-9', reused: true, firstReply: null })
    expect(dispatchCalls().length).toBe(0) // no new SMS on reuse
  })
})
