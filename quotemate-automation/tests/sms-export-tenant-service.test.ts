import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { createSourceFile, isFunctionDeclaration, ModuleKind, ScriptTarget, transpileModule } from 'typescript'
import { describe, expect, it, vi } from 'vitest'

const exporter = readFileSync('scripts/export-receptionist.mjs', 'utf8')
const parsed = createSourceFile('export-receptionist.mjs', exporter, ScriptTarget.Latest, true)
function exporterFunction<T>(name: string): T {
  const declaration = parsed.statements.find(statement => isFunctionDeclaration(statement) && statement.name?.text === name)
  if (!declaration) throw new Error(`Missing exporter function: ${name}`)
  return runInNewContext(`(${declaration.getText(parsed)})`) as T
}
const scope = exporterFunction<(source: string) => string>('scopeDialogToService')
const strip = exporterFunction<(source: string) => string>('stripRetirementGuard')
const scopeSlots = exporterFunction<(source: string) => string>('scopeSlotExtractor')
const serviceModule = exporterFunction<(trade: string) => string>('serviceDialogModule')
const canonical = readFileSync('app/api/sms/inbound/route.ts', 'utf8')
const transformed = scope(scopeSlots(strip(canonical)))
const compile = (source: string) => transpileModule(source, {
  compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
}).outputText
const inboundCode = compile(transformed)
const trades = ['electrical', 'plumbing', 'roofing', 'painting', 'solar'] as const

function runtime(trade: string, tenant: Record<string, unknown> | null, signup = false) {
  const dialog = vi.fn(() => { throw new Error('Unexpected model call') })
  const effects: string[] = []
  const callbacks: Array<() => unknown> = []
  const inserts: Array<{ table: string; body: Record<string, unknown> }> = []
  const customer = vi.fn(async () => { throw new Error('customer_boundary') })
  const registrationIntent = vi.fn(async () => ({ intent: signup ? 'tradie_registration' : 'customer_quote' }))
  const service = { exports: {} as Record<string, unknown> }
  runInNewContext(compile(serviceModule(trade)), { module: service, exports: service.exports,
    require: () => ({ decideNextTurn: dialog, decideScopedFallback: dialog }),
  })
  const db = { from(table: string) {
    effects.push(`db:${table}`)
    const query = {
      select: () => query, eq: () => query, order: () => query, limit: () => query,
      maybeSingle: async () => ({ data: null, error: null }),
      single: async () => ({ data: { id: 'signup-conversation' }, error: null }),
      insert: (body: Record<string, unknown>) => { inserts.push({ table, body }); return query },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve),
    }
    return query
  } }
  const runtimeModule = { exports: {} as { POST?: (request: Request) => Promise<Response> } }
  const modules: Record<string, unknown> = {
    '@supabase/supabase-js': { createClient: () => db },
    '@/lib/sms/durable-work': {
      currentSmsWork: () => ({ id: 'worker-1' }), assertSmsWorkOwnership: async () => {},
      attributeSmsWorkTenant: async () => {}, withFencedSmsClient: (client: unknown) => client,
      durableAfter: (callback: () => unknown) => callbacks.push(callback),
    },
    '@/lib/sms/delivery-context': { updateSmsDeliveryContext: () => {} },
    '@/lib/sms/twilio-validator': { parseTwilioForm: (raw: string) => Object.fromEntries(new URLSearchParams(raw)),
      validateTwilioSignature: () => true },
    '@/lib/sms/send-reliability': { getDeliveryKnobs: () => ({ maxDurationSec: 300 }) },
    '@/lib/tenant/lookup': { tenantByDestinationSms: async () => tenant, isProvisionedAgentNumber: async () => null,
      isTransactableTenantStatus: (status: unknown) => status === 'active' },
    '@/lib/customers/lookup': { findOrCreateCustomer: customer },
    '@/lib/customers/memory-scope': { customerMemoryAllowed: () => false, stripCustomerMemory: () => null },
    '@/lib/sms/service-dialog': service.exports,
    '@/lib/sms/intent': { classifyIntent: registrationIntent },
  }
  runInNewContext(inboundCode, { module: runtimeModule, exports: runtimeModule.exports, Response, URL, Error,
    process: { env: {} }, console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    require: (name: string) => modules[name] ?? new Proxy({}, { get: (_target, key) => () => {
      effects.push(`unexpected:${name}:${String(key)}`)
      throw new Error(`Unexpected dependency effect: ${name}:${String(key)}`)
    } }),
  })
  const request = () => new Request('https://fixture.invalid/api/sms/inbound', {
    method: 'POST', body: new URLSearchParams({ From: '+61400000000', To: '+61411111111', Body: signup ? 'I want to sign up' : 'Please quote my job' }),
  })
  return { post: () => runtimeModule.exports.POST!(request()), customer, dialog, effects, callbacks, inserts, registrationIntent,
    enabled: service.exports.serviceTradeEnabled as (value: unknown) => boolean }
}

