import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ from: vi.fn(), generateText: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: h.from }) }))
vi.mock('@ai-sdk/anthropic', () => ({ anthropic: () => 'offline-model' }))
vi.mock('ai', () => ({ generateText: h.generateText, stepCountIs: () => 'stop' }))
vi.mock('./tools', () => ({ makeTools: vi.fn() }))
vi.mock('./prompt', () => ({ systemPrompt: vi.fn() }))
vi.mock('@/lib/log/pipeline', () => ({ pipelineLog: () => ({ ok: vi.fn(), err: vi.fn() }) }))
vi.mock('@/lib/log/trace', () => ({ createTracer: () => vi.fn(), stopwatch: () => ({ elapsed: () => 0 }) }))

import { runEstimation } from './run'

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('RANK1_QUOTE_CORE_TENANTS', '')
  vi.stubEnv('DETERMINISTIC_BOM', 'false')
  h.from.mockImplementation(() => { throw new Error('No database pricing should be attempted') })
})
afterEach(() => vi.unstubAllEnvs())

describe('system-wide authoritative estimator entry point', () => {
  it.each(['tenant-a', 'tenant-b'])('holds incomplete account %s without any model-price fallback', async tenantId => {
    const result = await runEstimation({ tenant_id: tenantId, trade: 'electrical' }, null)
    expect(result.quoteCore).toMatchObject({ status: 'review_required', tenantId })
    expect(result.draft).toMatchObject({ good: null, better: null, best: null, needs_inspection: false })
    expect(h.from).not.toHaveBeenCalled()
    expect(h.generateText).not.toHaveBeenCalled()
  })

  it.each([null, {}, { trade: 'electrical' }, { tenant_id: 'tenant-a' }])(
    'fails closed for missing intake identity: %j', async intake => {
      const result = await runEstimation(intake, null)
      expect(result.quoteCore).toMatchObject({ status: 'review_required' })
      expect(result.draft.needs_inspection).toBe(false)
      expect(h.from).not.toHaveBeenCalled()
      expect(h.generateText).not.toHaveBeenCalled()
    },
  )

  it.each(['plumbing', 'roofing', 'painting', 'solar', 'unsupported'])(
    'does not route unsupported generic %s jobs to a model or inspection charge', async trade => {
      const result = await runEstimation({ tenant_id: 'tenant-b', trade, inspection_required: true },
        { id: 'book-b', tenant_id: 'tenant-b', trade }, undefined, null, { pricingBookVersionId: 'version-b' })
      expect(result.quoteCore?.status).toBe('review_required')
      expect(result.draft).toMatchObject({ good: null, better: null, best: null, needs_inspection: false })
      expect(result.draft.scope_of_works).not.toContain('Electrical')
      expect(h.from).not.toHaveBeenCalled()
      expect(h.generateText).not.toHaveBeenCalled()
    },
  )
})
