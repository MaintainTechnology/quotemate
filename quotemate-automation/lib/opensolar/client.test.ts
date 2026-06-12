import { describe, it, expect, vi, beforeEach } from 'vitest'
import { gzipSync } from 'node:zlib'
import {
  decompressOpenSolarDesign,
  extractOpenSolarDocumentUrl,
  fetchOpenSolarProposalData,
  isOpenSolarDocumentType,
  listOpenSolarProjects,
  openSolarEnabled,
  openSolarLeadPushEnabled,
  openSolarProposalsEnabled,
  resetOpenSolarTokenCache,
} from './client'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const BASE_ENV = {
  OPENSOLAR_ENABLED: 'true',
  OPENSOLAR_PROPOSALS_ENABLED: 'true',
  OPENSOLAR_ORG_ID: '62854',
  OPENSOLAR_API_TOKEN: 'tok',
}

beforeEach(() => resetOpenSolarTokenCache())

describe('gates', () => {
  it('openSolarEnabled requires flag + org + credentials', () => {
    expect(openSolarEnabled(BASE_ENV)).toBe(true)
    expect(openSolarEnabled({ ...BASE_ENV, OPENSOLAR_ENABLED: 'false' })).toBe(false)
    expect(openSolarEnabled({ ...BASE_ENV, OPENSOLAR_ORG_ID: undefined })).toBe(false)
    expect(openSolarEnabled({ ...BASE_ENV, OPENSOLAR_API_TOKEN: undefined })).toBe(false)
    // Machine-user login credentials count as credentials too.
    expect(
      openSolarEnabled({
        ...BASE_ENV,
        OPENSOLAR_API_TOKEN: undefined,
        OPENSOLAR_USERNAME: 'bot@example.com',
        OPENSOLAR_PASSWORD: 'pw',
      }),
    ).toBe(true)
  })

  it('openSolarProposalsEnabled is independent of OPENSOLAR_ENABLED', () => {
    expect(
      openSolarProposalsEnabled({ ...BASE_ENV, OPENSOLAR_ENABLED: undefined }),
    ).toBe(true)
    expect(
      openSolarProposalsEnabled({ ...BASE_ENV, OPENSOLAR_PROPOSALS_ENABLED: 'false' }),
    ).toBe(false)
    expect(openSolarProposalsEnabled({})).toBe(false)
  })

  it('lead push uses the tenant allowlist', () => {
    const env = { ...BASE_ENV, OPENSOLAR_LEAD_PUSH_TENANTS: 'a, b' }
    expect(openSolarLeadPushEnabled(env, 'b')).toBe(true)
    expect(openSolarLeadPushEnabled(env, 'c')).toBe(false)
    expect(openSolarLeadPushEnabled({ ...BASE_ENV, OPENSOLAR_LEAD_PUSH_TENANTS: '*' }, 'x')).toBe(true)
    expect(openSolarLeadPushEnabled(BASE_ENV, 'a')).toBe(false)
    expect(openSolarLeadPushEnabled({ ...BASE_ENV, OPENSOLAR_LEAD_PUSH_TENANTS: '*' }, null)).toBe(false)
  })
})

describe('decompressOpenSolarDesign', () => {
  it('round-trips a gzip+base64 design JSON', () => {
    const design = { systems: [{ uuid: 'abc' }], pricing: { system_price_including_tax: 8990 } }
    const encoded = gzipSync(Buffer.from(JSON.stringify(design), 'utf8')).toString('base64')
    const res = decompressOpenSolarDesign(encoded)
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.data).toEqual(design)
  })

  it('null/absent design (API Access plan) is ok:null, not an error', () => {
    expect(decompressOpenSolarDesign(null)).toEqual({ ok: true, data: null })
    expect(decompressOpenSolarDesign(undefined)).toEqual({ ok: true, data: null })
    expect(decompressOpenSolarDesign('')).toEqual({ ok: true, data: null })
  })

  it('rejects non-string, garbage and non-object payloads', () => {
    expect(decompressOpenSolarDesign(42).ok).toBe(false)
    expect(decompressOpenSolarDesign('not-base64-gzip!!').ok).toBe(false)
    const arrayPayload = gzipSync(Buffer.from('[1,2,3]', 'utf8')).toString('base64')
    expect(decompressOpenSolarDesign(arrayPayload).ok).toBe(false)
  })
})

