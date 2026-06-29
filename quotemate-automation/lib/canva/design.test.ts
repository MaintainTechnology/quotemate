import { describe, it, expect } from 'vitest'
import {
  FLYER_DESIGN_SIZE,
  buildCreateDesignBody,
  parseCreateDesignResponse,
  appendCorrelationState,
  DESIGNS_ENDPOINT,
} from './design'

describe('buildCreateDesignBody', () => {
  it('defaults to an A4-portrait custom design', () => {
    const b = buildCreateDesignBody()
    expect(b.design_type).toEqual({ type: 'custom', width: FLYER_DESIGN_SIZE.width, height: FLYER_DESIGN_SIZE.height })
    expect('title' in b).toBe(false)
  })

  it('keeps the design within Canva’s 25MP area cap', () => {
    expect(FLYER_DESIGN_SIZE.width * FLYER_DESIGN_SIZE.height).toBeLessThanOrEqual(25_000_000)
  })

  it('includes a trimmed title when provided and omits a blank one', () => {
    expect(buildCreateDesignBody({ title: '  Spring promo  ' }).title).toBe('Spring promo')
    expect('title' in buildCreateDesignBody({ title: '   ' })).toBe(false)
  })

  it('honours custom dimensions', () => {
    expect(buildCreateDesignBody({ width: 1080, height: 1080 }).design_type).toEqual({
      type: 'custom',
      width: 1080,
      height: 1080,
    })
  })
})

describe('parseCreateDesignResponse', () => {
  it('extracts id + edit/view URLs', () => {
    const ref = parseCreateDesignResponse({
      design: { id: 'DAF-1', urls: { edit_url: 'https://canva.com/design/DAF-1/edit', view_url: 'https://canva.com/design/DAF-1/view' } },
    })
    expect(ref).toEqual({
      id: 'DAF-1',
      editUrl: 'https://canva.com/design/DAF-1/edit',
      viewUrl: 'https://canva.com/design/DAF-1/view',
    })
  })

  it('tolerates a missing view URL', () => {
    const ref = parseCreateDesignResponse({ design: { id: 'D', urls: { edit_url: 'https://canva.com/e' } } })
    expect(ref.viewUrl).toBeNull()
  })

  it('throws on a malformed response', () => {
    expect(() => parseCreateDesignResponse({})).toThrow()
    expect(() => parseCreateDesignResponse({ design: { id: 'D' } })).toThrow()
  })
})

describe('appendCorrelationState', () => {
  it('adds correlation_state without dropping existing query params', () => {
    const out = appendCorrelationState('https://canva.com/design/D/edit?token=abc', 'flyer:42')
    const u = new URL(out)
    expect(u.searchParams.get('token')).toBe('abc')
    expect(u.searchParams.get('correlation_state')).toBe('flyer:42')
  })

  it('is idempotent for the same state', () => {
    const once = appendCorrelationState('https://canva.com/e', 's')
    expect(appendCorrelationState(once, 's')).toBe(once)
  })
})

describe('DESIGNS_ENDPOINT', () => {
  it('targets the Connect designs endpoint', () => {
    expect(DESIGNS_ENDPOINT).toBe('https://api.canva.com/rest/v1/designs')
  })
})
