import { describe, it, expect } from 'vitest'
import {
  FLYER_TEMPLATE_SUGGESTIONS,
  getTemplateSuggestion,
  type FlyerTemplateLayout,
} from './templates'

const LAYOUTS: FlyerTemplateLayout[] = ['services', 'promo', 'beforeafter', 'contact', 'seasonal', 'hiring']

describe('FLYER_TEMPLATE_SUGGESTIONS', () => {
  it('offers a healthy gallery (≥6)', () => {
    expect(FLYER_TEMPLATE_SUGGESTIONS.length).toBeGreaterThanOrEqual(6)
  })

  it('has unique ids', () => {
    const ids = FLYER_TEMPLATE_SUGGESTIONS.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every entry is well-formed and on-brand', () => {
    for (const t of FLYER_TEMPLATE_SUGGESTIONS) {
      expect(t.name.trim().length).toBeGreaterThan(0)
      expect(t.description.trim().length).toBeGreaterThan(0)
      expect(t.category.trim().length).toBeGreaterThan(0)
      expect(LAYOUTS).toContain(t.layout)
      expect(['accent', 'teal']).toContain(t.accent)
    }
  })

  it('links only to stable Canva template URLs (no fabricated design ids)', () => {
    for (const t of FLYER_TEMPLATE_SUGGESTIONS) {
      expect(t.canvaUrl.startsWith('https://www.canva.com/templates/?query=')).toBe(true)
      // Must be a parseable URL on the canva.com host.
      const u = new URL(t.canvaUrl)
      expect(u.host).toBe('www.canva.com')
      expect(u.searchParams.get('query')?.length ?? 0).toBeGreaterThan(0)
    }
  })
})

describe('getTemplateSuggestion', () => {
  it('finds a known template and returns null otherwise', () => {
    expect(getTemplateSuggestion('services-rundown')?.name).toBe('Services Rundown')
    expect(getTemplateSuggestion('nope')).toBeNull()
  })
})