describe('listOpenSolarProjects', () => {
  it('maps a plain-array response to slim rows', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse([
        {
          id: 3763174,
          address: '6 Hopetoun Ave',
          locality: 'Vaucluse',
          state: 'NSW',
          zip: '2030',
          stage: 0,
          identifier: 'abc',
          created_date: '2026-06-01T00:00:00Z',
          modified_date: '2026-06-10T00:00:00Z',
        },
        { no_id: true },
      ]),
    )
    const res = await listOpenSolarProjects({ orgId: '62854', apiToken: 'tok', fetchImpl })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data).toHaveLength(1)
      expect(res.data[0].id).toBe('3763174')
      expect(res.data[0].address).toBe('6 Hopetoun Ave')
    }
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('/api/orgs/62854/projects/?fieldset=list')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok')
  })

  it('tolerates a paginated { results: [...] } envelope', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ results: [{ id: 9 }] }))
    const res = await listOpenSolarProjects({ orgId: '1', apiToken: 'tok', fetchImpl })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.data[0].id).toBe('9')
  })

  it('missing org id → disabled result, no fetch', async () => {
    const fetchImpl = vi.fn()
    const res = await listOpenSolarProjects({ orgId: undefined, apiToken: 'tok', fetchImpl })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe('disabled')
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('plan + throttle handling', () => {
  it('403 surfaces as the plan code (data, not an exception)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ detail: 'nope' }, 403))
    const res = await fetchOpenSolarProposalData('1', { orgId: '1', apiToken: 'tok', fetchImpl })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe('plan')
  })

  it('429 retries once then fails clean as throttled', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 429))
      .mockResolvedValueOnce(jsonResponse({}, 429))
    const res = await fetchOpenSolarProposalData('1', {
      orgId: '1',
      apiToken: 'tok',
      fetchImpl,
      retryDelayMs: 0,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe('throttled')
  })

  it('429 then 200 succeeds after the backoff retry', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 429))
      .mockResolvedValueOnce(jsonResponse([{ id: 1 }]))
    const res = await fetchOpenSolarProposalData('1', {
      orgId: '1',
      apiToken: 'tok',
      fetchImpl,
      retryDelayMs: 0,
    })
    expect(res.ok).toBe(true)
  })
})

