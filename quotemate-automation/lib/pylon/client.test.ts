import { describe, it, expect, vi } from 'vitest'
import {
  pylonEnabled,
  pylonLeadPushEnabled,
  pylonProposalsEnabled,
  fetchPylonStcAmount,
  pushPylonOpportunity,
  listPylonSolarDesigns,
  fetchPylonSolarDesign,
  fetchPylonSolarProject,
  fetchPylonComponent,
  fetchPylonComponentPrice,
  fetchPylonOpportunity,
  fetchPylonStageName,
  downloadPylonAsset,
} from './client'
import { PYLON_DESIGN_FIXTURE, PYLON_PROJECT_FIXTURE } from './__fixtures__/design'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('pylonEnabled', () => {
  it('requires the env gate AND a key', () => {
    expect(pylonEnabled({ PYLON_ENABLED: 'true', PYLON_API_KEY: 'k' })).toBe(true)
    expect(pylonEnabled({ PYLON_ENABLED: '1', PYLON_API_KEY: 'k' })).toBe(true)
    expect(pylonEnabled({ PYLON_ENABLED: 'true' })).toBe(false)
    expect(pylonEnabled({ PYLON_API_KEY: 'k' })).toBe(false)
    expect(pylonEnabled({ PYLON_ENABLED: 'false', PYLON_API_KEY: 'k' })).toBe(false)
    expect(pylonEnabled({})).toBe(false)
  })
})

describe('pylonLeadPushEnabled', () => {
  const base = { PYLON_ENABLED: 'true', PYLON_API_KEY: 'k' }
  it('tenant allowlist semantics', () => {
    expect(
      pylonLeadPushEnabled({ ...base, PYLON_LEAD_PUSH_TENANTS: 'a, b' }, 'b'),
    ).toBe(true)
    expect(pylonLeadPushEnabled({ ...base, PYLON_LEAD_PUSH_TENANTS: 'a' }, 'b')).toBe(false)
    expect(pylonLeadPushEnabled({ ...base, PYLON_LEAD_PUSH_TENANTS: '*' }, 'anything')).toBe(true)
    expect(pylonLeadPushEnabled({ ...base }, 'a')).toBe(false) // empty allowlist
    expect(pylonLeadPushEnabled({ ...base, PYLON_LEAD_PUSH_TENANTS: '*' }, null)).toBe(false)
  })
  it('master gate off → always false', () => {
    expect(
      pylonLeadPushEnabled({ PYLON_ENABLED: 'false', PYLON_API_KEY: 'k', PYLON_LEAD_PUSH_TENANTS: '*' }, 'a'),
    ).toBe(false)
  })
})

describe('fetchPylonStcAmount', () => {
  it('parses a flat payload', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ stcs: 68, zone: '3', zone_rating: 1.382, deeming_period: 5 }),
    )
    const res = await fetchPylonStcAmount(
      { output_kw: 10, site_postcode: '2570', installation_year: 2026 },
      { apiKey: 'k', fetchImpl },
    )
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data.stcs).toBe(68)
      expect(res.data.zone_rating).toBe(1.382)
    }
    // Request shape: bearer + query params.
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('/v1/au/stc_amount?')
    expect(url).toContain('output_kw=10')
    expect(url).toContain('site_postcode=2570')
    expect(url).toContain('installation_year=2026')
    expect(url).toContain('sgu_kind=solar_deemed')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer k')
  })

  it('parses a JSON:API-wrapped payload', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ data: { attributes: { stcs: '68', zone: '3' } } }),
    )
    const res = await fetchPylonStcAmount(
      { output_kw: 10, site_postcode: '2570', installation_year: 2026 },
      { apiKey: 'k', fetchImpl },
    )
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.data.stcs).toBe(68)
  })

  it('disabled result when no key is available', async () => {
    const res = await fetchPylonStcAmount(
      { output_kw: 10, site_postcode: '2570', installation_year: 2026 },
      { apiKey: undefined, fetchImpl: vi.fn() },
    )
    // Falls back to process.env.PYLON_API_KEY which is unset in tests.
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe('disabled')
  })

  it('http_error result on a non-2xx without throwing', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'nope' }, 401))
    const res = await fetchPylonStcAmount(
      { output_kw: 10, site_postcode: '2570', installation_year: 2026 },
      { apiKey: 'bad', fetchImpl },
    )
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.code).toBe('http_error')
      expect(res.detail).toContain('401')
    }
  })

  it('network_error result on fetch rejection without throwing', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    })
    const res = await fetchPylonStcAmount(
      { output_kw: 10, site_postcode: '2570', installation_year: 2026 },
      { apiKey: 'k', fetchImpl },
    )
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe('network_error')
  })

  it('invalid_response when stcs is missing', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ zone: '3' }))
    const res = await fetchPylonStcAmount(
      { output_kw: 10, site_postcode: '2570', installation_year: 2026 },
      { apiKey: 'k', fetchImpl },
    )
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe('invalid_response')
  })
})

