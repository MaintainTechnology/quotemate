import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  checkpoints: new Map<string, unknown>(), lostCheckpoint: '', jobId: 'work-one',
  dispatch: vi.fn(), publish: vi.fn(),
}))
vi.mock('./durable-work', () => ({
  currentSmsWork: () => h.jobId ? { jobId: h.jobId } : undefined,
  smsWorkCheckpoint: async (name: string, operation: () => Promise<unknown>) => {
    if (h.checkpoints.has(name)) return h.checkpoints.get(name)
    const result = await operation()
    if (h.lostCheckpoint === name) { h.lostCheckpoint = ''; throw new Error('Checkpoint response lost') }
    h.checkpoints.set(name, result)
    return result
  },
}))
vi.mock('./dispatch', () => ({ dispatchQuoteMessage: h.dispatch }))
vi.mock('./reply-publication', () => ({ recordSmsReply: h.publish }))
vi.mock('./public-origin', () => ({ publicWebOrigin: () => 'https://quotemax.com.au' }))

import { handlePlumbingFormOffer } from './plumbing-form-offer'
import { decideFormOfferTurn, plumbingFormOfferEnabled } from './form-offer'
import { mergeSlotUpdates, normaliseState } from './extract-slots'

function fixture() {
  const leads = new Map<string, Record<string, unknown>>()
  const events: string[] = []
  const writes: Array<{ table: string; payload: Record<string, unknown>; filters: Record<string, unknown> }> = []
  const fail = { lead: false, pin: false, readback: false }
  const db = {
    from(table: string) {
      const filters: Record<string, unknown> = {}
      let payload: Record<string, unknown> = {}, action = 'select'
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => { filters[key] = value; return query },
        maybeSingle: () => query,
        upsert: (row: Record<string, unknown>, options: unknown) => {
          expect(options).toEqual({ onConflict: 'token', ignoreDuplicates: true })
          payload = row; action = 'upsert'; return query
        },
        update: (row: Record<string, unknown>) => { payload = row; action = 'update'; return query },
        then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
          let data: unknown = null, error: unknown = null
          if (action !== 'select') {
            writes.push({ table, payload, filters }); events.push(`${table}:${action}`)
          }
          if (table === 'trade_lead_requests' && action === 'upsert') {
            if (fail.lead) error = { message: 'offline insert failure' }
            else if (!leads.has(String(payload.token))) leads.set(String(payload.token), { ...payload })
          } else if (table === 'trade_lead_requests') {
            const lead = leads.get(String(filters.token))
            if (!fail.readback && lead && Object.entries(filters).every(([key, value]) => lead[key] === value)) data = { token: lead.token }
          } else if (table === 'sms_conversations' && action === 'update') {
            if (fail.pin) error = { message: 'offline fenced update failure' }
            else if (filters.id === 'conversation-one' && filters.tenant_id === 'tenant-one') data = { id: filters.id }
          } else throw new Error(`Unexpected table/action ${table}:${action}`)
          return Promise.resolve({ data, error }).then(resolve, reject)
        },
      }
      return query
    },
  } as unknown as SupabaseClient
  const args = { db, tenantId: 'tenant-one', conversationId: 'conversation-one',
    customerPhone: '+61411111111', fromNumber: '+61488888888', state: normaliseState({}),
    firstName: 'Sam', inbound: 'My tap is leaking', agentHasReplied: false, suppressed: false, initialTurnCount: 2 }
  h.dispatch.mockImplementation(async () => {
    events.push('dispatch'); return { ok: true, sid: 'SM-offline', status: 'accepted', outboxId: 'outbox-one' }
  })
  return { args, leads, events, writes, fail }
}

beforeEach(() => {
  vi.clearAllMocks(); h.checkpoints.clear(); h.lostCheckpoint = ''; h.jobId = 'work-one'
})