describe('machine-user token flow', () => {
  it('logs in once and refreshes after a 401', async () => {
    const fetchImpl = vi
      .fn()
      // login → token1
      .mockResolvedValueOnce(jsonResponse({ token: 't1' }))
      // request with t1 → 401 (expired)
      .mockResolvedValueOnce(jsonResponse({}, 401))
      // re-login → token2
      .mockResolvedValueOnce(jsonResponse({ token: 't2' }))
      // retried request with t2 → 200
      .mockResolvedValueOnce(jsonResponse([{ id: 5 }]))
    const res = await listOpenSolarProjects({
      orgId: '1',
      username: 'bot@example.com',
      password: 'pw',
      fetchImpl,
    })
    expect(res.ok).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(4)
    const loginCall = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(loginCall[0]).toContain('/api-token-auth/')
    const retried = fetchImpl.mock.calls[3] as unknown as [string, RequestInit]
    expect((retried[1].headers as Record<string, string>).Authorization).toBe('Bearer t2')
  })

  it('no credentials at all → disabled', async () => {
    const fetchImpl = vi.fn()
    const res = await listOpenSolarProjects({
      orgId: '1',
      apiToken: undefined,
      username: undefined,
      password: undefined,
      fetchImpl,
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe('disabled')
  })
})

describe('fetchOpenSolarComponentActivations', () => {
  it('parses activations incl. the JSON-string data blob', async () => {
    const { fetchOpenSolarComponentActivations } = await import('./client')
    const fetchImpl = vi.fn(async () =>
      jsonResponse([
        {
          module_id: 8520,
          manufacturer_name: 'LG Energy',
          code: 'LG330N1C-A5',
          is_default: true,
          is_archived: false,
          product_warranty: null,
          data: '{"kw_stc": 0.33, "product_warranty": 25, "technology": "Mono-c-Si", "code": "LG330N1C-A5"}',
        },
        { manufacturer_name: 'Old Co', code: 'GONE', is_archived: true, data: '{}' },
        { data: 'not-json{' },
      ]),
    )
    const res = await fetchOpenSolarComponentActivations('module', {
      orgId: '1',
      apiToken: 'tok',
      fetchImpl,
    })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data).toHaveLength(1) // archived + nameless rows dropped
      expect(res.data[0]).toEqual({
        kind: 'module',
        manufacturer: 'LG Energy',
        code: 'LG330N1C-A5',
        kw_stc: 0.33,
        product_warranty_years: 25,
        technology: 'Mono-c-Si',
        is_default: true,
      })
    }
    const [url] = fetchImpl.mock.calls[0] as unknown as [string]
    expect(url).toContain('/component_module_activations/')
  })
})

describe('fetchOpenSolarPricingSchemes', () => {
  it('parses schemes incl. the configuration_json string', async () => {
    const { fetchOpenSolarPricingSchemes } = await import('./client')
    const fetchImpl = vi.fn(async () =>
      jsonResponse([
        {
          id: 68,
          title: 'per equipment',
          pricing_formula: 'Price Per Module/Inverter/Battery',
          configuration_json:
            '{"price_per_module":500,"price_per_inverter":1000,"price_per_battery":2000,"tax_percentage_included":10}',
          priority: 1,
          auto_apply_enabled: true,
          auto_apply_only_specified_states: null,
          auto_apply_only_specified_zips: null,
          is_archived: false,
        },
        { id: 70, title: 'archived', is_archived: true },
      ]),
    )
    const res = await fetchOpenSolarPricingSchemes({ orgId: '1', apiToken: 'tok', fetchImpl })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data).toHaveLength(1)
      expect(res.data[0].id).toBe('68')
      expect(res.data[0].pricing_formula).toBe('Price Per Module/Inverter/Battery')
      expect(res.data[0].configuration.price_per_module).toBe(500)
      expect(res.data[0].auto_apply_enabled).toBe(true)
    }
  })
})

describe('document helpers', () => {
  it('whitelists only the adopted document types', () => {
    expect(isOpenSolarDocumentType('shade_report')).toBe(true)
    expect(isOpenSolarDocumentType('global_bom')).toBe(true)
    expect(isOpenSolarDocumentType('proposal')).toBe(false)
    expect(isOpenSolarDocumentType('contract')).toBe(false)
    expect(isOpenSolarDocumentType(42)).toBe(false)
  })

  it('extracts a downloadable URL from the documented response shapes', () => {
    expect(extractOpenSolarDocumentUrl('https://x/file.pdf')).toBe('https://x/file.pdf')
    expect(extractOpenSolarDocumentUrl({ url: 'https://x/a.pdf' })).toBe('https://x/a.pdf')
    expect(extractOpenSolarDocumentUrl({ file_contents: 'https://x/b.pdf' })).toBe('https://x/b.pdf')
    expect(
      extractOpenSolarDocumentUrl({ private_file: { file_contents: 'https://x/c.pdf' } }),
    ).toBe('https://x/c.pdf')
    expect(extractOpenSolarDocumentUrl({ status: 'pending' })).toBeNull()
    expect(extractOpenSolarDocumentUrl(null)).toBeNull()
  })
})