describe('standalone tenant-service ingress authority', () => {
  it.each(trades)('%s generated helper requires the explicit enabled service', trade => {
    const { enabled } = runtime(trade, null)
    for (const value of [undefined, null, [], '', trade, {}, [trade.toUpperCase()], ['disabled'], { includes: () => true }]) {
      expect(enabled(value)).toBe(false)
    }
    expect(enabled([trade])).toBe(true)
    expect(enabled(['another', trade])).toBe(true)
  })

  it.each(trades)('%s full transformed POST rejects missing, empty or disabled trades before customer/model work', async trade => {
    for (const enabledTrades of [undefined, null, [], ['another'], trade]) {
      // Legacy singular trade does not substitute for the disabled trades list.
      const h = runtime(trade, { id: 'tenant-1', status: 'active', trade, trades: enabledTrades })
      const response = await h.post()
      expect(response.status).toBe(200)
      expect(await response.text()).toContain('<Response/>')
      expect(h.customer).not.toHaveBeenCalled()
      expect(h.dialog).not.toHaveBeenCalled()
      expect(h.registrationIntent).not.toHaveBeenCalled()
      expect(h.effects).toEqual([])
      expect(h.callbacks).toEqual([])
      expect(h.inserts).toEqual([])
    }
  })

  it.each(trades)('%s enabled active tenant reaches its original customer boundary', async trade => {
    const h = runtime(trade, { id: 'tenant-1', status: 'active', trades: [trade] })
    const response = await h.post()
    expect(response.status).toBe(500) // Deliberate offline stop at first customer call.
    expect(await response.text()).toContain('customer_boundary')
    expect(h.customer).toHaveBeenCalledWith('+61400000000', 'sms', 'tenant-1')
    expect(h.dialog).not.toHaveBeenCalled()
  })

  it.each(trades)('%s preserves no-tenant signup without enabling customer quoting', async trade => {
    const h = runtime(trade, null, true)
    expect((await h.post()).status).toBe(200)
    expect(h.registrationIntent).toHaveBeenCalledOnce()
    expect(h.inserts).toContainEqual({ table: 'sms_conversations', body: expect.objectContaining({ conversation_type: 'tradie_registration' }) })
    expect(h.callbacks).toHaveLength(1) // Invitation-code request; never executed against a provider.
    expect(h.customer).not.toHaveBeenCalled()
    expect(h.dialog).not.toHaveBeenCalled()
    expect(h.effects.every(effect => effect === 'db:sms_conversations' || effect === 'db:sms_messages')).toBe(true)
  })

  it('retains inactive-tenant denial even when the service is enabled', async () => {
    const h = runtime('electrical', { id: 'tenant-1', status: 'suspended', trades: ['electrical'] })
    expect((await h.post()).status).toBe(200)
    expect(h.customer).not.toHaveBeenCalled()
    expect(h.effects).toEqual([])
  })

  it('fails export rather than silently omitting a moved or duplicated ingress anchor', () => {
    for (const anchor of ["import { decideNextTurn, type ConversationTurn } from '@/lib/sms/dialog'",
      '  // ─────── Customer memory lookup ───────', 'const tenant = await tenantByDestinationSms(supabase, toNumber)',
      'if (!isTransactableTenantStatus(tenant.status)) {']) {
      expect(() => scope(canonical.replace(anchor, 'changed source'))).toThrow('required unique ingress anchor')
      expect(() => scope(`${canonical}\n${anchor}`)).toThrow('required unique ingress anchor')
    }
    expect(transformed.indexOf('!serviceTradeEnabled(tenant.trades)')).toBeLessThan(transformed.indexOf('await findOrCreateCustomer('))
  })
})
