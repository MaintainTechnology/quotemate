import { describe, expect, it } from 'vitest'
import {
  createRoofPricingRun,
  parseTenantRoofingRateCard,
  roofMeasurementTokensForRun,
  roofingPricingRevision,
  roofRunRequestDigest,
  verifyRoofPricingRun,
  type TenantRoofingPricingContext,
} from './pricing-authority'

const COMPLETE_CARD = {
  reroof_rate_per_m2: {
    colorbond_corrugated: 90,
    colorbond_trimdek: 95,
    colorbond_spandek: 97,
    colorbond_kliplok: 110,
    concrete_tile: 88,
    terracotta_tile: 105,
    cement_sheet: 140,
  },
  multi_storey_loading_pct: 0.2,
  asbestos_loading_pct: 0.35,
  complexity_loading_pct: 0.15,
  upgrade_material: 'colorbond_trimdek',
  gst_registered: true,
  call_out_minimum_ex_gst: 500,
  gutter_rate_per_lm: 40,
  downpipe_rate_per_each: 220,
  fascia_rate_per_lm: 50,
  soffit_rate_per_lm: 60,
  ridge_hip_repoint_rate_per_lm: 15,
  valley_flashing_rate_per_lm: 45,
  box_gutter_rate_per_lm: 70,
  price_edge_works: true,
  solar_detach_reinstate_base_ex_gst: 1200,
  solar_detach_reinstate_per_array_ex_gst: 500,
}

function context(): TenantRoofingPricingContext {
  const rateCard = parseTenantRoofingRateCard(COMPLETE_CARD)
  if (!rateCard) throw new Error('invalid test card')
  return {
    rateCard,
    authority: {
      source: 'tenant_pricing_book',
      tenant_id: 'tenant-1',
      pricing_book_id: 'book-1',
      revision: roofingPricingRevision('book-1', rateCard),
    },
  }
}

describe('tenant roofing pricing card', () => {
  it('accepts a complete finite persisted card and adds no seeded value', () => {
    const parsed = parseTenantRoofingRateCard(COMPLETE_CARD)
    expect(parsed).not.toBeNull()
    expect(parsed?.reroof_rate_per_m2.unknown).toBe(0)
    expect(parsed?.gst_registered).toBe(true)
  })

  it.each([
    ['missing card', null],
    ['partial card', { reroof_rate_per_m2: COMPLETE_CARD.reroof_rate_per_m2 }],
    [
      'zero material rate',
      {
        ...COMPLETE_CARD,
        reroof_rate_per_m2: { ...COMPLETE_CARD.reroof_rate_per_m2, concrete_tile: 0 },
      },
    ],
    ['null GST', { ...COMPLETE_CARD, gst_registered: null }],
    ['non-finite loading', { ...COMPLETE_CARD, complexity_loading_pct: Number.NaN }],
    ['missing provenance input', { ...COMPLETE_CARD, price_edge_works: undefined }],
  ])('fails closed for %s', (_label, value) => {
    expect(parseTenantRoofingRateCard(value)).toBeNull()
  })
})

describe('signed roofing pricing run', () => {
  const secret = 'server-only-test-secret'
  const request = {
    address: { address: '1 Test St', postcode: '4000', state: 'QLD' },
    provider: 'geoscape',
    quote: { structures: [{ price: { tiers: [{ ex_gst: 10 }] } }] },
  }

  it('binds tenant, book revision, exact result digest and expiry', () => {
    const ctx = context()
    const digest = roofRunRequestDigest(request)
    const run = createRoofPricingRun({
      context: ctx,
      requestDigest: digest,
      secret,
      nowMs: 1_000,
      ttlMs: 5_000,
      runId: 'a'.repeat(32),
    })
    expect(
      verifyRoofPricingRun({
        token: run.token,
        secret,
        tenantId: 'tenant-1',
        currentAuthority: ctx.authority,
        requestDigest: digest,
        nowMs: 5_999,
      }),
    ).toMatchObject({ ok: true, proof: { run_id: 'a'.repeat(32) } })
    expect(
      verifyRoofPricingRun({
        token: run.token,
        secret,
        tenantId: 'tenant-2',
        currentAuthority: ctx.authority,
        requestDigest: digest,
        nowMs: 2_000,
      }),
    ).toEqual({ ok: false, error: 'wrong_tenant' })
    expect(
      verifyRoofPricingRun({
        token: run.token,
        secret,
        tenantId: 'tenant-1',
        currentAuthority: { ...ctx.authority, revision: 'b'.repeat(64) },
        requestDigest: digest,
        nowMs: 2_000,
      }),
    ).toEqual({ ok: false, error: 'pricing_stale' })
    expect(
      verifyRoofPricingRun({
        token: run.token,
        secret,
        tenantId: 'tenant-1',
        currentAuthority: ctx.authority,
        requestDigest: roofRunRequestDigest({ ...request, provider: 'manual' }),
        nowMs: 2_000,
      }),
    ).toEqual({ ok: false, error: 'run_mismatch' })
    expect(
      verifyRoofPricingRun({
        token: run.token,
        secret,
        tenantId: 'tenant-1',
        currentAuthority: ctx.authority,
        requestDigest: digest,
        nowMs: 6_000,
      }),
    ).toEqual({ ok: false, error: 'run_expired' })
  })

  it('rejects tampering and derives stable retry tokens scoped to the run', () => {
    const ctx = context()
    const run = createRoofPricingRun({
      context: ctx,
      requestDigest: roofRunRequestDigest(request),
      secret,
      runId: 'a'.repeat(32),
    })
    expect(
      verifyRoofPricingRun({
        token: `${run.token}x`,
        secret,
        tenantId: 'tenant-1',
        currentAuthority: ctx.authority,
        requestDigest: roofRunRequestDigest(request),
      }),
    ).toEqual({ ok: false, error: 'invalid_run' })
    const first = roofMeasurementTokensForRun({ runId: 'a'.repeat(32), secret })
    expect(first).toEqual(roofMeasurementTokensForRun({ runId: 'a'.repeat(32), secret }))
    expect(first).not.toEqual(roofMeasurementTokensForRun({ runId: 'b'.repeat(32), secret }))
  })
})
