import { describe, expect, it, vi } from 'vitest'
import { resolvePylonStages, STAGE_LOOKUP_CAP } from './pylon-stage'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

const ENV = { PYLON_ENABLED: 'true', PYLON_API_KEY: 'k' }

function buildFetchImpl() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/v1/opportunities/')) {
      const id = url.split('/').pop()!.split('?')[0]
      return jsonResponse({
        data: {
          id,
          attributes: {
            current_pipeline_name: 'Residential',
            in_app_url: `https://app.getpylon.com/platform/leads/${id}`,
          },
          relationships: {
            pipeline_stage: { data: { type: 'pipeline_stages', id: 'stage-1' } },
            status: { data: { type: 'lead_statuses', id: 'status-1' } },
          },
        },
      })
    }
    if (url.includes('/v1/pipeline_stages/')) {
      return jsonResponse({ data: { id: 'stage-1', attributes: { name: 'Qualified' } } })
    }
    return jsonResponse({ data: { id: 'status-1', attributes: { name: 'Contacted' } } })
  })
}

describe('resolvePylonStages', () => {
  it('resolves stage · pipeline labels keyed by the caller key', async () => {
    const fetchImpl = buildFetchImpl()
    const out = await resolvePylonStages(
      [
        { key: 'tokA', opportunityId: 'opp1' },
        { key: 'tokB', opportunityId: 'opp2' },
      ],
      ENV,
      { fetchImpl },
    )
    expect(out.tokA.stage).toBe('Qualified · Residential')
    expect(out.tokA.url).toContain('opp1')
    expect(out.tokB.stage).toBe('Qualified · Residential')
  })

  it('caches stage names across opportunities (1 stage lookup for N leads)', async () => {
    const fetchImpl = buildFetchImpl()
    await resolvePylonStages(
      [
        { key: 'a', opportunityId: 'o1' },
        { key: 'b', opportunityId: 'o2' },
        { key: 'c', opportunityId: 'o3' },
      ],
      ENV,
      { fetchImpl },
    )
    const stageCalls = fetchImpl.mock.calls.filter((c) =>
      String(c[0]).includes('/v1/pipeline_stages/'),
    )
    expect(stageCalls).toHaveLength(1)
  })

  it('caps upstream lookups', async () => {
    const fetchImpl = buildFetchImpl()
    const lookups = Array.from({ length: STAGE_LOOKUP_CAP + 5 }, (_, i) => ({
      key: `k${i}`,
      opportunityId: `o${i}`,
    }))
    const out = await resolvePylonStages(lookups, ENV, { fetchImpl })
    expect(Object.keys(out)).toHaveLength(STAGE_LOOKUP_CAP)
  })

  it('falls back to the lead status when the stage is unset', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/v1/opportunities/')) {
        return jsonResponse({
          data: {
            id: 'o1',
            attributes: { in_app_url: null },
            relationships: {
              pipeline_stage: { data: null },
              status: { data: { type: 'lead_statuses', id: 'status-1' } },
            },
          },
        })
      }
      return jsonResponse({ data: { id: 'status-1', attributes: { name: 'Uncontacted' } } })
    })
    const out = await resolvePylonStages([{ key: 'a', opportunityId: 'o1' }], ENV, { fetchImpl })
    expect(out.a.stage).toBe('Uncontacted')
  })

  it('disabled / empty → empty map, no calls', async () => {
    const fetchImpl = vi.fn()
    expect(await resolvePylonStages([{ key: 'a', opportunityId: 'o' }], {}, { fetchImpl })).toEqual({})
    expect(await resolvePylonStages([], ENV, { fetchImpl })).toEqual({})
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('a failed opportunity lookup just omits that key', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 500 }))
    const out = await resolvePylonStages([{ key: 'a', opportunityId: 'o1' }], ENV, { fetchImpl })
    expect(out).toEqual({})
  })
})