describe('pylonProposalsEnabled', () => {
  it('requires the Pylon-tab gate AND a key', () => {
    expect(pylonProposalsEnabled({ PYLON_PROPOSALS_ENABLED: 'true', PYLON_API_KEY: 'k' })).toBe(true)
    expect(pylonProposalsEnabled({ PYLON_PROPOSALS_ENABLED: '1', PYLON_API_KEY: 'k' })).toBe(true)
    expect(pylonProposalsEnabled({ PYLON_PROPOSALS_ENABLED: 'true' })).toBe(false)
    expect(pylonProposalsEnabled({ PYLON_API_KEY: 'k' })).toBe(false)
    expect(pylonProposalsEnabled({})).toBe(false)
  })
})

/** Re-wrap a flat fixture into the JSON:API resource shape the API sends. */
function asJsonApiResource(flat: Record<string, unknown>, type: string) {
  const { id, relationships, ...attributes } = flat
  return { type, id, attributes, relationships }
}

describe('listPylonSolarDesigns', () => {
  it('sends the mandatory fields[solar_designs] param and maps rows', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ data: [asJsonApiResource(PYLON_DESIGN_FIXTURE, 'solar_designs')] }),
    )
    const res = await listPylonSolarDesigns({ apiKey: 'k', fetchImpl })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data).toHaveLength(1)
      const row = res.data[0]
      expect(row.id).toBe('RnlPy9NMNr')
      expect(row.title).toBe('13.5kWh Battery storage with 4.99kW Inverter')
      expect(row.dc_output_kw).toBe(6.49)
      expect(row.total_cents).toBe(760000)
      expect(row.project_id).toBe('rukSigcyTR')
    }
    const [url] = fetchImpl.mock.calls[0] as unknown as [string]
    expect(url).toContain('/v1/solar_designs?')
    expect(decodeURIComponent(url)).toContain('fields[solar_designs]=')
  })

  it('invalid_response when the data array is missing', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ nope: true }))
    const res = await listPylonSolarDesigns({ apiKey: 'k', fetchImpl })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe('invalid_response')
  })
})

describe('fetchPylonSolarDesign', () => {
  it('requests every attribute and flat-unwraps the resource', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ data: asJsonApiResource(PYLON_DESIGN_FIXTURE, 'solar_designs') }),
    )
    const res = await fetchPylonSolarDesign('RnlPy9NMNr', { apiKey: 'k', fetchImpl })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data.id).toBe('RnlPy9NMNr')
      expect((res.data.summary as Record<string, unknown>).dc_output_kw).toBe(6.49)
      expect(Array.isArray(res.data.line_items)).toBe(true)
    }
    const [url] = fetchImpl.mock.calls[0] as unknown as [string]
    expect(url).toContain('/v1/solar_designs/RnlPy9NMNr?')
    const decoded = decodeURIComponent(url)
    for (const f of ['summary', 'line_items', 'pricing', 'proposal_quote', 'locale']) {
      expect(decoded).toContain(f)
    }
  })

  it('http_error surfaces non-2xx without throwing', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'gone' }, 404))
    const res = await fetchPylonSolarDesign('missing', { apiKey: 'k', fetchImpl })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.detail).toContain('404')
  })
})

describe('fetchPylonSolarProject', () => {
  it('flat-unwraps customer + site fields', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ data: asJsonApiResource(PYLON_PROJECT_FIXTURE, 'solar_projects') }),
    )
    const res = await fetchPylonSolarProject('rukSigcyTR', { apiKey: 'k', fetchImpl })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect((res.data.customer_details as Record<string, unknown>).name).toBe(
        'Hubert J. Farnsworth',
      )
      expect((res.data.site_address as Record<string, unknown>).zip).toBe('3147')
    }
  })
})

