import { createHmac } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Real route, signature validator, and durable worker; database and external
// providers are offline fixtures. SQL isolation and live delivery are separate.
const h = vi.hoisted(() => {
  process.env.SMS_RECEPTIONIST_ENABLED = '1'
  type Row = Record<string, unknown>
  const state = {
    job: null as Row | null,
    reads: [] as string[],
    writes: [] as Array<{ table: string; action: string; payload: Row }>,
    enqueueError: false,
  }
  const client = {
    rpc: vi.fn(async (name: string, args: Row) => {
      if (name === 'enqueue_sms_work') {
        if (state.enqueueError) return { data: null, error: { message: 'receipt unavailable' } }
        state.job ??= {
          id: 'inbound-work-1', kind: args.p_kind, work_key: args.p_key,
          serial_key: args.p_serial_key, turn_id: args.p_turn_id,
          tenant_id: null, payload: args.p_payload, sequence: 1,
          status: 'pending', attempts: 0, checkpoint: {}, result: null,
        }
        return { data: state.job, error: null }
      }
      if (name === 'claim_sms_work') {
        if (!state.job || state.job.status === 'completed') return { data: [], error: null }
        state.job.status = 'running'
        state.job.owner_token = 'worker-owner-1'
        state.job.attempts = Number(state.job.attempts) + 1
        return { data: [state.job], error: null }
      }
      if (name === 'assert_sms_work_owner') return { data: true, error: null }
      if (name === 'finish_sms_work' && state.job) {
        state.job.status = args.p_error ? 'retry' : 'completed'
        state.job.last_error = args.p_error ?? null
        if (args.p_result) state.job.result = args.p_result
        return { data: true, error: null }
      }
      throw new Error(`Unexpected worker RPC: ${name}`)
    }),
    from(table: string) {
      state.reads.push(table)
      let action = 'read'
      let payload: Row = {}
      const query: Record<string, unknown> = {}
      for (const method of ['select', 'eq', 'is', 'order', 'limit', 'maybeSingle', 'single']) {
        query[method] = () => query
      }
      for (const method of ['insert', 'update', 'upsert']) {
        query[method] = (row: Row) => { action = method; payload = row; return query }
      }
      query.then = (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => {
        if (action !== 'read') state.writes.push({ table, action, payload })
        return Promise.resolve({
          data: action === 'insert' ? { id: 'registration-1' } : null,
          error: null,
        }).then(resolve, reject)
      }
      return query
    },
  }
  return {
    state, client,
    tenantLookup: vi.fn(async () => null),
    findCustomer: vi.fn(), dialog: vi.fn(), extract: vi.fn(),
    classify: vi.fn(), send: vi.fn(), signup: vi.fn(),
  }
})

vi.mock('@supabase/supabase-js', () => ({ createClient: () => h.client }))
vi.mock('@/lib/tenant/lookup', () => ({
  tenantByDestinationSms: h.tenantLookup,
  isProvisionedAgentNumber: async () => null,
  isTransactableTenantStatus: () => true,
}))
vi.mock('@/lib/customers/lookup', () => ({
  findOrCreateCustomer: h.findCustomer,
  formatCustomerContext: () => '',
  writeCustomerCorrections: vi.fn(),
}))
vi.mock('@/lib/sms/dialog', () => ({ decideNextTurn: h.dialog }))
vi.mock('@/lib/sms/extract-slots', async (original) => ({
  ...await original<object>(), extractSlots: h.extract,
}))
vi.mock('@/lib/sms/intent', () => ({ classifyIntent: h.classify }))
vi.mock('@/lib/sms/twilio', () => ({ sendSms: h.send }))
vi.mock('@/lib/onboard/intent-tokens', () => ({ createOrGetActiveIntent: h.signup }))
vi.mock('@/lib/onboard/invitation-codes', () => ({ checkInvitationCode: async () => ({ ok: true }) }))
vi.mock('@/lib/quote/pdf', () => ({ ensureRoofQuotePdf: vi.fn(), roofQuotePdfUrl: vi.fn(), signQuotePdfUrl: vi.fn() }))
vi.mock('@/lib/sms/roofing-measure-dispatch', () => ({ measureAndDispatchRoofing: vi.fn(), ROOFING_APP_BASE_URL: 'https://quotemax.com.au' }))
vi.mock('@/lib/sms/painting-estimate-dispatch', () => ({ estimateAndDispatchPainting: vi.fn() }))
vi.mock('@/lib/sms/solar-receptionist', () => ({ handleSolarSmsTurn: vi.fn() }))
vi.mock('@/lib/filestore/ingest-quote', () => ({ archiveAndIngestQuote: vi.fn() }))
vi.mock('@/lib/roofing/roof-after', () => ({ generateRoofAfterImage: vi.fn() }))

import { runSmsWorkBatch } from '@/lib/sms/durable-work'
import { POST } from './route'

const URL = 'https://quotemax.com.au/api/sms/inbound'
const AUTH_TOKEN = 'offline-tenant-boundary-fixture'
function request(body = 'Please quote two downlights', signed = true) {
  const params: Record<string, string> = {
    From: '+61411111111', To: '+61488888888', MessageSid: 'SM-tenant-boundary', Body: body,
  }
  const signaturePayload = URL + Object.keys(params).sort().map(key => key + params[key]).join('')
  return new Request(URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': signed ? createHmac('sha1', AUTH_TOKEN).update(signaturePayload).digest('base64') : 'invalid',
    },
    body: new URLSearchParams(params),
  })
}
const drain = () => runSmsWorkBatch({ inbound: POST }, { db: h.client as unknown as SupabaseClient, limit: 1 })

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('SMS_RECEPTIONIST_ENABLED', '1')
  vi.stubEnv('TWILIO_AUTH_TOKEN', AUTH_TOKEN)
  vi.stubEnv('PUBLIC_WEB_ORIGIN', 'https://quotemax.com.au')
  h.state.job = null
  h.state.reads = []
  h.state.writes = []
  h.state.enqueueError = false
  h.classify.mockResolvedValue({ intent: 'customer_quote', source: 'regex_customer' })
  h.signup.mockResolvedValue({ token: 'offline-signup-token', reused: false })
  h.send.mockResolvedValue({ ok: true, sid: 'SM-signup-reply' })
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

