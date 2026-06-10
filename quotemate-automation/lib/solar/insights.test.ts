import { describe, it, expect } from 'vitest'
import {
  fetchSolarBuildingInsights,
  parseSolarBuildingInsights,
} from './insights'
import { COVERED_RAW_BODY } from './__fixtures__/building-insights'

describe('parseSolarBuildingInsights', () => {
  it('parses a covered body and carries the raw handle', () => {
    const insight = parseSolarBuildingInsights(COVERED_RAW_BODY)
    expect(insight).not.toBeNull()
    expect(insight?.segments.length).toBeGreaterThan(0)
    // The raw body is preserved so roof.ts can read solarPotential extras.
    expect(insight?.raw).toBe(COVERED_RAW_BODY)
  })

  it('returns null on an unparseable body', () => {
    expect(parseSolarBuildingInsights(null)).toBeNull()
    expect(parseSolarBuildingInsights({ nonsense: true })).toBeNull()
  })
})

describe('fetchSolarBuildingInsights', () => {
  it('fails closed without an apiKey, without calling fetch', async () => {
    let called = false
    const fetchImpl = async () => {
      called = true
      return new Response('{}', { status: 200 })
    }
    const r = await fetchSolarBuildingInsights(
      { lat: -33.8, lng: 151.2 },
      { apiKey: undefined, fetchImpl },
    )
    expect(called).toBe(false)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('no_key')
  })

  it('requests findClosest with the coordinate + key and returns the insight', async () => {
    let calledUrl = ''
    const fetchImpl = async (u: RequestInfo | URL) => {
      calledUrl = String(u)
      return new Response(JSON.stringify(COVERED_RAW_BODY), { status: 200 })
    }
    const r = await fetchSolarBuildingInsights(
      { lat: -33.8688, lng: 151.2093 },
      { apiKey: 'KEY', fetchImpl },
    )
    expect(calledUrl).toContain('location.latitude=-33.8688')
    expect(calledUrl).toContain('requiredQuality=LOW')
    expect(calledUrl).toContain('key=KEY')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.insight.raw).toBeTruthy()
  })

  it('maps a 404 to no_coverage', async () => {
    const fetchImpl = async () => new Response('not found', { status: 404 })
    const r = await fetchSolarBuildingInsights(
      { lat: 1, lng: 2 },
      { apiKey: 'KEY', fetchImpl },
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('no_coverage')
  })

  it('maps other non-2xx to http_error', async () => {
    const fetchImpl = async () => new Response('boom', { status: 500 })
    const r = await fetchSolarBuildingInsights(
      { lat: 1, lng: 2 },
      { apiKey: 'KEY', fetchImpl },
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('http_error')
  })

  it('surfaces a network error as not-ok (never throws)', async () => {
    const fetchImpl = async () => {
      throw new Error('boom')
    }
    const r = await fetchSolarBuildingInsights(
      { lat: 1, lng: 2 },
      { apiKey: 'KEY', fetchImpl },
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('network_error')
  })
})
