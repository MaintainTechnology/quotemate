import { afterEach, expect, it, vi } from 'vitest'
import { estimatePainting } from './measure'
import { DEFAULT_PAINTING_RATE_CARD } from './pricing'
import { MockPropertyProvider } from './providers/mock'

afterEach(() => vi.unstubAllEnvs())
const address = { address: '10 Test Street Sydney', postcode: '2000', state: 'NSW' as const }
const inputs = { scopes: ['walls' as const], coats: 2 as const, condition: 'sound' as const,
  ceiling_height: 'standard' as const, colour_change: false }

it('does not substitute demo property measurements when production provider configuration is missing', async () => {
  vi.stubEnv('GOOGLE_MAPS_API_KEY', '')
  expect(await estimatePainting(address, inputs, { rateCard: DEFAULT_PAINTING_RATE_CARD }))
    .toMatchObject({ ok: false, code: 'measurement_provider_required' })
})
it('allows an explicit isolated test provider without live network configuration', async () => {
  vi.stubEnv('GOOGLE_MAPS_API_KEY', '')
  vi.stubEnv('GEOSCAPE_API_KEY', '')
  vi.stubEnv('PROPRADAR_API', '')
  vi.stubEnv('DOMAIN_API_KEY', '')
  expect(await estimatePainting(address, inputs, { rateCard: DEFAULT_PAINTING_RATE_CARD, provider: new MockPropertyProvider() }))
    .toMatchObject({ ok: true, estimate: { provider: 'mock' } })
})
