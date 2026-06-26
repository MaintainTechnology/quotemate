import { describe, it, expect } from 'vitest'
import { buildSavedPaintingRow, mintToken } from './save-row'
import type { SavePaintingRequest } from './request-schema'

// A minimal, valid-shaped save request. `estimate` is stored verbatim and
// only the nested paths the row derives from need to be present.
const sample: SavePaintingRequest = {
  address: { address: '28 Greens Rd, Coorparoo', postcode: '4151', state: 'QLD' },
  source: 'mock',
  inputs: {
    scopes: ['walls', 'ceilings'],
    coats: 2,
    condition: 'sound',
    ceiling_height: 'standard',
    colour_change: false,
    storeys: 1,
    manual_floor_area_m2: null,
  },
  estimate: {
    measurement: { floor_area_m2: 120 },
    price: {
      total_area_m2: 260,
      confidence: 'high',
      routing: { decision: 'tradie_review' },
      tiers: [
        { tier: 'good', inc_gst: 2800 },
        { tier: 'better', inc_gst: 4200 },
        { tier: 'best', inc_gst: 5600 },
      ],
    },
  },
}

const HEX32 = /^[0-9a-f]{32}$/

describe('mintToken', () => {
  it('returns a 32-char hex string', () => {
    expect(mintToken()).toMatch(HEX32)
  })
  it('is effectively unique across calls', () => {
    const a = mintToken()
    const b = mintToken()
    expect(a).not.toBe(b)
  })
})

describe('buildSavedPaintingRow', () => {
  it('derives the denormalised summary columns from the estimate', () => {
    const row = buildSavedPaintingRow({ tenantId: 't1', userId: 'u1', data: sample })
    expect(row.floor_area_m2).toBe(120)
    expect(row.total_area_m2).toBe(260)
    expect(row.confidence).toBe('high')
    // Better tier (index 1) inc-GST is the headline list number.
    expect(row.better_inc_gst).toBe(4200)
    expect(row.routing).toBe('tradie_review')
    expect(row.scopes).toEqual(['walls', 'ceilings'])
    expect(row.tenant_id).toBe('t1')
    expect(row.created_by).toBe('u1')
    expect(row.address).toBe('28 Greens Rd, Coorparoo')
  })

  it('mints two distinct unguessable tokens', () => {
    const row = buildSavedPaintingRow({ tenantId: 't1', userId: 'u1', data: sample })
    expect(row.public_token).toMatch(HEX32)
    expect(row.estimate_token).toMatch(HEX32)
    expect(row.public_token).not.toBe(row.estimate_token)
  })

  it('mints public_token first, estimate_token second (injectable generator)', () => {
    let n = 0
    const row = buildSavedPaintingRow({
      tenantId: null,
      userId: 'u',
      data: sample,
      mint: () => `tok${n++}`,
    })
    expect(row.public_token).toBe('tok0')
    expect(row.estimate_token).toBe('tok1')
  })

  it('tolerates an estimate missing the derived paths (nulls, never throws)', () => {
    const row = buildSavedPaintingRow({
      tenantId: null,
      userId: 'u',
      data: { ...sample, estimate: {} },
    })
    expect(row.floor_area_m2).toBeNull()
    expect(row.total_area_m2).toBeNull()
    expect(row.confidence).toBeNull()
    expect(row.better_inc_gst).toBeNull()
    expect(row.routing).toBeNull()
    // Tokens are still minted regardless of estimate completeness.
    expect(row.public_token).toMatch(HEX32)
    expect(row.estimate_token).toMatch(HEX32)
  })
})
