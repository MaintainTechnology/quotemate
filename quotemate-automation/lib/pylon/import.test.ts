import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { importPylonDesign } from './import'
import { PYLON_DESIGN_FIXTURE, PYLON_PROJECT_FIXTURE } from './__fixtures__/design'

function asJsonApiResource(flat: Record<string, unknown>, type: string) {
  const { id, relationships, ...attributes } = flat
  return { type, id, attributes, relationships }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** Routes every upstream call the import makes; records asset uploads. */
function buildFetchImpl(overrides: { stcs?: number; failAssets?: boolean } = {}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/v1/solar_designs/RnlPy9NMNr')) {
      return jsonResponse({ data: asJsonApiResource(PYLON_DESIGN_FIXTURE, 'solar_designs') })
    }
    if (url.includes('/v1/solar_projects/rukSigcyTR')) {
      return jsonResponse({ data: asJsonApiResource(PYLON_PROJECT_FIXTURE, 'solar_projects') })
    }
    if (url.includes('/v1/solar_modules/') || url.includes('/v1/solar_inverters/') || url.includes('/v1/solar_batteries/')) {
      return jsonResponse({
        data: {
          id: 'sku',
          attributes: {
            name: 'Component',
            identity: { brand: 'Brand', series: 'Series', model_number: 'M-1' },
            files: { datasheet_url: 'https://static.getpylon.com/ds.pdf' },
          },
        },
      })
    }
    if (url.includes('/v1/au/stc_amount')) {
      return jsonResponse({ stcs: overrides.stcs ?? 103, zone: '4', zone_rating: 1.185, deeming_period: 5 })
    }
    // Asset URLs (snapshot/SLD/site-info)
    if (overrides.failAssets) return new Response('gone', { status: 410 })
    return new Response(new Uint8Array([7, 7, 7]), {
      status: 200,
      headers: { 'Content-Type': url.endsWith('.jpeg') ? 'image/jpeg' : 'application/pdf' },
    })
  })
}

/** Minimal stateful supabase stub for the upsert + storage calls. */
function buildSupabaseStub(existing: { id: string; public_token: string } | null = null) {
  const uploads: string[] = []
  const writes: Array<{ kind: 'insert' | 'update'; row: Record<string, unknown> }> = []
  const stub = {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({ data: existing, error: null })),
          })),
        })),
      })),
      insert: vi.fn(async (row: Record<string, unknown>) => {
        writes.push({ kind: 'insert', row })
        return { error: null }
      }),
      update: vi.fn((row: Record<string, unknown>) => ({
        eq: vi.fn(async () => {
          writes.push({ kind: 'update', row })
          return { error: null }
        }),
      })),
    })),
    storage: {
      from: vi.fn(() => ({
        upload: vi.fn(async (path: string) => {
          uploads.push(path)
          return { error: null }
        }),
      })),
    },
  }
  return { stub: stub as unknown as SupabaseClient, uploads, writes }
}

describe('importPylonDesign', () => {
  it('imports a clean design: customer, datasheets, assets, no flags', async () => {
    const { stub, uploads, writes } = buildSupabaseStub()
    const fetchImpl = buildFetchImpl()
    const res = await importPylonDesign(
      stub,
      { tenantId: 'tenant-1', designId: 'RnlPy9NMNr' },
      { apiKey: 'k', fetchImpl },
    )
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.flags).toEqual([])
    expect(res.token).toMatch(/^[A-Za-z0-9_-]+$/)

    // All three artefacts cached under pylon/{tenant}/{design}/.
    expect(uploads).toHaveLength(3)
    for (const p of uploads) expect(p).toMatch(/^pylon\/tenant-1\/RnlPy9NMNr\//)

    // One insert with the normalized snapshot + project data.
    expect(writes).toHaveLength(1)
    expect(writes[0].kind).toBe('insert')
    const row = writes[0].row
    expect(row.status).toBe('awaiting_confirmation')
    expect(row.address_text).toBe('19 Parmesan Avenue, Glen Iris, Victoria, 3147')
    expect((row.customer as { name: string }).name).toBe('Hubert J. Farnsworth')
    const design = row.design as { components: Array<{ datasheet: unknown }> }
    expect(design.components.every((c) => c.datasheet !== null)).toBe(true)
  })

  it('flags an STC mismatch and stores status=flagged', async () => {
    const { stub, writes } = buildSupabaseStub()
    const res = await importPylonDesign(
      stub,
      { tenantId: 'tenant-1', designId: 'RnlPy9NMNr' },
      { apiKey: 'k', fetchImpl: buildFetchImpl({ stcs: 80 }) },
    )
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.flags.some((f) => f.startsWith('stc_mismatch_pylon'))).toBe(true)
    expect(writes[0].row.status).toBe('flagged')
  })

  it('re-import keeps the token, updates the row and resets the confirm gate', async () => {
    const { stub, writes } = buildSupabaseStub({ id: 'row-1', public_token: 'kept-token' })
    const res = await importPylonDesign(
      stub,
      { tenantId: 'tenant-1', designId: 'RnlPy9NMNr' },
      { apiKey: 'k', fetchImpl: buildFetchImpl() },
    )
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.token).toBe('kept-token')
    expect(writes[0].kind).toBe('update')
    expect(writes[0].row.confirmed_at).toBeNull()
    expect(writes[0].row.pdf_path).toBeNull()
  })

  it('asset failures degrade soft: import succeeds with null paths', async () => {
    const { stub, uploads, writes } = buildSupabaseStub()
    const res = await importPylonDesign(
      stub,
      { tenantId: 'tenant-1', designId: 'RnlPy9NMNr' },
      { apiKey: 'k', fetchImpl: buildFetchImpl({ failAssets: true }) },
    )
    expect(res.ok).toBe(true)
    expect(uploads).toHaveLength(0)
    const assets = writes[0].row.assets as Record<string, string | null>
    expect(assets.snapshot_path).toBeNull()
    expect(assets.sld_path).toBeNull()
  })

  it('design fetch failure returns a result, never throws', async () => {
    const { stub } = buildSupabaseStub()
    const fetchImpl = vi.fn(async () => new Response('{"error":"gone"}', { status: 404 }))
    const res = await importPylonDesign(
      stub,
      { tenantId: 'tenant-1', designId: 'missing' },
      { apiKey: 'k', fetchImpl },
    )
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.status).toBe(404)
  })
})
