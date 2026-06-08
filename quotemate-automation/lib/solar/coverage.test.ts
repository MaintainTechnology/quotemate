import { describe, it, expect } from 'vitest'
import { checkSolarCoverage } from './coverage'
import { resolveSolarOpts } from '../roofing/solar-api'
import { COVERED_RAW_BODY, DEGENERATE_RAW_BODY } from './__fixtures__/building-insights'
import type { LatLng } from './types'

const LOC: LatLng = { lat: -33.8688, lng: 151.2093 }

function fakeFetch(status: number, body: unknown) {
  return async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
}

describe('checkSolarCoverage', () => {
  it('returns covered with HIGH imagery + date when findClosest succeeds', async () => {
    const opts = resolveSolarOpts({ apiKey: 'k', fetchImpl: fakeFetch(200, COVERED_RAW_BODY) })
    const r = await checkSolarCoverage(LOC, opts)
    expect(r.covered).toBe(true)
    if (r.covered) {
      expect(r.location).toEqual(LOC)
      expect(r.imagery_quality).toBe('HIGH')
      expect(r.imagery_date).toBe('2024-03-12')
    }
  })

  it('returns covered with MEDIUM imagery (the spec floor)', async () => {
    // DEGENERATE_RAW_BODY has imageryQuality: 'MEDIUM' — the lowest
    // quality that still passes the coverage gate.
    const opts = resolveSolarOpts({ apiKey: 'k', fetchImpl: fakeFetch(200, DEGENERATE_RAW_BODY) })
    const r = await checkSolarCoverage(LOC, opts)
    expect(r.covered).toBe(true)
    if (r.covered) {
      expect(r.imagery_quality).toBe('MEDIUM')
    }
  })

  it('returns uncovered/no_building_at_address on a 404', async () => {
    const opts = resolveSolarOpts({ apiKey: 'k', fetchImpl: fakeFetch(404, { error: {} }) })
    const r = await checkSolarCoverage(LOC, opts)
    expect(r.covered).toBe(false)
    if (!r.covered) expect(r.code).toBe('no_building_at_address')
  })

  it('returns uncovered/imagery_below_floor when quality is LOW', async () => {
    const lowBody = { ...COVERED_RAW_BODY, imageryQuality: 'LOW' }
    const opts = resolveSolarOpts({ apiKey: 'k', fetchImpl: fakeFetch(200, lowBody) })
    const r = await checkSolarCoverage(LOC, opts)
    expect(r.covered).toBe(false)
    if (!r.covered) expect(r.code).toBe('imagery_below_floor')
  })

  it('returns uncovered/provider_unavailable on a network error', async () => {
    const opts = resolveSolarOpts({
      apiKey: 'k',
      fetchImpl: async () => {
        throw new Error('ECONNRESET')
      },
    })
    const r = await checkSolarCoverage(LOC, opts)
    expect(r.covered).toBe(false)
    if (!r.covered) expect(r.code).toBe('provider_unavailable')
  })

  it('returns uncovered/provider_unavailable when the api key is missing', async () => {
    const opts = resolveSolarOpts({ apiKey: undefined, fetchImpl: fakeFetch(200, COVERED_RAW_BODY) })
    const r = await checkSolarCoverage(LOC, opts)
    expect(r.covered).toBe(false)
    if (!r.covered) expect(r.code).toBe('provider_unavailable')
  })

  it('returns uncovered/provider_unavailable on an HTTP 500 error', async () => {
    const opts = resolveSolarOpts({ apiKey: 'k', fetchImpl: fakeFetch(500, { error: 'Internal Server Error' }) })
    const r = await checkSolarCoverage(LOC, opts)
    expect(r.covered).toBe(false)
    if (!r.covered) expect(r.code).toBe('provider_unavailable')
  })

  it('returns uncovered/provider_invalid_response on a 200 with no usable segments', async () => {
    // An empty solarPotential means parseBuildingInsights returns null,
    // which fetchBuildingInsights maps to invalid_response → provider_invalid_response.
    const emptyBody = { imageryQuality: 'HIGH', solarPotential: {} }
    const opts = resolveSolarOpts({ apiKey: 'k', fetchImpl: fakeFetch(200, emptyBody) })
    const r = await checkSolarCoverage(LOC, opts)
    expect(r.covered).toBe(false)
    if (!r.covered) expect(r.code).toBe('provider_invalid_response')
  })
})