describe('checkpointed plumbing form offer (offline provider/database fixtures)', () => {
  it('saves an owned lead and conversation pin before sending the review-first form offer', async () => {
    const f = fixture()
    const result = await handlePlumbingFormOffer(f.args)
    expect(result.handled).toBe(true)
    expect(result.state.form_offer).toMatchObject({ step: 'offer_form', token: expect.stringMatching(/^[a-f0-9]{32}$/) })
    expect([...f.leads.values()]).toEqual([expect.objectContaining({ tenant_id: 'tenant-one', conversation_id: 'conversation-one', trade: 'plumbing', status: 'pending' })])
    expect(f.events).toEqual(['trade_lead_requests:upsert', 'sms_conversations:update', 'dispatch'])
    expect(f.writes[1]).toMatchObject({ filters: { id: 'conversation-one', tenant_id: 'tenant-one' }, payload: { turn_count: 3 } })
    expect(h.dispatch).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-one', conversationId: 'conversation-one', deliveryKey: 'plumbing-form:work-one:offer',
      text: expect.stringContaining('the tradie will review your request before any quote is sent') }))
    expect(h.dispatch.mock.calls[0][0].text).toContain('/quote-request/' + result.state.form_offer?.token)
    expect(h.dispatch.mock.calls[0][0].text).not.toMatch(/text your quote straight/)
  })

  it('replays the frozen plan without another token, conversation mutation, or provider call', async () => {
    const f = fixture()
    const first = await handlePlumbingFormOffer(f.args)
    const second = await handlePlumbingFormOffer({ ...f.args, agentHasReplied: true, inbound: 'new extraction after retry' })
    expect(second).toEqual(first); expect(f.leads.size).toBe(1)
    expect(f.writes).toHaveLength(2); expect(h.dispatch).toHaveBeenCalledTimes(1)
  })

  it('does not reset a submitted lead when its successful write checkpoint was lost', async () => {
    const f = fixture(); h.lostCheckpoint = 'plumbing_form_lead'
    await expect(handlePlumbingFormOffer(f.args)).rejects.toThrow('Checkpoint response lost')
    const lead = [...f.leads.values()][0]; lead.status = 'submitted'
    await handlePlumbingFormOffer(f.args)
    expect(f.leads.size).toBe(1); expect([...f.leads.values()][0].status).toBe('submitted')
    expect(f.writes.filter(write => write.table === 'trade_lead_requests').map(write => write.payload.token)).toEqual([lead.token, lead.token])
  })

  it('does not create a lead or send before the random bearer token plan is checkpointed', async () => {
    const f = fixture(); h.lostCheckpoint = 'plumbing_form_plan'
    await expect(handlePlumbingFormOffer(f.args)).rejects.toThrow('Checkpoint response lost')
    expect(f.leads.size).toBe(0); expect(f.writes).toEqual([]); expect(h.dispatch).not.toHaveBeenCalled()
    await handlePlumbingFormOffer(f.args)
    expect(f.leads.size).toBe(1); expect(h.dispatch).toHaveBeenCalledTimes(1)
  })

  it('reuses the delivery key after carrier acceptance but lost reply checkpoint', async () => {
    const f = fixture(); h.lostCheckpoint = 'plumbing_form_reply'
    await expect(handlePlumbingFormOffer(f.args)).rejects.toThrow('Checkpoint response lost')
    await handlePlumbingFormOffer(f.args)
    expect(h.dispatch).toHaveBeenCalledTimes(2)
    expect(h.dispatch.mock.calls[1][0]).toEqual(h.dispatch.mock.calls[0][0])
    expect(f.writes).toHaveLength(2)
  })

  it.each(['lead', 'pin', 'readback'] as const)('stops before any reply when %s persistence/ownership fails', async failure => {
    const f = fixture(); f.fail[failure] = true
    await expect(handlePlumbingFormOffer(f.args)).rejects.toThrow(/Plumbing form/)
    expect(h.dispatch).not.toHaveBeenCalled()
  })

  it('lets uncertain delivery fail for worker recovery instead of falling through to a second answer', async () => {
    const f = fixture(); h.dispatch.mockResolvedValue({ ok: false, status: 'uncertain', outboxId: 'outbox-one' })
    await expect(handlePlumbingFormOffer(f.args)).rejects.toThrow('awaiting durable delivery recovery')
    expect(h.publish).not.toHaveBeenCalled(); expect(h.checkpoints.has('plumbing_form_reply')).toBe(false)
  })

  it('acknowledges form choice without minting another lead', async () => {
    const f = fixture()
    f.args.state.form_offer = { token: 'existing-token', step: 'offer_form' }
    f.args.inbound = "I'll use the form"
    const result = await handlePlumbingFormOffer(f.args)
    expect(result.state.form_offer).toEqual({ token: 'existing-token', step: 'await_form' })
    expect(f.leads.size).toBe(0); expect(result.handled).toBe(true)
    expect(h.dispatch.mock.calls[0][0].deliveryKey).toBe('plumbing-form:work-one:acknowledge')
  })

  it('preserves gathered details and resumes dialog without sending a separate form reply', async () => {
    const f = fixture()
    f.args.state = normaliseState({ slots: { address: '12 Smith St, Brisbane QLD 4000' }, form_offer: { token: 'existing-token', step: 'offer_form' } })
    f.args.inbound = 'No, ask me here'
    const result = await handlePlumbingFormOffer(f.args)
    expect(result.handled).toBe(false); expect(result.state.form_offer?.step).toBe('gather')
    expect(result.state.slots.address).toBe('12 Smith St, Brisbane QLD 4000')
    expect(f.writes[0].payload).not.toHaveProperty('turn_count'); expect(h.dispatch).not.toHaveBeenCalled()
  })

  it('suppresses an already pinned stop/busy conversation without writes or replies', async () => {
    const f = fixture(); f.args.state.form_offer = { token: 'existing-token', step: 'offer_form' }; f.args.suppressed = true
    expect((await handlePlumbingFormOffer(f.args)).handled).toBe(false)
    expect(f.writes).toEqual([]); expect(h.dispatch).not.toHaveBeenCalled()
  })

  it('requires both an owned work context and tenant identity', async () => {
    const f = fixture(); h.jobId = ''
    await expect(handlePlumbingFormOffer(f.args)).rejects.toThrow('owned recoverable SMS work')
    h.jobId = 'work-one'
    await expect(handlePlumbingFormOffer({ ...f.args, tenantId: '' })).rejects.toThrow('owned recoverable SMS work')
    expect(f.writes).toEqual([])
  })
})