describe('fetchPylonComponent', () => {
  it('maps the datasheet identity for each component kind', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        data: {
          type: 'solar_modules',
          id: 'c59f1f6f',
          attributes: {
            name: 'Tindo Solar Karra 72 Cell Series 380W',
            identity: { brand: 'Tindo Solar', series: 'Karra 72 Cell Series', model_number: 'Karra-380' },
            files: { datasheet_url: 'https://static.getpylon.com/datasheets/x.pdf' },
          },
        },
      }),
    )
    const res = await fetchPylonComponent('module', 'c59f1f6f', { apiKey: 'k', fetchImpl })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data.brand).toBe('Tindo Solar')
      expect(res.data.model_number).toBe('Karra-380')
      expect(res.data.datasheet_url).toContain('datasheets')
    }
    const [url] = fetchImpl.mock.calls[0] as unknown as [string]
    expect(url).toContain('/v1/solar_modules/c59f1f6f')
  })

  it('routes inverter + battery kinds to their endpoints', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ data: { id: 'x', attributes: {} } }))
    await fetchPylonComponent('inverter', 'sku1', { apiKey: 'k', fetchImpl })
    await fetchPylonComponent('battery', 'sku2', { apiKey: 'k', fetchImpl })
    const urls = fetchImpl.mock.calls.map((c) => (c as unknown as [string])[0])
    expect(urls[0]).toContain('/v1/solar_inverters/sku1')
    expect(urls[1]).toContain('/v1/solar_batteries/sku2')
  })
})

describe('downloadPylonAsset', () => {
  it('returns the bytes + content type', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'Content-Type': 'image/jpeg' },
        }),
    )
    const res = await downloadPylonAsset('https://static.getpylon.com/x.jpg', {
      apiKey: 'k',
      fetchImpl,
    })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data.bytes).toEqual(new Uint8Array([1, 2, 3]))
      expect(res.data.contentType).toBe('image/jpeg')
    }
  })

  it('rejects empty bodies and non-2xx without throwing', async () => {
    const empty = await downloadPylonAsset('https://x/y', {
      apiKey: 'k',
      fetchImpl: vi.fn(async () => new Response(new Uint8Array(), { status: 200 })),
    })
    expect(empty.ok).toBe(false)

    const gone = await downloadPylonAsset('https://x/y', {
      apiKey: 'k',
      fetchImpl: vi.fn(async () => new Response('nope', { status: 410 })),
    })
    expect(gone.ok).toBe(false)
    if (!gone.ok) expect(gone.code).toBe('http_error')
  })

  it('network errors return a result object', async () => {
    const res = await downloadPylonAsset('https://x/y', {
      apiKey: 'k',
      fetchImpl: vi.fn(async () => {
        throw new Error('ENOTFOUND')
      }),
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe('network_error')
  })
})

describe('pushPylonOpportunity', () => {
  // The documented create-leads response: a full opportunity resource.
  const opportunityResponse = jsonResponse({
    data: {
      type: 'opportunities',
      id: 'yyVS7sGKjH',
      attributes: { in_app_url: 'https://app.getpylon.com/platform/leads/yyVS7sGKjH' },
      relationships: {},
    },
  })

  it('POSTs the documented field names (first_name et al.), not legacy ones', async () => {
    const fetchImpl = vi.fn(async () => opportunityResponse)
    const res = await pushPylonOpportunity(
      {
        name: 'Jane Q Customer',
        phone: '+61400000000',
        email: 'jane@example.com',
        address: '12 Test St, Sydney',
        state: 'NSW',
        postcode: '2000',
        title: '10 kW solar — QuoteMate',
        summary: '10 kW solar',
        valueDollars: 12345.6,
        sourceLinkedId: 'tok123',
      },
      { apiKey: 'k', fetchImpl },
    )
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data.id).toBe('yyVS7sGKjH')
      expect(res.data.in_app_url).toContain('platform/leads')
    }
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('/v1/opportunities_form')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body as string)
    // Documented fields:
    expect(body.first_name).toBe('Jane')
    expect(body.last_name).toBe('Q Customer')
    expect(body.phone_number).toBe('+61400000000')
    expect(body.email_address).toBe('jane@example.com')
    expect(body.address).toEqual({
      line1: '12 Test St, Sydney',
      state: 'NSW',
      zip: '2000',
      country: 'Australia',
    })
    expect(body.title).toBe('10 kW solar — QuoteMate')
    expect(body.notes).toBe('10 kW solar')
    expect(body.value).toBe(12346) // whole dollars, rounded
    expect(body.source_name).toBe('quotemate')
    expect(body.source_linked_id).toBe('tok123')
    // Legacy (wrong) fields must be gone:
    expect(body.name).toBeUndefined()
    expect(body.phone).toBeUndefined()
    expect(body.email).toBeUndefined()
  })

  it('single-word name → first_name only', async () => {
    const fetchImpl = vi.fn(async () => opportunityResponse)
    await pushPylonOpportunity({ name: 'Jane' }, { apiKey: 'k', fetchImpl })
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.first_name).toBe('Jane')
    expect(body.last_name).toBeUndefined()
    expect(body.address).toBeUndefined()
  })

  it('never throws on failure', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('boom')
    })
    const res = await pushPylonOpportunity({ name: 'X' }, { apiKey: 'k', fetchImpl })
    expect(res.ok).toBe(false)
  })
})

