import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadTenantRoofingPricingContext: vi.fn(),
  measureAndPriceRoofs: vi.fn(),
  sendSms: vi.fn(),
  toRoofingRequest: vi.fn(),
}))

vi.mock('./roofing-intake', () => ({
  toRoofingRequest: mocks.toRoofingRequest,
}))
vi.mock('./twilio', () => ({ sendSms: mocks.sendSms }))
vi.mock('@/lib/roofing/measure', () => ({ measureAndPriceRoofs: mocks.measureAndPriceRoofs }))
vi.mock('@/lib/roofing/pricing-authority', () => ({
  loadTenantRoofingPricingContext: mocks.loadTenantRoofingPricingContext,
}))

import { measureAndDispatchRoofing } from './roofing-measure-dispatch'

const sendReply = vi.fn()
const baseArgs = {
  supabase: { from: vi.fn() } as never,
  tenantId: 'tenant-1',
  tenantTrade: 'roofing',
  conversationId: 'conversation-1',
  customerPhone: '0400000000',
  firstName: 'Pat',
  baseUrl: 'https://example.test',
  slots: {} as never,
  isInspection: false,
  sendReply,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.toRoofingRequest.mockReturnValue({
    address: { address: '1 Test Street', postcode: '4000', state: 'QLD' },
    inputs: {
      material: 'colorbond_corrugated',
      pitch: 'standard',
      intent: 'full_reroof',
    },
  })
})

describe('roofing message dispatch pricing safety', () => {
  it('does not measure, persist or send for a tenant-less caller', async () => {
    await expect(
      measureAndDispatchRoofing({ ...baseArgs, tenantId: null }),
    ).resolves.toEqual({ ok: false, reason: 'tenant pricing setup required' })
    expect(mocks.loadTenantRoofingPricingContext).not.toHaveBeenCalled()
    expect(mocks.measureAndPriceRoofs).not.toHaveBeenCalled()
    expect(sendReply).not.toHaveBeenCalled()
    expect(mocks.sendSms).not.toHaveBeenCalled()
  })

  it('does not measure, persist or send when the complete tenant card is absent', async () => {
    mocks.loadTenantRoofingPricingContext.mockResolvedValue(null)
    await expect(measureAndDispatchRoofing(baseArgs)).resolves.toEqual({
      ok: false,
      reason: 'tenant roofing pricing setup required',
    })
    expect(mocks.measureAndPriceRoofs).not.toHaveBeenCalled()
    expect(sendReply).not.toHaveBeenCalled()
    expect(mocks.sendSms).not.toHaveBeenCalled()
  })
})
