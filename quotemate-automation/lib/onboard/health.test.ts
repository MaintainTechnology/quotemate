// Unit tests for tenant-health stub detection + the required/info verdict
// (spec A1/A2/A6). The stub detectors are the backstop that stops a
// stub-mode tenant from ever being reported production-ready.

import { describe, expect, it } from 'vitest'
import { isStubTwilioNumber, isStubVapiId, checkTenantHealth } from './health'

describe('stub detection', () => {
  it('flags deterministic stub Twilio numbers', () => {
    expect(isStubTwilioNumber('+61482012345')).toBe(true)
    expect(isStubTwilioNumber('+61412345678')).toBe(false) // real-shaped
    expect(isStubTwilioNumber(null)).toBe(false)
    expect(isStubTwilioNumber(undefined)).toBe(false)
    expect(isStubTwilioNumber('')).toBe(false)
  })

  it('flags stub Vapi assistant ids', () => {
    expect(isStubVapiId('vapi-stub-abcd1234')).toBe(true)
    expect(isStubVapiId('asst_real_123')).toBe(false)
    expect(isStubVapiId(null)).toBe(false)
  })
})

// Minimal supabase mock for checkTenantHealth. Each table resolves the
// queries health.ts makes; we model a fully-healthy electrical tenant and
// then a stub-number tenant.
function mockSupabase(tenant: Record<string, any>, opts: {
  pricing?: any[]
  assemblies?: any[]
  offerings?: any[]
  licences?: number
  provenance?: number
} = {}) {
  const pricing = opts.pricing ?? [{ trade: 'electrical', hourly_rate: 110 }]
  const assemblies = opts.assemblies ?? [{ id: 'a1', trade: 'electrical' }]
  const offerings = opts.offerings ?? [{ assembly_id: 'a1' }]
  return {
    from(table: string) {
      const api: any = {
        select(_cols: string, selOpts?: { count?: string; head?: boolean }) {
          const head = selOpts?.head
          const chain: any = {
            eq(_col: string, _val: string) {
              return chain
            },
            in(_col: string, _vals: string[]) {
              return chain
            },
            single() {
              if (table === 'tenants') return Promise.resolve({ data: tenant, error: null })
              return Promise.resolve({ data: null, error: null })
            },
            then(resolve: (v: any) => void) {
              // terminal await on a list/count query
              if (table === 'pricing_book') return resolve({ data: pricing, error: null })
              if (table === 'shared_assemblies') return resolve({ data: assemblies, error: null })
              if (table === 'tenant_service_offerings') return resolve({ data: offerings, error: null })
              if (table === 'tenant_licences') return resolve({ count: opts.licences ?? 1, error: null })
              if (table === 'tenant_feature_sources') return resolve({ count: opts.provenance ?? 1, error: null })
              return resolve({ data: [], count: 0, error: null })
            },
          }
          // count+head queries (trade_prompts via readiness) resolve to count
          if (head) {
            chain.then = (resolve: (v: any) => void) => {
              if (table === 'shared_assemblies') return resolve({ count: assemblies.length, error: null })
              if (table === 'tenant_licences') return resolve({ count: opts.licences ?? 1, error: null })
              if (table === 'tenant_feature_sources') return resolve({ count: opts.provenance ?? 1, error: null })
              return resolve({ count: 0, error: null })
            }
          }
          // trade_prompts maybeSingle (from trade-readiness)
          chain.maybeSingle = () => Promise.resolve({ data: null, error: null })
          return chain
        },
      }
      return api
    },
  } as any
}

describe('checkTenantHealth', () => {
  it('reports a true stub tenant (no Twilio SID) as Incomplete (A2 backstop)', async () => {
    const tenant = {
      id: 't1',
      business_name: 'Stub Co',
      status: 'active',
      activated_at: '2026-06-01T00:00:00Z',
      owner_user_id: 'u1',
      trade: 'electrical',
      trades: ['electrical'],
      twilio_sms_number: '+61482012345', // stub-shaped...
      twilio_number_sid: null, // ...and no SID → confirmed stub
      vapi_assistant_id: 'vapi-stub-abcd1234', // stub
    }
    const sb = mockSupabase(tenant)
    const health = await checkTenantHealth(sb, 't1', { checkWebhook: false })
    expect(health.ready).toBe(false)
    expect(health.requiredFailures).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Twilio'),
        expect.stringContaining('Vapi'),
      ]),
    )
  })

  it('treats a real number in the stub band as real when a Twilio SID is on file (BUG-15)', async () => {
    const tenant = {
      id: 't2',
      business_name: 'Oak Crest',
      status: 'active',
      activated_at: '2026-06-01T00:00:00Z',
      owner_user_id: 'u1',
      trade: 'electrical',
      trades: ['electrical'],
      twilio_sms_number: '+61482012345', // stub-SHAPED, but...
      twilio_number_sid: 'PN0123456789abcdef0123456789abcdef', // ...a real Twilio SID is on file
      vapi_assistant_id: 'asst_real_123',
    }
    const sb = mockSupabase(tenant)
    const health = await checkTenantHealth(sb, 't2', { checkWebhook: false })
    const twilio = health.checks.find((c) => c.key === 'twilio_number')!
    expect(twilio.level).toBe('required')
    expect(twilio.ok).toBe(true)
    expect(health.requiredFailures).not.toContain('Real Twilio number')
  })

  it('marks a no-SID, real-shaped number as unverified (neutral, non-blocking) — never stub', async () => {
    const tenant = {
      id: 't3',
      business_name: 'Unverified Co',
      status: 'active',
      activated_at: '2026-06-01T00:00:00Z',
      owner_user_id: 'u1',
      trade: 'electrical',
      trades: ['electrical'],
      twilio_sms_number: '+61412345678', // real-shaped, NOT the stub band
      twilio_number_sid: null, // no SID yet (e.g. backfill not run)
      vapi_assistant_id: 'asst_real_123',
    }
    const sb = mockSupabase(tenant)
    const health = await checkTenantHealth(sb, 't3', { checkWebhook: false })
    const twilio = health.checks.find((c) => c.key === 'twilio_number')!
    expect(twilio.level).toBe('info') // neutral, non-blocking
    expect(twilio.ok).toBe(true)
    expect(twilio.detail).toMatch(/unverified|no Twilio SID/i)
    // Not asserted as a stub, and does not block readiness.
    expect(health.requiredFailures).not.toContain('Twilio number unverified')
    expect(health.requiredFailures).not.toContain('Real Twilio number')
  })
})