describe('fetchPylonOpportunity', () => {
  it('reads stage/status ids + pipeline name', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        data: {
          type: 'opportunities',
          id: 'opp1',
          attributes: {
            current_pipeline_name: 'Residential',
            in_app_url: 'https://app.getpylon.com/platform/leads/opp1',
          },
          relationships: {
            pipeline_stage: { data: { type: 'pipeline_stages', id: 'stage9' } },
            status: { data: { type: 'lead_statuses', id: 'status3' } },
          },
        },
      }),
    )
    const res = await fetchPylonOpportunity('opp1', { apiKey: 'k', fetchImpl })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data.current_pipeline_name).toBe('Residential')
      expect(res.data.pipeline_stage_id).toBe('stage9')
      expect(res.data.lead_status_id).toBe('status3')
    }
  })

  it('tolerates null relationships', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        data: {
          id: 'opp1',
          attributes: {},
          relationships: { pipeline_stage: { data: null }, status: { data: null } },
        },
      }),
    )
    const res = await fetchPylonOpportunity('opp1', { apiKey: 'k', fetchImpl })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data.pipeline_stage_id).toBeNull()
      expect(res.data.lead_status_id).toBeNull()
    }
  })
})

describe('fetchPylonStageName', () => {
  it('resolves names for stages and statuses', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ data: { id: 's1', attributes: { name: 'Qualified' } } }),
    )
    const stage = await fetchPylonStageName('pipeline_stage', 's1', { apiKey: 'k', fetchImpl })
    expect(stage.ok).toBe(true)
    if (stage.ok) expect(stage.data).toBe('Qualified')
    const [url] = fetchImpl.mock.calls[0] as unknown as [string]
    expect(url).toContain('/v1/pipeline_stages/s1')
  })

  it('invalid_response when no name field', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ data: { id: 's1', attributes: {} } }))
    const res = await fetchPylonStageName('lead_status', 's1', { apiKey: 'k', fetchImpl })
    expect(res.ok).toBe(false)
  })
})

describe('fetchPylonComponentPrice', () => {
  it('filters by component type+id and prefers the latest row', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        data: [
          { id: 'p1', attributes: { price_excl_tax: 9000, cost_excl_tax: 7000, is_latest: false } },
          { id: 'p2', attributes: { price_excl_tax: 12000, cost_excl_tax: 10000, is_latest: true } },
        ],
      }),
    )
    const res = await fetchPylonComponentPrice('module', 'sku-1', { apiKey: 'k', fetchImpl })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data.price_excl_tax_cents).toBe(12000)
      expect(res.data.cost_excl_tax_cents).toBe(10000)
    }
    const [url] = fetchImpl.mock.calls[0] as unknown as [string]
    const decoded = decodeURIComponent(url)
    expect(decoded).toContain('filter[component.type]=solar_modules')
    expect(decoded).toContain('filter[component.id]=sku-1')
  })

  it('null prices when the tenant has no price for the SKU', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ data: [] }))
    const res = await fetchPylonComponentPrice('inverter', 'sku-2', { apiKey: 'k', fetchImpl })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.data.price_excl_tax_cents).toBeNull()
  })
})