describe('unmatched SMS destination tenant boundary', () => {
  it('persists a signed receipt before ACK and defers all tenant and model work', async () => {
    const response = await POST(request())

    expect(response.status).toBe(200)
    expect(response.headers.get('x-quotemax-job-id')).toBe('inbound-work-1')
    expect(await response.text()).toContain('<Response')
    expect(h.state.job).toMatchObject({ status: 'pending', kind: 'inbound', tenant_id: null })
    expect(h.tenantLookup).not.toHaveBeenCalled()
    expect(h.classify).not.toHaveBeenCalled()
    expect(h.state.reads).toEqual([])
    expect(h.state.writes).toEqual([])
  })

  it('rejects unsigned traffic before creating any receipt', async () => {
    expect((await POST(request(undefined, false))).status).toBe(403)
    expect(h.client.rpc).not.toHaveBeenCalled()
    expect(h.state.job).toBeNull()
  })

  it('does not ACK success if durable receipt persistence fails', async () => {
    h.state.enqueueError = true
    expect((await POST(request())).status).toBe(500)
    expect(h.state.job).toBeNull()
    expect(h.tenantLookup).not.toHaveBeenCalled()
  })

  it('retains the missing-tenant recovery reason without customer quote work', async () => {
    await POST(request())
    expect(await drain()).toEqual([{ id: 'inbound-work-1', ok: false }])

    expect(h.state.job).toMatchObject({ status: 'retry', result: null })
    expect(h.state.job?.last_error).toContain('Pipeline HTTP 500')
    expect(h.state.job?.last_error).toContain('sms_tenant_unresolved')
    expect(h.findCustomer).not.toHaveBeenCalled()
    expect(h.dialog).not.toHaveBeenCalled()
    expect(h.extract).not.toHaveBeenCalled()
    expect(h.send).not.toHaveBeenCalled()
    expect(h.state.writes).toEqual([])
    for (const table of ['customers', 'intakes', 'quotes']) {
      expect(h.state.reads).not.toContain(table)
    }
    expect(h.client.rpc.mock.calls.filter(([name]) => name === 'enqueue_sms_work')).toHaveLength(1)
  })

  it('keeps shared-number signup available and drains its reply before completion', async () => {
    h.classify.mockResolvedValue({ intent: 'tradie_registration', source: 'regex_tradie' })
    expect((await POST(request('JOIN TEST-CODE'))).status).toBe(200)
    expect(await drain()).toEqual([{ id: 'inbound-work-1', ok: true }])

    expect(h.signup).toHaveBeenCalledOnce()
    expect(h.send).toHaveBeenCalledOnce()
    expect(h.state.job).toMatchObject({ status: 'completed', result: { status: 200 } })
    expect(h.findCustomer).not.toHaveBeenCalled()
    expect(h.dialog).not.toHaveBeenCalled()
    expect(h.extract).not.toHaveBeenCalled()
    const createdConversations = h.state.writes.filter(row => row.table === 'sms_conversations' && row.action === 'insert')
    expect(createdConversations).toHaveLength(1)
    expect(createdConversations[0].payload.conversation_type).toBe('tradie_registration')
    expect(h.state.writes.every(row => ['sms_conversations', 'sms_messages'].includes(row.table))).toBe(true)
  })
})
