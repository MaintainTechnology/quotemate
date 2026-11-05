import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadSolarTenantRates, SolarPricingSetupError } from './rate-card-overlay'
import { DEFAULT_SOLAR_CONFIG } from './config'

const complete = { install_rate_per_kw: { standard_panels: 1200, premium_panels: 1500 },
  multi_storey_loading_pct: 0, complex_roof_loading_pct: 0, call_out_minimum_ex_gst: 0,
  gst_registered: false, stc_price_aud: 35 }
function client(overlay: unknown, error: unknown = null) {
  const filters: Array<[string, unknown]> = []
  const query = { select: () => query, eq: (key: string, value: unknown) => { filters.push([key, value]); return query },
    limit: () => query, maybeSingle: async () => ({ data: { overlays: { solar_rate_card: overlay } }, error }) }
  return { db: { from: () => query } as unknown as SupabaseClient, filters }
}
describe('all solar pricing entry points require a complete tenant-owned card', () => {
  it.each([null, {}, { install_rate_per_kw: { standard_panels: 1200 } }, { ...complete, gst_registered: undefined }])
    ('rejects missing/incomplete pricing instead of merging defaults', async (overlay) => {
      const { db } = client(overlay)
      await expect(loadSolarTenantRates(db, 'tenant-a', DEFAULT_SOLAR_CONFIG)).rejects.toBeInstanceOf(SolarPricingSetupError)
    })
  it('fails closed on a read error even if the response carries otherwise usable data', async () => {
    const { db } = client(complete, { message: 'unavailable' })
    await expect(loadSolarTenantRates(db, 'tenant-a', DEFAULT_SOLAR_CONFIG)).rejects.toBeInstanceOf(SolarPricingSetupError)
  })
  it('cannot quote without a tenant', async () => {
    const { db } = client(complete)
    await expect(loadSolarTenantRates(db, null, DEFAULT_SOLAR_CONFIG)).rejects.toBeInstanceOf(SolarPricingSetupError)
  })
  it('uses the scoped tenant values, preserving meaningful zero and GST false', async () => {
    const { db, filters } = client(complete)
    const result = await loadSolarTenantRates(db, 'tenant-b', DEFAULT_SOLAR_CONFIG)
    expect(filters).toContainEqual(['tenant_id', 'tenant-b'])
    expect(filters).toContainEqual(['trade', 'solar'])
    expect(result.rateCard).toMatchObject({ gst_registered: false, call_out_minimum_ex_gst: 0,
      install_rate_per_kw: complete.install_rate_per_kw })
    expect(result.config.stc_price_aud).toBe(35)
  })
})
