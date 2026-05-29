import { describe, expect, it, vi } from 'vitest'
import { PredictiveProvider, parseSuggestions } from './predictive'

describe('parseSuggestions — envelope variations', () => {
  it('reads { suggest: [...] }', () => {
    expect(
      parseSuggestions({
        suggest: [{ id: 'a1', address: '27 SMITH ST, PENRITH NSW 2750' }],
      }),
    ).toEqual([
      { id: 'a1', address: '27 SMITH ST, PENRITH NSW 2750', state: null, postcode: null },
    ])
  })
  it('reads { data: [{ addressId, formattedAddress, state, postcode }] }', () => {
    expect(
      parseSuggestions({
        data: [
          {
            addressId: 'a2',
            formattedAddress: '15 GEORGE ST, SYDNEY NSW 2000',
            state: 'NSW',
            postcode: '2000',
          },
        ],
      }),
    ).toEqual([
      { id: 'a2', address: '15 GEORGE ST, SYDNEY NSW 2000', state: 'NSW', postcode: '2000' },
    ])
  })
  it('skips entries missing id or address', () => {
    expect(parseSuggestions({ data: [{ id: 'a1' }, { address: 'x' }] })).toEqual([])
  })
  it('returns [] for unrecognised shapes', () => {
    expect(parseSuggestions({})).toEqual([])
    expect(parseSuggestions(null)).toEqual([])
  })
})

describe('PredictiveProvider.suggest — fetch envelope', () => {
  it('returns invalid_input for queries shorter than 3 chars', async () => {
    const p = new PredictiveProvider({ apiKey: 'fake', fetchImpl: vi.fn() as never })
    const r = await p.suggest('27')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('invalid_input')
  })

  it('returns provider_unavailable when API key missing', async () => {
    const p = new PredictiveProvider({ apiKey: '', fetchImpl: vi.fn() as never })
    const r = await p.suggest('27 Smith')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('provider_unavailable')
  })

  it('returns provider_rate_limited on 429', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response(null, { status: 429 }))
    const p = new PredictiveProvider({ apiKey: 'fake', fetchImpl })
    const r = await p.suggest('27 Smith')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('provider_rate_limited')
  })

  it('returns parsed suggestions on a typical 200', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          suggest: [
            { id: 'a1', address: '27 SMITH STREET, PENRITH NSW 2750' },
            { id: 'a2', address: '27A SMITH STREET, PENRITH NSW 2750' },
          ],
        }),
        { status: 200 },
      ),
    )
    const p = new PredictiveProvider({ apiKey: 'fake', fetchImpl })
    const r = await p.suggest('27 Smith', 'NSW')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.suggestions).toHaveLength(2)
      expect(r.suggestions[0].address).toMatch(/PENRITH/)
    }
  })

  it('returns provider_invalid_response on non-JSON 200', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('<html>not json</html>', { status: 200 }))
    const p = new PredictiveProvider({ apiKey: 'fake', fetchImpl })
    const r = await p.suggest('27 Smith')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('provider_invalid_response')
  })
})