describe('plumbing-only form compatibility', () => {
  it.each([
    [['plumbing'], null, 'plumbing', true], [['electrical'], 'plumbing', 'plumbing', false],
    [['plumbing', 'electrical'], 'electrical', 'platform', false], [['plumbing', 'electrical'], 'plumbing', 'platform', true],
    [['plumbing'], null, 'platform', true], [['plumbing', 'electrical'], 'plumbing', 'electrical', false],
  ])('scopes %j/%s to service %s (%s)', (trades, jobTrade, service, expected) => {
    expect(plumbingFormOfferEnabled(trades, jobTrade, service as string)).toBe(expected)
  })
  it('retains only validated pins through normalization and extraction', () => {
    const pin = { token: 'existing-token', step: 'offer_form' }
    const state = normaliseState({ form_offer: pin })
    expect(mergeSlotUpdates(state, { first_name: 'Sam' }).form_offer).toEqual(pin)
    expect(normaliseState({ form_offer: { token: '', step: 'offer_form' } }).form_offer).toBeNull()
    expect(normaliseState({ form_offer: { token: 'x', step: 'unknown' } }).form_offer).toBeNull()
    expect(decideFormOfferTurn({ pin: state.form_offer, suppressed: true, agentHasReplied: true, inbound: "I'll use the form" })).toBe('none')
  })
})
